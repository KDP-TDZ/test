import crypto from 'node:crypto';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { BoundedTtlCache, buildDeterministicCacheKey } from '../core/cache.js';
import type {
  AiExecutionLog,
  AiTaskType,
  SystemAiConfig,
  TaskModelConfig,
} from '../core/types.js';
import { resolveActiveGeminiApiKey } from './singleKeyService.js';
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

export const GEMINI_TIMEOUT_MS = 22_000;

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
): { thinkingLevel: ThinkingLevel } {
  const isLite = modelId.toLowerCase().includes('flash-lite');
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

export function resolveModelForTask(
  taskType: AiTaskType,
  config: SystemAiConfig,
  consumeOverride?: () => void
): ResolvedModelDecision {
  const taskCfg = config.taskModels?.[taskType] || DEFAULT_TASK_MODELS[taskType];
  const activeFallbackDefault = config.activeModel || 'gemini-4-hydrogen';

  let modelId = (taskCfg.defaultModel || activeFallbackDefault).trim();
  let usedOverride = false;

  if (taskCfg.oneTimeOverrideModel && taskCfg.oneTimeOverrideModel.trim()) {
    modelId = taskCfg.oneTimeOverrideModel.trim();
    usedOverride = true;
    consumeOverride?.();
  }

  return {
    taskType,
    modelId,
    fallbackModelId: (taskCfg.fallbackModel || 'gemini-3.1-flash-lite').trim(),
    enableFallback: Boolean(taskCfg.enableFallback),
    usedOverride,
    promptVersion: taskCfg.promptVersion || 'v2.0',
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
    decision.fallbackModelId !== decision.modelId;

  const executeTask = async (): Promise<{
    data: T;
    modelId: string;
    usedFallback: boolean;
    usedOverride: boolean;
    cached: boolean;
  }> => {
    const start = Date.now();
    try {
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
            'Chưa thiết lập biến môi trường GROQ_API_KEY trên máy chủ (Vercel Environment Variables hoặc .env).',
        };
      }
      const resp = await callWithTimeout(
        (signal) =>
          callGroqChatCompletion({
            modelId,
            prompt: 'Trả lời duy nhất 1 từ: OK',
            maxOutputTokens: 32,
            signal,
          }),
        15_000
      );
      const text = (resp.text || '').trim();
      return {
        ok: Boolean(text),
        modelId,
        latencyMs: Date.now() - start,
        message: text
          ? `Model ${modelId} (Groq Cloud Free) hoạt động bình thường (${Date.now() - start}ms).`
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
            'Chưa thiết lập CLOUDFLARE_ACCOUNT_ID và CLOUDFLARE_API_TOKEN trên máy chủ (Vercel Environment Variables hoặc .env).',
        };
      }
      const resp = await callWithTimeout(
        (signal) =>
          callCloudflareChatCompletion({
            modelId,
            prompt: 'Trả lời duy nhất 1 từ: OK',
            maxOutputTokens: 32,
            signal,
          }),
        15_000
      );
      const text = (resp.text || '').trim();
      return {
        ok: Boolean(text),
        modelId,
        latencyMs: Date.now() - start,
        message: text
          ? `Model ${modelId} (Cloudflare Workers AI Free) hoạt động bình thường (${Date.now() - start}ms).`
          : `Model ${modelId} trả về nội dung rỗng.`,
      };
    }

    const ai = await createServerAiClient();
    const resp = await callWithTimeout((signal) =>
      ai.models.generateContent({
        model: modelId,
        contents: 'Trả lời 1 từ: OK',
        config: {
          thinkingConfig: thinkingConfigForModel(modelId, 'minimal'),
          maxOutputTokens: 128,
          abortSignal: signal,
        },
      })
    );
    const text = (resp.text || '').trim();
    return {
      ok: Boolean(text),
      modelId,
      latencyMs: Date.now() - start,
      message: text
        ? `Model ${modelId} hoạt động bình thường (${Date.now() - start}ms).`
        : `Model ${modelId} trả về nội dung rỗng.`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      modelId,
      latencyMs: Date.now() - start,
      message: `Lỗi kết nối model ${modelId}: ${msg.slice(0, 160)}`,
    };
  }
}
