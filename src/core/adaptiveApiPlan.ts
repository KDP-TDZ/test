import type { AdaptiveApiPlanAudit, AiProviderId, CoverageStatus } from './types.js';

export const ADAPTIVE_LONG_TEXT_CHAR_THRESHOLD = 1500;
export const MIN_ADAPTIVE_THRESHOLD_CHARS = 300;
export const MAX_ADAPTIVE_THRESHOLD_CHARS = 20000;

export const MISTRAL_GRADE_MODEL = 'mistral:mistral-small-latest';
export const MISTRAL_VERIFY_MODEL = 'mistral:ministral-8b-latest';
export const MISTRAL_VISION_MODEL = 'mistral:mistral-small-latest';

export const CF_GRADE_MODEL = 'cf:@cf/meta/llama-3.3-70b-instruct-fp8-fast';
export const CF_VERIFY_MODEL = 'cf:@cf/meta/llama-3.1-8b-instruct-fast';
export const CF_VISION_MODEL = 'cf:@cf/qwen/qwen3.8-27b';

export const GROQ_SCAN_VISION_MODEL = 'groq:qwen/qwen3.8-27b';
export const GROQ_VERIFY_SLOT1_MODEL = 'groq:openai/gpt-oss-20b';
export const GROQ_VERIFY_SLOT2_MODEL = 'groq:qwen/qwen3.8-27b';
export const GROQ_GRADE_FALLBACK_MODEL = 'groq:openai/gpt-oss-120b';

export type AdaptiveStageCode = 'QUET' | 'CHAM' | 'DO';
export type AdaptiveSlotNumber = 1 | 2;

export interface AdaptiveApiPlan {
  textLength: number;
  thresholdChars: number;
  isLongText: boolean;
  scanApiCount: 1 | 2;
  gradeApiCount: 1 | 2;
  verifyApiCount: 1 | 2;
}

export interface StudentGradingBlock {
  pageNumber: number;
  blockId: string;
  text: string;
  sourceBlockId?: string;
}

export interface AdaptiveTextPageLike {
  pageNumber?: number;
  rawText?: string;
  confirmedText?: string;
  textBlocks?: Array<{ blockId?: string; text?: string }>;
}

export interface ConfiguredProvidersMap {
  mistral: boolean;
  groq: boolean;
  cloudflare: boolean;
}

export interface CoverageMergeCandidate {
  itemId?: string;
  criterionId?: string;
  concept: string;
  chapter?: string;
  lesson?: string;
  importanceWeight?: 1 | 2 | 3;
  status: CoverageStatus;
  suggestedAddition?: string;
  referenceExcerpt?: string;
  referencePage?: number;
  matchedChunkId?: string;
}

export interface GradedHalfPayload<TClaim = Record<string, unknown>, TCov extends CoverageMergeCandidate = CoverageMergeCandidate> {
  claims: TClaim[];
  coverageItems: TCov[];
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
}

const COVERAGE_STATUS_RANK: Record<CoverageStatus, number> = {
  COVERED: 4,
  PARTIALLY_COVERED: 3,
  MISSING: 2,
  OUT_OF_SCOPE: 1,
};

/**
 * Clamp Admin-configurable threshold strictly to [300, 20000], defaulting to 1500.
 */
export function clampAdaptiveThresholdChars(
  value: unknown,
  fallback = ADAPTIVE_LONG_TEXT_CHAR_THRESHOLD
): number {
  const safeFallback =
    typeof fallback === 'number' && Number.isFinite(fallback)
      ? Math.min(MAX_ADAPTIVE_THRESHOLD_CHARS, Math.max(MIN_ADAPTIVE_THRESHOLD_CHARS, Math.round(fallback)))
      : ADAPTIVE_LONG_TEXT_CHAR_THRESHOLD;

  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.min(
      MAX_ADAPTIVE_THRESHOLD_CHARS,
      Math.max(MIN_ADAPTIVE_THRESHOLD_CHARS, Math.round(value))
    );
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      return Math.min(
        MAX_ADAPTIVE_THRESHOLD_CHARS,
        Math.max(MIN_ADAPTIVE_THRESHOLD_CHARS, Math.round(parsed))
      );
    }
  }
  return safeFallback;
}

/**
 * Compute deterministic normalized (NFC + trimmed) character count from text or pages.
 */
export function computeNormalizedTextLength(
  input: string | AdaptiveTextPageLike[],
  ocrConfirmed = false
): number {
  if (typeof input === 'string') {
    return input.normalize('NFC').trim().length;
  }
  if (!Array.isArray(input) || input.length === 0) return 0;

  const combined = input
    .map((page) => {
      const preferred =
        ocrConfirmed && page.confirmedText && page.confirmedText.trim()
          ? page.confirmedText
          : page.rawText || page.confirmedText || '';
      if (preferred.trim()) return preferred.normalize('NFC').trim();
      if (Array.isArray(page.textBlocks) && page.textBlocks.length > 0) {
        return page.textBlocks
          .map((b) => String(b?.text || '').normalize('NFC').trim())
          .filter(Boolean)
          .join('\n');
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');

  return combined.normalize('NFC').trim().length;
}

/**
 * Determine whether Scan, Grade, and Verify run 1 API or 2 APIs based on text length vs threshold.
 */
export function computeAdaptiveApiPlan(
  textLength: number,
  thresholdChars?: number
): AdaptiveApiPlan {
  const safeLen = Number.isFinite(textLength) && textLength > 0 ? Math.floor(textLength) : 0;
  const threshold = clampAdaptiveThresholdChars(thresholdChars);
  const isLongText = safeLen >= threshold;
  const count: 1 | 2 = isLongText ? 2 : 1;

  return {
    textLength: safeLen,
    thresholdChars: threshold,
    isLongText,
    scanApiCount: count,
    gradeApiCount: count,
    verifyApiCount: count,
  };
}

export function createAdaptiveAuditMetadata(
  plan: AdaptiveApiPlan,
  overrides?: Partial<Pick<AdaptiveApiPlanAudit, 'verifyExecutedApiCount' | 'verifyAdjustmentsCount' | 'gradeModels' | 'verifyModels'>>
): AdaptiveApiPlanAudit {
  return {
    textLength: plan.textLength,
    thresholdChars: plan.thresholdChars,
    isLongText: plan.isLongText,
    scanApiCount: plan.scanApiCount,
    gradeApiCount: plan.gradeApiCount,
    verifyApiCount: plan.verifyApiCount,
    verifyExecutedApiCount: overrides?.verifyExecutedApiCount ?? 0,
    verifyAdjustmentsCount: overrides?.verifyAdjustmentsCount ?? 0,
    ...(overrides?.gradeModels ? { gradeModels: overrides.gradeModels } : {}),
    ...(overrides?.verifyModels ? { verifyModels: overrides.verifyModels } : {}),
  };
}

/**
 * Find a clean midpoint split index on newline or sentence boundary inside a single giant block.
 */
function findCleanMidpointSplit(text: string): number {
  const mid = Math.floor(text.length / 2);
  const windowRadius = Math.max(40, Math.floor(text.length * 0.2));
  const minIdx = Math.max(1, mid - windowRadius);
  const maxIdx = Math.min(text.length - 1, mid + windowRadius);

  // 1. Prefer newline nearest to midpoint
  let bestIdx = -1;
  let bestDist = Infinity;
  for (let i = minIdx; i <= maxIdx; i++) {
    if (text[i] === '\n') {
      const dist = Math.abs(i - mid);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i + 1;
      }
    }
  }
  if (bestIdx > 0 && bestIdx < text.length) return bestIdx;

  // 2. Next prefer sentence punctuation (. ! ? ;) followed by whitespace
  for (let i = minIdx; i <= maxIdx; i++) {
    const ch = text[i];
    if ((ch === '.' || ch === '!' || ch === '?' || ch === ';') && /\s/.test(text[i + 1] || '')) {
      const dist = Math.abs(i - mid);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i + 1;
      }
    }
  }
  if (bestIdx > 0 && bestIdx < text.length) return bestIdx;

  // 3. Fallback to nearest whitespace
  for (let i = minIdx; i <= maxIdx; i++) {
    if (/\s/.test(text[i])) {
      const dist = Math.abs(i - mid);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i + 1;
      }
    }
  }
  if (bestIdx > 0 && bestIdx < text.length) return bestIdx;

  return mid;
}

/**
 * Split student blocks into 2 character-balanced halves preserving page headers & blockIds.
 * If only 1 giant block exists, splits it cleanly near midpoint on newline/sentence boundary.
 */
export function splitStudentBlocksIntoTwoHalves(
  blocks: StudentGradingBlock[]
): [StudentGradingBlock[], StudentGradingBlock[]] {
  const clean = blocks
    .map((b) => ({
      ...b,
      text: String(b.text || '').normalize('NFC').trim(),
    }))
    .filter((b) => b.text.length > 0);

  if (clean.length === 0) return [[], []];

  if (clean.length === 1) {
    const only = clean[0];
    if (only.text.length < 40) {
      return [[only], []];
    }
    const splitAt = findCleanMidpointSplit(only.text);
    const leftText = only.text.slice(0, splitAt).trim();
    const rightText = only.text.slice(splitAt).trim();
    if (!leftText || !rightText) {
      return [[only], []];
    }
    return [
      [
        {
          pageNumber: only.pageNumber,
          blockId: only.blockId,
          sourceBlockId: only.sourceBlockId || only.blockId,
          text: leftText,
        },
      ],
      [
        {
          pageNumber: only.pageNumber,
          blockId: `${only.blockId}_part2`,
          sourceBlockId: only.sourceBlockId || only.blockId,
          text: rightText,
        },
      ],
    ];
  }

  const totalChars = clean.reduce((sum, b) => sum + b.text.length, 0);
  const target = totalChars / 2;

  let running = 0;
  let splitIndex = 1;
  let bestDiff = Infinity;

  for (let i = 0; i < clean.length - 1; i++) {
    running += clean[i].text.length;
    const diff = Math.abs(running - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      splitIndex = i + 1;
    }
  }

  return [clean.slice(0, splitIndex), clean.slice(splitIndex)];
}

/**
 * Format a half of student grading blocks into a prompt-ready page-grouped string.
 */
export function formatStudentBlocksForPrompt(blocks: StudentGradingBlock[]): string {
  const byPage = new Map<number, StudentGradingBlock[]>();
  for (const block of blocks) {
    const arr = byPage.get(block.pageNumber) || [];
    arr.push(block);
    byPage.set(block.pageNumber, arr);
  }
  const pageNums = Array.from(byPage.keys()).sort((a, b) => a - b);
  return pageNums
    .map((pageNumber) => {
      const items = byPage.get(pageNumber) || [];
      const lines = items.map((b) => `[${b.blockId}] ${b.text}`).join('\n');
      return `=== TRANG ${pageNumber} ===\n${lines}`;
    })
    .join('\n\n');
}

/**
 * Split graded claims into 2 balanced halves preserving original order.
 */
export function splitClaimsIntoTwoHalves<T>(claims: T[]): [T[], T[]] {
  if (!Array.isArray(claims) || claims.length === 0) return [[], []];
  if (claims.length === 1) return [[claims[0]], []];
  const mid = Math.ceil(claims.length / 2);
  return [claims.slice(0, mid), claims.slice(mid)];
}

function normalizeMergeKey(val: string | undefined): string {
  return String(val || '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function deduplicateStringsPreserveOrder(listA: string[], listB: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [...listA, ...listB]) {
    const trimmed = String(raw || '').normalize('NFC').trim();
    if (!trimmed) continue;
    const key = normalizeMergeKey(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

/**
 * Merge 2 parallel grading outputs deterministically:
 * - Claims concatenated in order (Part 1 then Part 2).
 * - CoverageItems merged by criterionId or normalized concept with strict precedence:
 *   COVERED > PARTIALLY_COVERED > MISSING > OUT_OF_SCOPE.
 * - Strengths, weaknesses, suggestions deduplicated cleanly.
 */
export function mergeGradedHalves<
  TClaim = Record<string, unknown>,
  TCov extends CoverageMergeCandidate = CoverageMergeCandidate,
>(
  part1: GradedHalfPayload<TClaim, TCov>,
  part2: GradedHalfPayload<TClaim, TCov>
): GradedHalfPayload<TClaim, TCov> {
  const claims = [...(part1.claims || []), ...(part2.claims || [])];

  const covMap = new Map<string, TCov>();
  const covOrder: string[] = [];

  for (const item of [...(part1.coverageItems || []), ...(part2.coverageItems || [])]) {
    const key = item.criterionId?.trim()
      ? `cid:${item.criterionId.trim()}`
      : `concept:${normalizeMergeKey(item.concept)}`;
    const existing = covMap.get(key);
    if (!existing) {
      covMap.set(key, item);
      covOrder.push(key);
      continue;
    }

    const existingRank = COVERAGE_STATUS_RANK[existing.status] ?? 0;
    const incomingRank = COVERAGE_STATUS_RANK[item.status] ?? 0;

    if (incomingRank > existingRank) {
      covMap.set(key, {
        ...existing,
        ...item,
        suggestedAddition:
          item.status === 'COVERED'
            ? item.suggestedAddition || ''
            : item.suggestedAddition || existing.suggestedAddition || '',
        referenceExcerpt: item.referenceExcerpt || existing.referenceExcerpt || '',
        matchedChunkId: item.matchedChunkId || existing.matchedChunkId,
      });
    } else if (incomingRank === existingRank) {
      covMap.set(key, {
        ...existing,
        suggestedAddition: existing.suggestedAddition || item.suggestedAddition || '',
        referenceExcerpt: existing.referenceExcerpt || item.referenceExcerpt || '',
        matchedChunkId: existing.matchedChunkId || item.matchedChunkId,
      });
    }
  }

  return {
    claims,
    coverageItems: covOrder.map((k) => covMap.get(k)!),
    strengths: deduplicateStringsPreserveOrder(part1.strengths || [], part2.strengths || []),
    weaknesses: deduplicateStringsPreserveOrder(part1.weaknesses || [], part2.weaknesses || []),
    suggestions: deduplicateStringsPreserveOrder(part1.suggestions || [], part2.suggestions || []),
  };
}

/**
 * Identify provider from model ID string.
 */
export function detectProviderIdFromModel(modelId: string): AiProviderId {
  const clean = String(modelId || '').trim().toLowerCase();
  if (clean.startsWith('groq:')) return 'groq';
  if (clean.startsWith('cf:') || clean.startsWith('cloudflare:') || clean.startsWith('@cf/')) {
    return 'cloudflare';
  }
  return 'mistral';
}

/**
 * Select the primary and fallback Verification models enforcing:
 * 1. NEVER reuse the provider that graded this part whenever >= 2 providers are configured.
 * 2. In parallel 2-API verification, Slot 1 and Slot 2 avoid hitting the exact same Groq 8K-TPM
 *    model bucket (Slot 1 prefers `groq:openai/gpt-oss-20b`; Slot 2 prefers `groq:qwen/qwen3.8-27b`
 *    or `mistral:ministral-8b-latest`).
 */
export function selectCrossProviderVerifierModel(params: {
  gradedByProvider: AiProviderId;
  slot: AdaptiveSlotNumber;
  configuredProviders: ConfiguredProvidersMap;
  slot1VerifyModel?: string;
}): { primaryModel: string; fallbackModel: string; primaryProvider: AiProviderId } {
  const { gradedByProvider, slot, configuredProviders, slot1VerifyModel } = params;

  const configuredList = (['mistral', 'groq', 'cloudflare'] as AiProviderId[]).filter(
    (p) => configuredProviders[p]
  );

  // Ordered candidate models tailored to slot and avoiding Groq 8K-TPM bucket collision
  const slot1GroqModel = GROQ_VERIFY_SLOT1_MODEL; // groq:openai/gpt-oss-20b
  const slot2GroqModel =
    slot1VerifyModel === GROQ_VERIFY_SLOT1_MODEL
      ? GROQ_VERIFY_SLOT2_MODEL // groq:qwen/qwen3.8-27b (separate 8K-TPM bucket)
      : GROQ_VERIFY_SLOT1_MODEL;

  const modelForProvider = (p: AiProviderId): string => {
    if (p === 'groq') return slot === 1 ? slot1GroqModel : slot2GroqModel;
    if (p === 'cloudflare') return CF_VERIFY_MODEL;
    return MISTRAL_VERIFY_MODEL;
  };

  // Preferred provider priority per slot
  // Slot 1 (typically verifying Mistral): Groq -> Cloudflare -> Mistral
  // Slot 2 (typically verifying Cloudflare): Groq (qwen3.8-27b bucket) -> Mistral -> Cloudflare
  const preferredOrder: AiProviderId[] =
    slot === 1
      ? ['groq', 'cloudflare', 'mistral']
      : ['groq', 'mistral', 'cloudflare'];

  // Step 1: Strictly exclude the grading provider if at least one OTHER configured provider exists
  const crossConfigured = preferredOrder.filter(
    (p) => p !== gradedByProvider && configuredProviders[p]
  );

  if (crossConfigured.length >= 2) {
    return {
      primaryModel: modelForProvider(crossConfigured[0]),
      fallbackModel: modelForProvider(crossConfigured[1]),
      primaryProvider: crossConfigured[0],
    };
  }

  if (crossConfigured.length === 1) {
    const primary = crossConfigured[0];
    // Fallback can only be another configured provider (or grading provider as last-resort outage safety)
    const fallbackProvider =
      configuredList.find((p) => p !== primary) ||
      preferredOrder.find((p) => p !== primary) ||
      primary;
    return {
      primaryModel: modelForProvider(primary),
      fallbackModel: modelForProvider(fallbackProvider),
      primaryProvider: primary,
    };
  }

  // Only 1 provider (the grading provider itself) or 0 providers configured
  const sole = configuredList[0] || preferredOrder.find((p) => p !== gradedByProvider) || 'groq';
  const fallbackP = preferredOrder.find((p) => p !== sole) || 'cloudflare';
  return {
    primaryModel: modelForProvider(sole),
    fallbackModel: modelForProvider(fallbackP),
    primaryProvider: sole,
  };
}

/**
 * Resolve scoped stage/slot API keys from environment variables with strict priority:
 * 1. Exact provider + stage + slot: `<PROVIDER>_KEY_<STAGE>_<SLOT>` (e.g. `GROQ_KEY_QUET_1`, `MISTRAL_KEY_CHAM_1`)
 * 2. Short stage + slot alias: `KEY_<STAGE>_<SLOT>` (e.g. `KEY_QUET_1`, `KEY_CHAM_1`, `KEY_DO_1`)
 *    (Safeguard: never send a Groq `gsk_` key to Mistral via the short alias.)
 * 3. Numbered provider key: `<PROVIDER>_API_KEY_<SLOT>` (e.g. `GROQ_API_KEY_1`, `MISTRAL_API_KEY_2`)
 * 4. Default provider key (`defaultKey` or `<PROVIDER>_API_KEY`)
 */
export function resolveScopedStageApiKey(params: {
  provider: 'groq' | 'mistral';
  stage: AdaptiveStageCode;
  slot: AdaptiveSlotNumber;
  env?: Record<string, string | undefined>;
  defaultKey?: string | null;
}): string | null {
  const { provider, stage, slot, defaultKey } = params;
  const env = params.env || (typeof process !== 'undefined' ? process.env : {});
  const prefix = provider === 'groq' ? 'GROQ' : 'MISTRAL';

  const pick = (name: string): string | null => {
    const val = env[name]?.trim();
    return val ? val : null;
  };

  // 1. Exact provider + stage + slot
  const exact = pick(`${prefix}_KEY_${stage}_${slot}`);
  if (exact) return exact;

  // 2. Short stage + slot alias
  const shortAlias = pick(`KEY_${stage}_${slot}`);
  if (shortAlias) {
    const looksLikeGroqKey = shortAlias.startsWith('gsk_');
    if (!(provider === 'mistral' && looksLikeGroqKey)) {
      return shortAlias;
    }
  }

  // 3. Numbered provider key
  const numbered = pick(`${prefix}_API_KEY_${slot}`);
  if (numbered) return numbered;

  // 4. Default provider key
  if (defaultKey && defaultKey.trim()) return defaultKey.trim();
  const baseEnv = pick(`${prefix}_API_KEY`);
  return baseEnv;
}
