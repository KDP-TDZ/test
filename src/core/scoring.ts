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
 * Computes Accuracy Score strictly from verified claims present in the student's document.
 * - CORRECT = 1.0
 * - PARTIALLY_CORRECT = 0.5
 * - INCORRECT = 0
 * - UNVERIFIED, OCR_UNCERTAIN, OUT_OF_SCOPE, AMBIGUOUS, MISSING are excluded from Accuracy denominator.
 * Never returns a fabricated 100% when there are zero verified claims.
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

  let totalClaimWeight = 0;
  let verifiedWeight = 0;
  let earnedWeight = 0;
  let ocrConfidenceSum = 0;
  let ocrCount = 0;

  for (const claim of claims) {
    const w = claim.importanceWeight || 1;
    if (claim.evaluationStatus !== 'MISSING' && claim.evaluationStatus !== 'OUT_OF_SCOPE') {
      totalClaimWeight += w;
      ocrConfidenceSum += typeof claim.ocrConfidence === 'number' ? claim.ocrConfidence : 1;
      ocrCount += 1;
    }

    switch (claim.evaluationStatus) {
      case 'CORRECT':
        counts.correct += 1;
        verifiedWeight += w;
        earnedWeight += w * 1.0;
        break;
      case 'PARTIALLY_CORRECT':
        counts.partiallyCorrect += 1;
        verifiedWeight += w;
        earnedWeight += w * 0.5;
        break;
      case 'INCORRECT':
        counts.incorrect += 1;
        verifiedWeight += w;
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

  const accuracyScore =
    verifiedWeight > 0 ? Math.round((earnedWeight / verifiedWeight) * 1000) / 10 : null;

  const evidenceCoverage =
    totalClaimWeight > 0 ? Math.round((verifiedWeight / totalClaimWeight) * 1000) / 10 : null;

  const avgOcrConfidence = ocrCount > 0 ? ocrConfidenceSum / ocrCount : 0;

  let confidenceLevel: ConfidenceLevel = 'Chưa đủ dữ liệu đánh giá';
  let confidenceReason = 'Chưa có đủ mệnh đề kiến thức được xác minh để đánh giá độ tin cậy.';

  if (verifiedWeight > 0 && evidenceCoverage !== null) {
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
    verifiedWeight,
    earnedWeight,
    totalClaimWeight,
    evidenceCoverage,
    confidenceLevel,
    confidenceReason,
    counts,
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
    const w = item.importanceWeight || 1;
    totalRequiredWeight += w;

    if (item.status === 'COVERED') {
      coveredWeight += w * 1.0;
      coveredCount += 1;
    } else if (item.status === 'PARTIALLY_COVERED') {
      coveredWeight += w * 0.5;
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
