import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateAccuracyScore,
  calculateCompletenessScore,
  evaluateMasteryStatus,
} from './scoring';
import { validateReferenceUrl } from './urlSecurity';
import { retrieveRelevantChunks, buildChunksFromPages } from './retrieval';
import type { ExtractedClaim, KnowledgeCoverageItem } from './types';

function makeClaim(
  id: string,
  status: ExtractedClaim['evaluationStatus'],
  weight: 1 | 2 | 3 = 2,
  ocrConfidence = 0.95
): ExtractedClaim {
  return {
    claimId: id,
    sourceText: `Nội dung ${id}`,
    normalizedMeaning: `Ý nghĩa ${id}`,
    subject: 'hoa_hoc',
    chapter: 'Chương 3: Liên kết hóa học',
    concept: 'Liên kết hydrogen',
    importanceLevel: weight === 3 ? 'core' : weight === 2 ? 'supporting' : 'detail',
    importanceWeight: weight,
    sourcePage: 1,
    ocrConfidence,
    knowledgeType: 'textbook_core',
    evaluationStatus: status,
    explanation: 'Giải thích',
    correctKnowledge: 'Kiến thức chuẩn',
    evidences: [],
  };
}

test('calculateAccuracyScore matches weighted formula and excludes UNVERIFIED/OCR_UNCERTAIN/OUT_OF_SCOPE/MISSING', () => {
  const claims: ExtractedClaim[] = [
    ...Array.from({ length: 7 }, (_, i) => makeClaim(`c${i}`, 'CORRECT', 1)),
    makeClaim('p1', 'PARTIALLY_CORRECT', 1),
    makeClaim('p2', 'PARTIALLY_CORRECT', 1),
    makeClaim('i1', 'INCORRECT', 1),
    makeClaim('u1', 'UNVERIFIED', 3),
    makeClaim('o1', 'OCR_UNCERTAIN', 3),
    makeClaim('oos1', 'OUT_OF_SCOPE', 3),
    makeClaim('m1', 'MISSING', 3),
  ];

  const result = calculateAccuracyScore(claims, true);
  // (7 + 2 * 0.5) / 10 * 100 = 80%
  assert.equal(result.accuracyScore, 80);
  // Total claim weight excluding MISSING & OUT_OF_SCOPE = 10 + 3 + 3 = 16; verified = 10 -> 62.5%
  assert.equal(result.evidenceCoverage, 62.5);
  assert.equal(result.counts.incorrect, 1);
  assert.equal(result.counts.unverified, 1);
  assert.equal(result.counts.missing, 1);
});

test('calculateAccuracyScore returns null instead of fake 100% when no claims are verified', () => {
  const claims = [makeClaim('u1', 'UNVERIFIED', 2), makeClaim('o1', 'OCR_UNCERTAIN', 2)];
  const result = calculateAccuracyScore(claims, false);
  assert.equal(result.accuracyScore, null);
  assert.equal(result.confidenceLevel, 'Chưa đủ dữ liệu đánh giá');
});

test('Accuracy and Completeness remain completely independent (95% accuracy with 50% completeness vs 50% accuracy with 100% completeness)', () => {
  const coverageHalf: KnowledgeCoverageItem[] = [
    {
      itemId: '1',
      concept: 'Khái niệm',
      chapter: 'Chương 3',
      importanceWeight: 2,
      status: 'COVERED',
      suggestedAddition: '',
      referenceExcerpt: '...',
    },
    {
      itemId: '2',
      concept: 'Điều kiện hình thành',
      chapter: 'Chương 3',
      importanceWeight: 2,
      status: 'MISSING',
      suggestedAddition: 'Bổ sung điều kiện',
      referenceExcerpt: '...',
    },
  ];
  const compHalf = calculateCompletenessScore(coverageHalf, true);
  assert.equal(compHalf.completenessScore, 50);

  const compNoScope = calculateCompletenessScore(coverageHalf, false);
  assert.equal(compNoScope.completenessScore, null);
});

test('evaluateMasteryStatus never grants Tạm nắm vững after 1 correct answer and enforces 5 attempts / 2 sessions / 80%', () => {
  // 1 correct answer -> Đã học qua (NOT Tạm nắm vững)
  const singleCorrect = evaluateMasteryStatus({
    encounteredCount: 1,
    practiceAttemptCount: 1,
    correctAttempts: 1,
    incorrectAttempts: 0,
    recentResults: [true],
    distinctSessionCount: 1,
  });
  assert.notEqual(singleCorrect.masteryStatus, 'Tạm nắm vững');
  assert.equal(singleCorrect.masteryStatus, 'Đã học qua');

  // 5 correct answers in ONLY 1 session -> Đang củng cố (needs >= 2 sessions)
  const singleSessionFive = evaluateMasteryStatus({
    encounteredCount: 1,
    practiceAttemptCount: 5,
    correctAttempts: 5,
    incorrectAttempts: 0,
    recentResults: [true, true, true, true, true],
    distinctSessionCount: 1,
  });
  assert.equal(singleSessionFive.masteryStatus, 'Đang củng cố');

  // 5 attempts across 2 sessions with 4/5 (80%) -> Tạm nắm vững
  const mastered = evaluateMasteryStatus({
    encounteredCount: 1,
    practiceAttemptCount: 5,
    correctAttempts: 4,
    incorrectAttempts: 1,
    recentResults: [false, true, true, true, true],
    distinctSessionCount: 2,
  });
  assert.equal(mastered.masteryStatus, 'Tạm nắm vững');
  assert.equal(mastered.recentAccuracy, 80);

  // Repeated incorrect answers -> Cần ôn tập
  const weak = evaluateMasteryStatus({
    encounteredCount: 1,
    practiceAttemptCount: 3,
    correctAttempts: 1,
    incorrectAttempts: 2,
    recentResults: [true, false, false],
    distinctSessionCount: 2,
  });
  assert.equal(weak.masteryStatus, 'Cần ôn tập');
});

test('validateReferenceUrl blocks SSRF private IPs, metadata endpoints, and http URLs while allowing valid HTTPS', () => {
  assert.equal(validateReferenceUrl('http://example.com/book.pdf').valid, false);
  assert.equal(validateReferenceUrl('https://localhost:3000/secret').valid, false);
  assert.equal(validateReferenceUrl('https://169.254.169.254/latest/meta-data').valid, false);
  assert.equal(validateReferenceUrl('https://10.0.0.5/internal.pdf').valid, false);
  assert.equal(validateReferenceUrl('https://192.168.1.10/book.pdf').valid, false);
  assert.equal(validateReferenceUrl('https://172.16.0.1/book.pdf').valid, false);
  assert.equal(validateReferenceUrl('https://metadata.google.internal/computeMetadata').valid, false);
  assert.equal(validateReferenceUrl('https://moet.gov.vn/sgk-hoa-10.pdf').valid, true);
});

test('retrieveRelevantChunks builds and ranks textbook chunks by keyword and title overlap', () => {
  const chunks = buildChunksFromPages({
    referenceId: 'ref_hoa10',
    grade: '10',
    subject: 'hoa_hoc',
    textbookSeries: 'Kết nối tri thức',
    pages: [
      {
        pageNumber: 54,
        text: 'Chương 3: Liên kết hóa học\nBài 11: Liên kết hydrogen và tương tác van der Waals\n1. Liên kết hydrogen\nLiên kết hydrogen là loại liên kết yếu hình thành giữa nguyên tử H (đã liên kết với nguyên tử có độ âm điện lớn như F, O, N) với nguyên tử khác có độ âm điện lớn và còn cặp electron hóa trị riêng.',
      },
      {
        pageNumber: 62,
        text: 'Chương 4: Phản ứng oxi hóa - khử\nBài 15: Phản ứng oxi hóa - khử\nChất khử là chất nhường electron, số oxi hóa tăng sau phản ứng.',
      },
    ],
  });

  assert.ok(chunks.length >= 2);
  const hits = retrieveRelevantChunks('Liên kết hydrogen nguyên tử có độ âm điện lớn F O N', chunks, {
    referenceId: 'ref_hoa10',
  });
  assert.ok(hits.length >= 1);
  assert.equal(hits[0].chunk.pageNumber, 54);
});
