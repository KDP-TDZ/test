import crypto from 'node:crypto';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { BoundedTtlCache, buildDeterministicCacheKey } from '../core/cache';
import type {
  AiExecutionLog,
  AiTaskType,
  SystemAiConfig,
  TaskModelConfig,
} from '../core/types';
import { resolveActiveGeminiApiKey } from './singleKeyService';

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
    enableFallback: false,
    oneTimeOverrideModel: null,
    promptVersion: 'v2.1',
  },
  curriculum_extraction: {
    defaultModel: 'gemini-4-hydrogen',
    fallbackModel: 'gemini-3.1-flash-lite',
    enableFallback: false,
    oneTimeOverrideModel: null,
    promptVersion: 'v2.1',
  },
  knowledge_analysis: {
    defaultModel: 'gemini-4-hydrogen',
    fallbackModel: 'gemini-3.1-flash-lite',
    enableFallback: false,
    oneTimeOverrideModel: null,
    promptVersion: 'v2.2',
  },
  completeness_analysis: {
    defaultModel: 'gemini-4-hydrogen',
    fallbackModel: 'gemini-3.1-flash-lite',
    enableFallback: false,
    oneTimeOverrideModel: null,
    promptVersion: 'v2.1',
  },
  claim_validation: {
    defaultModel: 'gemini-4-hydrogen',
    fallbackModel: 'gemini-3.1-flash-lite',
    enableFallback: false,
    oneTimeOverrideModel: null,
    promptVersion: 'v2.1',
  },
  quiz_blueprint: {
    defaultModel: 'gemini-4-hydrogen',
    fallbackModel: 'gemini-3.1-flash-lite',
    enableFallback: false,
    oneTimeOverrideModel: null,
    promptVersion: 'v2.1',
  },
  quiz_generation: {
    defaultModel: 'gemini-4-hydrogen',
    fallbackModel: 'gemini-3.1-flash-lite',
    enableFallback: false,
    oneTimeOverrideModel: null,
    promptVersion: 'v2.2',
  },
  quiz_validation: {
    defaultModel: 'gemini-3.1-flash-lite',
    fallbackModel: 'gemini-4-hydrogen',
    enableFallback: false,
    oneTimeOverrideModel: null,
    promptVersion: 'v2.1',
  },
  answer_explanation: {
    defaultModel: 'gemini-3.1-flash-lite',
    fallbackModel: 'gemini-4-hydrogen',
    enableFallback: false,
    oneTimeOverrideModel: null,
    promptVersion: 'v2.1',
  },
  flashcard_generation: {
    defaultModel: 'gemini-3.1-flash-lite',
    fallbackModel: 'gemini-4-hydrogen',
    enableFallback: false,
    oneTimeOverrideModel: null,
    promptVersion: 'v2.1',
  },
  feedback_analysis: {
    defaultModel: 'gemini-3.1-flash-lite',
    fallbackModel: 'gemini-4-hydrogen',
    enableFallback: false,
    oneTimeOverrideModel: null,
    promptVersion: 'v2.0',
  },
};

const aiResponseCache = new BoundedTtlCache<unknown>(160, 45 * 60 * 1000);
const executionLogs: AiExecutionLog[] = [];

export function clearAiResponseCache(): void {
  aiResponseCache.clear();
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

export function isTransientProviderError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('429') ||
    msg.includes('500') ||
    msg.includes('502') ||
    msg.includes('503') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('DEADLINE_EXCEEDED') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('ECONNRESET')
  );
}

export async function withExponentialBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 2
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt += 1;
      if (attempt > maxRetries || !isTransientProviderError(err)) {
        throw err;
      }
      const jitter = Math.floor(Math.random() * 250);
      const delayMs = 600 * Math.pow(2, attempt - 1) + jitter;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

export async function createServerAiClient(): Promise<GoogleGenAI> {
  const apiKey = await resolveActiveGeminiApiKey();
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
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
  }

  const start = Date.now();
  try {
    const result = await withExponentialBackoff(() => runWithModel(decision.modelId));
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
    // Only fall back when Admin explicitly enabled fallback for this task AND fallback model differs
    if (
      decision.enableFallback &&
      decision.fallbackModelId &&
      decision.fallbackModelId !== decision.modelId
    ) {
      try {
        const fbResult = await withExponentialBackoff(() => runWithModel(decision.fallbackModelId));
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
    const resp = await ai.models.generateContent({
      model: modelId,
      contents: 'Trả lời 1 từ: OK',
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        maxOutputTokens: 16,
      },
    });
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
