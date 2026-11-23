import crypto from 'node:crypto';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { BoundedTtlCache, buildDeterministicCacheKey } from '../core/cache.js';
import type {
  AiExecutionLog,
  AiTaskType,
  SystemAiConfig,
  TaskModelConfig,
} from '../core/types.js';
import { isGeminiConfigured, resolveActiveGeminiApiKey } from './singleKeyService.js';
import {
  callGroqChatCompletion,
  GROQ_RESCUE_MODEL_FAST,
  GROQ_RESCUE_MODEL_STRONG,
  GROQ_VISION_MODEL,
  isGroqConfigured,
  isGroqModelId,
  isGroqVisionModelId,
  normalizeGroqModelId,
} from './groqProvider.js';
import {
  callCloudflareChatCompletion,
  CF_RESCUE_MODEL_FAST,
  CF_RESCUE_MODEL_STRONG,
  isCloudflareConfigured,
  isCloudflareModelId,
} from './cloudflareProvider.js';
import {
  DEFAULT_TASK_MODELS,
  MODEL_CATALOG,
  type ModelCatalogItem,
} from './modelDefaults.js';

export { DEFAULT_TASK_MODELS, MODEL_CATALOG, type ModelCatalogItem };

function defaultGroqRescueModelForTask(taskType: AiTaskType): string {
  switch (taskType) {
    case 'knowledge_analysis':
    case 'completeness_analysis':
    case 'quiz_generation':
    case 'quiz_blueprint':
      return GROQ_RESCUE_MODEL_STRONG;
    default:
      return GROQ_RESCUE_MODEL_FAST;
  }
}

function defaultCloudflareRescueModelForTask(taskType: AiTaskType): string {
  switch (taskType) {
    case 'knowledge_analysis':
    case 'completeness_analysis':
    case 'quiz_generation':
    case 'quiz_blueprint':
      return CF_RESCUE_MODEL_STRONG;
    default:
      return CF_RESCUE_MODEL_FAST;
  }
}

interface CachedTaskEnvelope {
  data: unknown;
  requestedModel: string;
  actualModel: string;
  usedFallback: boolean;
  usedOverride: boolean;
  systemFingerprint?: string;
  promptVersion: string;
  configVersion: number;
}

export interface RoutedAiTaskResult<T> {
  data: T;
  modelId: string;
  requestedModel: string;
  actualModel: string;
  usedFallback: boolean;
  usedOverride: boolean;
  cached: boolean;
  systemFingerprint?: string;
  promptVersion: string;
  configVersion: number;
}

// Extended 6-hour bounded cache (320 entries) tuned for small 2-3 user teams re-running documents
const aiResponseCache = new BoundedTtlCache<CachedTaskEnvelope>(320, 6 * 60 * 60 * 1000);
// Coalesce concurrent identical AI requests so simultaneous calls spend only 1 API invocation
const inFlightTasks = new Map<string, Promise<RoutedAiTaskResult<unknown>>>();
const executionLogs: AiExecutionLog[] = [];

export function clearAiResponseCache(): void {
  aiResponseCache.clear();
  inFlightTasks.clear();
}

export function getRecentExecutionLogs(): AiExecutionLog[] {
  return [...executionLogs];
}

function appendExecutionLog(log: AiExecutionLog): void {
  executionLogs.unshift(log);
  if (executionLogs.length > 120) {
    executionLogs.length = 120;
  }
}

export const GEMINI_TIMEOUT_MS = 45_000;

export async function callWithTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs = GEMINI_TIMEOUT_MS
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error(`Yêu cầu AI vượt quá thời gian chờ (${Math.round(timeoutMs / 1000)} giây).`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function isTransientProviderError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('vượt quá thời gian chờ')) {
    return false;
  }
  return (
    msg.includes('429') ||
    msg.includes('503') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('UNAVAILABLE') ||
    msg.includes('ECONNRESET')
  );
}

export async function withExponentialBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 2
): Promise<T> {
  let attempt = 0;
  let lastDelayMs = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt += 1;
      if (attempt > maxRetries || !isTransientProviderError(err)) {
        throw err;
      }
      const baseDelay = attempt === 1 ? 1000 : 2500;
      const jitter = Math.floor(Math.random() * 200);
      const delayMs = Math.max(lastDelayMs + 500, baseDelay + jitter);
      lastDelayMs = delayMs;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

export function thinkingConfigForModel(
  modelId: string,
  tier: 'minimal' | 'low' | 'medium'
): { thinkingLevel: ThinkingLevel } | undefined {
  const lower = modelId.toLowerCase();
  // Only Gemini 3 and Gemini 4 families support thinkingLevel; passing thinkingLevel to gemini-2.5-* causes HTTP 400.
  if (!lower.includes('gemini-3') && !lower.includes('gemini-4')) {
    return undefined;
  }
  const isLite = lower.includes('flash-lite');
  if (tier === 'minimal') {
    // Gemini 3.1 Flash Lite supports MINIMAL; Gemini 4 models require at least LOW (MINIMAL returns 400).
    return { thinkingLevel: isLite ? ThinkingLevel.MINIMAL : ThinkingLevel.LOW };
  }
  if (tier === 'low') {
    return { thinkingLevel: ThinkingLevel.LOW };
  }
  return { thinkingLevel: ThinkingLevel.MEDIUM };
}

let cachedAiClient: { apiKey: string; client: GoogleGenAI } | null = null;
const workingGeminiModelPerKey = new Map<string, string>();

export const GEMINI_FALLBACK_CANDIDATES = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-3.1-flash-lite-preview',
  'gemini-3-flash-preview',
  'gemini-2.0-flash',
  'gemini-2.5-pro',
  'gemini-3.1-flash-lite',
  'gemini-4-hydrogen',
] as const;

export function sanitizeGeminiModelId(modelId: string): string {
  const trimmed = (modelId || '').trim();
  if (!trimmed || isGroqModelId(trimmed) || isCloudflareModelId(trimmed)) {
    return 'gemini-2.5-flash';
  }
  return trimmed.startsWith('models/') ? trimmed.slice('models/'.length) : trimmed;
}

async function fetchPublicGeminiGenerateModels(apiKey: string, signal?: AbortSignal): Promise<string[]> {
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, { method: 'GET', signal });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>;
    };
    return (data.models || [])
      .filter(
        (m) =>
          m &&
          typeof m.name === 'string' &&
          Array.isArray(m.supportedGenerationMethods) &&
          m.supportedGenerationMethods.includes('generateContent')
      )
      .map((m) => m.name!.replace(/^models\//, '').trim())
      .filter(
        (name) =>
          name.startsWith('gemini-') &&
          !name.includes('embedding') &&
          !name.includes('tts') &&
          !name.includes('imagen') &&
          !name.includes('aqa')
      );
  } catch {
    return [];
  }
}

function isGemini4ModelId(modelId: string): boolean {
  return /gemini-4/i.test(modelId || '');
}

/**
 * Calls `ai.models.generateContent` with automatic model discovery & fallback when an external or sandbox
 * Gemini API key returns 404 NOT_FOUND or 400 INVALID_ARGUMENT on an internal model alias or schema config.
 * When `strictModelLock: true`, strictly runs the requested model without silently swapping to another model.
 */
export async function generateGeminiContentWithFallback(params: {
  ai?: GoogleGenAI;
  apiKeyOverride?: string;
  model: string;
  contents: unknown;
  config?: Record<string, unknown>;
  thinkingTier?: 'minimal' | 'low' | 'medium';
  temperature?: number;
  seed?: number;
  strictModelLock?: boolean;
}): Promise<{
  text: string;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
  resolvedModel: string;
  systemFingerprint?: string;
}> {
  const apiKey = (params.apiKeyOverride || '').trim() || (await resolveActiveGeminiApiKey());
  const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex').slice(0, 16);
  const ai =
    params.ai ||
    new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

  const requestedModel = sanitizeGeminiModelId(params.model);
  const cachedWorking = params.strictModelLock ? undefined : workingGeminiModelPerKey.get(keyHash);
  const candidates: string[] = [];
  if (params.strictModelLock) {
    candidates.push(requestedModel);
  } else {
    // Prioritize cachedWorking first if known for this key, then requestedModel, then public v1beta fallback candidates
    for (const m of [cachedWorking, requestedModel, ...GEMINI_FALLBACK_CANDIDATES]) {
      if (m && !candidates.includes(m)) {
        candidates.push(m);
      }
    }
  }

  let lastErr: unknown = null;
  const tried = new Set<string>();
  const triedList: string[] = [];
  const wantsJson = params.config?.responseMimeType === 'application/json';

  const normalizeOutputText = (rawText: string): string => {
    if (!wantsJson) return rawText || '';
    const trimmed = (rawText || '').trim();
    if (!trimmed) return '';
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenced && fenced[1]) {
      const inner = fenced[1].trim();
      const fb = inner.indexOf('{');
      const lb = inner.lastIndexOf('}');
      return fb >= 0 && lb > fb ? inner.slice(fb, lb + 1) : inner;
    }
    const fb = trimmed.indexOf('{');
    const lb = trimmed.lastIndexOf('}');
    if (fb >= 0 && lb > fb) {
      return trimmed.slice(fb, lb + 1);
    }
    return trimmed;
  };

  const tryCandidate = async (candidateModel: string) => {
    tried.add(candidateModel);
    triedList.push(candidateModel);
    const baseConfig = { ...(params.config || {}) };
    delete baseConfig.thinkingConfig;

    // Gemini 4 models strictly reject deprecated sampling parameters (temperature, topP, topK, candidateCount) with HTTP 400.
    if (isGemini4ModelId(candidateModel)) {
      delete baseConfig.temperature;
      delete baseConfig.topP;
      delete baseConfig.topK;
      delete baseConfig.candidateCount;
    } else if (typeof params.temperature === 'number' && Number.isFinite(params.temperature)) {
      baseConfig.temperature = Math.max(0, Math.min(2, params.temperature));
    }

    if (typeof params.seed === 'number' && Number.isFinite(params.seed)) {
      baseConfig.seed = Math.floor(params.seed);
    }

    const tc = params.thinkingTier ? thinkingConfigForModel(candidateModel, params.thinkingTier) : undefined;
    if (tc) {
      baseConfig.thinkingConfig = tc;
    }

    try {
      const resp = await ai.models.generateContent({
        model: candidateModel,
        contents: params.contents as never,
        config: baseConfig as never,
      });
      if (!params.strictModelLock) {
        workingGeminiModelPerKey.set(keyHash, candidateModel);
      }
      return {
        text: normalizeOutputText(resp.text || ''),
        usageMetadata: resp.usageMetadata,
        resolvedModel: candidateModel,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const is400OrParamErr =
        msg.includes('400') ||
        msg.includes('INVALID_ARGUMENT') ||
        msg.includes('thinking') ||
        msg.includes('Thinking') ||
        msg.includes('seed') ||
        msg.includes('response_schema') ||
        msg.includes('responseSchema');

      // Progressive fallback 0: retry without seed if this Gemini model rejects `seed`
      if (baseConfig.seed !== undefined && is400OrParamErr && msg.toLowerCase().includes('seed')) {
        delete baseConfig.seed;
        try {
          const retrySeedResp = await ai.models.generateContent({
            model: candidateModel,
            contents: params.contents as never,
            config: baseConfig as never,
          });
          if (!params.strictModelLock) {
            workingGeminiModelPerKey.set(keyHash, candidateModel);
          }
          return {
            text: normalizeOutputText(retrySeedResp.text || ''),
            usageMetadata: retrySeedResp.usageMetadata,
            resolvedModel: candidateModel,
          };
        } catch {
          // Continue to progressive fallback 1/2
        }
      }

      // Progressive fallback 1: retry without thinkingConfig
      if (tc && is400OrParamErr) {
        delete baseConfig.thinkingConfig;
        try {
          const retryResp = await ai.models.generateContent({
            model: candidateModel,
            contents: params.contents as never,
            config: baseConfig as never,
          });
          if (!params.strictModelLock) {
            workingGeminiModelPerKey.set(keyHash, candidateModel);
          }
          return {
            text: normalizeOutputText(retryResp.text || ''),
            usageMetadata: retryResp.usageMetadata,
            resolvedModel: candidateModel,
          };
        } catch (err2) {
          // Proceed to Progressive fallback 2 if responseSchema was present
          const msg2 = err2 instanceof Error ? err2.message : String(err2);
          if (!baseConfig.responseSchema || (!msg2.includes('400') && !msg2.includes('INVALID_ARGUMENT'))) {
            throw err2;
          }
        }
      }

      // Progressive fallback 2: retry without responseSchema (keeping responseMimeType: 'application/json')
      if (baseConfig.responseSchema && is400OrParamErr) {
        const schemaLessConfig = { ...baseConfig };
        delete schemaLessConfig.thinkingConfig;
        delete schemaLessConfig.responseSchema;
        const retryResp2 = await ai.models.generateContent({
          model: candidateModel,
          contents: params.contents as never,
          config: schemaLessConfig as never,
        });
        if (!params.strictModelLock) {
          workingGeminiModelPerKey.set(keyHash, candidateModel);
        }
        return {
          text: normalizeOutputText(retryResp2.text || ''),
          usageMetadata: retryResp2.usageMetadata,
          resolvedModel: candidateModel,
        };
      }

      throw err;
    }
  };

  const signal = params.config?.abortSignal as AbortSignal | undefined;
  let sawNotFound = false;

  for (const candidate of candidates) {
    if (signal?.aborted) {
      throw lastErr || new Error('Yêu cầu AI vượt quá thời gian chờ.');
    }
    try {
      return await tryCandidate(candidate);
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (signal?.aborted || msg.includes('AbortError') || msg.includes('aborted')) {
        throw err;
      }
      if (msg.includes('404') || msg.includes('NOT_FOUND') || msg.includes('not found')) {
        sawNotFound = true;
      }
      // Only abort immediately if the API key itself is invalid or disabled
      const isFatalKeyError =
        msg.includes('API_KEY_INVALID') ||
        msg.includes('API key not valid') ||
        msg.includes('SERVICE_DISABLED') ||
        msg.includes('API has not been used');
      if (isFatalKeyError || params.strictModelLock) {
        throw err;
      }
    }
  }

  // Last resort: query public /v1beta/models for this key and try available flash/pro models (disabled when strictModelLock)
  if (!signal?.aborted && !params.strictModelLock) {
    const discovered = await fetchPublicGeminiGenerateModels(apiKey, signal);
    for (const disc of discovered) {
      if (signal?.aborted) break;
      if (tried.has(disc)) continue;
      try {
        return await tryCandidate(disc);
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('404') || msg.includes('NOT_FOUND') || msg.includes('not found')) {
          sawNotFound = true;
        }
      }
    }
  }

  if (!sawNotFound && lastErr) {
    throw lastErr;
  }

  const lastMsg = lastErr instanceof Error ? lastErr.message : String(lastErr || '');
  throw new Error(
    `NOT_FOUND (Gemini): Đã thử các model [${triedList.join(', ')}] nhưng đều không khả dụng cho khóa hiện tại. Chi tiết: ${lastMsg.slice(0, 220)}`
  );
}

export async function createServerAiClient(): Promise<GoogleGenAI> {
  const apiKey = await resolveActiveGeminiApiKey();
  if (cachedAiClient && cachedAiClient.apiKey === apiKey) {
    return cachedAiClient.client;
  }
  const client = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
  cachedAiClient = { apiKey, client };
  return client;
}

export interface ResolvedModelDecision {
  taskType: AiTaskType;
  modelId: string;
  fallbackModelId: string;
  enableFallback: boolean;
  usedOverride: boolean;
  promptVersion: string;
  configVersion: number;
}

export function isModelProviderConfigured(modelId: string): boolean {
  if (isGroqModelId(modelId)) return isGroqConfigured();
  if (isCloudflareModelId(modelId)) return isCloudflareConfigured();
  return isGeminiConfigured();
}

function pickConfiguredProviderModel(
  taskType: AiTaskType,
  preferredModel: string,
  activeModel: string,
  excludeModel?: string
): string {
  if (isModelProviderConfigured(preferredModel) && preferredModel !== excludeModel) {
    return preferredModel;
  }
  if (isModelProviderConfigured(activeModel) && activeModel !== excludeModel) {
    return activeModel;
  }
  if (isGroqConfigured()) {
    const groqPrimary = defaultGroqRescueModelForTask(taskType);
    if (groqPrimary !== excludeModel) return groqPrimary;
    return groqPrimary === GROQ_RESCUE_MODEL_STRONG
      ? GROQ_RESCUE_MODEL_FAST
      : GROQ_VISION_MODEL;
  }
  if (isGeminiConfigured()) {
    const geminiPrimary = 'gemini-2.5-flash';
    if (geminiPrimary !== excludeModel) return geminiPrimary;
    return 'gemini-3.1-flash-lite-preview';
  }
  if (isCloudflareConfigured()) {
    const cfPrimary = defaultCloudflareRescueModelForTask(taskType);
    if (cfPrimary !== excludeModel) return cfPrimary;
    return cfPrimary === CF_RESCUE_MODEL_STRONG ? CF_RESCUE_MODEL_FAST : CF_RESCUE_MODEL_STRONG;
  }
  return preferredModel;
}

export function resolveModelForTask(
  taskType: AiTaskType,
  config: SystemAiConfig,
  consumeOverride?: () => void
): ResolvedModelDecision {
  const taskCfg = config.taskModels?.[taskType] || DEFAULT_TASK_MODELS[taskType];
  const activeFallbackDefault = (config.activeModel || 'groq:openai/gpt-oss-120b').trim();

  let modelId = (taskCfg.defaultModel || activeFallbackDefault).trim();
  let usedOverride = false;

  if (taskCfg.oneTimeOverrideModel && taskCfg.oneTimeOverrideModel.trim()) {
    modelId = taskCfg.oneTimeOverrideModel.trim();
    usedOverride = true;
    consumeOverride?.();
  }

  let fallbackModelId = (
    taskCfg.fallbackModel || GROQ_VISION_MODEL
  ).trim();

  // Bidirectionally route to whichever provider key (Groq / Gemini / Cloudflare) is actually configured
  if (!isModelProviderConfigured(modelId)) {
    modelId = pickConfiguredProviderModel(taskType, modelId, activeFallbackDefault);
  }

  if (!isModelProviderConfigured(fallbackModelId) || fallbackModelId === modelId) {
    fallbackModelId = pickConfiguredProviderModel(taskType, fallbackModelId, activeFallbackDefault, modelId);
  }

  return {
    taskType,
    modelId,
    fallbackModelId,
    enableFallback: taskCfg.enableFallback !== false,
    usedOverride,
    promptVersion: taskCfg.promptVersion || 'v3.2',
    configVersion: config.configVersion || 1,
  };
}

export async function executeRoutedAiTask<T>(params: {
  taskType: AiTaskType;
  config: SystemAiConfig;
  consumeOneTimeOverride?: (task: AiTaskType) => Promise<void>;
  cacheInput?: Record<string, unknown>;
  bypassCache?: boolean;
  allowGroqRescue?: boolean;
  groqRescueModelId?: string;
  strictModelLock?: boolean;
  extractExecutionMeta?: (data: T) => { actualModel?: string; systemFingerprint?: string };
  runWithModel: (modelId: string) => Promise<T>;
}): Promise<RoutedAiTaskResult<T>> {
  const {
    taskType,
    config,
    consumeOneTimeOverride,
    cacheInput,
    bypassCache,
    allowGroqRescue = true,
    groqRescueModelId,
    strictModelLock = false,
    extractExecutionMeta,
    runWithModel,
  } = params;

  let overrideConsumed = false;
  const decision = resolveModelForTask(taskType, config, () => {
    overrideConsumed = true;
  });

  const requestedModel = decision.modelId;
  const cacheKey =
    cacheInput && !bypassCache
      ? buildDeterministicCacheKey({
          taskType,
          modelId: requestedModel,
          strictModelLock,
          promptVersion: decision.promptVersion,
          configVersion: decision.configVersion,
          ...cacheInput,
        })
      : null;

  if (cacheKey) {
    const hit = aiResponseCache.get(cacheKey);
    if (hit !== undefined) {
      appendExecutionLog({
        executionId: `exec_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
        taskType,
        modelId: hit.actualModel,
        requestedModel: hit.requestedModel,
        actualModel: hit.actualModel,
        ...(hit.systemFingerprint ? { systemFingerprint: hit.systemFingerprint } : {}),
        usedFallback: hit.usedFallback,
        usedOverride: hit.usedOverride,
        promptVersion: hit.promptVersion,
        configVersion: hit.configVersion,
        status: 'success',
        durationMs: 0,
        cached: true,
        timestamp: new Date().toISOString(),
      });
      return {
        data: hit.data as T,
        modelId: hit.actualModel,
        requestedModel: hit.requestedModel,
        actualModel: hit.actualModel,
        usedFallback: hit.usedFallback,
        usedOverride: hit.usedOverride,
        cached: true,
        ...(hit.systemFingerprint ? { systemFingerprint: hit.systemFingerprint } : {}),
        promptVersion: hit.promptVersion,
        configVersion: hit.configVersion,
      };
    }

    const pending = inFlightTasks.get(cacheKey);
    if (pending) {
      const shared = await pending;
      return {
        data: shared.data as T,
        modelId: shared.actualModel,
        requestedModel: shared.requestedModel,
        actualModel: shared.actualModel,
        usedFallback: shared.usedFallback,
        usedOverride: shared.usedOverride,
        cached: true,
        ...(shared.systemFingerprint ? { systemFingerprint: shared.systemFingerprint } : {}),
        promptVersion: shared.promptVersion,
        configVersion: shared.configVersion,
      };
    }
  }

  const canFallback =
    !strictModelLock &&
    decision.enableFallback &&
    Boolean(decision.fallbackModelId) &&
    decision.fallbackModelId !== requestedModel &&
    isModelProviderConfigured(decision.fallbackModelId);

  const primaryUnconfigured = !isModelProviderConfigured(requestedModel);

  const finalizeSuccess = (
    result: T,
    executedModel: string,
    usedFallback: boolean,
    startMs: number
  ): RoutedAiTaskResult<T> => {
    const meta = extractExecutionMeta?.(result);
    const actualModel = (meta?.actualModel || executedModel).trim();
    const systemFingerprint = meta?.systemFingerprint;
    const effectiveFallback = usedFallback || actualModel !== requestedModel;

    if (cacheKey) {
      aiResponseCache.set(cacheKey, {
        data: result,
        requestedModel,
        actualModel,
        usedFallback: effectiveFallback,
        usedOverride: decision.usedOverride,
        ...(systemFingerprint ? { systemFingerprint } : {}),
        promptVersion: decision.promptVersion,
        configVersion: decision.configVersion,
      });
    }
    appendExecutionLog({
      executionId: `exec_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
      taskType,
      modelId: actualModel,
      requestedModel,
      actualModel,
      ...(systemFingerprint ? { systemFingerprint } : {}),
      usedFallback: effectiveFallback,
      usedOverride: decision.usedOverride,
      promptVersion: decision.promptVersion,
      configVersion: decision.configVersion,
      status: 'success',
      durationMs: Date.now() - startMs,
      cached: false,
      timestamp: new Date().toISOString(),
    });
    return {
      data: result,
      modelId: actualModel,
      requestedModel,
      actualModel,
      usedFallback: effectiveFallback,
      usedOverride: decision.usedOverride,
      cached: false,
      ...(systemFingerprint ? { systemFingerprint } : {}),
      promptVersion: decision.promptVersion,
      configVersion: decision.configVersion,
    };
  };

  const executeTask = async (): Promise<RoutedAiTaskResult<T>> => {
    const start = Date.now();
    try {
      if (primaryUnconfigured) {
        throw new Error(
          isGroqModelId(requestedModel)
            ? 'GROQ_API_KEY_UNCONFIGURED'
            : isCloudflareModelId(requestedModel)
              ? 'CLOUDFLARE_CREDENTIALS_UNCONFIGURED'
              : 'GEMINI_API_KEY_UNCONFIGURED'
        );
      }
      // When fallback is active, retry primary 0 times so 429/503 transitions immediately to fallback within Vercel's 60s budget
      const primaryRetries = canFallback ? 0 : 1;
      const result = await withExponentialBackoff(() => runWithModel(requestedModel), primaryRetries);
      if (overrideConsumed && consumeOneTimeOverride) {
        await consumeOneTimeOverride(taskType);
      }
      return finalizeSuccess(result, requestedModel, false, start);
    } catch (primaryErr) {
      let lastErr: unknown = primaryErr;

      if (strictModelLock) {
        const reason =
          primaryErr instanceof Error ? primaryErr.message.slice(0, 220) : String(primaryErr).slice(0, 220);
        appendExecutionLog({
          executionId: `exec_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
          taskType,
          modelId: requestedModel,
          requestedModel,
          actualModel: requestedModel,
          usedFallback: false,
          usedOverride: decision.usedOverride,
          promptVersion: decision.promptVersion,
          configVersion: decision.configVersion,
          status: 'failed',
          error: `STRICT_LOCK: ${reason}`.slice(0, 180),
          durationMs: Date.now() - start,
          timestamp: new Date().toISOString(),
        });
        // Preserve specific JSON validation or key missing error codes while signaling strict model lock
        if (
          reason.includes('GRADING_JSON_INVALID') ||
          reason.includes('GROQ_API_KEY_UNCONFIGURED') ||
          reason.includes('GEMINI_API_KEY_UNCONFIGURED') ||
          reason.includes('CLOUDFLARE_CREDENTIALS_UNCONFIGURED')
        ) {
          throw primaryErr;
        }
        throw new Error(
          `STRICT_GRADING_MODEL_UNAVAILABLE: Model chấm điểm cố định (${requestedModel}) tạm thời không phản hồi và hệ thống đã khóa chuyển đổi chéo model để bảo vệ tính nhất quán điểm số. Chi tiết: ${reason}`
        );
      }

      if (canFallback) {
        try {
          const fbResult = await withExponentialBackoff(() => runWithModel(decision.fallbackModelId), 1);
          if (overrideConsumed && consumeOneTimeOverride) {
            await consumeOneTimeOverride(taskType);
          }
          return finalizeSuccess(fbResult, decision.fallbackModelId, true, start);
        } catch (fbErr) {
          lastErr = fbErr;
        }
      }

      // Cross-provider rescue hop 1 (Groq Cloud Free): if primary + fallback failed on a text task and GROQ_API_KEY is configured
      const rescueModel = groqRescueModelId || defaultGroqRescueModelForTask(taskType);
      const canGroqRescue =
        allowGroqRescue &&
        isGroqConfigured() &&
        !isGroqModelId(requestedModel) &&
        !(canFallback && isGroqModelId(decision.fallbackModelId));

      if (canGroqRescue) {
        try {
          const rescueResult = await withExponentialBackoff(() => runWithModel(rescueModel), 1);
          return finalizeSuccess(rescueResult, rescueModel, true, start);
        } catch (rescueErr) {
          lastErr = rescueErr;
        }
      }

      // Cross-provider rescue hop 2 (Cloudflare Workers AI Free): if primary + fallback (+ Groq) failed and Cloudflare is configured
      const cfRescueModel = defaultCloudflareRescueModelForTask(taskType);
      const canCloudflareRescue =
        allowGroqRescue &&
        isCloudflareConfigured() &&
        !isCloudflareModelId(requestedModel) &&
        !(canFallback && isCloudflareModelId(decision.fallbackModelId));

      if (canCloudflareRescue) {
        try {
          const cfResult = await withExponentialBackoff(() => runWithModel(cfRescueModel), 1);
          return finalizeSuccess(cfResult, cfRescueModel, true, start);
        } catch (cfErr) {
          lastErr = cfErr;
        }
      }

      // Cross-provider rescue hop 3 (Gemini): if Groq/Cloudflare failed and Gemini API Key is configured
      const isPrimaryGemini = !isGroqModelId(requestedModel) && !isCloudflareModelId(requestedModel);
      const isFallbackGemini =
        canFallback && !isGroqModelId(decision.fallbackModelId) && !isCloudflareModelId(decision.fallbackModelId);
      const canGeminiRescue = isGeminiConfigured() && !isPrimaryGemini && !isFallbackGemini;

      if (canGeminiRescue) {
        const geminiRescueModel = 'gemini-2.5-flash';
        try {
          const gemResult = await withExponentialBackoff(() => runWithModel(geminiRescueModel), 1);
          return finalizeSuccess(gemResult, geminiRescueModel, true, start);
        } catch (gemErr) {
          lastErr = gemErr;
        }
      }

      appendExecutionLog({
        executionId: `exec_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
        taskType,
        modelId: canFallback ? decision.fallbackModelId : requestedModel,
        requestedModel,
        actualModel: canFallback ? decision.fallbackModelId : requestedModel,
        usedFallback: canFallback,
        usedOverride: decision.usedOverride,
        promptVersion: decision.promptVersion,
        configVersion: decision.configVersion,
        status: 'failed',
        error:
          lastErr instanceof Error ? lastErr.message.slice(0, 180) : String(lastErr).slice(0, 180),
        durationMs: Date.now() - start,
        timestamp: new Date().toISOString(),
      });
      throw lastErr;
    }
  };

  if (!cacheKey) {
    return executeTask();
  }

  const taskPromise = executeTask().finally(() => {
    inFlightTasks.delete(cacheKey);
  });
  inFlightTasks.set(cacheKey, taskPromise as Promise<RoutedAiTaskResult<unknown>>);
  return taskPromise;
}

export async function testModelConnectivity(modelId: string): Promise<{
  ok: boolean;
  modelId: string;
  latencyMs: number;
  message: string;
}> {
  const start = Date.now();
  try {
    if (isGroqModelId(modelId)) {
      const normalizedTarget = normalizeGroqModelId(modelId);
      if (!isGroqConfigured()) {
        return {
          ok: false,
          modelId: normalizedTarget,
          latencyMs: Date.now() - start,
          message:
            'Chưa cấu hình Groq API Key. Super Admin có thể thêm trực tiếp tại tab "API Key & Bảo mật" trong web (không cần sửa biến môi trường Vercel).',
        };
      }
      const resp = await callWithTimeout(
        (signal) =>
          callGroqChatCompletion({
            modelId: normalizedTarget,
            prompt: 'Trả lời duy nhất 1 từ: OK',
            maxOutputTokens: 256,
            signal,
          }),
        15_000
      );
      const text = (resp.text || '').trim();
      const effectiveModel = resp.resolvedModel || normalizedTarget;
      const resolvedLabel =
        effectiveModel !== modelId ? `${modelId} → tự động chạy bằng ${effectiveModel}` : modelId;
      const visionHint = isGroqVisionModelId(effectiveModel)
        ? ' (hỗ trợ trực tiếp OCR ảnh)'
        : ` (văn bản OK; tác vụ OCR ảnh sẽ dùng ${GROQ_VISION_MODEL})`;
      return {
        ok: Boolean(text),
        modelId: effectiveModel,
        latencyMs: Date.now() - start,
        message: text
          ? `Model ${resolvedLabel} (Groq Cloud Free) hoạt động bình thường (${Date.now() - start}ms)${visionHint}.`
          : `Model ${modelId} trả về nội dung rỗng.`,
      };
    }

    if (isCloudflareModelId(modelId)) {
      if (!isCloudflareConfigured()) {
        return {
          ok: false,
          modelId,
          latencyMs: Date.now() - start,
          message:
            'Chưa cấu hình Cloudflare Account ID & API Token. Super Admin có thể thêm trực tiếp tại tab "API Key & Bảo mật" trong web (không cần sửa biến môi trường Vercel).',
        };
      }
      const resp = await callWithTimeout(
        (signal) =>
          callCloudflareChatCompletion({
            modelId,
            prompt: 'Trả lời duy nhất 1 từ: OK',
            maxOutputTokens: 128,
            signal,
          }),
        15_000
      );
      const text = (resp.text || '').trim();
      const resolvedLabel =
        resp.resolvedModel && resp.resolvedModel !== modelId
          ? `${modelId} → tự động chạy bằng ${resp.resolvedModel}`
          : modelId;
      return {
        ok: Boolean(text),
        modelId: resp.resolvedModel || modelId,
        latencyMs: Date.now() - start,
        message: text
          ? `Model ${resolvedLabel} (Cloudflare Workers AI Free) hoạt động bình thường (${Date.now() - start}ms).`
          : `Model ${modelId} trả về nội dung rỗng.`,
      };
    }

    const ai = await createServerAiClient();
    const resp = await callWithTimeout((signal) =>
      generateGeminiContentWithFallback({
        ai,
        model: modelId,
        contents: 'Trả lời 1 từ: OK',
        thinkingTier: 'minimal',
        config: {
          maxOutputTokens: 128,
          abortSignal: signal,
        },
      })
    );
    const text = (resp.text || '').trim();
    const resolvedLabel =
      resp.resolvedModel && resp.resolvedModel !== modelId
        ? `${modelId} → tự động chạy bằng ${resp.resolvedModel}`
        : modelId;
    return {
      ok: Boolean(text),
      modelId: resp.resolvedModel || modelId,
      latencyMs: Date.now() - start,
      message: text
        ? `Model ${resolvedLabel} hoạt động bình thường (${Date.now() - start}ms).`
        : `Model ${modelId} trả về nội dung rỗng.`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      modelId,
      latencyMs: Date.now() - start,
      message: `Lỗi kết nối model ${modelId}: ${msg.slice(0, 220)}`,
    };
  }
}
