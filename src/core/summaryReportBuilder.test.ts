import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildVerificationSummaryReport,
  formatSummaryReportAsTxt,
  sanitizeSummaryFileBaseName,
} from './summaryReportBuilder';
import type { AnalysisRecord } from './types';

function makeSampleAnalysis(): AnalysisRecord {
  return {
    analysisId: 'an_summary_test_1',
    ownerUid: 'user_123',
    documentTitle: 'Bài ôn tập Động lực học & Định luật Newton',
    originalFileName: 'dong-luc-hoc.pdf',
    mimeType: 'application/pdf',
    storagePath: 'users/user_123/dong-luc-hoc.pdf',
    grade: '10',
    subject: 'vat_ly',
    textbookReferenceId: 'ref_ly_10',
    textbookTitle: 'Vật lý 10 — Kết nối tri thức',
    selectedChapters: ['Chương II: Động lực học'],
    scope: 'Chương II: Động lực học',
    analysisStatus: 'completed',
    extractedPages: [],
    claims: [
      {
        claimId: 'c1',
        sourceText: 'Gia tốc cùng hướng với hợp lực tác dụng lên vật.',
        normalizedMeaning: 'Định luật II Newton',
        subject: 'vat_ly',
        chapter: 'Chương II',
        concept: 'Định luật II Newton',
        importanceLevel: 'core',
        importanceWeight: 3,
        sourcePage: 1,
        ocrConfidence: 0.98,
        knowledgeType: 'textbook_core',
        evaluationStatus: 'CORRECT',
        explanation: 'Trình bày chính xác định luật II Newton.',
        correctKnowledge: 'a = F / m',
        evidences: [
          {
            evidenceId: 'ev_1',
            sourceType: 'textbook',
            title: 'SGK Vật lý 10 KNTT',
            pageNumber: 62,
            excerpt: 'Gia tốc của một vật cùng hướng với lực tác dụng lên vật.',
          },
        ],
      },
      {
        claimId: 'c2',
        sourceText: 'Lực ma sát luôn cản trở mọi chuyển động của vật.',
        normalizedMeaning: 'Vai trò lực ma sát',
        subject: 'vat_ly',
        chapter: 'Chương II',
        concept: 'Lực ma sát',
        importanceLevel: 'supporting',
        importanceWeight: 2,
        sourcePage: 2,
        ocrConfidence: 0.94,
        knowledgeType: 'textbook_core',
        evaluationStatus: 'INCORRECT',
        explanation: 'Lực ma sát nghỉ có thể đóng vai trò là lực phát động giúp người đi bộ tiến lên.',
        correctKnowledge: 'Lực ma sát cản trở chuyển động trượt hoặc giữ cho vật không trượt.',
        suggestedFix: 'Sửa thành: Lực ma sát trượt cản trở chuyển động tương đối giữa hai bề mặt tiếp xúc.',
        evidences: [],
      },
    ],
    coverageItems: [
      {
        itemId: 'cov1',
        concept: 'Định luật II Newton',
        chapter: 'Chương II',
        importanceWeight: 3,
        status: 'COVERED',
        suggestedAddition: '',
        referenceExcerpt: 'a = F/m',
        referencePage: 62,
      },
      {
        itemId: 'cov2',
        concept: 'Định luật III Newton',
        chapter: 'Chương II',
        importanceWeight: 3,
        status: 'MISSING',
        suggestedAddition: 'Bổ sung cặp lực và phản lực tác dụng lên hai vật khác nhau.',
        referenceExcerpt: 'FAB = -FBA',
        referencePage: 67,
      },
    ],
    annotations: [],
    accuracyScore: 60,
    completenessScore: 50,
    evidenceCoverage: 50,
    confidenceLevel: 'Cao',
    confidenceReason: 'Đối chiếu đầy đủ với SGK Vật lý 10.',
    strengths: [
      {
        title: 'Nắm chắc biểu thức Định luật II Newton',
        detail: 'Xác định đúng mối liên hệ giữa gia tốc, hợp lực và khối lượng.',
        sourceExcerpt: 'Gia tốc cùng hướng với hợp lực',
        pageNumber: 1,
      },
    ],
    weaknesses: [
      {
        title: 'Nhầm lẫn về vai trò lực ma sát',
        category: 'knowledge_error',
        detail: 'Đồng nhất ma sát nghỉ với lực cản mọi chuyển động.',
        claimId: 'c2',
        pageNumber: 2,
      },
    ],
    suggestions: [
      {
        priority: 1,
        actionType: 'fix_error',
        title: 'Phân biệt ma sát trượt và ma sát nghỉ',
        description: 'Xem lại ví dụ lực ma sát nghỉ khi bước đi.',
      },
    ],
    webSources: [
      {
        evidenceId: 'web1',
        sourceType: 'web',
        title: 'Tài liệu ôn tập Vật lý 10',
        domain: 'hoclieu.vn',
        url: 'https://hoclieu.vn/vat-ly-10',
        excerpt: 'Tổng hợp định luật Newton',
      },
    ],
    usedWebGrounding: true,
    createdAt: '2026-11-21T10:00:00.000Z',
    updatedAt: '2026-11-21T10:05:00.000Z',
  };
}

test('buildVerificationSummaryReport refuses to generate when confirmed is false', () => {
  const analysis = makeSampleAnalysis();
  assert.throws(
    () =>
      buildVerificationSummaryReport(analysis, {
        confirmed: false,
      }),
    /Cần xác nhận của người dùng/
  );
});

test('sanitizeSummaryFileBaseName normalizes Vietnamese diacritics safely', () => {
  const name = sanitizeSummaryFileBaseName(
    'Đề kiểm tra Vật lý 10 — Chương II (Động lực học)!',
    '2026-11-21T19:10:00.000Z'
  );
  assert.equal(name, 'Ban_Tong_Ket_De_kiem_tra_Vat_ly_10_Chuong_II_Dong_luc_hoc_20261121');
});

test('buildVerificationSummaryReport includes student corrections and formats clean TXT when confirmed', () => {
  const analysis = makeSampleAnalysis();
  const report = buildVerificationSummaryReport(analysis, {
    confirmed: true,
    confirmedAt: '2026-11-21T19:15:00.000Z',
    includeStudentCorrections: true,
    includeCoverageAndSources: true,
    customNote: 'Ôn thi giữa kỳ I',
    generatedByName: 'Tuấn Khang',
    correctionsMap: {
      'claim:c2': {
        studentText: 'Lực ma sát trượt cản trở chuyển động tương đối giữa hai mặt tiếp xúc.',
        resolved: true,
      },
    },
  });

  assert.equal(report.metrics.accuracyScoreDisplay, '60%');
  assert.equal(report.metrics.completenessScoreDisplay, '50%');
  assert.equal(report.metrics.actionableTotal, 2);
  assert.equal(report.metrics.resolvedCorrectionsCount, 1);
  assert.equal(report.claims[1]?.studentResolved, true);
  assert.match(report.claims[1]?.studentFixText || '', /ma sát trượt/);
  assert.equal(report.coverageItems.length, 2);
  assert.equal(report.webSources.length, 1);

  const txt = formatSummaryReportAsTxt(report);
  assert.match(txt, /BẢN TỔNG KẾT KIỂM ĐỊNH KIẾN THỨC — STUDYCHECK AI/);
  assert.match(txt, /Độ chính xác \(Accuracy\)\s*: 60%/);
  assert.match(txt, /Ôn thi giữa kỳ I/);
  assert.match(txt, /Đã đánh dấu sửa xong/);
  assert.match(txt, /Định luật III Newton/);

  // Excluding coverage & student corrections strips them cleanly
  const compact = buildVerificationSummaryReport(analysis, {
    confirmed: true,
    includeStudentCorrections: false,
    includeCoverageAndSources: false,
  });
  assert.equal(compact.coverageItems.length, 0);
  assert.equal(compact.webSources.length, 0);
  assert.equal(compact.claims[1]?.studentFixText, '');
  assert.equal(compact.claims[1]?.studentResolved, false);
});
