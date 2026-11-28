import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ADAPTIVE_LONG_TEXT_CHAR_THRESHOLD,
  ADAPTIVE_LONG_TEXT_WORD_THRESHOLD,
  CF_GRADE_MODEL,
  CF_VERIFY_MODEL,
  GROQ_VERIFY_SLOT1_MODEL,
  GROQ_VERIFY_SLOT2_MODEL,
  MAX_ADAPTIVE_THRESHOLD_CHARS,
  MIN_ADAPTIVE_THRESHOLD_CHARS,
  MISTRAL_VERIFY_MODEL,
  clampAdaptiveThresholdChars,
  computeAdaptiveApiPlan,
  computeNormalizedTextLength,
  computeNormalizedWordCount,
  formatStudentBlocksForPrompt,
  mergeGradedHalves,
  reconcileDualFullContextGradings,
  resolveScopedStageApiKey,
  selectCrossProviderVerifierModel,
  selectSecondGraderModel,
  splitClaimsIntoTwoHalves,
  splitStudentBlocksIntoTwoHalves,
} from './adaptiveApiPlan.js';

describe('adaptiveApiPlan — threshold clamping & short/long classification (1500-word rule)', () => {
  it('clamps threshold to [300, 20000] and defaults to 1500 words', () => {
    assert.equal(clampAdaptiveThresholdChars(undefined), ADAPTIVE_LONG_TEXT_WORD_THRESHOLD);
    assert.equal(ADAPTIVE_LONG_TEXT_CHAR_THRESHOLD, 1500);
    assert.equal(clampAdaptiveThresholdChars(null), 1500);
    assert.equal(clampAdaptiveThresholdChars('not-a-number'), 1500);
    assert.equal(clampAdaptiveThresholdChars(120), MIN_ADAPTIVE_THRESHOLD_CHARS);
    assert.equal(clampAdaptiveThresholdChars(50000), MAX_ADAPTIVE_THRESHOLD_CHARS);
    assert.equal(clampAdaptiveThresholdChars('2400'), 2400);
    assert.equal(clampAdaptiveThresholdChars(1799.6), 1800);
  });

  it('returns 1-1-1 plan for < 1500 words and 1-2-1 plan (2 Grade APIs + 1 Verify API) for >= 1500 words', () => {
    const shortPlan = computeAdaptiveApiPlan(1499);
    assert.equal(shortPlan.isLongText, false);
    assert.equal(shortPlan.thresholdChars, 1500);
    assert.equal(shortPlan.scanApiCount, 1);
    assert.equal(shortPlan.gradeApiCount, 1);
    assert.equal(shortPlan.verifyApiCount, 1);

    const boundaryPlan = computeAdaptiveApiPlan(1500);
    assert.equal(boundaryPlan.isLongText, true);
    assert.equal(boundaryPlan.scanApiCount, 1);
    assert.equal(boundaryPlan.gradeApiCount, 2);
    assert.equal(boundaryPlan.verifyApiCount, 1);

    const longPlan = computeAdaptiveApiPlan(2500, 1500, 14200);
    assert.equal(longPlan.isLongText, true);
    assert.equal(longPlan.wordCount, 2500);
    assert.equal(longPlan.textLength, 14200);
    assert.equal(longPlan.thresholdChars, 1500);
    assert.equal(longPlan.scanApiCount, 1);
    assert.equal(longPlan.gradeApiCount, 2);
    assert.equal(longPlan.verifyApiCount, 1);
  });

  it('computes NFC-normalized trimmed text length and word count from strings and pages', () => {
    // Decomposed Vietnamese 'e' + combining acute vs NFC composed 'é'
    const nfd = '  e\u0301  ';
    assert.equal(computeNormalizedTextLength(nfd), 1);
    assert.equal(computeNormalizedWordCount(nfd), 1);

    const pages = [
      { pageNumber: 1, rawText: 'Trang 1 raw', confirmedText: 'Trang 1 confirmed!' },
      { pageNumber: 2, rawText: 'Trang 2 raw', confirmedText: '' },
    ];
    assert.equal(
      computeNormalizedTextLength(pages, true),
      'Trang 1 confirmed!\nTrang 2 raw'.length
    );
    assert.equal(
      computeNormalizedTextLength(pages, false),
      'Trang 1 raw\nTrang 2 raw'.length
    );
    assert.equal(computeNormalizedWordCount(pages, true), 6);

    const longEssay = Array.from({ length: 1500 }, (_, i) => `chữ_${i + 1}`).join(' ');
    assert.equal(computeNormalizedWordCount(longEssay), 1500);
    const planFor1500Words = computeAdaptiveApiPlan(computeNormalizedWordCount(longEssay));
    assert.equal(planFor1500Words.gradeApiCount, 2);
    assert.equal(planFor1500Words.verifyApiCount, 1);
  });

  it('reconciles dual full-context gradings by preferring CORRECT over pure omission complaints while keeping real INCORRECT errors', () => {
    const eval1 = {
      claims: [
        {
          blockId: 'p1_b2',
          sourcePage: 1,
          sourceText: 'Khi đó quãng đường đi được là s = v.t',
          chapter: 'Chương 1',
          concept: 'Quãng đường chuyển động thẳng đều',
          importanceWeight: 3,
          evaluationStatus: 'PARTIALLY_CORRECT',
          explanation: 'Thiếu nêu điều kiện vận tốc không đổi và chưa giải thích đơn vị ở dòng này.',
          correctKnowledge: 's = v.t với v không đổi (m/s), t (s)',
          errorSpan: 's = v.t',
          shortFix: 'Bổ sung điều kiện v không đổi.',
        },
        {
          blockId: 'p1_b3',
          sourcePage: 1,
          sourceText: 'Gia tốc trong chuyển động thẳng đều tăng dần theo thời gian.',
          chapter: 'Chương 1',
          concept: 'Gia tốc chuyển động thẳng đều',
          importanceWeight: 3,
          evaluationStatus: 'CORRECT',
          explanation: 'Đúng.',
          correctKnowledge: 'a = 0',
        },
      ],
      coverageItems: [],
      strengths: [{ title: 'Trình bày mạch lạc', detail: 'Đủ các mục' }],
      weaknesses: [],
      suggestions: [],
    };

    const eval2 = {
      claims: [
        {
          blockId: 'p1_b2',
          sourcePage: 1,
          sourceText: 'Khi đó quãng đường đi được là s = v.t',
          chapter: 'Chương 1',
          concept: 'Quãng đường chuyển động thẳng đều',
          importanceWeight: 3,
          evaluationStatus: 'CORRECT',
          explanation: 'Đúng vì điều kiện chuyển động thẳng đều và đơn vị đã nêu ở đoạn 1 phía trên.',
          correctKnowledge: 's = v.t',
        },
        {
          blockId: 'p1_b3',
          sourcePage: 1,
          sourceText: 'Gia tốc trong chuyển động thẳng đều tăng dần theo thời gian.',
          chapter: 'Chương 1',
          concept: 'Gia tốc chuyển động thẳng đều',
          importanceWeight: 3,
          evaluationStatus: 'INCORRECT',
          explanation: 'Sai bản chất: chuyển động thẳng đều có vận tốc không đổi nên gia tốc bằng 0.',
          correctKnowledge: 'a = 0',
          errorSpan: 'tăng dần theo thời gian',
          shortFix: 'Sửa thành gia tốc luôn bằng 0.',
        },
      ],
      coverageItems: [],
      strengths: [{ title: 'Trình bày mạch lạc', detail: 'Đủ các mục' }],
      weaknesses: [{ title: 'Nhầm gia tốc chuyển động thẳng đều', detail: 'Gia tốc phải bằng 0' }],
      suggestions: [],
    };

    const reconciled = reconcileDualFullContextGradings(eval1, eval2);
    assert.equal(reconciled.claims.length, 2);
    // Claim 1: resolved to CORRECT because eval2 recognized upstream context and eval1 was only an omission complaint
    assert.equal(reconciled.claims[0].evaluationStatus, 'CORRECT');
    assert.equal(reconciled.claims[0].errorSpan, undefined);
    // Claim 2: retained INCORRECT with errorSpan so the 1 Verifier API can audit it
    assert.equal(reconciled.claims[1].evaluationStatus, 'INCORRECT');
    assert.equal(reconciled.claims[1].errorSpan, 'tăng dần theo thời gian');

    const secondGrader = selectSecondGraderModel({
      slot1Provider: 'mistral',
      configuredProviders: { mistral: true, cloudflare: true, groq: true },
    });
    assert.equal(secondGrader.primaryProvider, 'cloudflare');
    assert.equal(secondGrader.primaryModel, CF_GRADE_MODEL);
  });
});

describe('adaptiveApiPlan — block & claim splitting and deterministic merging', () => {
  it('splits multiple student blocks into 2 character-balanced halves preserving page headers & blockIds', () => {
    const blocks = [
      { pageNumber: 1, blockId: 'p1_b1', text: 'A'.repeat(400) },
      { pageNumber: 1, blockId: 'p1_b2', text: 'B'.repeat(450) },
      { pageNumber: 2, blockId: 'p2_b1', text: 'C'.repeat(420) },
      { pageNumber: 2, blockId: 'p2_b2', text: 'D'.repeat(430) },
    ];
    const [h1, h2] = splitStudentBlocksIntoTwoHalves(blocks);
    assert.equal(h1.length, 2);
    assert.equal(h2.length, 2);
    assert.equal(h1[0].blockId, 'p1_b1');
    assert.equal(h2[0].blockId, 'p2_b1');
    assert.match(formatStudentBlocksForPrompt(h1), /=== TRANG 1 ===/);
    assert.match(formatStudentBlocksForPrompt(h2), /=== TRANG 2 ===/);
  });

  it('splits a single giant block cleanly near midpoint on newline or sentence boundary', () => {
    const giant = [
      'Đoạn một: Định luật bảo toàn khối lượng phát biểu rằng tổng khối lượng các chất tham gia bằng tổng khối lượng sản phẩm.',
      'Đoạn hai: Phương trình hóa học cần cân bằng đúng hệ số nguyên tử của từng nguyên tố ở hai vế.',
      'Đoạn ba: Trong phản ứng oxi hóa khử, chất khử nhường electron còn chất oxi hóa nhận electron.',
      'Đoạn bốn: Tốc độ phản ứng phụ thuộc vào nồng độ, nhiệt độ, áp suất, diện tích bề mặt và chất xúc tác.',
    ].join('\n');

    const [h1, h2] = splitStudentBlocksIntoTwoHalves([
      { pageNumber: 1, blockId: 'p1_b1', text: giant },
    ]);

    assert.equal(h1.length, 1);
    assert.equal(h2.length, 1);
    assert.equal(h1[0].blockId, 'p1_b1');
    assert.equal(h2[0].blockId, 'p1_b1_part2');
    assert.equal(h2[0].sourceBlockId, 'p1_b1');
    assert.ok(h1[0].text.length > 50);
    assert.ok(h2[0].text.length > 50);
    assert.equal(`${h1[0].text}\n${h2[0].text}`, giant);
  });

  it('splits claims into 2 balanced halves and merges coverage with strict precedence', () => {
    const [c1, c2] = splitClaimsIntoTwoHalves(['c1', 'c2', 'c3', 'c4', 'c5']);
    assert.deepEqual(c1, ['c1', 'c2', 'c3']);
    assert.deepEqual(c2, ['c4', 'c5']);

    const merged = mergeGradedHalves(
      {
        claims: [{ id: 1 }, { id: 2 }],
        coverageItems: [
          { criterionId: 'crit_1', concept: 'Khái niệm A', status: 'MISSING' as const, suggestedAddition: 'Bổ sung A' },
          { criterionId: 'crit_2', concept: 'Khái niệm B', status: 'PARTIALLY_COVERED' as const, suggestedAddition: 'Thêm ví dụ B' },
          { criterionId: 'crit_3', concept: 'Khái niệm C', status: 'OUT_OF_SCOPE' as const, suggestedAddition: '' },
        ] as Array<{ criterionId: string; concept: string; status: 'COVERED' | 'PARTIALLY_COVERED' | 'MISSING' | 'OUT_OF_SCOPE'; suggestedAddition: string }>,
        strengths: ['Trình bày rõ ràng', 'Ghi đủ công thức'],
        weaknesses: ['Thiếu điều kiện nhiệt độ'],
        suggestions: ['Ôn lại Chương 2'],
      },
      {
        claims: [{ id: 3 }],
        coverageItems: [
          { criterionId: 'crit_1', concept: 'Khái niệm A', status: 'COVERED', suggestedAddition: '' },
          { criterionId: 'crit_2', concept: 'Khái niệm B', status: 'MISSING', suggestedAddition: 'Bổ sung B' },
          { criterionId: 'crit_3', concept: 'Khái niệm C', status: 'MISSING', suggestedAddition: 'Bổ sung C' },
        ],
        strengths: ['trình bày rõ ràng', 'Ví dụ sát SGK'],
        weaknesses: ['Thiếu điều kiện nhiệt độ', 'Nhầm đơn vị mol'],
        suggestions: ['Ôn lại Chương 2', 'Luyện thêm bài tập'],
      }
    );

    assert.equal(merged.claims.length, 3);
    assert.equal(merged.coverageItems.find((c) => c.criterionId === 'crit_1')?.status, 'COVERED');
    assert.equal(merged.coverageItems.find((c) => c.criterionId === 'crit_2')?.status, 'PARTIALLY_COVERED');
    assert.equal(merged.coverageItems.find((c) => c.criterionId === 'crit_3')?.status, 'MISSING');
    assert.deepEqual(merged.strengths, ['Trình bày rõ ràng', 'Ghi đủ công thức', 'Ví dụ sát SGK']);
    assert.deepEqual(merged.weaknesses, ['Thiếu điều kiện nhiệt độ', 'Nhầm đơn vị mol']);
    assert.deepEqual(merged.suggestions, ['Ôn lại Chương 2', 'Luyện thêm bài tập']);
  });
});

describe('adaptiveApiPlan — cross-provider verification & Groq bucket separation', () => {
  it('never reuses the grading provider when >= 2 providers are configured', () => {
    const all3 = { mistral: true, groq: true, cloudflare: true };

    // Slot 1 graded by Mistral -> must pick Groq (gpt-oss-20b)
    const v1 = selectCrossProviderVerifierModel({
      gradedByProvider: 'mistral',
      slot: 1,
      configuredProviders: all3,
    });
    assert.equal(v1.primaryProvider, 'groq');
    assert.equal(v1.primaryModel, GROQ_VERIFY_SLOT1_MODEL);
    assert.notEqual(v1.primaryProvider, 'mistral');

    // Slot 2 graded by Cloudflare -> must pick Groq Qwen (different 8K-TPM bucket from gpt-oss-20b)
    const v2 = selectCrossProviderVerifierModel({
      gradedByProvider: 'cloudflare',
      slot: 2,
      configuredProviders: all3,
      slot1VerifyModel: v1.primaryModel,
    });
    assert.equal(v2.primaryProvider, 'groq');
    assert.equal(v2.primaryModel, GROQ_VERIFY_SLOT2_MODEL);
    assert.notEqual(v2.primaryModel, v1.primaryModel);
    assert.notEqual(v2.primaryProvider, 'cloudflare');

    // If Groq graded Part 1, verifier MUST NOT be Groq
    const vFromGroq = selectCrossProviderVerifierModel({
      gradedByProvider: 'groq',
      slot: 1,
      configuredProviders: all3,
    });
    assert.notEqual(vFromGroq.primaryProvider, 'groq');
    assert.equal(vFromGroq.primaryModel, CF_VERIFY_MODEL);

    // If only Mistral + Cloudflare are configured and Cloudflare graded Part 2 -> must pick Mistral
    const vNoGroq = selectCrossProviderVerifierModel({
      gradedByProvider: 'cloudflare',
      slot: 2,
      configuredProviders: { mistral: true, groq: false, cloudflare: true },
    });
    assert.equal(vNoGroq.primaryProvider, 'mistral');
    assert.equal(vNoGroq.primaryModel, MISTRAL_VERIFY_MODEL);
  });
});

describe('adaptiveApiPlan — scoped stage & slot API key resolution priority', () => {
  it('resolves exact provider+stage+slot -> short KEY_<STAGE>_<SLOT> -> numbered -> default', () => {
    const env = {
      GROQ_KEY_QUET_1: 'gsk_exact_quet_1',
      KEY_QUET_2: 'gsk_short_quet_2',
      GROQ_API_KEY_1: 'gsk_numbered_1',
      GROQ_API_KEY: 'gsk_default',
      MISTRAL_KEY_CHAM_1: 'mistral_exact_cham_1',
      KEY_CHAM_2: 'mistral_short_cham_2',
      MISTRAL_API_KEY_2: 'mistral_numbered_2',
      MISTRAL_API_KEY: 'mistral_default',
    };

    assert.equal(
      resolveScopedStageApiKey({ provider: 'groq', stage: 'QUET', slot: 1, env }),
      'gsk_exact_quet_1'
    );
    assert.equal(
      resolveScopedStageApiKey({ provider: 'groq', stage: 'QUET', slot: 2, env }),
      'gsk_short_quet_2'
    );
    assert.equal(
      resolveScopedStageApiKey({ provider: 'groq', stage: 'DO', slot: 1, env }),
      'gsk_numbered_1'
    );
    assert.equal(
      resolveScopedStageApiKey({ provider: 'groq', stage: 'DO', slot: 2, env }),
      'gsk_default'
    );
    assert.equal(
      resolveScopedStageApiKey({ provider: 'mistral', stage: 'CHAM', slot: 1, env }),
      'mistral_exact_cham_1'
    );
    assert.equal(
      resolveScopedStageApiKey({ provider: 'mistral', stage: 'CHAM', slot: 2, env }),
      'mistral_short_cham_2'
    );
    // Safeguard: never pass a Groq gsk_ short alias key to Mistral
    assert.equal(
      resolveScopedStageApiKey({ provider: 'mistral', stage: 'QUET', slot: 2, env }),
      'mistral_numbered_2'
    );
  });
});
