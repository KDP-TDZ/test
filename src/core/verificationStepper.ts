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
    description: 'Chọn tệp PDF, DOCX hoặc ảnh chụp vở kèm khối lớp & môn học',
    progressPct: 12,
    progressScale: 0.12,
  },
  {
    id: 2,
    label: 'Rà soát OCR',
    shortLabel: 'Rà OCR',
    description: 'Kiểm tra văn bản & công thức nhận diện, chỉnh các đoạn mờ (< 72%)',
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

/**
 * 7-Block Zero-Deviation Master Prompt for Gemini Argon to build or extend
 * the 5-Step Exercise Verification & Error-Correction Workflow UI.
 */
export const GEMINI_ARGON_VERIFICATION_UI_PROMPT = `# MASTER PROMPT CHO GEMINI ARGON — XÂY DỰNG GIAO DIỆN QUY TRÌNH KIỂM ĐỊNH & SỬA LỖI BÀI TẬP 5 BƯỚC (STUDYCHECK AI)

## KHỐI 1: VAI TRÒ & NGUYÊN TẮC BẤT DI BẤT DỊCH (ROLE & INVARIANT PRINCIPLES)
Bạn là kỹ sư giao diện chính thực thi trên model **Gemini Argon (\`gemini-4-argon\`)**. Nhiệm vụ của bạn là xây dựng và duy trì **Giao diện Quy trình Kiểm định & Sửa lỗi Bài tập 5 Bước** bám sát 100% ảnh thiết kế tham chiếu và khớp tuyệt đối với cấu trúc dữ liệu thật của **StudyCheck AI**.
- **Mục tiêu cốt lõi**: Chuyển hóa quy trình từ lúc học sinh gửi bài tập (ảnh chụp vở viết tay, PDF, DOCX) đến khi sửa xong từng lỗi kiến thức/công thức thành luồng dẫn đường 5 bước trực quan, nhẹ nhàng, không quá tải thị giác.
- **Bảo toàn tầng AI phía máy chủ**: Toàn bộ model xử lý tệp, OCR, đối chiếu SGK và Model Router đã được cấu hình sẵn ở backend. Bạn **CHỈ** xây dựng lớp giao diện quy trình & tương tác sửa lỗi, **TUYỆT ĐỐI KHÔNG** thay đổi Model Router hay ghi đè cấu hình model xử lý tệp.

---

## KHỐI 2: ĐẶC TẢ THỊ GIÁC PIXEL-BY-PIXEL TỪ ẢNH THAM CHIẾU (VISUAL ANATOMY)
1. **Khung nền khí quyển (Atmospheric Backdrop)**:
   - Light mode: Dải chuyển sắc dọc từ Teal đậm (\`#0E4B5A\`) qua Xanh ngọc dịu (\`#6AA5B3\`) xuống Trắng băng (\`#EAF4F6\`).
   - Dark mode (\`@custom-variant dark\`): Dải đêm xanh thẫm (\`#08141E\` -> \`#0C2230\` -> \`#0F172A\`) đảm bảo độ tương phản chữ >= 4.5:1.
2. **Thẻ nổi trung tâm (Floating Stepper Card)**:
   - Nền trắng tinh \`#FFFFFF\` (Dark: \`#111C2D\`), bo góc lớn \`28px–32px\`, bóng đổ mềm sâu (\`0 24px 56px -16px rgba(14,75,90,0.22)\`), viền hairline mảnh \`1px\`.
   - Khoảng thở nội bộ rộng rãi (\`px-6 py-7 sm:px-10 sm:py-9\`).
3. **5 Vòng tròn bước độc lập trên trục ngang (NO CONNECTING LINES)**:
   - **ĐẶC ĐIỂM NHẬN DIỆN SỐ 1**: Tuyệt đối **KHÔNG** vẽ đường kẻ ngang nối giữa các vòng tròn \`1..5\`. Các vòng tròn đứng độc lập trên trục ngang 5 cột đều nhau; mạch liên kết nằm hoàn toàn ở thanh tiến trình đơn liên tục dưới đáy thẻ.
   - Kích thước mỗi vòng tròn: \`40px × 40px\` (\`rounded-full\`), chữ số dùng \`font-mono tabular-nums\`.
   - **Bước đang hoạt động (Active)**: Nền đặc Teal đậm \`#0E4D5D\` (Dark: \`#0891B2\`), chữ trắng \`#FFFFFF\`, đổ bóng nhẹ.
   - **Bước đã hoàn thành (Completed)**: Nền Teal nhạt \`#F0FDFA\` (Dark: \`rgba(8,145,178,0.2)\`), viền \`1.25px solid #0E4D5D\`, cho phép nhấp để quay lại.
   - **Bước chưa tới (Upcoming)**: Nền trắng \`#FFFFFF\` (Dark: \`#111C2D\`), viền hairline \`1.25px solid #64748B\`, chữ \`#475569\` (Dark: \`#94A3B8\`).
4. **Nhãn bước bên dưới vòng tròn**:
   - Căn giữa ngay dưới mỗi vòng tròn (khoảng cách dọc \`14px\`), tối đa 2–4 từ trên một dòng (\`whitespace-nowrap\` trên desktop), vùng chạm tối thiểu \`44px × 44px\`.
   - Nhãn bước đang mở in đậm \`font-semibold text-[#0F172A] dark:text-white\`; nhãn bước khác dùng \`font-medium text-[#475569] dark:text-[#94A3B8]\`.
5. **Thanh ray tiến trình đáy liên tục (Continuous Bottom Progress Rail)**:
   - Đặt cách hàng nhãn \`24px–28px\`, chiều cao \`6px\` (\`h-1.5\`), bo tròn hai đầu (\`rounded-full\`), nền xám nhạt \`#E2E8F0\` (Dark: \`#1E293B\`).
   - Thanh fill màu Cyan \`#06B6D4\` bo tròn hai đầu, chuyển động mượt bằng GPU (\`transform: scaleX(...)\`, \`transform-origin: left\`, thời gian \`<= 200ms\`) theo đúng 5 mốc:
     - Bước 1: \`12%\` (\`scaleX(0.12)\`)
     - Bước 2: \`35%\` (\`scaleX(0.35)\`)
     - Bước 3: \`58%\` (\`scaleX(0.58)\`)
     - Bước 4: \`80%\` (\`scaleX(0.80)\`)
     - Bước 5: \`100%\` (\`scaleX(1.00)\`)

---

## KHỐI 3: HỢP ĐỒNG 5 BƯỚC & BẢNG CHUYỂN TRẠNG THÁI (5-STEP WORKFLOW CONTRACT)
- **Bước 1 — Nạp bài làm** (\`queued\` | \`uploading\`): Chọn tệp PDF/DOCX/Ảnh vở ghi, chọn Khối lớp (\`10 | 11 | 12\`) & Môn học (\`SubjectId\`), tùy chọn bật rà soát OCR trước khi chấm.
- **Bước 2 — Rà soát OCR** (\`extracting\` | \`awaiting_ocr_confirmation\`): Xem song song trang tài liệu gốc và các khối \`ExtractedTextBlock\`. Tô sáng cảnh báo các khối có \`confidence < 0.72\` để học sinh sửa trực tiếp \`extractedText\` trước khi chấm, không để lỗi OCR bị tính nhầm thành sai kiến thức.
- **Bước 3 — Đối chiếu chuẩn** (\`retrieving_references\` | \`verifying\` | \`calculating\` | \`generating_report\`): Hiển thị tiến trình kiểm định 4 lớp thời gian thực theo từng chặng của pipeline sẵn có.
- **Bước 4 — Sửa lỗi** (\`completed\` khi còn mục cần rà soát/sửa): Không gian trọng tâm hiển thị danh sách lỗi từ \`claims\` (\`INCORRECT\`, \`PARTIALLY_CORRECT\`, \`MISSING\`) và \`coverageItems\` (\`PARTIALLY_COVERED\`, \`MISSING\`).
- **Bước 5 — Hoàn tất** (\`completed\` khi học sinh đã rà soát xong hoặc bài làm đạt chuẩn 100%): Hiển thị bảng tổng kết số lỗi đã sửa, 4 chỉ số độc lập, nút xuất **Phiếu sửa lỗi (In / PDF)** có chữ ký tác giả **Tuấn Khang**, tạo **Flashcard** và **Bài tập trắc nghiệm**.

---

## KHỐI 4: LƯỢC ĐỒ DỮ LIỆU THẬT CỦA STUDYCHECK AI (STRICT DATA SCHEMAS — CẤM ĐỔI TÊN TRƯỜNG)
Giao diện bắt buộc đọc đúng các trường từ \`src/core/types.ts\`:
- \`AnalysisRecord\`: \`analysisId\`, \`documentTitle\`, \`grade\`, \`subject\`, \`textbookTitle\`, \`scope\`, \`analysisStatus\`, \`extractedPages\`, \`claims\`, \`coverageItems\`, \`accuracyScore\`, \`completenessScore\`, \`evidenceCoverage\`, \`confidenceLevel\`, \`confidenceReason\`, \`accuracyBreakdown\`, \`completenessBreakdown\`, \`strengths\`, \`weaknesses\`, \`suggestions\`, \`webSources\`.
- \`ExtractedPage\` & \`ExtractedTextBlock\`: \`pageNumber\`, \`rawText\`, \`ocrAverageConfidence\`, \`blocks[]\` (\`blockId\`, \`extractedText\`, \`textType\`, \`confidence\`, \`readingOrder\`, \`formulaText\`).
- \`ExtractedClaim\`: \`claimId\`, \`sourceText\`, \`sourcePage\`, \`chapter\`, \`concept\`, \`evaluationStatus\` (\`'CORRECT' | 'PARTIALLY_CORRECT' | 'INCORRECT' | 'MISSING' | 'UNVERIFIED' | 'AMBIGUOUS' | 'OCR_UNCERTAIN' | 'OUT_OF_SCOPE'\`), \`explanation\`, \`reason\`, \`correctKnowledge\`, \`suggestedFix\`, \`evidences[]\`.
- \`KnowledgeCoverageItem\`: \`itemId\`, \`concept\`, \`chapter\`, \`lesson\`, \`importanceWeight\`, \`status\` (\`'COVERED' | 'PARTIALLY_COVERED' | 'MISSING' | 'OUT_OF_SCOPE'\`), \`suggestedAddition\`, \`referenceExcerpt\`, \`referencePage\`.

Mỗi thẻ sửa lỗi ở **Bước 4** bắt buộc hiển thị đủ 5 thành phần:
1. **(a) Trích đoạn bài làm**: \`sourceText\` + số trang \`sourcePage\`.
2. **(b) Phân loại trạng thái + lý do**: Biểu tượng + nhãn chữ tiếng Việt song mã + \`explanation\` / \`reason\`.
3. **(c) Kiến thức chuẩn & gợi ý sửa**: \`correctKnowledge\` + \`suggestedFix\` (hoặc \`suggestedAddition\`).
4. **(d) Nguồn đối chiếu SGK / Web**: \`evidences[]\` (\`title\`, \`chapter\`, \`pageNumber\`, \`excerpt\`).
5. **(e) Tương tác của học sinh**: Ô nhập *"Bản tự sửa của bạn"* (lưu theo \`analysisId\`), nút *"Đã hiểu & đã sửa"* cập nhật tiến độ sửa lỗi, và nút *"Báo sai / Phản hồi"* gửi về hệ thống qua \`submitFeedback\` + \`/api/feedback/classify\`.

---

## KHỐI 5: LUẬT KIỂM ĐỊNH 4 LỚP & CÔNG THỨC TÁCH BIỆT 2 CHỈ SỐ
- **Cấm gộp điểm**: Tuyệt đối giữ độc lập **Độ chính xác (\`accuracyScore\`)** và **Độ đầy đủ (\`completenessScore\`)** — không bao giờ cộng trung bình hai số này thành một điểm tổng.
- **Công thức Độ chính xác**: \`earnedWeight / verifiedWeight\` (Đúng = 1.0; Thiếu điều kiện = 0.5; Sai = 0). Các mệnh đề \`UNVERIFIED\`, \`OCR_UNCERTAIN\`, \`OUT_OF_SCOPE\` không bị phạt vào mẫu số.
- **Công thức Độ đầy đủ**: \`coveredWeight / totalRequiredWeight\` trên khung mục tiêu chương SGK. Thiếu ý chỉ giảm Độ đầy đủ, không làm giảm Độ chính xác.
- **Trạng thái bài làm không có lỗi**: Nếu \`errorClaimsCount === 0\` và mọi \`coverageItems\` đều \`COVERED\`, Bước 4 hiển thị trạng thái tích cực *"Bài làm không có lỗi kiến thức cần chỉnh sửa"* kèm nút chuyển thẳng sang Bước 5.

---

## KHỐI 6: RÀO CHẮN KỸ THUẬT & KỶ LUẬT CHỐNG "AI SLOP" (HARD CONSTRAINTS)
1. **Cấm đụng chạm AI Backend**: Không tạo route AI mới, không sửa \`modelRouter.ts\`, \`geminiPipeline.ts\`, \`groqProvider.ts\`, \`cloudflareProvider.ts\` hay khóa API.
2. **Kỷ luật Zero-Pill & Anti-Slop**:
   - Không bọc metadata tĩnh (môn học, lớp, số trang, ngày tháng) trong khung viên thuốc màu; dùng chữ gọn ngăn cách bởi dấu \`·\`.
   - Không dùng thanh viền trái dày (\`border-l-4\`), không dùng chữ chìm watermark, không dùng tiền tố giả lập code (\`// 01_STEP\`), không dùng chấm tròn nhấp nháy trang trí.
   - Không báo hiệu trạng thái chỉ bằng màu sắc (luôn đi kèm biểu tượng + nhãn tiếng Việt rõ nghĩa).
   - Mọi nút bấm, bộ lọc, ô nhập bản tự sửa và nút bước đều phải có hàm xử lý thật (\`onClick\`, \`onChange\`), không có nút chết.

---

## KHỐI 7: CHECKLIST TỰ NGHIỆM THU TRƯỚC KHI XUẤT CODE
- [ ] Thanh 5 bước có đúng 5 vòng tròn số \`40x40px\` độc lập (không có đường nối giữa các vòng tròn) và 1 thanh ray tiến trình Cyan \`#06B6D4\` cao \`6px\` liên tục dưới đáy thẻ?
- [ ] Thanh tiến trình dùng \`transform: scaleX(...)\` mượt \`<= 200ms\` đúng 5 mốc \`12% -> 35% -> 58% -> 80% -> 100%\`?
- [ ] Bước 4 hiển thị đủ 5 thành phần \`(a)..(e)\` cho từng lỗi, lưu được bản tự sửa của học sinh và gửi được phản hồi chấm sai?
- [ ] Độ chính xác và Độ đầy đủ được hiển thị độc lập, dùng \`tabular-nums\`, tương thích hoàn hảo cả Light Mode và Dark Mode trên desktop (1440px) lẫn mobile (360px–430px)?`;
