import crypto from 'node:crypto';
import { BoundedTtlCache, buildDeterministicCacheKey } from '../core/cache.js';
import type {
  AiExecutionLog,
  AiTaskType,
  SystemAiConfig,
} from '../core/types.js';
import {
  callMistralChatCompletion,
  isMistralConfigured,
  isMistralModelId,
  MISTRAL_FAST_MODEL,
  MISTRAL_PRIMARY_MODEL,
  normalizeMistralModelId,
} from './mistralProvider.js';
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
  UNIFIED_FALLBACK_MODEL,
  UNIFIED_PRIMARY_MODEL,
  type ModelCatalogItem,
} from './modelDefaults.js';

export { DEFAULT_TASK_MODELS, MODEL_CATALOG, type ModelCatalogItem };

function defaultMistralRescueModelForTask(taskType: AiTaskType): string {
  switch (taskType) {
    case 'subject_classification':
    case 'claim_validation':
    case 'quiz_validation':
    case 'flashcard_generation':
    case 'feedback_analysis':
      return MISTRAL_FAST_MODEL;
    default:
      return MISTRAL_PRIMARY_MODEL;
  }
}

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

/**
 * Normalize model IDs across Mistral, Groq, and Cloudflare.
 * Automatically migrates any retired/legacy Gemini model IDs stored in old configs to Mistral Primary.
 */
export function normalizeSupportedModelId(modelId: string | null | undefined): string {
  const trimmed = String(modelId || '').trim();
  if (!trimmed) return UNIFIED_PRIMARY_MODEL;
  if (isGroqModelId(trimmed)) return normalizeGroqModelId(trimmed);
  if (isCloudflareModelId(trimmed)) return trimmed;
  if (trimmed.toLowerCase().startsWith('@cf/')) return `cf:${trimmed}`;
  if (isMistralModelId(trimmed)) return normalizeMistralModelId(trimmed);
  // Migrate any legacy Gemini or unrecognized model ID to Mistral Primary
  return UNIFIED_PRIMARY_MODEL;
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

const aiResponseCache = new BoundedTtlCache<CachedTaskEnvelope>(320, 6 * 60 * 60 * 1000);
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

export const AI_REQUEST_TIMEOUT_MS = 45_000;

export async function callWithTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs = AI_REQUEST_TIMEOUT_MS
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
    msg.includes('502') ||
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
  if (isMistralModelId(modelId)) return isMistralConfigured();
  return isMistralConfigured();
}

function pickConfiguredProviderModel(
  taskType: AiTaskType,
  preferredModel: string,
  activeModel: string,
  excludeModel?: string
): string {
  const normPreferred = normalizeSupportedModelId(preferredModel);
  const normActive = normalizeSupportedModelId(activeModel);

  if (isModelProviderConfigured(normPreferred) && normPreferred !== excludeModel) {
    return normPreferred;
  }
  if (isModelProviderConfigured(normActive) && normActive !== excludeModel) {
    return normActive;
  }
  if (isMistralConfigured()) {
    const mistralPrimary = defaultMistralRescueModelForTask(taskType);
    if (mistralPrimary !== excludeModel) return mistralPrimary;
    return mistralPrimary === MISTRAL_PRIMARY_MODEL ? MISTRAL_FAST_MODEL : MISTRAL_PRIMARY_MODEL;
  }
  if (isGroqConfigured()) {
    const groqPrimary = defaultGroqRescueModelForTask(taskType);
    if (groqPrimary !== excludeModel) return groqPrimary;
    return groqPrimary === GROQ_RESCUE_MODEL_STRONG
      ? GROQ_RESCUE_MODEL_FAST
      : GROQ_VISION_MODEL;
  }
  if (isCloudflareConfigured()) {
    const cfPrimary = defaultCloudflareRescueModelForTask(taskType);
    if (cfPrimary !== excludeModel) return cfPrimary;
    return cfPrimary === CF_RESCUE_MODEL_STRONG ? CF_RESCUE_MODEL_FAST : CF_RESCUE_MODEL_STRONG;
  }
  return normPreferred;
}

export function resolveModelForTask(
  taskType: AiTaskType,
  config: SystemAiConfig,
  consumeOverride?: () => void
): ResolvedModelDecision {
  const taskCfg = config.taskModels?.[taskType] || DEFAULT_TASK_MODELS[taskType];
  const activeFallbackDefault = normalizeSupportedModelId(
    config.activeModel || UNIFIED_PRIMARY_MODEL
  );

  let modelId = normalizeSupportedModelId(taskCfg.defaultModel || activeFallbackDefault);
  let usedOverride = false;

  if (taskCfg.oneTimeOverrideModel && taskCfg.oneTimeOverrideModel.trim()) {
    modelId = normalizeSupportedModelId(taskCfg.oneTimeOverrideModel);
    usedOverride = true;
    consumeOverride?.();
  }

  let fallbackModelId = normalizeSupportedModelId(
    taskCfg.fallbackModel || UNIFIED_FALLBACK_MODEL
  );

  // Bidirectionally route to whichever configured provider key (Mistral / Groq / Cloudflare) is available
  if (!isModelProviderConfigured(modelId)) {
    modelId = pickConfiguredProviderModel(taskType, modelId, activeFallbackDefault);
  }

  if (!isModelProviderConfigured(fallbackModelId) || fallbackModelId === modelId) {
    fallbackModelId = pickConfiguredProviderModel(
      taskType,
      fallbackModelId,
      activeFallbackDefault,
      modelId
    );
  }

  return {
    taskType,
    modelId,
    fallbackModelId,
    enableFallback: taskCfg.enableFallback !== false,
    usedOverride,
    promptVersion: taskCfg.promptVersion || 'v4.2_3provider',
    configVersion: config.configVersion || 1,
  };
}

export async function executeRoutedAiTask<T>(params: {
  taskType: AiTaskType;
  config: SystemAiConfig;
  consumeOneTimeOverride?: (task: AiTaskType) => Promise<void>;
  cacheInput?: Record<string, unknown>;
  bypassCache?: boolean;
  allowCrossProviderRescue?: boolean;
  /** @deprecated Alias kept for backward compatibility; prefer allowCrossProviderRescue */
  allowGroqRescue?: boolean;
  groqRescueModelId?: string;
  preferredPrimaryModelId?: string;
  preferredFallbackModelId?: string;
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
    groqRescueModelId,
    preferredPrimaryModelId,
    preferredFallbackModelId,
    strictModelLock = false,
    extractExecutionMeta,
    runWithModel,
  } = params;

  const allowCrossProviderRescue =
    params.allowCrossProviderRescue ?? params.allowGroqRescue ?? true;

  let overrideConsumed = false;
  const decision = resolveModelForTask(taskType, config, () => {
    overrideConsumed = true;
  });

  let requestedModel = preferredPrimaryModelId
    ? normalizeSupportedModelId(preferredPrimaryModelId)
    : decision.modelId;
  let fallbackModelId = preferredFallbackModelId
    ? normalizeSupportedModelId(preferredFallbackModelId)
    : decision.fallbackModelId;

  if (!strictModelLock && !isModelProviderConfigured(requestedModel)) {
    requestedModel = pickConfiguredProviderModel(taskType, requestedModel, decision.modelId);
  }
  if (!strictModelLock && (!isModelProviderConfigured(fallbackModelId) || fallbackModelId === requestedModel)) {
    fallbackModelId = pickConfiguredProviderModel(
      taskType,
      fallbackModelId,
      decision.fallbackModelId,
      requestedModel
    );
  }

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
    Boolean(fallbackModelId) &&
    fallbackModelId !== requestedModel &&
    isModelProviderConfigured(fallbackModelId);

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
              : 'MISTRAL_API_KEY_UNCONFIGURED'
        );
      }
      // When fallback is active, transition immediately on transient 429/503 within Vercel's timeout budget
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
        if (
          reason.includes('GRADING_JSON_INVALID') ||
          reason.includes('GROQ_API_KEY_UNCONFIGURED') ||
          reason.includes('MISTRAL_API_KEY_UNCONFIGURED') ||
          reason.includes('CLOUDFLARE_CREDENTIALS_UNCONFIGURED')
        ) {
          throw primaryErr;
        }
        throw new Error(
          `STRICT_GRADING_MODEL_UNAVAILABLE: Model chấm điểm cố định (${requestedModel}) tạm thời không phản hồi và yêu cầu đã bật khóa model. Chi tiết: ${reason}`
        );
      }

      const triedProviders = new Set<string>();
      const providerOf = (m: string) =>
        isGroqModelId(m) ? 'groq' : isCloudflareModelId(m) ? 'cloudflare' : 'mistral';
      triedProviders.add(providerOf(requestedModel));

      if (canFallback) {
        triedProviders.add(providerOf(fallbackModelId));
        try {
          const fbResult = await withExponentialBackoff(() => runWithModel(fallbackModelId), 1);
          if (overrideConsumed && consumeOneTimeOverride) {
            await consumeOneTimeOverride(taskType);
          }
          return finalizeSuccess(fbResult, fallbackModelId, true, start);
        } catch (fbErr) {
          lastErr = fbErr;
        }
      }

      if (allowCrossProviderRescue) {
        // Cross-provider rescue hops across Mistral <-> Groq <-> Cloudflare
        const rescueHops: Array<{ provider: string; configured: boolean; modelId: string }> = [
          {
            provider: 'mistral',
            configured: isMistralConfigured(),
            modelId: defaultMistralRescueModelForTask(taskType),
          },
          {
            provider: 'groq',
            configured: isGroqConfigured(),
            modelId: groqRescueModelId || defaultGroqRescueModelForTask(taskType),
          },
          {
            provider: 'cloudflare',
            configured: isCloudflareConfigured(),
            modelId: defaultCloudflareRescueModelForTask(taskType),
          },
        ];

        for (const hop of rescueHops) {
          if (!hop.configured || triedProviders.has(hop.provider)) continue;
          triedProviders.add(hop.provider);
          try {
            const rescueResult = await withExponentialBackoff(() => runWithModel(hop.modelId), 1);
            return finalizeSuccess(rescueResult, hop.modelId, true, start);
          } catch (rescueErr) {
            lastErr = rescueErr;
          }
        }
      }

      appendExecutionLog({
        executionId: `exec_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
        taskType,
        modelId: canFallback ? fallbackModelId : requestedModel,
        requestedModel,
        actualModel: canFallback ? fallbackModelId : requestedModel,
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
  const targetModel = normalizeSupportedModelId(modelId);
  try {
    if (isGroqModelId(targetModel)) {
      if (!isGroqConfigured()) {
        return {
          ok: false,
          modelId: targetModel,
          latencyMs: Date.now() - start,
          message:
            'Chưa cấu hình Groq API Key. Super Admin có thể thêm trực tiếp tại tab "API Key & Bảo mật" trong web.',
        };
      }
      const resp = await callWithTimeout(
        (signal) =>
          callGroqChatCompletion({
            modelId: targetModel,
            prompt: 'Trả lời duy nhất 1 từ: OK',
            maxOutputTokens: 256,
            signal,
          }),
        15_000
      );
      const text = (resp.text || '').trim();
      const effectiveModel = resp.resolvedModel || targetModel;
      const visionHint = isGroqVisionModelId(effectiveModel)
        ? ' (hỗ trợ trực tiếp OCR ảnh)'
        : ` (văn bản OK; tác vụ OCR ảnh sẽ dùng ${GROQ_VISION_MODEL})`;
      return {
        ok: Boolean(text),
        modelId: effectiveModel,
        latencyMs: Date.now() - start,
        message: text
          ? `Model ${effectiveModel} (Groq Cloud Free) hoạt động bình thường (${Date.now() - start}ms)${visionHint}.`
          : `Model ${targetModel} trả về nội dung rỗng.`,
      };
    }

    if (isCloudflareModelId(targetModel)) {
      if (!isCloudflareConfigured()) {
        return {
          ok: false,
          modelId: targetModel,
          latencyMs: Date.now() - start,
          message:
            'Chưa cấu hình Cloudflare Account ID & API Token. Super Admin có thể thêm trực tiếp tại tab "API Key & Bảo mật" trong web.',
        };
      }
      const resp = await callWithTimeout(
        (signal) =>
          callCloudflareChatCompletion({
            modelId: targetModel,
            prompt: 'Trả lời duy nhất 1 từ: OK',
            maxOutputTokens: 128,
            signal,
          }),
        15_000
      );
      const text = (resp.text || '').trim();
      return {
        ok: Boolean(text),
        modelId: resp.resolvedModel || targetModel,
        latencyMs: Date.now() - start,
        message: text
          ? `Model ${resp.resolvedModel || targetModel} (Cloudflare Workers AI Free) hoạt động bình thường (${Date.now() - start}ms).`
          : `Model ${targetModel} trả về nội dung rỗng.`,
      };
    }

    // Default: Mistral AI
    if (!isMistralConfigured()) {
      return {
        ok: false,
        modelId: targetModel,
        latencyMs: Date.now() - start,
        message:
          'Chưa cấu hình Mistral AI API Key. Super Admin có thể thêm trực tiếp tại tab "API Key & Bảo mật" hoặc biến MISTRAL_API_KEY.',
      };
    }
    const resp = await callWithTimeout(
      (signal) =>
        callMistralChatCompletion({
          modelId: targetModel,
          prompt: 'Trả lời duy nhất 1 từ: OK',
          maxOutputTokens: 64,
          signal,
        }),
      15_000
    );
    const text = (resp.text || '').trim();
    return {
      ok: Boolean(text),
      modelId: resp.modelUsed || targetModel,
      latencyMs: Date.now() - start,
      message: text
        ? `Model ${resp.modelUsed || targetModel} (Mistral AI Free) hoạt động bình thường (${Date.now() - start}ms).`
        : `Model ${targetModel} trả về nội dung rỗng.`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      modelId: targetModel,
      latencyMs: Date.now() - start,
      message: `Lỗi kết nối model ${targetModel}: ${msg.slice(0, 220)}`,
    };
  }
}
