import type {
  AnalysisRecord,
  AnalysisStage,
  ClaimStatus,
  CoverageStatus,
  ExtractedClaim,
  KnowledgeCoverageItem,
  ReferenceEvidence,
} from './types';

export type VerificationStepId = 1 | 2 | 3 | 4 | 5;

export interface VerificationStepSpec {
  id: VerificationStepId;
  label: string;
  shortLabel: string;
  description: string;
  progressPct: number;
  progressScale: number;
}

export const VERIFICATION_STEPS: readonly VerificationStepSpec[] = [
  {
    id: 1,
    label: 'Nạp bài làm',
    shortLabel: 'Nạp bài',
    description: 'Chuẩn bị tệp PDF, DOCX hoặc ảnh chụp trang vở & nhận diện phạm vi SGK',
    progressPct: 12,
    progressScale: 0.12,
  },
  {
    id: 2,
    label: 'Rà soát OCR',
    shortLabel: 'Rà OCR',
    description: 'Trích xuất văn bản & công thức, kiểm tra các đoạn chữ viết tay hoặc ảnh mờ',
    progressPct: 35,
    progressScale: 0.35,
  },
  {
    id: 3,
    label: 'Đối chiếu chuẩn',
    shortLabel: 'Đối chiếu',
    description: 'Kiểm định 4 lớp đối chiếu sách giáo khoa & tính điểm độc lập',
    progressPct: 58,
    progressScale: 0.58,
  },
  {
    id: 4,
    label: 'Sửa lỗi',
    shortLabel: 'Sửa lỗi',
    description: 'Rà soát từng lỗi sai kiến thức, bổ sung ý thiếu và tự viết lại câu chuẩn',
    progressPct: 80,
    progressScale: 0.8,
  },
  {
    id: 5,
    label: 'Hoàn tất',
    shortLabel: 'Hoàn tất',
    description: 'Tổng kết chỉ số độc lập, xuất Phiếu sửa lỗi, tạo Flashcard & Trắc nghiệm',
    progressPct: 100,
    progressScale: 1,
  },
] as const;

export function getStepProgressFraction(stepId: VerificationStepId): number {
  const found = VERIFICATION_STEPS.find((s) => s.id === stepId);
  return found ? found.progressScale : 0.12;
}

export function resolveStepFromAnalysisStage(
  stage: AnalysisStage,
  options?: {
    hasUnresolvedErrors?: boolean;
    forceCompletedStep?: boolean;
  }
): VerificationStepId {
  switch (stage) {
    case 'queued':
    case 'uploading':
    case 'failed':
    case 'cancelled':
      return 1;
    case 'extracting':
    case 'awaiting_ocr_confirmation':
      return 2;
    case 'retrieving_references':
    case 'verifying':
    case 'calculating':
    case 'generating_report':
      return 3;
    case 'completed':
      if (options?.forceCompletedStep) return 5;
      if (options?.hasUnresolvedErrors === false) return 5;
      return 4;
    default:
      return 1;
  }
}

export function computeLivePipelineProgressPct(
  stage: AnalysisStage,
  progressDetail?: { current: number; total: number } | null
): number {
  const ratio =
    progressDetail && progressDetail.total > 0
      ? Math.max(0, Math.min(1, progressDetail.current / progressDetail.total))
      : 0.35;

  switch (stage) {
    case 'queued':
    case 'uploading':
      return Math.round(12 + ratio * 16); // 12% -> 28%
    case 'extracting':
      return Math.round(35 + ratio * 15); // 35% -> 50%
    case 'awaiting_ocr_confirmation':
      return 48;
    case 'retrieving_references':
      return 58;
    case 'verifying':
      return Math.round(62 + ratio * 8); // 62% -> 70%
    case 'calculating':
      return 72;
    case 'generating_report':
      return 76;
    case 'completed':
      return 80;
    default:
      return 12;
  }
}

export type ActionableCorrectionKind = 'claim_error' | 'claim_partial' | 'coverage_gap';

export interface ActionableCorrectionItem {
  id: string;
  kind: ActionableCorrectionKind;
  claimId?: string;
  coverageItemId?: string;
  concept: string;
  chapter: string;
  sourcePage?: number;
  sourceText: string;
  statusLabel: string;
  claimStatus?: ClaimStatus;
  coverageStatus?: CoverageStatus;
  explanation: string;
  reason?: string;
  correctKnowledge: string;
  suggestedFix: string;
  evidences: ReferenceEvidence[];
  importanceWeight: 1 | 2 | 3;
}

export function buildErrorCorrectionQueue(
  analysis: Pick<AnalysisRecord, 'claims' | 'coverageItems'>
): ActionableCorrectionItem[] {
  const items: ActionableCorrectionItem[] = [];

  // 1. Incorrect claims first (highest priority to fix)
  for (const claim of analysis.claims) {
    if (claim.evaluationStatus === 'INCORRECT') {
      items.push(mapClaimToCorrectionItem(claim, 'claim_error', 'Sai kiến thức / Công thức'));
    }
  }

  // 2. Partially correct or missing claims
  for (const claim of analysis.claims) {
    if (
      claim.evaluationStatus === 'PARTIALLY_CORRECT' ||
      claim.evaluationStatus === 'MISSING'
    ) {
      items.push(
        mapClaimToCorrectionItem(
          claim,
          'claim_partial',
          claim.evaluationStatus === 'MISSING'
            ? 'Thiếu mệnh đề trọng tâm'
            : 'Thiếu thông tin / Điều kiện'
        )
      );
    }
  }

  // 3. Uncovered or partially covered textbook chapter objectives
  for (const cov of analysis.coverageItems) {
    if (cov.status === 'MISSING' || cov.status === 'PARTIALLY_COVERED') {
      items.push(mapCoverageToCorrectionItem(cov));
    }
  }

  return items;
}

function mapClaimToCorrectionItem(
  claim: ExtractedClaim,
  kind: 'claim_error' | 'claim_partial',
  statusLabel: string
): ActionableCorrectionItem {
  return {
    id: `claim:${claim.claimId}`,
    kind,
    claimId: claim.claimId,
    concept: claim.concept,
    chapter: claim.chapter,
    sourcePage: claim.sourcePage,
    sourceText: claim.sourceText,
    statusLabel,
    claimStatus: claim.evaluationStatus,
    explanation: claim.explanation,
    reason: claim.reason,
    correctKnowledge: claim.correctKnowledge,
    suggestedFix: claim.suggestedFix || claim.correctKnowledge,
    evidences: claim.evidences || [],
    importanceWeight: claim.importanceWeight,
  };
}

function mapCoverageToCorrectionItem(cov: KnowledgeCoverageItem): ActionableCorrectionItem {
  const evidences: ReferenceEvidence[] = cov.referenceExcerpt
    ? [
        {
          evidenceId: `cov_ev_${cov.itemId}`,
          sourceType: 'textbook',
          title: 'Khung kiến thức chuẩn SGK',
          chapter: cov.chapter,
          lesson: cov.lesson,
          pageNumber: cov.referencePage,
          excerpt: cov.referenceExcerpt,
        },
      ]
    : [];

  return {
    id: `coverage:${cov.itemId}`,
    kind: 'coverage_gap',
    coverageItemId: cov.itemId,
    concept: cov.concept,
    chapter: cov.chapter,
    sourcePage: cov.referencePage,
    sourceText: 'Chưa đề cập hoặc trình bày chưa đủ trong bài làm đã nộp.',
    statusLabel:
      cov.status === 'MISSING' ? 'Còn thiếu trong bài làm' : 'Bao phủ mới một phần',
    coverageStatus: cov.status,
    explanation: `Mục tiêu chương "${cov.concept}" (${cov.chapter}) cần được bổ sung để hoàn thiện độ đầy đủ kiến thức.`,
    correctKnowledge: cov.referenceExcerpt || cov.suggestedAddition,
    suggestedFix: cov.suggestedAddition || cov.referenceExcerpt,
    evidences,
    importanceWeight: cov.importanceWeight,
  };
}
