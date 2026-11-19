import type {
  CognitiveLevel,
  ExamBlueprint,
  ExamDocument,
  ExamQuestion,
  QuizQuestion,
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
      const pairs: Array<{ key: 'A' | 'B' | 'C' | 'D'; text: string }> = [
        { key: 'A', text: q.optionA || '' },
        { key: 'B', text: q.optionB || '' },
        { key: 'C', text: q.optionC || '' },
        { key: 'D', text: q.optionD || '' },
      ];
      const shuffledOpts = shuffleWithSeed(pairs, `${exam.examId}:${variantCode}:${q.questionId}`);
      const letters: Array<'A' | 'B' | 'C' | 'D'> = ['A', 'B', 'C', 'D'];
      const newCorrectIdx = shuffledOpts.findIndex((p) => p.key === (q.correctAnswer || 'A'));
      return {
        ...q,
        orderIndex: idx + 1,
        optionA: shuffledOpts[0].text,
        optionB: shuffledOpts[1].text,
        optionC: shuffledOpts[2].text,
        optionD: shuffledOpts[3].text,
        correctAnswer: letters[newCorrectIdx >= 0 ? newCorrectIdx : 0],
      };
    }
  );

  return {
    variantCode,
    questions: shuffledQuestions,
  };
}
