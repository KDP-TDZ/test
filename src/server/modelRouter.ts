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

export interface ModelCatalogItem {
  modelId: string;
  displayName: string;
  tier: 'free';
  strengths: string;
  supportsMultimodal: boolean;
  supportsGoogleSearch: boolean;
}

export const MODEL_CATALOG: ModelCatalogItem[] = [
  {
    modelId: 'gemini-4-hydrogen',
    displayName: 'Gemini 4 Hydrogen',
    tier: 'free',
    strengths: 'Suy luận sâu, kiểm định tri thức đa nguồn, OCR công thức & chữ viết tay phức tạp.',
    supportsMultimodal: true,
    supportsGoogleSearch: true,
  },
  {
    modelId: 'gemini-3.1-flash-lite',
    displayName: 'Gemini 3.1 Flash Lite',
    tier: 'free',
    strengths: 'Tốc độ rất nhanh, tiết kiệm token cho phân loại môn, kiểm tra cấu trúc, flashcard & phản hồi.',
    supportsMultimodal: true,
    supportsGoogleSearch: true,
  },
];

export const DEFAULT_TASK_MODELS: Record<AiTaskType, TaskModelConfig> = {
  subject_classification: {
    defaultModel: 'gemini-3.1-flash-lite',
    fallbackModel: 'gemini-4-hydrogen',
    enableFallback: true,
    oneTimeOverrideModel: null,
    promptVersion: 'v2.1',
  },
  curriculum_extraction: {
    defaultModel: 'gemini-3.1-flash-lite',
    fallbackModel: 'gemini-4-hydrogen',
    enableFallback: true,
    oneTimeOverrideModel: null,
    promptVersion: 'v2.2',
  },
  knowledge_analysis: {
    defaultModel: 'gemini-4-hydrogen',
    fallbackModel: 'gemini-3.1-flash-lite',
    enableFallback: true,
    oneTimeOverrideModel: null,
    promptVersion: 'v2.2',
  },
  completeness_analysis: {
    defaultModel: 'gemini-4-hydrogen',
    fallbackModel: 'gemini-3.1-flash-lite',
    enableFallback: true,
    oneTimeOverrideModel: null,
    promptVersion: 'v2.1',
  },
  claim_validation: {
    defaultModel: 'gemini-3.1-flash-lite',
    fallbackModel: 'gemini-4-hydrogen',
    enableFallback: true,
    oneTimeOverrideModel: null,
    promptVersion: 'v2.2',
  },
  quiz_blueprint: {
    defaultModel: 'gemini-4-hydrogen',
    fallbackModel: 'gemini-3.1-flash-lite',
    enableFallback: true,
    oneTimeOverrideModel: null,
    promptVersion: 'v2.1',
  },
  quiz_generation: {
    defaultModel: 'gemini-4-hydrogen',
    fallbackModel: 'gemini-3.1-flash-lite',
    enableFallback: true,
    oneTimeOverrideModel: null,
    promptVersion: 'v2.2',
  },
  quiz_validation: {
    defaultModel: 'gemini-3.1-flash-lite',
    fallbackModel: 'gemini-4-hydrogen',
    enableFallback: true,
    oneTimeOverrideModel: null,
    promptVersion: 'v2.1',
  },
  answer_explanation: {
    defaultModel: 'gemini-3.1-flash-lite',
    fallbackModel: 'gemini-4-hydrogen',
    enableFallback: true,
    oneTimeOverrideModel: null,
    promptVersion: 'v2.1',
  },
  flashcard_generation: {
    defaultModel: 'gemini-3.1-flash-lite',
    fallbackModel: 'gemini-4-hydrogen',
    enableFallback: true,
    oneTimeOverrideModel: null,
    promptVersion: 'v2.1',
  },
  feedback_analysis: {
    defaultModel: 'gemini-3.1-flash-lite',
    fallbackModel: 'gemini-4-hydrogen',
    enableFallback: true,
    oneTimeOverrideModel: null,
    promptVersion: 'v2.0',
  },
};

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

export const GEMINI_TIMEOUT_MS = 30_000;

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
  runWithModel: (modelId: string) => Promise<T>;
}): Promise<{ data: T; modelId: string; usedFallback: boolean; usedOverride: boolean; cached: boolean }> {
  const { taskType, config, consumeOneTimeOverride, cacheInput, bypassCache, runWithModel } = params;

  let overrideConsumed = false;
  const decision = resolveModelForTask(taskType, config, () => {
    overrideConsumed = true;
  });

  if (overrideConsumed && consumeOneTimeOverride) {
    await consumeOneTimeOverride(taskType);
  }

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
      // When fallback is active, retry primary at most once so 429/503 transitions quickly to fallback
      const primaryRetries = canFallback ? 1 : 2;
      const result = await withExponentialBackoff(() => runWithModel(decision.modelId), primaryRetries);
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
          appendExecutionLog({
            executionId: `exec_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
            taskType,
            modelId: decision.fallbackModelId,
            usedFallback: true,
            usedOverride: decision.usedOverride,
            promptVersion: decision.promptVersion,
            configVersion: decision.configVersion,
            status: 'failed',
            error: fbErr instanceof Error ? fbErr.message.slice(0, 180) : String(fbErr).slice(0, 180),
            durationMs: Date.now() - start,
            timestamp: new Date().toISOString(),
          });
          throw fbErr;
        }
      }

      appendExecutionLog({
        executionId: `exec_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
        taskType,
        modelId: decision.modelId,
        usedFallback: false,
        usedOverride: decision.usedOverride,
        promptVersion: decision.promptVersion,
        configVersion: decision.configVersion,
        status: 'failed',
        error:
          primaryErr instanceof Error
            ? primaryErr.message.slice(0, 180)
            : String(primaryErr).slice(0, 180),
        durationMs: Date.now() - start,
        timestamp: new Date().toISOString(),
      });
      throw primaryErr;
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
