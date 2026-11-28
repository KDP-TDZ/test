export const EXPERIENCE_REMIND_HOURS = 6;
export const EXPERIENCE_REMIND_MS = EXPERIENCE_REMIND_HOURS * 60 * 60 * 1000;
export const EXPERIENCE_MAX_AUTHOR_LENGTH = 60;
export const EXPERIENCE_MIN_COMMENT_LENGTH = 5;
export const EXPERIENCE_MAX_COMMENT_LENGTH = 400;
export const EXPERIENCE_STORAGE_KEY_PREFIX = 'studycheck_experience_rating_v1';

export const EXPERIENCE_ROLE_OPTIONS = [
  'Học sinh lớp 10',
  'Học sinh lớp 11',
  'Học sinh lớp 12',
  'Giáo viên / Phụ huynh',
  'Khách trải nghiệm',
] as const;

export type ExperienceRoleLabel = (typeof EXPERIENCE_ROLE_OPTIONS)[number];

export const EXPERIENCE_STAR_LABELS: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: 'Chưa hài lòng',
  2: 'Cần cải thiện',
  3: 'Bình thường',
  4: 'Hài lòng',
  5: 'Rất hài lòng',
};

export interface ExperienceRatingRecord {
  ratingId: string;
  ownerUid: string;
  authorName: string;
  roleLabel: ExperienceRoleLabel;
  stars: number;
  easeOfUse: number;
  usefulness: number;
  speedAndUi: number;
  comment: string;
  isVerifiedAccount: boolean;
  visibility: 'public';
  createdAt: string;
  updatedAt: string;
}

export interface ExperienceRatingInput {
  authorName?: string;
  roleLabel: ExperienceRoleLabel;
  stars: number;
  easeOfUse: number;
  usefulness: number;
  speedAndUi: number;
  comment: string;
}

export interface SanitizedExperienceRatingInput {
  authorName: string;
  roleLabel: ExperienceRoleLabel;
  stars: 1 | 2 | 3 | 4 | 5;
  easeOfUse: 1 | 2 | 3 | 4 | 5;
  usefulness: 1 | 2 | 3 | 4 | 5;
  speedAndUi: 1 | 2 | 3 | 4 | 5;
  comment: string;
}

export interface ExperienceStarBucket {
  star: 1 | 2 | 3 | 4 | 5;
  count: number;
  percent: number;
}

export interface ExperienceStatsSummary {
  totalCount: number;
  averageStars: number | null;
  satisfactionPercent: number | null;
  fiveStarPercent: number | null;
  verifiedAccountCount: number;
  distribution: ExperienceStarBucket[];
  aspectAverages: {
    easeOfUse: number | null;
    usefulness: number | null;
    speedAndUi: number | null;
  };
  recentComments: ExperienceRatingRecord[];
  latestUpdatedAt: string | null;
}

export interface RatingPromptStorageState {
  visitorId: string;
  hasRated: boolean;
  ratedRatingId?: string;
  ratedAt?: number;
  remindAfter?: number;
}

const VALID_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;
const GUEST_ID_REGEX = /^guest_[a-zA-Z0-9_-]{8,64}$/;

export function isValidExperienceRatingId(id: string): boolean {
  return typeof id === 'string' && VALID_ID_REGEX.test(id);
}

export function isValidGuestRatingId(id: string): boolean {
  return typeof id === 'string' && GUEST_ID_REGEX.test(id);
}

export function generateGuestRatingId(): string {
  const ts = Date.now().toString(36);
  const randA = Math.random().toString(36).slice(2, 10);
  const randB = Math.random().toString(36).slice(2, 8);
  const candidate = `guest_${ts}_${randA}${randB}`.replace(/[^a-zA-Z0-9_-]/g, '');
  return candidate.slice(0, 48);
}

function isValidScore(val: unknown): val is 1 | 2 | 3 | 4 | 5 {
  return typeof val === 'number' && Number.isInteger(val) && val >= 1 && val <= 5;
}

export function isExperienceRoleLabel(value: unknown): value is ExperienceRoleLabel {
  return (
    typeof value === 'string' &&
    (EXPERIENCE_ROLE_OPTIONS as readonly string[]).includes(value)
  );
}

export function validateExperienceRatingInput(
  input: Partial<ExperienceRatingInput>
): { ok: true; sanitized: SanitizedExperienceRatingInput } | { ok: false; error: string } {
  if (!isValidScore(input.stars)) {
    return { ok: false, error: 'Vui lòng chọn mức đánh giá từ 1 đến 5 sao.' };
  }

  const easeOfUse = isValidScore(input.easeOfUse) ? input.easeOfUse : input.stars;
  const usefulness = isValidScore(input.usefulness) ? input.usefulness : input.stars;
  const speedAndUi = isValidScore(input.speedAndUi) ? input.speedAndUi : input.stars;

  const roleLabel: ExperienceRoleLabel = isExperienceRoleLabel(input.roleLabel)
    ? input.roleLabel
    : 'Khách trải nghiệm';

  const rawAuthor = typeof input.authorName === 'string' ? input.authorName.trim() : '';
  const authorName = (rawAuthor || roleLabel).slice(0, EXPERIENCE_MAX_AUTHOR_LENGTH);

  const rawComment = typeof input.comment === 'string' ? input.comment.trim() : '';
  if (rawComment.length === 0) {
    return {
      ok: false,
      error: 'Vui lòng viết nhận xét về trải nghiệm của bạn trước khi gửi đánh giá.',
    };
  }
  if (rawComment.length < EXPERIENCE_MIN_COMMENT_LENGTH) {
    return {
      ok: false,
      error: `Nhận xét cần tối thiểu ${EXPERIENCE_MIN_COMMENT_LENGTH} ký tự để chia sẻ rõ trải nghiệm của bạn.`,
    };
  }
  if (rawComment.length > EXPERIENCE_MAX_COMMENT_LENGTH) {
    return {
      ok: false,
      error: `Nhận xét tối đa ${EXPERIENCE_MAX_COMMENT_LENGTH} ký tự.`,
    };
  }

  return {
    ok: true,
    sanitized: {
      authorName,
      roleLabel,
      stars: input.stars,
      easeOfUse,
      usefulness,
      speedAndUi,
      comment: rawComment,
    },
  };
}

export function buildExperienceRatingRecord(params: {
  ratingId: string;
  ownerUid: string;
  isVerifiedAccount: boolean;
  sanitized: SanitizedExperienceRatingInput;
  createdAt?: string;
  nowIso?: string;
}): ExperienceRatingRecord {
  const nowIso = params.nowIso || new Date().toISOString();
  const createdAt = params.createdAt || nowIso;
  return {
    ratingId: params.ratingId,
    ownerUid: params.ownerUid,
    authorName: params.sanitized.authorName.slice(0, EXPERIENCE_MAX_AUTHOR_LENGTH),
    roleLabel: params.sanitized.roleLabel,
    stars: params.sanitized.stars,
    easeOfUse: params.sanitized.easeOfUse,
    usefulness: params.sanitized.usefulness,
    speedAndUi: params.sanitized.speedAndUi,
    comment: params.sanitized.comment.slice(0, EXPERIENCE_MAX_COMMENT_LENGTH),
    isVerifiedAccount: params.isVerifiedAccount,
    visibility: 'public',
    createdAt,
    updatedAt: nowIso,
  };
}

function roundOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

function parseIsoMs(iso?: string): number {
  if (!iso) return 0;
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function aggregateExperienceRatings(
  records: readonly ExperienceRatingRecord[]
): ExperienceStatsSummary {
  const validRecords = records.filter(
    (r) =>
      r &&
      isValidScore(r.stars) &&
      isValidScore(r.easeOfUse) &&
      isValidScore(r.usefulness) &&
      isValidScore(r.speedAndUi)
  );

  const totalCount = validRecords.length;
  const counts: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

  if (totalCount === 0) {
    return {
      totalCount: 0,
      averageStars: null,
      satisfactionPercent: null,
      fiveStarPercent: null,
      verifiedAccountCount: 0,
      distribution: ([5, 4, 3, 2, 1] as const).map((star) => ({
        star,
        count: 0,
        percent: 0,
      })),
      aspectAverages: {
        easeOfUse: null,
        usefulness: null,
        speedAndUi: null,
      },
      recentComments: [],
      latestUpdatedAt: null,
    };
  }

  let sumStars = 0;
  let sumEase = 0;
  let sumUsefulness = 0;
  let sumSpeed = 0;
  let satisfiedCount = 0;
  let verifiedAccountCount = 0;

  for (const r of validRecords) {
    const s = r.stars as 1 | 2 | 3 | 4 | 5;
    counts[s] += 1;
    sumStars += s;
    sumEase += r.easeOfUse;
    sumUsefulness += r.usefulness;
    sumSpeed += r.speedAndUi;
    if (s >= 4) satisfiedCount += 1;
    if (r.isVerifiedAccount) verifiedAccountCount += 1;
  }

  const sortedNewest = [...validRecords].sort(
    (a, b) =>
      parseIsoMs(b.updatedAt || b.createdAt) - parseIsoMs(a.updatedAt || a.createdAt)
  );

  const recentComments = sortedNewest.filter((r) => (r.comment || '').trim().length > 0);
  const latestRecord = sortedNewest[0];

  return {
    totalCount,
    averageStars: roundOneDecimal(sumStars / totalCount),
    satisfactionPercent: Math.round((satisfiedCount / totalCount) * 100),
    fiveStarPercent: Math.round((counts[5] / totalCount) * 100),
    verifiedAccountCount,
    distribution: ([5, 4, 3, 2, 1] as const).map((star) => ({
      star,
      count: counts[star],
      percent: Math.round((counts[star] / totalCount) * 100),
    })),
    aspectAverages: {
      easeOfUse: roundOneDecimal(sumEase / totalCount),
      usefulness: roundOneDecimal(sumUsefulness / totalCount),
      speedAndUi: roundOneDecimal(sumSpeed / totalCount),
    },
    recentComments,
    latestUpdatedAt: latestRecord ? latestRecord.updatedAt || latestRecord.createdAt : null,
  };
}

export function computeSnoozeUntil(
  nowMs: number,
  hours = EXPERIENCE_REMIND_HOURS
): number {
  return nowMs + hours * 60 * 60 * 1000;
}

export function shouldShowExperiencePrompt(params: {
  state: RatingPromptStorageState;
  hasRemoteAccountRating: boolean;
  nowMs: number;
}): boolean {
  if (params.hasRemoteAccountRating) return false;
  if (params.state.hasRated) return false;
  if (
    typeof params.state.remindAfter === 'number' &&
    Number.isFinite(params.state.remindAfter) &&
    params.nowMs < params.state.remindAfter
  ) {
    return false;
  }
  return true;
}

export function formatExperienceRelativeTime(isoString: string, nowMs = Date.now()): string {
  const ts = parseIsoMs(isoString);
  if (!ts) return 'Vừa cập nhật';
  const diffMs = Math.max(0, nowMs - ts);
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'Vừa xong';
  if (diffMin < 60) return `${diffMin} phút trước`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours} giờ trước`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays} ngày trước`;

  const d = new Date(ts);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function getStorageKey(scopeKey = 'browser'): string {
  return `${EXPERIENCE_STORAGE_KEY_PREFIX}:${scopeKey}`;
}

export type MinimalStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function readPromptStorageState(
  storage: MinimalStorage | null,
  scopeKey = 'browser'
): RatingPromptStorageState {
  const fallback: RatingPromptStorageState = {
    visitorId: generateGuestRatingId(),
    hasRated: false,
  };

  if (!storage) return fallback;

  try {
    const key = getStorageKey(scopeKey);
    const raw = storage.getItem(key);
    if (!raw) {
      storage.setItem(key, JSON.stringify(fallback));
      return fallback;
    }
    const parsed = JSON.parse(raw) as Partial<RatingPromptStorageState>;
    const visitorId =
      typeof parsed.visitorId === 'string' && isValidGuestRatingId(parsed.visitorId)
        ? parsed.visitorId
        : generateGuestRatingId();
    const state: RatingPromptStorageState = {
      visitorId,
      hasRated: parsed.hasRated === true,
      ...(typeof parsed.ratedRatingId === 'string' ? { ratedRatingId: parsed.ratedRatingId } : {}),
      ...(typeof parsed.ratedAt === 'number' && Number.isFinite(parsed.ratedAt)
        ? { ratedAt: parsed.ratedAt }
        : {}),
      ...(typeof parsed.remindAfter === 'number' && Number.isFinite(parsed.remindAfter)
        ? { remindAfter: parsed.remindAfter }
        : {}),
    };
    if (state.visitorId !== parsed.visitorId) {
      storage.setItem(key, JSON.stringify(state));
    }
    return state;
  } catch {
    return fallback;
  }
}

export function savePromptSnooze(
  storage: MinimalStorage | null,
  nowMs = Date.now(),
  scopeKey = 'browser',
  hours = EXPERIENCE_REMIND_HOURS
): RatingPromptStorageState {
  const current = readPromptStorageState(storage, scopeKey);
  const next: RatingPromptStorageState = {
    ...current,
    remindAfter: computeSnoozeUntil(nowMs, hours),
  };
  if (storage) {
    try {
      storage.setItem(getStorageKey(scopeKey), JSON.stringify(next));
    } catch {
      // Ignore private-mode storage quota failures
    }
  }
  return next;
}

export function savePromptRated(
  storage: MinimalStorage | null,
  ratingId: string,
  nowMs = Date.now(),
  scopeKey = 'browser'
): RatingPromptStorageState {
  const current = readPromptStorageState(storage, scopeKey);
  const next: RatingPromptStorageState = {
    visitorId: current.visitorId,
    hasRated: true,
    ratedRatingId: ratingId,
    ratedAt: nowMs,
  };
  if (storage) {
    try {
      storage.setItem(getStorageKey(scopeKey), JSON.stringify(next));
    } catch {
      // Ignore private-mode storage quota failures
    }
  }
  return next;
}
