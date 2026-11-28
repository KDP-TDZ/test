import type {
  AccuracyBreakdown,
  CompletenessBreakdown,
  ConfidenceLevel,
  ExtractedClaim,
  KnowledgeCoverageItem,
  MasteryStatus,
} from './types.js';

export interface MasteryRuleConfig {
  minAttempts: number;
  minSessions: number;
  minRecentAccuracyPercent: number;
  recentWindowSize: number;
}

export const DEFAULT_MASTERY_RULE: MasteryRuleConfig = {
  minAttempts: 5,
  minSessions: 2,
  minRecentAccuracyPercent: 80,
  recentWindowSize: 5,
};

/**
 * Largest-remainder rounding to 1 decimal place so non-zero buckets ALWAYS sum to exact 100.0
 * while zero-count buckets remain strictly 0.
 */
function computeNormalizedThreeGroupPercents(
  correct: number,
  partial: number,
  incorrect: number
): {
  exactCorrectPercent: number | null;
  partialPercent: number | null;
  exactIncorrectPercent: number | null;
  notFullyCorrectPercent: number | null;
} {
  const total = correct + partial + incorrect;
  if (total <= 0) {
    return {
      exactCorrectPercent: null,
      partialPercent: null,
      exactIncorrectPercent: null,
      notFullyCorrectPercent: null,
    };
  }

  const counts = [correct, partial, incorrect];
  // Scale to tenths of a percent (target sum = 1000)
  const rawTenths = counts.map((c) => (c / total) * 1000);
  const floored = rawTenths.map((v) => Math.floor(v));
  let remainder = 1000 - floored.reduce((acc, v) => acc + v, 0);

  const order = counts
    .map((count, idx) => ({
      idx,
      count,
      frac: rawTenths[idx] - floored[idx],
    }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => {
      if (b.frac !== a.frac) return b.frac - a.frac;
      return b.idx - a.idx;
    });

  let cursor = 0;
  while (remainder > 0 && order.length > 0) {
    floored[order[cursor % order.length].idx] += 1;
    remainder -= 1;
    cursor += 1;
  }

  const exactCorrectPercent = floored[0] / 10;
  const partialPercent = floored[1] / 10;
  const exactIncorrectPercent = floored[2] / 10;
  const notFullyCorrectPercent = Math.round((100 - exactCorrectPercent) * 10) / 10;

  return {
    exactCorrectPercent,
    partialPercent,
    exactIncorrectPercent,
    notFullyCorrectPercent,
  };
}

/**
 * Computes transparent Accuracy Score & Total Correct / Wrong percentages strictly from evaluated claims.
 * Every evaluated written claim counts equally (1 unit) so counts and percentages ALWAYS match 100% transparently:
 * - CORRECT = 1.0 điểm
 * - PARTIALLY_CORRECT = 0.5 điểm (đúng một phần / thiếu đơn vị / thiếu điều kiện)
 * - INCORRECT = 0.0 điểm
 * - UNVERIFIED, OCR_UNCERTAIN, OUT_OF_SCOPE, AMBIGUOUS are excluded from evaluatedTotal.
 * - MISSING is tracked separately in counts.missing (and Completeness) to prevent double-counting.
 * - Guarantees exactCorrectPercent + partialPercent + exactIncorrectPercent === 100 AND correctPercent + incorrectPercent === 100 when evaluatedTotal > 0.
 * Never returns a fabricated 100% when there are zero evaluated claims.
 */
export function calculateAccuracyScore(
  claims: ExtractedClaim[],
  hasReferenceTextbook: boolean
): AccuracyBreakdown {
  const counts = {
    total: claims.length,
    correct: 0,
    partiallyCorrect: 0,
    incorrect: 0,
    missing: 0,
    unverified: 0,
    ambiguous: 0,
    ocrUncertain: 0,
    outOfScope: 0,
  };

  let ocrConfidenceSum = 0;
  let ocrCount = 0;

  for (const claim of claims) {
    if (claim.evaluationStatus !== 'MISSING' && claim.evaluationStatus !== 'OUT_OF_SCOPE') {
      ocrConfidenceSum += typeof claim.ocrConfidence === 'number' ? claim.ocrConfidence : 1;
      ocrCount += 1;
    }

    switch (claim.evaluationStatus) {
      case 'CORRECT':
        counts.correct += 1;
        break;
      case 'PARTIALLY_CORRECT':
        counts.partiallyCorrect += 1;
        break;
      case 'INCORRECT':
        counts.incorrect += 1;
        break;
      case 'MISSING':
        counts.missing += 1;
        break;
      case 'UNVERIFIED':
        counts.unverified += 1;
        break;
      case 'AMBIGUOUS':
        counts.ambiguous += 1;
        break;
      case 'OCR_UNCERTAIN':
        counts.ocrUncertain += 1;
        break;
      case 'OUT_OF_SCOPE':
        counts.outOfScope += 1;
        break;
    }
  }

  const evaluatedTotal = counts.correct + counts.partiallyCorrect + counts.incorrect;
  const earnedPoints = counts.correct * 1 + counts.partiallyCorrect * 0.5;
  const totalGradableClaims =
    evaluatedTotal + counts.unverified + counts.ambiguous + counts.ocrUncertain;

  const accuracyScore =
    evaluatedTotal > 0 ? Math.round((earnedPoints / evaluatedTotal) * 1000) / 10 : null;
  const correctPercent = accuracyScore;
  const incorrectPercent =
    accuracyScore !== null ? Math.round((100 - accuracyScore) * 10) / 10 : null;

  const {
    exactCorrectPercent,
    partialPercent,
    exactIncorrectPercent,
    notFullyCorrectPercent,
  } = computeNormalizedThreeGroupPercents(counts.correct, counts.partiallyCorrect, counts.incorrect);

  const verifiedWeight = evaluatedTotal;
  const earnedWeight = earnedPoints;
  const totalClaimWeight = totalGradableClaims;

  const evidenceCoverage =
    totalGradableClaims > 0
      ? Math.round((evaluatedTotal / totalGradableClaims) * 1000) / 10
      : null;

  const avgOcrConfidence = ocrCount > 0 ? ocrConfidenceSum / ocrCount : 0;

  let confidenceLevel: ConfidenceLevel = 'Chưa đủ dữ liệu đánh giá';
  let confidenceReason = 'Chưa có đủ mệnh đề kiến thức được xác minh để đánh giá độ tin cậy.';

  if (evaluatedTotal > 0 && evidenceCoverage !== null) {
    if (avgOcrConfidence >= 0.85 && evidenceCoverage >= 75 && hasReferenceTextbook) {
      confidenceLevel = 'Cao';
      confidenceReason = `Độ rõ OCR đạt ${Math.round(avgOcrConfidence * 100)}%, tỷ lệ dẫn chứng kiểm chứng ${evidenceCoverage}% và có sách giáo khoa tham chiếu trực tiếp.`;
    } else if (avgOcrConfidence >= 0.65 && evidenceCoverage >= 45) {
      confidenceLevel = 'Trung bình';
      confidenceReason = hasReferenceTextbook
        ? `Tỷ lệ có dẫn chứng đạt ${evidenceCoverage}% với độ rõ văn bản ${Math.round(avgOcrConfidence * 100)}%. Một số ý cần đối chiếu thêm.`
        : `Chưa chọn sách giáo khoa tham chiếu cố định; tỷ lệ kiểm chứng đạt ${evidenceCoverage}%.`;
    } else {
      confidenceLevel = 'Thấp';
      confidenceReason = `Tỷ lệ nội dung có đủ căn cứ kiểm chứng mới đạt ${evidenceCoverage}% hoặc độ rõ OCR còn thấp (${Math.round(avgOcrConfidence * 100)}%).`;
    }
  }

  return {
    accuracyScore,
    evaluatedTotal,
    correctPercent,
    incorrectPercent,
    exactCorrectPercent,
    partialPercent,
    exactIncorrectPercent,
    notFullyCorrectPercent,
    verifiedWeight,
    earnedWeight,
    totalClaimWeight,
    evidenceCoverage,
    confidenceLevel,
    confidenceReason,
    counts,
  };
}

export interface ClaimScoreSummary {
  evaluatedTotal: number;
  correctCount: number;
  partialCount: number;
  incorrectCount: number;
  missingCount: number;
  wrongOrNeedFixCount: number;
  unverifiedCount: number;
  earnedPoints: number;
  correctPercent: number | null;
  incorrectPercent: number | null;
  exactCorrectPercent: number | null;
  partialPercent: number | null;
  exactIncorrectPercent: number | null;
  notFullyCorrectPercent: number | null;
}

/**
 * Pure helper for UI & reports to always display consistent counts and percentages
 * even for historical AnalysisRecord entries saved before the breakdown fields were added.
 */
export function computeClaimScoreSummary(
  claims: ExtractedClaim[],
  breakdown?: AccuracyBreakdown | null
): ClaimScoreSummary {
  const correctCount =
    breakdown?.counts?.correct ?? claims.filter((c) => c.evaluationStatus === 'CORRECT').length;
  const partialCount =
    breakdown?.counts?.partiallyCorrect ??
    claims.filter((c) => c.evaluationStatus === 'PARTIALLY_CORRECT').length;
  const incorrectCount =
    breakdown?.counts?.incorrect ?? claims.filter((c) => c.evaluationStatus === 'INCORRECT').length;
  const missingCount =
    breakdown?.counts?.missing ?? claims.filter((c) => c.evaluationStatus === 'MISSING').length;
  const unverifiedCount =
    breakdown?.counts
      ? breakdown.counts.unverified + breakdown.counts.ambiguous + breakdown.counts.ocrUncertain
      : claims.filter(
          (c) =>
            c.evaluationStatus === 'UNVERIFIED' ||
            c.evaluationStatus === 'AMBIGUOUS' ||
            c.evaluationStatus === 'OCR_UNCERTAIN'
        ).length;

  const evaluatedTotal = correctCount + partialCount + incorrectCount;
  const earnedPoints = correctCount * 1 + partialCount * 0.5;
  const correctPercent =
    evaluatedTotal > 0 ? Math.round((earnedPoints / evaluatedTotal) * 1000) / 10 : null;
  const incorrectPercent =
    correctPercent !== null ? Math.round((100 - correctPercent) * 10) / 10 : null;

  const {
    exactCorrectPercent,
    partialPercent,
    exactIncorrectPercent,
    notFullyCorrectPercent,
  } = computeNormalizedThreeGroupPercents(correctCount, partialCount, incorrectCount);

  return {
    evaluatedTotal,
    correctCount,
    partialCount,
    incorrectCount,
    missingCount,
    wrongOrNeedFixCount: incorrectCount + partialCount + missingCount,
    unverifiedCount,
    earnedPoints,
    correctPercent,
    incorrectPercent,
    exactCorrectPercent,
    partialPercent,
    exactIncorrectPercent,
    notFullyCorrectPercent,
  };
}

/**
 * Computes Completeness Score independently from Accuracy Score.
 * - COVERED = 1.0
 * - PARTIALLY_COVERED = 0.5
 * - MISSING = 0
 * - OUT_OF_SCOPE excluded
 * Returns null if no reference scope / coverage items exist.
 */
export function calculateCompletenessScore(
  coverageItems: KnowledgeCoverageItem[],
  hasValidScope: boolean,
  options: {
    rubricMode?: 'fixed_textbook_rubric' | 'scope_guided' | 'unscoped';
    rubricItemCount?: number;
    extraObservationsCount?: number;
  } = {}
): CompletenessBreakdown {
  const effectiveRubricMode =
    options.rubricMode || (hasValidScope ? 'scope_guided' : 'unscoped');

  if (!hasValidScope || effectiveRubricMode === 'unscoped' || coverageItems.length === 0) {
    return {
      completenessScore: null,
      coveredWeight: 0,
      totalRequiredWeight: 0,
      missingCount: 0,
      partialCount: 0,
      coveredCount: 0,
      rubricMode: 'unscoped',
      rubricItemCount: 0,
      extraObservationsCount: options.extraObservationsCount ?? 0,
    };
  }

  let totalRequiredWeight = 0;
  let coveredWeight = 0;
  let missingCount = 0;
  let partialCount = 0;
  let coveredCount = 0;

  for (const item of coverageItems) {
    if (item.status === 'OUT_OF_SCOPE') continue;
    totalRequiredWeight += 1;

    if (item.status === 'COVERED') {
      coveredWeight += 1;
      coveredCount += 1;
    } else if (item.status === 'PARTIALLY_COVERED') {
      coveredWeight += 0.5;
      partialCount += 1;
    } else {
      missingCount += 1;
    }
  }

  const completenessScore =
    totalRequiredWeight > 0 ? Math.round((coveredWeight / totalRequiredWeight) * 1000) / 10 : null;

  return {
    completenessScore,
    coveredWeight,
    totalRequiredWeight,
    missingCount,
    partialCount,
    coveredCount,
    rubricMode: effectiveRubricMode,
    rubricItemCount: options.rubricItemCount ?? coverageItems.length,
    extraObservationsCount: options.extraObservationsCount ?? 0,
  };
}

/**
 * Evaluates provisional concept mastery status using strict evidence rules.
 * A single correct answer NEVER marks a concept as 'Tạm nắm vững'.
 */
export function evaluateMasteryStatus(
  params: {
    encounteredCount: number;
    practiceAttemptCount: number;
    correctAttempts: number;
    incorrectAttempts: number;
    recentResults: boolean[];
    distinctSessionCount: number;
    reviewedDocument?: boolean;
  },
  rule: MasteryRuleConfig = DEFAULT_MASTERY_RULE
): { masteryStatus: MasteryStatus; recentAccuracy: number | null } {
  const {
    practiceAttemptCount,
    incorrectAttempts,
    recentResults,
    distinctSessionCount,
    reviewedDocument,
  } = params;

  if (practiceAttemptCount === 0) {
    return {
      masteryStatus: reviewedDocument ? 'Đã học qua' : 'Đã tiếp cận',
      recentAccuracy: null,
    };
  }

  const windowSlice = recentResults.slice(-rule.recentWindowSize);
  const recentCorrect = windowSlice.filter(Boolean).length;
  const recentAccuracy =
    windowSlice.length > 0 ? Math.round((recentCorrect / windowSlice.length) * 1000) / 10 : null;

  // Provisional mastery check: requires >=5 attempts, >=2 distinct sessions, >=80% accuracy over recent 5
  if (
    practiceAttemptCount >= rule.minAttempts &&
    distinctSessionCount >= rule.minSessions &&
    windowSlice.length >= rule.minAttempts &&
    recentAccuracy !== null &&
    recentAccuracy >= rule.minRecentAccuracyPercent
  ) {
    return {
      masteryStatus: 'Tạm nắm vững',
      recentAccuracy,
    };
  }

  // Needs review if recent accuracy is weak (< 60%) or repeated mistakes occurred without recovery
  const lastTwo = recentResults.slice(-2);
  const consecutiveMisses = lastTwo.length === 2 && !lastTwo[0] && !lastTwo[1];
  if (
    consecutiveMisses ||
    (recentAccuracy !== null && recentAccuracy < 60 && practiceAttemptCount >= 2) ||
    (incorrectAttempts >= 2 && (recentAccuracy ?? 0) < 70)
  ) {
    return {
      masteryStatus: 'Cần ôn tập',
      recentAccuracy,
    };
  }

  if (practiceAttemptCount >= 2) {
    return {
      masteryStatus: 'Đang củng cố',
      recentAccuracy,
    };
  }

  return {
    masteryStatus: incorrectAttempts > 0 ? 'Cần ôn tập' : 'Đã học qua',
    recentAccuracy,
  };
}
