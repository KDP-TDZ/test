import { buildDeterministicCacheKey } from './cache.js';
import type {
  CoverageStatus,
  FixedRubric,
  GradeLevel,
  KnowledgeCoverageItem,
  ReferenceChunk,
  RubricCriterion,
  SubjectId,
} from './types.js';

function normalizeConceptKey(text: string): string {
  return (text || '')
    .toLowerCase()
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeWords(text: string): string[] {
  return normalizeConceptKey(text)
    .split(' ')
    .filter((w) => w.length >= 2);
}

/**
 * Deterministically classifies rubric criterion importance weight (1 | 2 | 3)
 * using academic signal keywords so the AI cannot arbitrarily mutate weights across runs.
 */
export function inferDeterministicCriterionWeight(
  concept: string,
  sourceKind: 'objective' | 'section' | 'concept_tag'
): 1 | 2 | 3 {
  const norm = normalizeConceptKey(concept);
  const coreSignals = [
    'khái niệm',
    'định nghĩa',
    'định luật',
    'định lí',
    'định lý',
    'công thức',
    'phương trình',
    'bản chất',
    'cấu tạo',
    'nguyên lí',
    'nguyên lý',
    'quy luật',
    'vai trò',
    'cơ chế',
    'tính chất',
    'điều kiện',
    'đặc điểm',
    'phân loại',
  ];
  const detailSignals = [
    'ví dụ',
    'lưu ý',
    'mở rộng',
    'vận dụng',
    'liên hệ',
    'thực tế',
    'ghi chú',
    'em có biết',
    'bài tập',
  ];

  if (detailSignals.some((s) => norm.includes(s))) {
    return 1;
  }
  if (coreSignals.some((s) => norm.includes(s))) {
    return 3;
  }
  if (sourceKind === 'objective') {
    return 3;
  }
  if (sourceKind === 'section') {
    return 2;
  }
  return 2;
}

/**
 * Builds a deterministic, pre-grading FixedRubric directly from indexed textbook ReferenceChunks.
 * Identical chunks + scope ALWAYS produce identical criterion IDs (KT01..KTn), order, weights, and rubricHash.
 */
export function buildFixedRubricFromChunks(params: {
  chunks: ReferenceChunk[];
  subject: SubjectId;
  grade: GradeLevel;
  textbookReferenceId: string;
  textbookTitle: string;
  selectedChapters?: string[];
  maxCriteria?: number;
}): FixedRubric {
  const {
    chunks,
    subject,
    grade,
    textbookReferenceId,
    textbookTitle,
    selectedChapters = [],
    maxCriteria = 24,
  } = params;

  const sortedChunks = [...chunks].sort(
    (a, b) => a.pageNumber - b.pageNumber || a.chunkId.localeCompare(b.chunkId)
  );

  const seenKeys = new Set<string>();
  const rawCriteria: Omit<RubricCriterion, 'criterionId'>[] = [];

  const tryAddCriterion = (candidate: Omit<RubricCriterion, 'criterionId'>) => {
    if (rawCriteria.length >= maxCriteria) return;
    const key = normalizeConceptKey(candidate.concept);
    if (!key || key.length < 3) return;
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    rawCriteria.push(candidate);
  };

  // Pass 1: Explicit learning objectives (highest pedagogical fidelity)
  for (const chunk of sortedChunks) {
    const objectives = Array.isArray(chunk.learningObjectives) ? chunk.learningObjectives : [];
    for (const obj of objectives) {
      const clean = (obj || '').trim();
      if (!clean) continue;
      tryAddCriterion({
        concept: clean.slice(0, 180),
        chapter: chunk.chapter,
        lesson: chunk.lesson,
        importanceWeight: inferDeterministicCriterionWeight(clean, 'objective'),
        referenceChunkId: chunk.chunkId,
        referencePage: chunk.pageNumber,
        referenceExcerpt: chunk.content.slice(0, 280),
        expectedKeywords: Array.from(
          new Set([...tokenizeWords(clean), ...(chunk.conceptTags || []).map(normalizeConceptKey)])
        )
          .filter(Boolean)
          .slice(0, 10),
      });
    }
  }

  // Pass 2: Distinct section titles from indexed textbook chunks
  for (const chunk of sortedChunks) {
    const section = (chunk.sectionTitle || '').trim();
    const isGenericSection =
      !section ||
      normalizeConceptKey(section) === 'noi dung chinh' ||
      normalizeConceptKey(section) === 'nội dung chính' ||
      normalizeConceptKey(section) === 'nội dung chuẩn sgk';
    const label = !isGenericSection ? section : (chunk.lesson || '').trim();
    if (!label) continue;
    tryAddCriterion({
      concept: label.slice(0, 180),
      chapter: chunk.chapter,
      lesson: chunk.lesson,
      importanceWeight: inferDeterministicCriterionWeight(label, 'section'),
      referenceChunkId: chunk.chunkId,
      referencePage: chunk.pageNumber,
      referenceExcerpt: chunk.content.slice(0, 280),
      expectedKeywords: Array.from(
        new Set([...tokenizeWords(label), ...(chunk.keywords || []).map(normalizeConceptKey)])
      )
        .filter(Boolean)
        .slice(0, 10),
    });
  }

  // Pass 3: Core concept tags when objectives/sections were sparse
  if (rawCriteria.length < 4) {
    for (const chunk of sortedChunks) {
      for (const tag of chunk.conceptTags || []) {
        const clean = (tag || '').trim();
        if (!clean || clean.length < 3) continue;
        tryAddCriterion({
          concept: clean.slice(0, 140),
          chapter: chunk.chapter,
          lesson: chunk.lesson,
          importanceWeight: inferDeterministicCriterionWeight(clean, 'concept_tag'),
          referenceChunkId: chunk.chunkId,
          referencePage: chunk.pageNumber,
          referenceExcerpt: chunk.content.slice(0, 280),
          expectedKeywords: tokenizeWords(clean).slice(0, 8),
        });
      }
    }
  }

  const criteria: RubricCriterion[] = rawCriteria.map((item, idx) => ({
    ...item,
    criterionId: `KT${String(idx + 1).padStart(2, '0')}`,
  }));

  const totalRequiredWeight = criteria.reduce((sum, c) => sum + c.importanceWeight, 0);
  const rubricMode =
    criteria.length > 0
      ? 'fixed_textbook_rubric'
      : selectedChapters.length > 0
      ? 'scope_guided'
      : 'unscoped';

  const rubricHash = buildDeterministicCacheKey({
    rubricMode,
    subject,
    grade,
    textbookReferenceId,
    selectedChapters: [...selectedChapters].sort(),
    criteria: criteria.map((c) => ({
      criterionId: c.criterionId,
      concept: c.concept,
      chapter: c.chapter,
      importanceWeight: c.importanceWeight,
      referenceChunkId: c.referenceChunkId,
    })),
  });

  return {
    rubricId: `rub_${rubricHash.slice(0, 12)}`,
    rubricHash,
    rubricMode,
    subject,
    grade,
    textbookReferenceId,
    textbookTitle,
    selectedChapters,
    criteria,
    totalRequiredWeight,
  };
}

/**
 * Formats the FixedRubric as an unambiguous checklist table injected into the grading prompt.
 */
export function formatFixedRubricForPrompt(rubric: FixedRubric): string {
  if (rubric.criteria.length === 0) {
    return 'Không có bảng rubric SGK cố định cho phạm vi này.';
  }
  const lines = [
    `BẢNG RUBRIC CỐ ĐỊNH BẮT BUỘC (${rubric.criteria.length} tiêu chí | tổng trọng số ${rubric.totalRequiredWeight} | mã rubric ${rubric.rubricId}):`,
    'BẮT BUỘC đánh giá ĐẦY ĐỦ TẤT CẢ các tiêu chí từ KT01 đến KT' +
      String(rubric.criteria.length).padStart(2, '0') +
      ' trong mảng coverageItems. KHÔNG được xóa tiêu chí, KHÔNG được tự đổi importanceWeight, và PHẢI ghi đúng criterionId.',
  ];
  for (const c of rubric.criteria) {
    lines.push(
      `- [${c.criterionId} | weight=${c.importanceWeight} | chunkId=${c.referenceChunkId} | Tr.${c.referencePage ?? '?'}] ${c.concept} (${c.chapter}${c.lesson ? ` - ${c.lesson}` : ''})`
    );
  }
  return lines.join('\n');
}

export interface RawAiCoverageEvaluation {
  criterionId?: string;
  concept: string;
  chapter: string;
  importanceWeight?: number;
  status: string;
  suggestedAddition?: string;
  referenceExcerpt?: string;
  referencePage?: number;
  matchedChunkId?: string;
}

function normalizeCoverageStatus(rawStatus: string): CoverageStatus {
  if (
    rawStatus === 'COVERED' ||
    rawStatus === 'PARTIALLY_COVERED' ||
    rawStatus === 'MISSING' ||
    rawStatus === 'OUT_OF_SCOPE'
  ) {
    return rawStatus;
  }
  return 'MISSING';
}

function computeConceptOverlap(a: string, b: string): number {
  const wordsA = new Set(tokenizeWords(a));
  const wordsB = new Set(tokenizeWords(b));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let shared = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) shared += 1;
  }
  return shared / Math.max(wordsA.size, wordsB.size);
}

/**
 * Reconciles AI coverage judgments strictly against a pre-built FixedRubric.
 * - Guarantees the completeness denominator ALWAYS matches the fixed rubric's criteria & weights.
 * - Prevents AI from mutating importanceWeight, dropping criteria, or inventing extra denominator items.
 * - Extra AI observations outside the fixed rubric are separated into `extraObservations`.
 */
export function reconcileCoverageAgainstFixedRubric(
  fixedRubric: FixedRubric,
  aiCoverageItems: RawAiCoverageEvaluation[]
): {
  coverageItems: KnowledgeCoverageItem[];
  extraObservations: KnowledgeCoverageItem[];
} {
  const usedAiIndices = new Set<number>();
  const coverageItems: KnowledgeCoverageItem[] = [];

  for (const criterion of fixedRubric.criteria) {
    // 1. Exact criterionId match
    let matchedIdx = aiCoverageItems.findIndex(
      (item, idx) =>
        !usedAiIndices.has(idx) &&
        typeof item.criterionId === 'string' &&
        item.criterionId.trim().toUpperCase() === criterion.criterionId.toUpperCase()
    );

    // 2. Fallback to highest lexical overlap on concept if AI omitted criterionId
    if (matchedIdx < 0) {
      let bestScore = 0;
      let bestIdx = -1;
      for (let i = 0; i < aiCoverageItems.length; i += 1) {
        if (usedAiIndices.has(i)) continue;
        const score = computeConceptOverlap(criterion.concept, aiCoverageItems[i].concept || '');
        if (score >= 0.45 && score > bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      }
      matchedIdx = bestIdx;
    }

    if (matchedIdx >= 0) {
      usedAiIndices.add(matchedIdx);
      const aiItem = aiCoverageItems[matchedIdx];
      const status = normalizeCoverageStatus(aiItem.status);
      // Fixed rubric criteria cannot be silently turned into OUT_OF_SCOPE unless truly empty
      const safeStatus: CoverageStatus = status === 'OUT_OF_SCOPE' ? 'MISSING' : status;
      coverageItems.push({
        itemId: criterion.criterionId,
        criterionId: criterion.criterionId,
        concept: criterion.concept,
        chapter: criterion.chapter,
        ...(criterion.lesson ? { lesson: criterion.lesson } : {}),
        importanceWeight: criterion.importanceWeight, // Locked by fixed rubric!
        status: safeStatus,
        suggestedAddition:
          safeStatus === 'COVERED'
            ? (aiItem.suggestedAddition || '').trim()
            : (aiItem.suggestedAddition || '').trim() ||
              `Bổ sung đầy đủ nội dung chuẩn SGK cho tiêu chí "${criterion.concept}".`,
        referenceExcerpt:
          (aiItem.referenceExcerpt || '').trim() || criterion.referenceExcerpt,
        ...(typeof criterion.referencePage === 'number' && criterion.referencePage > 0
          ? { referencePage: criterion.referencePage }
          : {}),
        matchedChunkId: criterion.referenceChunkId,
      });
    } else {
      // Criterion omitted by AI -> never silently drop from denominator; mark MISSING explicitly
      coverageItems.push({
        itemId: criterion.criterionId,
        criterionId: criterion.criterionId,
        concept: criterion.concept,
        chapter: criterion.chapter,
        ...(criterion.lesson ? { lesson: criterion.lesson } : {}),
        importanceWeight: criterion.importanceWeight,
        status: 'MISSING',
        suggestedAddition: `Bổ sung nội dung chuẩn SGK cho tiêu chí "${criterion.concept}".`,
        referenceExcerpt: criterion.referenceExcerpt,
        ...(typeof criterion.referencePage === 'number' && criterion.referencePage > 0
          ? { referencePage: criterion.referencePage }
          : {}),
        matchedChunkId: criterion.referenceChunkId,
      });
    }
  }

  // Separate any extra AI observations outside the fixed rubric
  const extraObservations: KnowledgeCoverageItem[] = [];
  aiCoverageItems.forEach((item, idx) => {
    if (usedAiIndices.has(idx)) return;
    if (!item.concept || !item.concept.trim()) return;
    const wRaw = Number(item.importanceWeight);
    const w: 1 | 2 | 3 = wRaw === 3 ? 3 : wRaw === 1 ? 1 : 2;
    extraObservations.push({
      itemId: `extra_${extraObservations.length + 1}`,
      concept: item.concept.trim(),
      chapter: (item.chapter || fixedRubric.selectedChapters[0] || 'Ghi nhận bổ sung').trim(),
      importanceWeight: w,
      status: normalizeCoverageStatus(item.status),
      suggestedAddition: (item.suggestedAddition || '').trim(),
      referenceExcerpt: (item.referenceExcerpt || '').trim(),
      ...(typeof item.referencePage === 'number' && item.referencePage > 0
        ? { referencePage: item.referencePage }
        : {}),
    });
  });

  return { coverageItems, extraObservations };
}
