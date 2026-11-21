import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildErrorCorrectionQueue,
  GEMINI_ARGON_VERIFICATION_UI_PROMPT,
  getStepProgressFraction,
  resolveStepFromAnalysisStage,
  VERIFICATION_STEPS,
} from './verificationStepper';
import type { ExtractedClaim, KnowledgeCoverageItem } from './types';

test('VERIFICATION_STEPS defines 5 canonical steps with reference image progress milestones', () => {
  assert.equal(VERIFICATION_STEPS.length, 5);
  assert.deepEqual(
    VERIFICATION_STEPS.map((s) => ({ id: s.id, label: s.label, pct: s.progressPct })),
    [
      { id: 1, label: 'Nạp bài làm', pct: 12 },
      { id: 2, label: 'Rà soát OCR', pct: 35 },
      { id: 3, label: 'Đối chiếu chuẩn', pct: 58 },
      { id: 4, label: 'Sửa lỗi', pct: 80 },
      { id: 5, label: 'Hoàn tất', pct: 100 },
    ]
  );
  assert.equal(getStepProgressFraction(1), 0.12);
  assert.equal(getStepProgressFraction(2), 0.35);
  assert.equal(getStepProgressFraction(3), 0.58);
  assert.equal(getStepProgressFraction(4), 0.8);
  assert.equal(getStepProgressFraction(5), 1);
});

test('resolveStepFromAnalysisStage maps every AnalysisStage to the correct 1..5 step', () => {
  assert.equal(resolveStepFromAnalysisStage('queued'), 1);
  assert.equal(resolveStepFromAnalysisStage('uploading'), 1);
  assert.equal(resolveStepFromAnalysisStage('failed'), 1);
  assert.equal(resolveStepFromAnalysisStage('cancelled'), 1);

  assert.equal(resolveStepFromAnalysisStage('extracting'), 2);
  assert.equal(resolveStepFromAnalysisStage('awaiting_ocr_confirmation'), 2);

  assert.equal(resolveStepFromAnalysisStage('retrieving_references'), 3);
  assert.equal(resolveStepFromAnalysisStage('verifying'), 3);
  assert.equal(resolveStepFromAnalysisStage('calculating'), 3);
  assert.equal(resolveStepFromAnalysisStage('generating_report'), 3);

  assert.equal(resolveStepFromAnalysisStage('completed'), 4);
  assert.equal(resolveStepFromAnalysisStage('completed', { hasUnresolvedErrors: true }), 4);
  assert.equal(resolveStepFromAnalysisStage('completed', { hasUnresolvedErrors: false }), 5);
  assert.equal(resolveStepFromAnalysisStage('completed', { forceCompletedStep: true }), 5);
});

test('buildErrorCorrectionQueue orders incorrect claims first, then partial/missing claims, then coverage gaps', () => {
  const claims: ExtractedClaim[] = [
    {
      claimId: 'c_correct',
      sourceText: 'Nước sôi ở 100 độ C tại 1 atm',
      normalizedMeaning: 'Nhiệt độ sôi của nước',
      subject: 'vat_ly',
      chapter: 'Chương 1',
      concept: 'Sự sôi',
      importanceLevel: 'core',
      importanceWeight: 3,
      sourcePage: 1,
      ocrConfidence: 0.96,
      knowledgeType: 'textbook_core',
      evaluationStatus: 'CORRECT',
      explanation: 'Đúng chuẩn SGK',
      correctKnowledge: 'Nước sôi ở 100 độ C tại áp suất tiêu chuẩn 1 atm',
      evidences: [],
    },
    {
      claimId: 'c_partial',
      sourceText: 'Định luật Ôm: I = U / R',
      normalizedMeaning: 'Định luật Ôm thiếu điều kiện nhiệt độ',
      subject: 'vat_ly',
      chapter: 'Chương 2',
      concept: 'Định luật Ôm',
      importanceLevel: 'core',
      importanceWeight: 2,
      sourcePage: 1,
      ocrConfidence: 0.91,
      knowledgeType: 'textbook_core',
      evaluationStatus: 'PARTIALLY_CORRECT',
      explanation: 'Thiếu giải thích ký hiệu và điều kiện vật dẫn kim loại',
      correctKnowledge: 'I = U / R, trong đó I là cường độ dòng điện (A), U là hiệu điện thế (V), R là điện trở (Ω)',
      suggestedFix: 'Bổ sung ý nghĩa các đại lượng I, U, R và đơn vị đo.',
      evidences: [],
    },
    {
      claimId: 'c_incorrect',
      sourceText: 'Liên kết cộng hóa trị luôn là liên kết có cực',
      normalizedMeaning: 'Phân loại liên kết cộng hóa trị',
      subject: 'hoa_hoc',
      chapter: 'Chương 3',
      concept: 'Liên kết cộng hóa trị',
      importanceLevel: 'core',
      importanceWeight: 3,
      sourcePage: 2,
      ocrConfidence: 0.95,
      knowledgeType: 'textbook_core',
      evaluationStatus: 'INCORRECT',
      explanation: 'Sai bản chất: liên kết cộng hóa trị gồm cả phân cực và không phân cực.',
      correctKnowledge: 'Liên kết cộng hóa trị có thể không phân cực (như H2, Cl2) hoặc phân cực (như HCl).',
      suggestedFix: 'Sửa thành: Liên kết cộng hóa trị được chia thành liên kết không phân cực và liên kết phân cực.',
      evidences: [
        {
          evidenceId: 'ev1',
          sourceType: 'textbook',
          title: 'SGK Hóa học 10',
          chapter: 'Chương 3',
          pageNumber: 54,
          excerpt: 'Liên kết cộng hóa trị không phân cực là liên kết mà cặp electron chung không lệch về phía nguyên tử nào.',
        },
      ],
    },
  ];

  const coverageItems: KnowledgeCoverageItem[] = [
    {
      itemId: 'cov_ok',
      concept: 'Khái niệm liên kết ion',
      chapter: 'Chương 3',
      importanceWeight: 2,
      status: 'COVERED',
      suggestedAddition: '',
      referenceExcerpt: 'Liên kết ion được hình thành bởi lực hút tĩnh điện giữa các ion mang điện tích trái dấu.',
    },
    {
      itemId: 'cov_missing',
      concept: 'Hiệu độ âm điện và phân loại liên kết',
      chapter: 'Chương 3',
      importanceWeight: 3,
      status: 'MISSING',
      suggestedAddition: 'Bổ sung bảng quy ước hiệu độ âm điện Δχ (0 đến < 0,4; 0,4 đến < 1,7; >= 1,7).',
      referenceExcerpt: 'Hiệu độ âm điện giúp dự đoán bản chất liên kết hóa học.',
      referencePage: 58,
    },
  ];

  const queue = buildErrorCorrectionQueue({ claims, coverageItems });
  assert.equal(queue.length, 3);
  assert.equal(queue[0]?.id, 'claim:c_incorrect');
  assert.equal(queue[0]?.kind, 'claim_error');
  assert.equal(queue[1]?.id, 'claim:c_partial');
  assert.equal(queue[1]?.kind, 'claim_partial');
  assert.equal(queue[2]?.id, 'coverage:cov_missing');
  assert.equal(queue[2]?.kind, 'coverage_gap');
});

test('GEMINI_ARGON_VERIFICATION_UI_PROMPT includes all 7 contract blocks and strict data fields', () => {
  assert.ok(GEMINI_ARGON_VERIFICATION_UI_PROMPT.includes('KHỐI 1:'));
  assert.ok(GEMINI_ARGON_VERIFICATION_UI_PROMPT.includes('KHỐI 2:'));
  assert.ok(GEMINI_ARGON_VERIFICATION_UI_PROMPT.includes('KHỐI 3:'));
  assert.ok(GEMINI_ARGON_VERIFICATION_UI_PROMPT.includes('KHỐI 4:'));
  assert.ok(GEMINI_ARGON_VERIFICATION_UI_PROMPT.includes('KHỐI 5:'));
  assert.ok(GEMINI_ARGON_VERIFICATION_UI_PROMPT.includes('KHỐI 6:'));
  assert.ok(GEMINI_ARGON_VERIFICATION_UI_PROMPT.includes('KHỐI 7:'));
  assert.ok(GEMINI_ARGON_VERIFICATION_UI_PROMPT.includes('AnalysisRecord'));
  assert.ok(GEMINI_ARGON_VERIFICATION_UI_PROMPT.includes('ExtractedClaim'));
  assert.ok(GEMINI_ARGON_VERIFICATION_UI_PROMPT.includes('KnowledgeCoverageItem'));
  assert.ok(GEMINI_ARGON_VERIFICATION_UI_PROMPT.includes('#0E4D5D'));
  assert.ok(GEMINI_ARGON_VERIFICATION_UI_PROMPT.includes('#06B6D4'));
});
