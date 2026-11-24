import type {
  CognitiveLevel,
  ExamBlueprint,
  ExamDocument,
  ExamQuestion,
  ExtractedClaim,
  KnowledgeCoverageItem,
  QuizQuestion,
  QuizQuestionOrigin,
  QuizScope,
} from './types.js';

export interface QuizValidationReport {
  validCount: number;
  repairedCount: number;
  rejectedCount: number;
  issues: string[];
  questions: QuizQuestion[];
}

export function normalizeVietnameseText(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeCognitiveLevel(
  level: string | undefined,
  difficulty: 'basic' | 'medium' | 'advanced'
): CognitiveLevel {
  if (
    level === 'nhan_biet' ||
    level === 'thong_hieu' ||
    level === 'van_dung' ||
    level === 'van_dung_cao'
  ) {
    return level;
  }
  if (difficulty === 'basic') return 'nhan_biet';
  if (difficulty === 'medium') return 'thong_hieu';
  return 'van_dung';
}

export function validateSingleQuizQuestion(q: QuizQuestion): {
  issues: string[];
  repaired: boolean;
  rejected: boolean;
  question: QuizQuestion;
} {
  const issues: string[] = [];
  let repaired = false;
  let rejected = false;
  const next: QuizQuestion = { ...q };

  next.questionText = (next.questionText || '').trim();
  next.optionA = (next.optionA || '').trim();
  next.optionB = (next.optionB || '').trim();
  next.optionC = (next.optionC || '').trim();
  next.optionD = (next.optionD || '').trim();
  next.explanation = (next.explanation || '').trim();

  if (next.questionText.length < 10) {
    issues.push('Nội dung câu hỏi quá ngắn hoặc trống.');
    rejected = true;
  }

  const options = [next.optionA, next.optionB, next.optionC, next.optionD];
  if (options.some((opt) => !opt)) {
    issues.push('Có đáp án A/B/C/D bị bỏ trống.');
    rejected = true;
  }

  const normalizedOptions = options.map((opt) => normalizeVietnameseText(opt));
  const uniqueOptions = new Set(normalizedOptions.filter(Boolean));
  if (uniqueOptions.size < 4 && !rejected) {
    issues.push('Các phương án A/B/C/D bị trùng lặp nội dung.');
  }

  if (!['A', 'B', 'C', 'D'].includes(next.correctAnswer)) {
    next.correctAnswer = 'A';
    issues.push('Đáp án đúng không hợp lệ, đã đặt lại mặc định A.');
    repaired = true;
  }

  // Length bias heuristic: correct option shouldn't be suspiciously >2.3x longer than average distractor
  const correctIdx = ['A', 'B', 'C', 'D'].indexOf(next.correctAnswer);
  const correctLen = options[correctIdx]?.length || 0;
  const distractorLens = options
    .filter((_, idx) => idx !== correctIdx)
    .map((o) => o.length)
    .filter((len) => len > 0);
  const avgDistractorLen =
    distractorLens.length > 0
      ? distractorLens.reduce((acc, v) => acc + v, 0) / distractorLens.length
      : 0;
  if (avgDistractorLen >= 12 && correctLen > avgDistractorLen * 2.3) {
    issues.push('Cảnh báo thiên lệch độ dài: đáp án đúng dài vượt trội so với đáp án nhiễu.');
  }

  if (!next.explanation || next.explanation.length < 8) {
    next.explanation = `Đáp án ${next.correctAnswer} phù hợp nhất theo nội dung kiến thức đã kiểm chứng.`;
    issues.push('Thiếu giải thích chi tiết, đã bổ sung giải thích chuẩn.');
    repaired = true;
  }

  const normalizedCog = normalizeCognitiveLevel(next.cognitiveLevel, next.difficulty);
  if (next.cognitiveLevel !== normalizedCog) {
    next.cognitiveLevel = normalizedCog;
  }

  next.validationIssues = issues;
  if (rejected) {
    next.validationStatus = 'rejected';
  } else if (issues.length > 0) {
    next.validationStatus = repaired ? 'repaired' : 'needs_review';
  } else {
    next.validationStatus = 'passed';
  }

  return { issues, repaired, rejected, question: next };
}

/**
 * Code-only structural & deduplication validation pass over AI-generated quiz questions.
 */
export function validateQuizQuestionSet(questions: QuizQuestion[]): QuizValidationReport {
  const seenStems = new Set<string>();
  const kept: QuizQuestion[] = [];
  const allIssues: string[] = [];
  let validCount = 0;
  let repairedCount = 0;
  let rejectedCount = 0;

  for (const raw of questions) {
    const stemKey = normalizeVietnameseText(raw.questionText || '');
    if (stemKey && seenStems.has(stemKey)) {
      rejectedCount += 1;
      allIssues.push(`Loại câu trùng lặp: "${raw.questionText.slice(0, 60)}..."`);
      continue;
    }

    const res = validateSingleQuizQuestion(raw);
    if (res.rejected) {
      rejectedCount += 1;
      allIssues.push(...res.issues);
      continue;
    }

    if (stemKey) seenStems.add(stemKey);
    if (res.repaired) repairedCount += 1;
    else validCount += 1;

    allIssues.push(...res.issues);
    kept.push(res.question);
  }

  return {
    validCount,
    repairedCount,
    rejectedCount,
    issues: Array.from(new Set(allIssues)),
    questions: kept,
  };
}

/**
 * Validates an Exam Blueprint / Ma trận đề before generating exam items.
 */
export function validateExamBlueprint(blueprint: ExamBlueprint): {
  valid: boolean;
  errors: string[];
  computedScore: number;
  totalQuestions: number;
} {
  const errors: string[] = [];
  if (!blueprint.title?.trim()) errors.push('Thiếu tiêu đề ma trận đề.');
  if (!blueprint.rows || blueprint.rows.length === 0) {
    errors.push('Ma trận đề phải có ít nhất 1 dòng phân bổ kiến thức.');
  }

  let computedScore = 0;
  let totalQuestions = 0;

  for (const row of blueprint.rows || []) {
    if (row.questionCount <= 0) {
      errors.push(`Dòng "${row.topic || row.chapter}" có số câu <= 0.`);
    }
    if (row.scorePerQuestion <= 0) {
      errors.push(`Dòng "${row.topic || row.chapter}" có điểm mỗi câu <= 0.`);
    }
    computedScore += row.questionCount * row.scorePerQuestion;
    totalQuestions += row.questionCount;
  }

  computedScore = Math.round(computedScore * 100) / 100;
  if (Math.abs(computedScore - blueprint.totalScore) > 0.05) {
    errors.push(
      `Tổng điểm ma trận (${computedScore}) chưa khớp thang điểm quy định (${blueprint.totalScore}).`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    computedScore,
    totalQuestions,
  };
}

function deterministicHash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function shuffleWithSeed<T>(items: T[], seedStr: string): T[] {
  const copy = [...items];
  let state = deterministicHash(seedStr);
  for (let i = copy.length - 1; i > 0; i -= 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const j = state % (i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Updates an explanation string when an ABCD option letter moves from oldKey to newKey during exam variant shuffling.
 */
export function syncShuffledAbcdExplanation(
  explanation: string | undefined,
  oldKey: 'A' | 'B' | 'C' | 'D',
  newKey: 'A' | 'B' | 'C' | 'D'
): string {
  const raw = (explanation || '').trim();
  if (!raw || oldKey === newKey) return raw;

  let updated = raw
    .replace(
      new RegExp(`(\\b(?:Đáp án|Phương án)\\s+(?:đúng\\s+)?(?:theo tài liệu gốc\\s+)?(?:là\\s+)?)\\b${oldKey}\\b`, 'gi'),
      `$1${newKey}`
    )
    .replace(new RegExp(`(\\bChọn\\s+(?:đáp án|phương án)?\\s*)\\b${oldKey}\\b`, 'gi'), `$1${newKey}`);

  if (updated === raw) {
    updated = `${raw} (Mã đề này đáp án đúng: ${newKey})`;
  }
  return updated;
}

/**
 * Generates a shuffled exam code variant (e.g. Mã đề 101, 102, 103) while keeping answer keys exact.
 */
export function generateShuffledExamVariant(
  exam: ExamDocument,
  variantCode: string
): { variantCode: string; questions: ExamQuestion[] } {
  const shuffledQuestions = shuffleWithSeed(exam.questions, `${exam.examId}:${variantCode}`).map(
    (q, idx) => {
      if (q.questionType !== 'abcd') {
        return { ...q, orderIndex: idx + 1 };
      }
      const origCorrect: 'A' | 'B' | 'C' | 'D' = q.correctAnswer || 'A';
      const pairs: Array<{ key: 'A' | 'B' | 'C' | 'D'; text: string }> = [
        { key: 'A', text: q.optionA || '' },
        { key: 'B', text: q.optionB || '' },
        { key: 'C', text: q.optionC || '' },
        { key: 'D', text: q.optionD || '' },
      ];
      const shuffledOpts = shuffleWithSeed(pairs, `${exam.examId}:${variantCode}:${q.questionId}`);
      const letters: Array<'A' | 'B' | 'C' | 'D'> = ['A', 'B', 'C', 'D'];
      const newCorrectIdx = shuffledOpts.findIndex((p) => p.key === origCorrect);
      const nextCorrect = letters[newCorrectIdx >= 0 ? newCorrectIdx : 0];
      return {
        ...q,
        orderIndex: idx + 1,
        optionA: shuffledOpts[0].text,
        optionB: shuffledOpts[1].text,
        optionC: shuffledOpts[2].text,
        optionD: shuffledOpts[3].text,
        correctAnswer: nextCorrect,
        explanation: syncShuffledAbcdExplanation(q.explanation, origCorrect, nextCorrect),
      };
    }
  );

  return {
    variantCode,
    questions: shuffledQuestions,
  };
}

/**
 * Evenly distributes totalScore across exam questions (rounded to 2 decimals, exact sum on final question).
 */
export function distributeExamQuestionScores(
  questions: ExamQuestion[],
  totalScore: number
): ExamQuestion[] {
  if (questions.length === 0) return [];
  const safeTotal = Math.max(1, Number(totalScore) || 10);
  const perQuestion = Math.max(0.05, Math.round((safeTotal / questions.length) * 100) / 100);

  let running = 0;
  return questions.map((q, idx) => {
    let weight = perQuestion;
    if (idx === questions.length - 1) {
      const remainder = Math.round((safeTotal - running) * 100) / 100;
      if (remainder >= 0.05) {
        weight = remainder;
      }
    }
    running = Math.round((running + weight) * 100) / 100;
    return {
      ...q,
      orderIndex: idx + 1,
      scoreWeight: weight,
    };
  });
}

export function normalizeQuizQuestionOrigin(
  rawOrigin: string | undefined,
  isExternalAdvanced: boolean,
  fallbackOrigin: QuizQuestionOrigin
): QuizQuestionOrigin {
  if (isExternalAdvanced || rawOrigin === 'external_advanced') {
    return 'external_advanced';
  }
  if (
    rawOrigin === 'upload' ||
    rawOrigin === 'mistake_variation' ||
    rawOrigin === 'textbook_supplement'
  ) {
    return rawOrigin;
  }
  return fallbackOrigin;
}

function normalizeJsonEscapesForSalvage(input: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  const isHex = (ch: string) => /^[0-9a-fA-F]$/.test(ch);

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (inString) {
      if (escaped) {
        out += ch;
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        const next = input[i + 1] || '';
        const isStandardEscape =
          next === '"' ||
          next === '\\' ||
          next === '/' ||
          next === 'b' ||
          next === 'f' ||
          next === 'n' ||
          next === 'r' ||
          next === 't' ||
          (next === 'u' &&
            i + 5 < input.length &&
            isHex(input[i + 2]) &&
            isHex(input[i + 3]) &&
            isHex(input[i + 4]) &&
            isHex(input[i + 5]));
        if (isStandardEscape) {
          out += ch;
          escaped = true;
        } else {
          out += '\\\\';
        }
        continue;
      }
      if (ch === '"') {
        inString = false;
        out += ch;
        continue;
      }
      if (ch === '\n') {
        out += '\\n';
        continue;
      }
      if (ch === '\r') {
        out += '\\r';
        continue;
      }
      if (ch === '\t') {
        out += '\\t';
        continue;
      }
      if (ch.charCodeAt(0) < 0x20) {
        out += ' ';
        continue;
      }
      out += ch;
    } else {
      if (ch === '"') inString = true;
      out += ch;
    }
  }
  return out.replace(/,\s*([}\]])/g, '$1');
}

/**
 * Parses quiz questions from model JSON output and salvages all complete question objects
 * even if the response was truncated mid-array due to output token limits.
 */
export function salvageQuestionsFromTruncatedJson<T = Record<string, unknown>>(
  rawText: string
): T[] {
  const stripped = (rawText || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .trim();
  if (!stripped) return [];

  const fenced = stripped.match(/```(?:json)?\s*([\s\S]*?)(?:```|$)/i);
  const body = (fenced && fenced[1] ? fenced[1] : stripped).trim();

  // 1. Fast path: try full JSON parse (raw and escape-repaired)
  const candidates = [body];
  const fb = body.indexOf('{');
  const lb = body.lastIndexOf('}');
  if (fb >= 0 && lb > fb) {
    candidates.push(body.slice(fb, lb + 1));
  }
  for (const cand of candidates) {
    for (const attempt of [cand, normalizeJsonEscapesForSalvage(cand)]) {
      try {
        const parsed = JSON.parse(attempt) as unknown;
        if (Array.isArray(parsed)) {
          return parsed.filter((item): item is T => Boolean(item) && typeof item === 'object');
        }
        if (parsed && typeof parsed === 'object') {
          const obj = parsed as { questions?: unknown };
          if (Array.isArray(obj.questions)) {
            return obj.questions.filter(
              (item): item is T => Boolean(item) && typeof item === 'object'
            );
          }
        }
      } catch {
        // Continue to truncation salvage
      }
    }
  }

  // 2. Truncated array salvage: find `"questions": [` (or leading `[`) and extract every complete `{...}`
  const qKeyMatch = /"questions"\s*:\s*\[/i.exec(body);
  const arrayStart = qKeyMatch
    ? qKeyMatch.index + qKeyMatch[0].length - 1
    : body.indexOf('[');
  if (arrayStart < 0) return [];

  const salvaged: T[] = [];
  let inString = false;
  let escaped = false;
  let braceDepth = 0;
  let objStart = -1;

  for (let i = arrayStart + 1; i < body.length; i += 1) {
    const ch = body[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') {
      if (braceDepth === 0) objStart = i;
      braceDepth += 1;
      continue;
    }
    if (ch === '}') {
      if (braceDepth > 0) {
        braceDepth -= 1;
        if (braceDepth === 0 && objStart >= 0) {
          const slice = body.slice(objStart, i + 1);
          objStart = -1;
          for (const attempt of [slice, normalizeJsonEscapesForSalvage(slice)]) {
            try {
              const item = JSON.parse(attempt) as unknown;
              if (item && typeof item === 'object' && !Array.isArray(item)) {
                salvaged.push(item as T);
                break;
              }
            } catch {
              // Ignore malformed fragment
            }
          }
        }
      }
      continue;
    }
    if (ch === ']' && braceDepth === 0) {
      break;
    }
  }

  return salvaged;
}

export type QuizScopeStrategyMode =
  | 'mistake_variation'
  | 'upload_plus_textbook'
  | 'upload_sufficient'
  | 'empty_scope_fallback';

export interface QuizScopeStrategy {
  mode: QuizScopeStrategyMode;
  targetClaims: ExtractedClaim[];
  missingItems: KnowledgeCoverageItem[];
  distinctConceptCount: number;
  needsTextbookSupplement: boolean;
  expectedUploadSlots: number;
  expectedSupplementSlots: number;
}

/**
 * Determines scope-aware quiz generation strategy:
 * - Targeted scopes (`incorrect`, `partial`, `missing`): prioritize multi-angle variations
 *   directly from the targeted errors/gaps; only fall back to full document + textbook if empty.
 * - Broad scopes (`all`, `chapter`): harvest all uploaded concepts first, then automatically
 *   supplement from textbook/GDPT 2018 whenever distinct concepts < baseTargetCount.
 */
export function resolveQuizScopeStrategy(params: {
  scope: QuizScope;
  baseTargetCount: number;
  claims: ExtractedClaim[];
  coverageItems: KnowledgeCoverageItem[];
  chapterFilter?: string;
}): QuizScopeStrategy {
  const { scope, baseTargetCount, claims, coverageItems, chapterFilter } = params;
  const safeBase = Math.max(1, baseTargetCount);

  const countDistinct = (cList: ExtractedClaim[], mList: KnowledgeCoverageItem[]): number =>
    new Set(
      [
        ...cList.map((c) => normalizeVietnameseText(c.concept || c.sourceText.slice(0, 40))),
        ...mList.map((m) => normalizeVietnameseText(m.concept || '')),
      ].filter(Boolean)
    ).size;

  const allMissingOrPartial = coverageItems.filter(
    (i) => i.status === 'MISSING' || i.status === 'PARTIALLY_COVERED'
  );

  if (scope === 'incorrect' || scope === 'partial' || scope === 'missing') {
    const targetClaims =
      scope === 'incorrect'
        ? claims.filter((c) => c.evaluationStatus === 'INCORRECT')
        : scope === 'partial'
        ? claims.filter((c) => c.evaluationStatus === 'PARTIALLY_CORRECT')
        : [];
    const missingItems =
      scope === 'missing'
        ? allMissingOrPartial
        : scope === 'partial'
        ? coverageItems.filter((i) => i.status === 'PARTIALLY_COVERED')
        : [];

    const hasTargetedData = targetClaims.length > 0 || missingItems.length > 0;
    if (hasTargetedData) {
      const distinctConceptCount = Math.max(1, countDistinct(targetClaims, missingItems));
      return {
        mode: 'mistake_variation',
        targetClaims,
        missingItems,
        distinctConceptCount,
        needsTextbookSupplement: false,
        expectedUploadSlots: safeBase,
        expectedSupplementSlots: 0,
      };
    }

    const fallbackDistinct = countDistinct(claims, allMissingOrPartial);
    return {
      mode: 'empty_scope_fallback',
      targetClaims: claims,
      missingItems: allMissingOrPartial,
      distinctConceptCount: fallbackDistinct,
      needsTextbookSupplement: fallbackDistinct < safeBase,
      expectedUploadSlots: Math.min(safeBase, fallbackDistinct),
      expectedSupplementSlots: Math.max(0, safeBase - fallbackDistinct),
    };
  }

  let targetClaims = claims;
  let missingItems = allMissingOrPartial;
  if (scope === 'chapter' && chapterFilter?.trim()) {
    const needle = chapterFilter.trim().toLowerCase();
    const filteredClaims = claims.filter((c) => (c.chapter || '').toLowerCase().includes(needle));
    const filteredMissing = allMissingOrPartial.filter((m) =>
      (m.chapter || '').toLowerCase().includes(needle)
    );
    if (filteredClaims.length === 0 && filteredMissing.length === 0) {
      const fallbackDistinct = countDistinct(claims, allMissingOrPartial);
      return {
        mode: 'empty_scope_fallback',
        targetClaims: claims,
        missingItems: allMissingOrPartial,
        distinctConceptCount: fallbackDistinct,
        needsTextbookSupplement: fallbackDistinct < safeBase,
        expectedUploadSlots: Math.min(safeBase, fallbackDistinct),
        expectedSupplementSlots: Math.max(0, safeBase - fallbackDistinct),
      };
    }
    targetClaims = filteredClaims;
    missingItems = filteredMissing;
  }

  const distinctConceptCount = countDistinct(targetClaims, missingItems);
  const needsTextbookSupplement = distinctConceptCount < safeBase;
  return {
    mode: needsTextbookSupplement ? 'upload_plus_textbook' : 'upload_sufficient',
    targetClaims,
    missingItems,
    distinctConceptCount,
    needsTextbookSupplement,
    expectedUploadSlots: Math.min(safeBase, distinctConceptCount),
    expectedSupplementSlots: Math.max(0, safeBase - distinctConceptCount),
  };
}

export interface MergedQuizQuotaResult {
  questions: QuizQuestion[];
  baseQuestions: QuizQuestion[];
  advancedQuestions: QuizQuestion[];
  missingBase: number;
  missingAdvanced: number;
}

/**
 * Merges and deduplicates existing + newly generated quiz questions while enforcing separate
 * quotas for base questions and optional external advanced questions.
 */
export function mergeQuizQuestionsWithQuota(params: {
  existing: QuizQuestion[];
  incoming: QuizQuestion[];
  baseTargetCount: number;
  advancedTargetCount: number;
}): MergedQuizQuotaResult {
  const { existing, incoming, baseTargetCount, advancedTargetCount } = params;
  const safeBaseTarget = Math.max(1, baseTargetCount);
  const safeAdvTarget = Math.max(0, advancedTargetCount);

  const normalizedIncoming = incoming.map((q) => {
    if (safeAdvTarget === 0 && q.isExternalAdvanced) {
      return {
        ...q,
        isExternalAdvanced: false,
        questionOrigin:
          q.questionOrigin === 'external_advanced' ? 'textbook_supplement' : q.questionOrigin,
      } satisfies QuizQuestion;
    }
    return q;
  });

  const validated = validateQuizQuestionSet([...existing, ...normalizedIncoming]);

  const baseQuestions: QuizQuestion[] = [];
  const advancedQuestions: QuizQuestion[] = [];

  for (const q of validated.questions) {
    if (safeAdvTarget > 0 && q.isExternalAdvanced) {
      if (advancedQuestions.length < safeAdvTarget) {
        advancedQuestions.push(q);
      }
    } else if (baseQuestions.length < safeBaseTarget) {
      baseQuestions.push(q);
    }
  }

  return {
    questions: [...baseQuestions, ...advancedQuestions],
    baseQuestions,
    advancedQuestions,
    missingBase: Math.max(0, safeBaseTarget - baseQuestions.length),
    missingAdvanced: Math.max(0, safeAdvTarget - advancedQuestions.length),
  };
}

/**
 * Executes a main generation pass followed by up to `maxTopUpPasses` (default 2) automatic
 * continuation passes whenever valid deduplicated questions fall short of requested quotas.
 */
export async function runQuizGenerationWithTopUp(params: {
  baseTargetCount: number;
  advancedTargetCount: number;
  maxTopUpPasses?: number;
  generateBatch: (batchReq: {
    attempt: number;
    missingBase: number;
    missingAdvanced: number;
    existingQuestions: QuizQuestion[];
  }) => Promise<{ questions: QuizQuestion[]; modelUsed?: string }>;
}): Promise<{
  questions: QuizQuestion[];
  baseQuestions: QuizQuestion[];
  advancedQuestions: QuizQuestion[];
  missingBase: number;
  missingAdvanced: number;
  attemptsUsed: number;
  topUpPassesUsed: number;
  modelUsed: string;
}> {
  const maxTopUpPasses = Math.max(0, Math.min(3, params.maxTopUpPasses ?? 2));
  let merged = mergeQuizQuestionsWithQuota({
    existing: [],
    incoming: [],
    baseTargetCount: params.baseTargetCount,
    advancedTargetCount: params.advancedTargetCount,
  });
  let modelUsed = '';
  let attemptsUsed = 0;

  for (let attempt = 0; attempt <= maxTopUpPasses; attempt += 1) {
    if (attempt > 0 && merged.missingBase === 0 && merged.missingAdvanced === 0) {
      break;
    }
    attemptsUsed += 1;
    try {
      const batch = await params.generateBatch({
        attempt,
        missingBase: merged.missingBase,
        missingAdvanced: merged.missingAdvanced,
        existingQuestions: merged.questions,
      });
      if (batch.modelUsed && !modelUsed) {
        modelUsed = batch.modelUsed;
      }
      merged = mergeQuizQuestionsWithQuota({
        existing: merged.questions,
        incoming: batch.questions,
        baseTargetCount: params.baseTargetCount,
        advancedTargetCount: params.advancedTargetCount,
      });
    } catch (err) {
      // Fail fast only if the initial pass itself threw and we have zero questions
      if (attempt === 0 && merged.questions.length === 0) {
        throw err;
      }
      break;
    }
  }

  return {
    ...merged,
    attemptsUsed,
    topUpPassesUsed: Math.max(0, attemptsUsed - 1),
    modelUsed,
  };
}


