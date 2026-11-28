import crypto from 'node:crypto';
import type {
  AiTaskType,
  ApiUsageDaily,
  AuditLogEntry,
  RateLimitConfig,
  SystemAiConfig,
  TaskModelConfig,
} from '../core/types.js';
import {
  firestoreRestGet,
  firestoreRestSet,
  firestoreRestList,
  SUPER_ADMIN_EMAIL,
} from './firebaseServer.js';
import { DEFAULT_TASK_MODELS, UNIFIED_PRIMARY_MODEL } from './modelDefaults.js';
import { clearAiResponseCache, normalizeSupportedModelId } from './modelRouter.js';
import {
  ADAPTIVE_LONG_TEXT_CHAR_THRESHOLD,
  clampAdaptiveThresholdChars,
} from '../core/adaptiveApiPlan.js';
import {
  getExperienceRatingConfig,
  setExperienceRatingEnabled,
} from './experienceRatingStore.js';

export const DEFAULT_RATE_LIMITS: RateLimitConfig = {
  requestsPerMinute: 15,
  requestsPerHour: 120,
  analysesPerDay: 35,
  cooldownSeconds: 2,
  maximumConcurrentJobs: 3,
  maximumPagesPerAnalysis: 25,
  maximumFileSizeMb: 20,
  adaptiveLongTextThresholdChars: ADAPTIVE_LONG_TEXT_CHAR_THRESHOLD,
};

export const DEFAULT_MAINTENANCE_MESSAGE =
  'StudyCheck AI đang tạm ngừng xử lý AI. Những tài liệu và kết quả đã lưu vẫn có thể được truy cập bình thường.';

function cloneDefaultTaskModels(): Record<AiTaskType, TaskModelConfig> {
  const out = {} as Record<AiTaskType, TaskModelConfig>;
  for (const [key, val] of Object.entries(DEFAULT_TASK_MODELS)) {
    out[key as AiTaskType] = { ...val };
  }
  return out;
}

let authoritativeAiConfig: SystemAiConfig = {
  enabled: true,
  disabledReason: '',
  maintenanceMessage: DEFAULT_MAINTENANCE_MESSAGE,
  updatedAt: new Date().toISOString(),
  updatedBy: SUPER_ADMIN_EMAIL,
  rateLimitConfig: { ...DEFAULT_RATE_LIMITS },
  activeModel: UNIFIED_PRIMARY_MODEL,
  configVersion: 1,
  allowedOrigins: [],
  taskModels: cloneDefaultTaskModels(),
  adaptiveLongTextThresholdChars: ADAPTIVE_LONG_TEXT_CHAR_THRESHOLD,
  experienceRatingEnabled: getExperienceRatingConfig().enabled,
};

/**
 * Serialize SystemAiConfig for Cloud Firestore `systemConfig/aiService` strictly matching
 * `isValidSystemConfig` allowed top-level keys in `firestore.rules`.
 * `adaptiveLongTextThresholdChars` is persisted inside `rateLimitConfig` so Firestore rules pass cleanly.
 */
function serializeSystemConfigForFirestore(cfg: SystemAiConfig): Record<string, unknown> {
  const threshold = clampAdaptiveThresholdChars(
    cfg.adaptiveLongTextThresholdChars ?? cfg.rateLimitConfig?.adaptiveLongTextThresholdChars
  );
  return {
    enabled: Boolean(cfg.enabled),
    disabledReason: String(cfg.disabledReason || '').slice(0, 300),
    maintenanceMessage: String(cfg.maintenanceMessage || DEFAULT_MAINTENANCE_MESSAGE).slice(0, 400),
    updatedAt: cfg.updatedAt || new Date().toISOString(),
    updatedBy: String(cfg.updatedBy || SUPER_ADMIN_EMAIL).slice(0, 128),
    rateLimitConfig: {
      ...DEFAULT_RATE_LIMITS,
      ...(cfg.rateLimitConfig || {}),
      adaptiveLongTextThresholdChars: threshold,
    },
    activeModel: normalizeSupportedModelId(cfg.activeModel),
    configVersion: typeof cfg.configVersion === 'number' && cfg.configVersion >= 1 ? cfg.configVersion : 1,
    allowedOrigins: Array.isArray(cfg.allowedOrigins) ? cfg.allowedOrigins.slice(0, 50) : [],
    taskModels: cfg.taskModels,
    experienceRatingEnabled:
      typeof cfg.experienceRatingEnabled === 'boolean'
        ? cfg.experienceRatingEnabled
        : getExperienceRatingConfig().enabled,
  };
}

// Server-side in-memory counters & locks (never bypassed by browser refresh)
const minuteWindows = new Map<string, number[]>();
const hourWindows = new Map<string, number[]>();
const dailyAnalyses = new Map<string, { date: string; count: number }>();
const lastAnalysisTime = new Map<string, number>();
const concurrentJobs = new Map<string, number>();
const idempotencyCache = new Map<string, { expiresAt: number; payload: unknown }>();

const usageDailyStore = new Map<string, ApiUsageDaily>();
const userDailyUsageStore = new Map<string, { uid: string; email: string; date: string; requests: number; analyses: number; blocked: number; tokens: number }>();
const auditLogStore: AuditLogEntry[] = [];

function todayDateKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function getOrCreateDailyUsage(date = todayDateKey()): ApiUsageDaily {
  const existing = usageDailyStore.get(date);
  if (existing) return existing;
  const fresh: ApiUsageDaily = {
    date,
    requestCount: 0,
    successfulCount: 0,
    failedCount: 0,
    blockedCount: 0,
    analysisCount: 0,
    quizGenerationCount: 0,
    ocrCount: 0,
    webGroundedCount: 0,
    actualPromptTokens: 0,
    actualCandidateTokens: 0,
    actualTotalTokens: 0,
    quotaExceededEvents: 0,
    providerErrorEvents: 0,
    updatedAt: new Date().toISOString(),
  };
  usageDailyStore.set(date, fresh);
  return fresh;
}

function mergeTaskModels(
  base: Record<AiTaskType, TaskModelConfig>,
  patch?: Partial<Record<AiTaskType, Partial<TaskModelConfig>>>,
  upgradeLegacyPreV42 = false
): Record<AiTaskType, TaskModelConfig> {
  const merged = {} as Record<AiTaskType, TaskModelConfig>;
  for (const taskKey of Object.keys(DEFAULT_TASK_MODELS) as AiTaskType[]) {
    const incomingPatch = patch?.[taskKey];
    const isLegacyPreV42 =
      upgradeLegacyPreV42 &&
      (!incomingPatch?.promptVersion || incomingPatch.promptVersion !== 'v4.2_3provider');

    if (isLegacyPreV42) {
      merged[taskKey] = {
        ...DEFAULT_TASK_MODELS[taskKey],
      };
      continue;
    }

    const combined: TaskModelConfig = {
      ...DEFAULT_TASK_MODELS[taskKey],
      ...(base?.[taskKey] || {}),
      ...(incomingPatch || {}),
      promptVersion: 'v4.2_3provider',
    };
    merged[taskKey] = {
      ...combined,
      defaultModel: normalizeSupportedModelId(combined.defaultModel),
      fallbackModel: normalizeSupportedModelId(combined.fallbackModel),
      oneTimeOverrideModel: combined.oneTimeOverrideModel
        ? normalizeSupportedModelId(combined.oneTimeOverrideModel)
        : null,
    };
  }
  return merged;
}

let lastRemoteConfigSyncAt = 0;
const CONFIG_SYNC_TTL_MS = 60_000;
const pendingConsumedOverrides = new Set<AiTaskType>();

export function getAuthoritativeAiConfigSnapshot(): SystemAiConfig {
  return authoritativeAiConfig;
}

export async function loadAuthoritativeAiConfig(
  idToken?: string,
  forceRefresh = false
): Promise<SystemAiConfig> {
  const now = Date.now();
  if (idToken && (forceRefresh || now - lastRemoteConfigSyncAt >= CONFIG_SYNC_TTL_MS)) {
    try {
      const remote = await firestoreRestGet<SystemAiConfig>('systemConfig/aiService', idToken);
      lastRemoteConfigSyncAt = now;
      if (remote && typeof remote.enabled === 'boolean') {
        const remoteTasks = remote.taskModels || ({} as Record<AiTaskType, TaskModelConfig>);
        const hasLegacyPreV42Tasks = (Object.keys(DEFAULT_TASK_MODELS) as AiTaskType[]).some(
          (k) => !remoteTasks[k]?.promptVersion || remoteTasks[k]?.promptVersion !== 'v4.2_3provider'
        );
        const migratedTaskModels = mergeTaskModels(
          authoritativeAiConfig.taskModels,
          remote.taskModels,
          true
        );
        let needsRemoteFlush = false;
        for (const consumedTask of pendingConsumedOverrides) {
          if (migratedTaskModels[consumedTask]?.oneTimeOverrideModel) {
            migratedTaskModels[consumedTask] = {
              ...migratedTaskModels[consumedTask],
              oneTimeOverrideModel: null,
            };
            needsRemoteFlush = true;
          } else {
            pendingConsumedOverrides.delete(consumedTask);
          }
        }
        const resolvedActiveModel = hasLegacyPreV42Tasks
          ? UNIFIED_PRIMARY_MODEL
          : normalizeSupportedModelId(remote.activeModel || UNIFIED_PRIMARY_MODEL);

        const resolvedThreshold = clampAdaptiveThresholdChars(
          remote.adaptiveLongTextThresholdChars ??
            remote.rateLimitConfig?.adaptiveLongTextThresholdChars ??
            authoritativeAiConfig.adaptiveLongTextThresholdChars
        );

        authoritativeAiConfig = {
          ...authoritativeAiConfig,
          ...remote,
          activeModel: resolvedActiveModel,
          adaptiveLongTextThresholdChars: resolvedThreshold,
          experienceRatingEnabled:
            typeof remote.experienceRatingEnabled === 'boolean'
              ? remote.experienceRatingEnabled
              : getExperienceRatingConfig().enabled,
          configVersion:
            typeof remote.configVersion === 'number'
              ? remote.configVersion
              : authoritativeAiConfig.configVersion,
          allowedOrigins: Array.isArray(remote.allowedOrigins)
            ? remote.allowedOrigins
            : authoritativeAiConfig.allowedOrigins,
          taskModels: migratedTaskModels,
          rateLimitConfig: {
            ...DEFAULT_RATE_LIMITS,
            ...(remote.rateLimitConfig || {}),
            adaptiveLongTextThresholdChars: resolvedThreshold,
          },
        };
        if (typeof remote.experienceRatingEnabled === 'boolean') {
          if (remote.experienceRatingEnabled !== getExperienceRatingConfig().enabled) {
            setExperienceRatingEnabled(remote.experienceRatingEnabled, remote.updatedBy || '');
          }
        }

        if (needsRemoteFlush) {
          try {
            await firestoreRestSet(
              'systemConfig/aiService',
              serializeSystemConfigForFirestore(authoritativeAiConfig),
              idToken
            );
            pendingConsumedOverrides.clear();
          } catch {
            // Keep in pendingConsumedOverrides until an admin token flushes it
          }
        }
      }
    } catch {
      // Fall back to current authoritative server state if Firestore not yet initialized
    }
  }
  return authoritativeAiConfig;
}

export function getActiveModel(): string {
  return normalizeSupportedModelId(authoritativeAiConfig.activeModel || UNIFIED_PRIMARY_MODEL);
}

export async function consumeOneTimeModelOverride(
  taskType: AiTaskType,
  idToken?: string
): Promise<void> {
  const cur = authoritativeAiConfig.taskModels[taskType];
  if (!cur?.oneTimeOverrideModel) return;
  pendingConsumedOverrides.add(taskType);
  authoritativeAiConfig = {
    ...authoritativeAiConfig,
    taskModels: {
      ...authoritativeAiConfig.taskModels,
      [taskType]: {
        ...cur,
        oneTimeOverrideModel: null,
      },
    },
    updatedAt: new Date().toISOString(),
  };
  lastRemoteConfigSyncAt = Date.now();
  if (idToken) {
    try {
      await firestoreRestSet(
        'systemConfig/aiService',
        serializeSystemConfigForFirestore(authoritativeAiConfig),
        idToken
      );
      pendingConsumedOverrides.delete(taskType);
    } catch {
      // Non-fatal if caller doesn't have systemConfig write role
    }
  }
}

export async function setOneTimeTaskOverride(params: {
  taskType: AiTaskType;
  modelId: string | null;
  actorUid: string;
  actorEmail: string;
  idToken: string;
}): Promise<SystemAiConfig> {
  const { taskType, modelId, actorUid, actorEmail, idToken } = params;
  if (modelId && modelId.trim()) {
    pendingConsumedOverrides.delete(taskType);
  } else {
    pendingConsumedOverrides.add(taskType);
  }
  const curTask = authoritativeAiConfig.taskModels[taskType] || DEFAULT_TASK_MODELS[taskType];
  const next: SystemAiConfig = {
    ...authoritativeAiConfig,
    taskModels: {
      ...authoritativeAiConfig.taskModels,
      [taskType]: {
        ...curTask,
        oneTimeOverrideModel: modelId ? normalizeSupportedModelId(modelId) : null,
      },
    },
    updatedAt: new Date().toISOString(),
    updatedBy: actorUid,
  };
  authoritativeAiConfig = next;
  lastRemoteConfigSyncAt = Date.now();
  try {
    await firestoreRestSet('systemConfig/aiService', serializeSystemConfigForFirestore(next), idToken);
    pendingConsumedOverrides.delete(taskType);
  } catch (err) {
    console.warn('Warning: unable to persist 1-run model override via REST:', err);
  }
  await recordAuditLog(
    {
      actorUid,
      actorEmail,
      action: 'ONE_TIME_MODEL_OVERRIDE_SET',
      resourceType: 'systemConfig',
      resourceId: taskType,
      status: 'success',
      metadata: {
        taskType,
        overrideModel: modelId || 'cleared',
      },
    },
    idToken
  );
  return next;
}

export async function updateAuthoritativeAiConfig(
  patch: Partial<SystemAiConfig>,
  actorUid: string,
  actorEmail: string,
  idToken: string
): Promise<SystemAiConfig> {
  const hasThresholdPatch =
    patch.adaptiveLongTextThresholdChars !== undefined ||
    patch.rateLimitConfig?.adaptiveLongTextThresholdChars !== undefined;

  const shouldBumpVersion = Boolean(
    patch.taskModels || patch.activeModel || patch.allowedOrigins || hasThresholdPatch
  );
  if (patch.taskModels || patch.activeModel || hasThresholdPatch) {
    clearAiResponseCache();
  }

  let updatedTaskModels = patch.taskModels
    ? mergeTaskModels(authoritativeAiConfig.taskModels, patch.taskModels)
    : { ...authoritativeAiConfig.taskModels };

  if (patch.activeModel && !patch.taskModels) {
    const normalizedActive = normalizeSupportedModelId(patch.activeModel.trim());
    const propagated = {} as Record<AiTaskType, TaskModelConfig>;
    for (const taskKey of Object.keys(DEFAULT_TASK_MODELS) as AiTaskType[]) {
      const cur = updatedTaskModels[taskKey] || DEFAULT_TASK_MODELS[taskKey];
      propagated[taskKey] = {
        ...cur,
        defaultModel: normalizedActive,
      };
    }
    updatedTaskModels = propagated;
  }

  const nextThreshold = clampAdaptiveThresholdChars(
    patch.adaptiveLongTextThresholdChars ??
      patch.rateLimitConfig?.adaptiveLongTextThresholdChars ??
      authoritativeAiConfig.adaptiveLongTextThresholdChars
  );

  const next: SystemAiConfig = {
    ...authoritativeAiConfig,
    ...patch,
    activeModel: patch.activeModel
      ? normalizeSupportedModelId(patch.activeModel.trim())
      : authoritativeAiConfig.activeModel,
    adaptiveLongTextThresholdChars: nextThreshold,
    configVersion: shouldBumpVersion
      ? (authoritativeAiConfig.configVersion || 1) + 1
      : authoritativeAiConfig.configVersion || 1,
    allowedOrigins: Array.isArray(patch.allowedOrigins)
      ? patch.allowedOrigins.map((o) => o.trim()).filter(Boolean)
      : authoritativeAiConfig.allowedOrigins,
    taskModels: updatedTaskModels,
    rateLimitConfig: {
      ...authoritativeAiConfig.rateLimitConfig,
      ...(patch.rateLimitConfig || {}),
      adaptiveLongTextThresholdChars: nextThreshold,
    },
    experienceRatingEnabled:
      typeof patch.experienceRatingEnabled === 'boolean'
        ? patch.experienceRatingEnabled
        : authoritativeAiConfig.experienceRatingEnabled ?? getExperienceRatingConfig().enabled,
    updatedAt: new Date().toISOString(),
    updatedBy: actorUid,
  };
  authoritativeAiConfig = next;
  if (typeof patch.experienceRatingEnabled === 'boolean') {
    setExperienceRatingEnabled(patch.experienceRatingEnabled, actorEmail);
  }
  lastRemoteConfigSyncAt = Date.now();
  pendingConsumedOverrides.clear();

  try {
    await firestoreRestSet('systemConfig/aiService', serializeSystemConfigForFirestore(next), idToken);
  } catch (err) {
    console.warn('Warning: unable to persist systemConfig/aiService via REST:', err);
  }

  await recordAuditLog(
    {
      actorUid,
      actorEmail,
      action:
        patch.experienceRatingEnabled !== undefined && patch.enabled === undefined
          ? patch.experienceRatingEnabled
            ? 'EXPERIENCE_RATING_ENABLED'
            : 'EXPERIENCE_RATING_DISABLED'
          : patch.enabled === false
          ? 'AI_SERVICE_DISABLED'
          : patch.enabled === true
          ? 'AI_SERVICE_ACTIVATED'
          : 'SYSTEM_CONFIG_UPDATED',
      resourceType: 'systemConfig',
      resourceId: 'aiService',
      status: 'success',
      metadata: {
        enabled: next.enabled,
        experienceRatingEnabled: Boolean(next.experienceRatingEnabled ?? true),
        disabledReason: next.disabledReason,
        activeModel: next.activeModel,
        configVersion: next.configVersion,
      },
    },
    idToken
  );

  return next;
}

export interface GuardCheckResult {
  allowed: boolean;
  httpStatus?: number;
  code?: string;
  message?: string;
  config: SystemAiConfig;
}

export async function checkAiRequestGuard(params: {
  uid: string;
  email: string;
  idToken: string;
  requestType: 'ocr' | 'analysis' | 'quiz' | 'detect';
}): Promise<GuardCheckResult> {
  const { uid, email, idToken, requestType } = params;
  const config = await loadAuthoritativeAiConfig(idToken);

  if (!config.enabled) {
    recordUsageEvent({
      uid,
      email,
      requestType,
      outcome: 'blocked',
      quotaBlocked: false,
    });
    return {
      allowed: false,
      httpStatus: 503,
      code: 'AI_SERVICE_DISABLED',
      message: config.maintenanceMessage || DEFAULT_MAINTENANCE_MESSAGE,
      config,
    };
  }

  const now = Date.now();
  const limits = config.rateLimitConfig;

  // Per-minute check
  const minWindow = (minuteWindows.get(uid) || []).filter((t) => now - t < 60_000);
  if (minWindow.length >= limits.requestsPerMinute) {
    recordUsageEvent({ uid, email, requestType, outcome: 'blocked', quotaBlocked: true });
    return {
      allowed: false,
      httpStatus: 429,
      code: 'RATE_LIMIT_MINUTE',
      message: `Bạn đã vượt giới hạn ${limits.requestsPerMinute} yêu cầu AI mỗi phút. Vui lòng đợi một lát.`,
      config,
    };
  }

  // Per-hour check
  const hrWindow = (hourWindows.get(uid) || []).filter((t) => now - t < 3_600_000);
  if (hrWindow.length >= limits.requestsPerHour) {
    recordUsageEvent({ uid, email, requestType, outcome: 'blocked', quotaBlocked: true });
    return {
      allowed: false,
      httpStatus: 429,
      code: 'RATE_LIMIT_HOUR',
      message: `Bạn đã đạt giới hạn ${limits.requestsPerHour} yêu cầu AI mỗi giờ.`,
      config,
    };
  }

  if (requestType === 'analysis') {
    const today = todayDateKey();
    const userDay = dailyAnalyses.get(uid);
    const dayCount = userDay && userDay.date === today ? userDay.count : 0;
    if (dayCount >= limits.analysesPerDay) {
      recordUsageEvent({ uid, email, requestType, outcome: 'blocked', quotaBlocked: true });
      return {
        allowed: false,
        httpStatus: 429,
        code: 'DAILY_ANALYSIS_LIMIT',
        message: `Bạn đã đạt giới hạn ${limits.analysesPerDay} lần phân tích tài liệu trong ngày hôm nay.`,
        config,
      };
    }

    const lastTs = lastAnalysisTime.get(uid) || 0;
    if (now - lastTs < limits.cooldownSeconds * 1000) {
      const waitSec = Math.ceil((limits.cooldownSeconds * 1000 - (now - lastTs)) / 1000);
      recordUsageEvent({ uid, email, requestType, outcome: 'blocked', quotaBlocked: true });
      return {
        allowed: false,
        httpStatus: 429,
        code: 'COOLDOWN_ACTIVE',
        message: `Vui lòng đợi ${waitSec} giây trước khi gửi phân tích tiếp theo.`,
        config,
      };
    }

    const activeJobs = concurrentJobs.get(uid) || 0;
    if (activeJobs >= limits.maximumConcurrentJobs) {
      recordUsageEvent({ uid, email, requestType, outcome: 'blocked', quotaBlocked: true });
      return {
        allowed: false,
        httpStatus: 429,
        code: 'MAX_CONCURRENT_JOBS',
        message: `Đang có ${activeJobs} tác vụ phân tích chạy song song (tối đa ${limits.maximumConcurrentJobs}).`,
        config,
      };
    }

    lastAnalysisTime.set(uid, now);
    dailyAnalyses.set(uid, { date: today, count: dayCount + 1 });
  }

  minWindow.push(now);
  hrWindow.push(now);
  minuteWindows.set(uid, minWindow);
  hourWindows.set(uid, hrWindow);

  return { allowed: true, config };
}

export function incrementConcurrentJob(uid: string): void {
  concurrentJobs.set(uid, (concurrentJobs.get(uid) || 0) + 1);
}

export function decrementConcurrentJob(uid: string): void {
  const cur = concurrentJobs.get(uid) || 0;
  concurrentJobs.set(uid, Math.max(0, cur - 1));
}

export function rollbackAiRequestGuard(
  uid: string,
  requestType: 'ocr' | 'analysis' | 'quiz' | 'detect'
): void {
  if (requestType === 'analysis') {
    const today = todayDateKey();
    const userDay = dailyAnalyses.get(uid);
    if (userDay && userDay.date === today && userDay.count > 0) {
      dailyAnalyses.set(uid, { date: today, count: userDay.count - 1 });
    }
    lastAnalysisTime.delete(uid);
  }
  const minW = minuteWindows.get(uid);
  if (minW && minW.length > 0) {
    minW.pop();
  }
  const hrW = hourWindows.get(uid);
  if (hrW && hrW.length > 0) {
    hrW.pop();
  }
}

export function getIdempotentResult<T>(key: string): T | null {
  const hit = idempotencyCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    idempotencyCache.delete(key);
    return null;
  }
  return hit.payload as T;
}

export function setIdempotentResult(key: string, payload: unknown, ttlMs = 600_000): void {
  idempotencyCache.set(key, {
    expiresAt: Date.now() + ttlMs,
    payload,
  });
}

export function recordUsageEvent(params: {
  uid: string;
  email: string;
  requestType: 'ocr' | 'analysis' | 'quiz' | 'detect' | 'key_test';
  outcome: 'success' | 'failed' | 'blocked';
  webGrounded?: boolean;
  quotaBlocked?: boolean;
  providerError?: boolean;
  promptTokens?: number;
  candidateTokens?: number;
  totalTokens?: number;
}): void {
  const date = todayDateKey();
  const daily = getOrCreateDailyUsage(date);
  daily.requestCount += 1;
  if (params.outcome === 'success') daily.successfulCount += 1;
  if (params.outcome === 'failed') daily.failedCount += 1;
  if (params.outcome === 'blocked') daily.blockedCount += 1;
  if (params.requestType === 'analysis' && params.outcome !== 'blocked') daily.analysisCount += 1;
  if (params.requestType === 'quiz' && params.outcome !== 'blocked') daily.quizGenerationCount += 1;
  if (params.requestType === 'ocr' && params.outcome !== 'blocked') daily.ocrCount += 1;
  if (params.webGrounded) daily.webGroundedCount += 1;
  if (params.quotaBlocked) daily.quotaExceededEvents += 1;
  if (params.providerError) daily.providerErrorEvents += 1;
  if (params.promptTokens) daily.actualPromptTokens += params.promptTokens;
  if (params.candidateTokens) daily.actualCandidateTokens += params.candidateTokens;
  if (params.totalTokens) daily.actualTotalTokens += params.totalTokens;
  daily.updatedAt = new Date().toISOString();

  const userKey = `${params.uid}_${date}`;
  const uStat = userDailyUsageStore.get(userKey) || {
    uid: params.uid,
    email: params.email,
    date,
    requests: 0,
    analyses: 0,
    blocked: 0,
    tokens: 0,
  };
  uStat.requests += 1;
  if (params.requestType === 'analysis' && params.outcome !== 'blocked') uStat.analyses += 1;
  if (params.outcome === 'blocked') uStat.blocked += 1;
  if (params.totalTokens) uStat.tokens += params.totalTokens;
  userDailyUsageStore.set(userKey, uStat);
}

export async function persistUsageSnapshot(
  idToken: string,
  isSuperAdmin: boolean,
  uid?: string
): Promise<void> {
  const date = todayDateKey();
  if (uid) {
    const userStat = userDailyUsageStore.get(`${uid}_${date}`);
    if (userStat) {
      try {
        await firestoreRestSet(
          `users/${uid}/usageDaily/${date}`,
          userStat as unknown as Record<string, unknown>,
          idToken
        );
      } catch {
        // Non-fatal if Firestore quota/offline
      }
    }
  }
  if (!isSuperAdmin) return;
  const daily = getOrCreateDailyUsage(date);
  try {
    await firestoreRestSet(`apiUsageDaily/${date}`, daily as unknown as Record<string, unknown>, idToken);
  } catch {
    // Non-fatal if Firestore quota/offline
  }
}

export async function getUsageStatistics(idToken: string): Promise<{
  today: ApiUsageDaily;
  dailySeries: ApiUsageDaily[];
  perUserToday: Array<{ uid: string; email: string; requests: number; analyses: number; blocked: number; tokens: number }>;
}> {
  const todayKey = todayDateKey();
  const inMemory = Array.from(usageDailyStore.values());
  let remoteDocs: ApiUsageDaily[] = [];
  try {
    remoteDocs = await firestoreRestList<ApiUsageDaily>('apiUsageDaily', idToken, 60);
  } catch {
    remoteDocs = [];
  }

  const mergedMap = new Map<string, ApiUsageDaily>();
  for (const d of remoteDocs) {
    if (d && d.date) mergedMap.set(d.date, d);
  }
  for (const d of inMemory) {
    const existing = mergedMap.get(d.date);
    if (!existing || d.requestCount >= existing.requestCount) {
      mergedMap.set(d.date, d);
    }
  }

  const today = mergedMap.get(todayKey) || getOrCreateDailyUsage(todayKey);
  const dailySeries = Array.from(mergedMap.values()).sort((a, b) => a.date.localeCompare(b.date));

  const perUserToday = Array.from(userDailyUsageStore.values())
    .filter((u) => u.date === todayKey)
    .sort((a, b) => b.requests - a.requests);

  return { today, dailySeries, perUserToday };
}

export async function recordAuditLog(
  entry: Omit<AuditLogEntry, 'logId' | 'timestamp'>,
  idToken?: string
): Promise<AuditLogEntry> {
  const log: AuditLogEntry = {
    logId: `log_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
    timestamp: new Date().toISOString(),
    ...entry,
  };
  auditLogStore.unshift(log);
  if (auditLogStore.length > 200) auditLogStore.length = 200;

  if (idToken) {
    try {
      await firestoreRestSet(`auditLogs/${log.logId}`, log as unknown as Record<string, unknown>, idToken);
    } catch {
      // Non-fatal
    }
  }
  return log;
}

export async function getAuditLogs(idToken: string): Promise<AuditLogEntry[]> {
  let remote: AuditLogEntry[] = [];
  try {
    remote = await firestoreRestList<AuditLogEntry>('auditLogs', idToken, 100);
  } catch {
    remote = [];
  }
  const map = new Map<string, AuditLogEntry>();
  for (const r of remote) {
    if (r?.logId) map.set(r.logId, r);
  }
  for (const l of auditLogStore) {
    map.set(l.logId, l);
  }
  return Array.from(map.values()).sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}
