import assert from 'node:assert/strict';
import test from 'node:test';
import { stripUndefinedDeep } from './firestoreSanitizer.js';
import { calculateAccuracyScore, calculateCompletenessScore } from './scoring.js';
import type { ExtractedClaim, KnowledgeCoverageItem } from './types.js';

test('stripUndefinedDeep removes top-level, nested, and array undefined values while preserving null and primitives', () => {
  const payload = {
    analysisId: 'doc_123',
    accuracyScore: null,
    webGroundingNotice: undefined,
    extractedPages: [
      {
        pageNumber: 1,
        rawText: 'Chuyển động thẳng đều',
        imageUrl: undefined,
        blocks: [
          {
            blockId: 'p1_b1',
            extractedText: 'x = x0 + v.t',
            formulaText: undefined,
            boundingBox: null,
          },
        ],
      },
    ],
    claims: [
      {
        claimId: 'c1',
        suggestedFix: undefined,
        evidences: [
          {
            evidenceId: 'ev1',
            referenceId: undefined,
            pageNumber: undefined,
            title: 'Chuẩn GDPT 2018',
          },
        ],
      },
    ],
    mixedArray: [1, undefined, 'ok', null, { nested: undefined, keep: true }],
    nanNumber: Number.NaN,
  };

  const cleaned = stripUndefinedDeep(payload) as Record<string, any>;

  assert.equal('webGroundingNotice' in cleaned, false);
  assert.equal('nanNumber' in cleaned, false);
  assert.equal(cleaned.accuracyScore, null);
  assert.equal('imageUrl' in cleaned.extractedPages[0], false);
  assert.equal('formulaText' in cleaned.extractedPages[0].blocks[0], false);
  assert.equal(cleaned.extractedPages[0].blocks[0].boundingBox, null);
  assert.equal('suggestedFix' in cleaned.claims[0], false);
  assert.equal('referenceId' in cleaned.claims[0].evidences[0], false);
  assert.equal('pageNumber' in cleaned.claims[0].evidences[0], false);
  assert.deepEqual(cleaned.mixedArray, [1, 'ok', null, { keep: true }]);

  // Ensure zero undefined remains anywhere when serialized/inspected recursively
  const checkNoUndefined = (node: unknown): void => {
    assert.notEqual(node, undefined);
    if (Array.isArray(node)) {
      node.forEach(checkNoUndefined);
    } else if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        assert.notEqual(v, undefined, `Unexpected undefined at key ${k}`);
        checkNoUndefined(v);
      }
    }
  };
  checkNoUndefined(cleaned);
});

test('scoring accurately grades 5-defect Uniform Rectilinear Motion test fixture (3 errors + 2 missing symbol definitions)', () => {
  const claims: ExtractedClaim[] = [
    {
      claimId: 'c1',
      sourceText: 'Chuyển động thẳng đều có tốc độ thay đổi theo thời gian.',
      normalizedMeaning: 'Tốc độ thay đổi',
      subject: 'vat_ly',
      chapter: 'Chuyển động thẳng đều',
      concept: 'Định nghĩa tốc độ trong chuyển động thẳng đều',
      importanceLevel: 'core',
      importanceWeight: 3,
      sourcePage: 1,
      ocrConfidence: 0.97,
      knowledgeType: 'textbook_core',
      evaluationStatus: 'INCORRECT',
      explanation: 'Sai bản chất: tốc độ phải không đổi theo thời gian.',
      correctKnowledge: 'Tốc độ không đổi theo thời gian.',
      evidences: [],
    },
    {
      claimId: 'c2',
      sourceText: 'Quãng đường đi được tỉ lệ nghịch với thời gian chuyển động.',
      normalizedMeaning: 'Quãng đường tỉ lệ nghịch thời gian',
      subject: 'vat_ly',
      chapter: 'Chuyển động thẳng đều',
      concept: 'Quan hệ quãng đường và thời gian',
      importanceLevel: 'core',
      importanceWeight: 3,
      sourcePage: 1,
      ocrConfidence: 0.97,
      knowledgeType: 'textbook_core',
      evaluationStatus: 'INCORRECT',
      explanation: 'Sai bản chất: quãng đường tỉ lệ thuận với thời gian.',
      correctKnowledge: 'Quãng đường tỉ lệ thuận với thời gian.',
      evidences: [],
    },
    {
      claimId: 'c3',
      sourceText: 's = v + t',
      normalizedMeaning: 's = v + t',
      subject: 'vat_ly',
      chapter: 'Chuyển động thẳng đều',
      concept: 'Công thức tính quãng đường',
      importanceLevel: 'core',
      importanceWeight: 3,
      sourcePage: 1,
      ocrConfidence: 0.99,
      knowledgeType: 'textbook_core',
      evaluationStatus: 'INCORRECT',
      explanation: 'Sai phép toán: công thức đúng là s = v.t.',
      correctKnowledge: 's = v.t',
      evidences: [],
    },
    {
      claimId: 'c4',
      sourceText: 'Trong đó: s là quãng đường (m), v là tốc độ (m/s).',
      normalizedMeaning: 'Chú thích đại lượng s, v',
      subject: 'vat_ly',
      chapter: 'Chuyển động thẳng đều',
      concept: 'Chú thích ký hiệu công thức quãng đường',
      importanceLevel: 'supporting',
      importanceWeight: 2,
      sourcePage: 1,
      ocrConfidence: 0.97,
      knowledgeType: 'textbook_core',
      evaluationStatus: 'PARTIALLY_CORRECT',
      explanation: 'Thiếu giải thích ý nghĩa và đơn vị của thời gian t (s).',
      correctKnowledge: 'Cần bổ sung: t là thời gian chuyển động (s).',
      evidences: [],
    },
    {
      claimId: 'c5',
      sourceText: 'x = x0 + v.t',
      normalizedMeaning: 'x = x0 + v.t',
      subject: 'vat_ly',
      chapter: 'Chuyển động thẳng đều',
      concept: 'Phương trình chuyển động thẳng đều',
      importanceLevel: 'core',
      importanceWeight: 3,
      sourcePage: 1,
      ocrConfidence: 0.99,
      knowledgeType: 'textbook_core',
      evaluationStatus: 'CORRECT',
      explanation: 'Phương trình đúng.',
      correctKnowledge: 'x = x0 + v.t',
      evidences: [],
    },
    {
      claimId: 'c6',
      sourceText: 'Trong đó x0 là tọa độ ban đầu, x là tọa độ của vật tại thời điểm t.',
      normalizedMeaning: 'Chú thích x0, x',
      subject: 'vat_ly',
      chapter: 'Chuyển động thẳng đều',
      concept: 'Chú thích ký hiệu phương trình chuyển động',
      importanceLevel: 'supporting',
      importanceWeight: 2,
      sourcePage: 1,
      ocrConfidence: 0.98,
      knowledgeType: 'textbook_core',
      evaluationStatus: 'PARTIALLY_CORRECT',
      explanation: 'Thiếu giải thích ý nghĩa của vận tốc v.',
      correctKnowledge: 'Cần bổ sung: v là vận tốc của vật (m/s).',
      evidences: [],
    },
  ];

  const coverageItems: KnowledgeCoverageItem[] = [
    {
      itemId: 'cov_1',
      concept: 'Giải thích ý nghĩa và đơn vị thời gian t',
      chapter: 'Chuyển động thẳng đều',
      importanceWeight: 2,
      status: 'MISSING',
      suggestedAddition: 'Bổ sung: t là thời gian chuyển động (đơn vị: s).',
      referenceExcerpt: 's = v.t với t là thời gian chuyển động (s).',
    },
    {
      itemId: 'cov_2',
      concept: 'Giải thích ý nghĩa vận tốc v trong phương trình chuyển động',
      chapter: 'Chuyển động thẳng đều',
      importanceWeight: 2,
      status: 'MISSING',
      suggestedAddition: 'Bổ sung: v là vận tốc của vật (m/s).',
      referenceExcerpt: 'x = x0 + v.t với v là vận tốc của vật.',
    },
    {
      itemId: 'cov_3',
      concept: 'Phương trình chuyển động thẳng đều x = x0 + v.t',
      chapter: 'Chuyển động thẳng đều',
      importanceWeight: 3,
      status: 'COVERED',
      suggestedAddition: '',
      referenceExcerpt: 'x = x0 + v.t',
    },
  ];

  const acc = calculateAccuracyScore(claims, false);
  const comp = calculateCompletenessScore(coverageItems, true);

  assert.equal(acc.counts.incorrect, 3);
  assert.equal(acc.counts.partiallyCorrect, 2);
  assert.equal(acc.counts.correct, 1);
  assert.equal(acc.counts.unverified, 0);
  // Count-based: (1 + 2*0.5) / 6 = 2 / 6 -> 33.3% đúng, 66.7% sai
  assert.equal(acc.evaluatedTotal, 6);
  assert.equal(acc.accuracyScore, 33.3);
  assert.equal(acc.correctPercent, 33.3);
  assert.equal(acc.incorrectPercent, 66.7);
  assert.equal(comp.missingCount, 2);
  // Count-based completeness: 1 covered / 3 total -> 33.3%
  assert.equal(comp.completenessScore, 33.3);
});
