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
  isGroqConfigured,
  isGroqModelId,
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

// Extended 6-hour bounded cache (320 entries) tuned for small 2-3 user teams re-running documents
const aiResponseCache = new BoundedTtlCache<unknown>(320, 6 * 60 * 60 * 1000);
// Coalesce concurrent identical AI requests so simultaneous calls spend only 1 API invocation
const inFlightTasks = new Map<
  string,
  Promise<{ data: unknown; modelId: string; usedFallback: boolean; usedOverride: boolean; cached: boolean }>
>();
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
  'gemini-3.1-flash-lite',
  'gemini-4-hydrogen',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-3.1-flash-lite-preview',
  'gemini-3-flash-preview',
] as const;

export function sanitizeGeminiModelId(modelId: string): string {
  const trimmed = (modelId || '').trim();
  if (!trimmed || isGroqModelId(trimmed) || isCloudflareModelId(trimmed)) {
    return 'gemini-3.1-flash-lite';
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
      .filter((name) => name.startsWith('gemini-') && !name.includes('embedding') && !name.includes('tts') && !name.includes('imagen'));
  } catch {
    return [];
  }
}

/**
 * Calls `ai.models.generateContent` with automatic model discovery & fallback when an external or sandbox
 * Gemini API key returns 404 NOT_FOUND on an internal model alias (e.g. `gemini-4-hydrogen` or `gemini-3.1-flash-lite`).
 */
export async function generateGeminiContentWithFallback(params: {
  ai?: GoogleGenAI;
  apiKeyOverride?: string;
  model: string;
  contents: unknown;
  config?: Record<string, unknown>;
  thinkingTier?: 'minimal' | 'low' | 'medium';
}): Promise<{ text: string; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number }; resolvedModel: string }> {
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
  const cachedWorking = workingGeminiModelPerKey.get(keyHash);
  const candidates: string[] = [];
  for (const m of [requestedModel, cachedWorking, ...GEMINI_FALLBACK_CANDIDATES]) {
    if (m && !candidates.includes(m)) {
      candidates.push(m);
    }
  }

  let lastErr: unknown = null;
  const tried = new Set<string>();

  const tryCandidate = async (candidateModel: string) => {
    tried.add(candidateModel);
    const baseConfig = { ...(params.config || {}) };
    delete baseConfig.thinkingConfig;
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
      workingGeminiModelPerKey.set(keyHash, candidateModel);
      return {
        text: resp.text || '',
        usageMetadata: resp.usageMetadata,
        resolvedModel: candidateModel,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // If thinkingConfig caused a 400 error on a preview/flash model, retry once without thinkingConfig
      if (tc && (msg.includes('thinking') || msg.includes('Thinking') || msg.includes('INVALID_ARGUMENT'))) {
        delete baseConfig.thinkingConfig;
        const retryResp = await ai.models.generateContent({
          model: candidateModel,
          contents: params.contents as never,
          config: baseConfig as never,
        });
        workingGeminiModelPerKey.set(keyHash, candidateModel);
        return {
          text: retryResp.text || '',
          usageMetadata: retryResp.usageMetadata,
          resolvedModel: candidateModel,
        };
      }
      throw err;
    }
  };

  for (const candidate of candidates) {
    try {
      return await tryCandidate(candidate);
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isModelNotFoundOrUnsupported =
        msg.includes('NOT_FOUND') ||
        msg.includes('404') ||
        msg.includes('not found') ||
        msg.includes('is not supported for generateContent');
      if (!isModelNotFoundOrUnsupported) {
        throw err;
      }
    }
  }

  // Last resort: query public /v1beta/models for this key and try the first available flash/pro model
  const signal = params.config?.abortSignal as AbortSignal | undefined;
  const discovered = await fetchPublicGeminiGenerateModels(apiKey, signal);
  for (const disc of discovered) {
    if (tried.has(disc)) continue;
    try {
      return await tryCandidate(disc);
    } catch (err) {
      lastErr = err;
    }
  }

  throw lastErr || new Error(`NOT_FOUND: Không tìm thấy model Gemini khả dụng cho khóa hiện tại.`);
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
    return groqPrimary === GROQ_RESCUE_MODEL_STRONG ? GROQ_RESCUE_MODEL_FAST : 'groq:meta-llama/llama-4-scout-17b-16e-instruct';
  }
  if (isGeminiConfigured()) {
    const geminiPrimary = 'gemini-3.1-flash-lite';
    if (geminiPrimary !== excludeModel) return geminiPrimary;
    return 'gemini-4-hydrogen';
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
    taskCfg.fallbackModel || 'groq:meta-llama/llama-4-scout-17b-16e-instruct'
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
    enableFallback: Boolean(taskCfg.enableFallback),
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
  runWithModel: (modelId: string) => Promise<T>;
}): Promise<{ data: T; modelId: string; usedFallback: boolean; usedOverride: boolean; cached: boolean }> {
  const {
    taskType,
    config,
    consumeOneTimeOverride,
    cacheInput,
    bypassCache,
    allowGroqRescue = false,
    groqRescueModelId,
    runWithModel,
  } = params;

  let overrideConsumed = false;
  const decision = resolveModelForTask(taskType, config, () => {
    overrideConsumed = true;
  });

  const cacheKey =
    cacheInput && !bypassCache
      ? buildDeterministicCacheKey({
          taskType,
          modelId: decision.modelId,
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
        modelId: decision.modelId,
        usedFallback: false,
        usedOverride: decision.usedOverride,
        promptVersion: decision.promptVersion,
        configVersion: decision.configVersion,
        status: 'success',
        durationMs: 0,
        cached: true,
        timestamp: new Date().toISOString(),
      });
      return {
        data: hit as T,
        modelId: decision.modelId,
        usedFallback: false,
        usedOverride: decision.usedOverride,
        cached: true,
      };
    }

    const pending = inFlightTasks.get(cacheKey);
    if (pending) {
      const shared = await pending;
      return {
        data: shared.data as T,
        modelId: shared.modelId,
        usedFallback: shared.usedFallback,
        usedOverride: shared.usedOverride,
        cached: true,
      };
    }
  }

  const canFallback =
    decision.enableFallback &&
    Boolean(decision.fallbackModelId) &&
    decision.fallbackModelId !== decision.modelId &&
    isModelProviderConfigured(decision.fallbackModelId);

  const primaryUnconfigured = !isModelProviderConfigured(decision.modelId);

  const executeTask = async (): Promise<{
    data: T;
    modelId: string;
    usedFallback: boolean;
    usedOverride: boolean;
    cached: boolean;
  }> => {
    const start = Date.now();
    try {
      if (primaryUnconfigured && canFallback) {
        throw new Error(
          isGroqModelId(decision.modelId)
            ? 'GROQ_API_KEY_UNCONFIGURED'
            : isCloudflareModelId(decision.modelId)
              ? 'CLOUDFLARE_CREDENTIALS_UNCONFIGURED'
              : 'GEMINI_API_KEY_UNCONFIGURED'
        );
      }
      // When fallback is active, retry primary 0 times so 429/503 transitions immediately to fallback within Vercel's 60s budget
      const primaryRetries = canFallback ? 0 : 1;
      const result = await withExponentialBackoff(() => runWithModel(decision.modelId), primaryRetries);
      if (overrideConsumed && consumeOneTimeOverride) {
        await consumeOneTimeOverride(taskType);
      }
      if (cacheKey) {
        aiResponseCache.set(cacheKey, result);
      }
      appendExecutionLog({
        executionId: `exec_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
        taskType,
        modelId: decision.modelId,
        usedFallback: false,
        usedOverride: decision.usedOverride,
        promptVersion: decision.promptVersion,
        configVersion: decision.configVersion,
        status: 'success',
        durationMs: Date.now() - start,
        cached: false,
        timestamp: new Date().toISOString(),
      });
      return {
        data: result,
        modelId: decision.modelId,
        usedFallback: false,
        usedOverride: decision.usedOverride,
        cached: false,
      };
    } catch (primaryErr) {
      let lastErr: unknown = primaryErr;

      if (canFallback) {
        try {
          const fbResult = await withExponentialBackoff(() => runWithModel(decision.fallbackModelId), 1);
          if (overrideConsumed && consumeOneTimeOverride) {
            await consumeOneTimeOverride(taskType);
          }
          if (cacheKey) {
            aiResponseCache.set(cacheKey, fbResult);
          }
          appendExecutionLog({
            executionId: `exec_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
            taskType,
            modelId: decision.fallbackModelId,
            usedFallback: true,
            usedOverride: decision.usedOverride,
            promptVersion: decision.promptVersion,
            configVersion: decision.configVersion,
            status: 'success',
            durationMs: Date.now() - start,
            cached: false,
            timestamp: new Date().toISOString(),
          });
          return {
            data: fbResult,
            modelId: decision.fallbackModelId,
            usedFallback: true,
            usedOverride: decision.usedOverride,
            cached: false,
          };
        } catch (fbErr) {
          lastErr = fbErr;
        }
      }

      // Cross-provider rescue hop 1 (Groq Cloud Free): if primary + fallback failed on a text task and GROQ_API_KEY is configured
      const rescueModel = groqRescueModelId || defaultGroqRescueModelForTask(taskType);
      const canGroqRescue =
        allowGroqRescue &&
        isGroqConfigured() &&
        !isGroqModelId(decision.modelId) &&
        !(canFallback && isGroqModelId(decision.fallbackModelId));

      if (canGroqRescue) {
        try {
          const rescueResult = await withExponentialBackoff(() => runWithModel(rescueModel), 1);
          if (cacheKey) {
            aiResponseCache.set(cacheKey, rescueResult);
          }
          appendExecutionLog({
            executionId: `exec_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
            taskType,
            modelId: rescueModel,
            usedFallback: true,
            usedOverride: decision.usedOverride,
            promptVersion: decision.promptVersion,
            configVersion: decision.configVersion,
            status: 'success',
            durationMs: Date.now() - start,
            cached: false,
            timestamp: new Date().toISOString(),
          });
          return {
            data: rescueResult,
            modelId: rescueModel,
            usedFallback: true,
            usedOverride: decision.usedOverride,
            cached: false,
          };
        } catch (rescueErr) {
          lastErr = rescueErr;
        }
      }

      // Cross-provider rescue hop 2 (Cloudflare Workers AI Free): if primary + fallback (+ Groq) failed and Cloudflare is configured
      const cfRescueModel = defaultCloudflareRescueModelForTask(taskType);
      const canCloudflareRescue =
        allowGroqRescue &&
        isCloudflareConfigured() &&
        !isCloudflareModelId(decision.modelId) &&
        !(canFallback && isCloudflareModelId(decision.fallbackModelId));

      if (canCloudflareRescue) {
        try {
          const cfResult = await withExponentialBackoff(() => runWithModel(cfRescueModel), 1);
          if (cacheKey) {
            aiResponseCache.set(cacheKey, cfResult);
          }
          appendExecutionLog({
            executionId: `exec_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
            taskType,
            modelId: cfRescueModel,
            usedFallback: true,
            usedOverride: decision.usedOverride,
            promptVersion: decision.promptVersion,
            configVersion: decision.configVersion,
            status: 'success',
            durationMs: Date.now() - start,
            cached: false,
            timestamp: new Date().toISOString(),
          });
          return {
            data: cfResult,
            modelId: cfRescueModel,
            usedFallback: true,
            usedOverride: decision.usedOverride,
            cached: false,
          };
        } catch (cfErr) {
          lastErr = cfErr;
        }
      }

      // Cross-provider rescue hop 3 (Gemini): if Groq/Cloudflare failed and Gemini API Key is configured
      const isPrimaryGemini = !isGroqModelId(decision.modelId) && !isCloudflareModelId(decision.modelId);
      const isFallbackGemini =
        canFallback && !isGroqModelId(decision.fallbackModelId) && !isCloudflareModelId(decision.fallbackModelId);
      const canGeminiRescue = isGeminiConfigured() && !isPrimaryGemini && !isFallbackGemini;

      if (canGeminiRescue) {
        const geminiRescueModel = 'gemini-3.1-flash-lite';
        try {
          const gemResult = await withExponentialBackoff(() => runWithModel(geminiRescueModel), 1);
          if (cacheKey) {
            aiResponseCache.set(cacheKey, gemResult);
          }
          appendExecutionLog({
            executionId: `exec_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
            taskType,
            modelId: geminiRescueModel,
            usedFallback: true,
            usedOverride: decision.usedOverride,
            promptVersion: decision.promptVersion,
            configVersion: decision.configVersion,
            status: 'success',
            durationMs: Date.now() - start,
            cached: false,
            timestamp: new Date().toISOString(),
          });
          return {
            data: gemResult,
            modelId: geminiRescueModel,
            usedFallback: true,
            usedOverride: decision.usedOverride,
            cached: false,
          };
        } catch (gemErr) {
          lastErr = gemErr;
        }
      }

      appendExecutionLog({
        executionId: `exec_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
        taskType,
        modelId: canFallback ? decision.fallbackModelId : decision.modelId,
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
  inFlightTasks.set(
    cacheKey,
    taskPromise as Promise<{
      data: unknown;
      modelId: string;
      usedFallback: boolean;
      usedOverride: boolean;
      cached: boolean;
    }>
  );
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
      if (!isGroqConfigured()) {
        return {
          ok: false,
          modelId,
          latencyMs: Date.now() - start,
          message:
            'Chưa cấu hình Groq API Key. Super Admin có thể thêm trực tiếp tại tab "API Key & Bảo mật" trong web (không cần sửa biến môi trường Vercel).',
        };
      }
      const resp = await callWithTimeout(
        (signal) =>
          callGroqChatCompletion({
            modelId,
            prompt: 'Trả lời duy nhất 1 từ: OK',
            maxOutputTokens: 256,
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
          ? `Model ${resolvedLabel} (Groq Cloud Free) hoạt động bình thường (${Date.now() - start}ms).`
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
