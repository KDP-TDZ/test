import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildDeterministicCacheKey, computeStableTextDigest } from '../core/cache.js';
import { retrieveRelevantChunks } from '../core/retrieval.js';
import {
  buildFixedRubricFromChunks,
  formatFixedRubricForPrompt,
  reconcileCoverageAgainstFixedRubric,
} from '../core/rubric.js';
import { calculateAccuracyScore, calculateCompletenessScore } from '../core/scoring.js';
import type { ExtractedClaim, ReferenceChunk, SystemAiConfig } from '../core/types.js';
import { DEFAULT_TASK_MODELS } from './modelDefaults.js';
import { clearAiResponseCache, executeRoutedAiTask } from './modelRouter.js';
import { parseAndValidateKnowledgeEvalJson } from './geminiPipeline.js';

function makeTestConfig(primaryModel: string, fallbackModel: string): SystemAiConfig {
  return {
    enabled: true,
    disabledReason: '',
    maintenanceMessage: '',
    updatedAt: '2026-11-23T00:00:00.000Z',
    updatedBy: 'test',
    activeModel: primaryModel,
    configVersion: 7,
    allowedOrigins: [],
    rateLimitConfig: {
      requestsPerMinute: 60,
      requestsPerHour: 300,
      analysesPerDay: 100,
      cooldownSeconds: 0,
      maximumConcurrentJobs: 5,
      maximumPagesPerAnalysis: 25,
      maximumFileSizeMb: 20,
    },
    taskModels: {
      ...DEFAULT_TASK_MODELS,
      knowledge_analysis: {
        defaultModel: primaryModel,
        fallbackModel,
        enableFallback: true,
        oneTimeOverrideModel: null,
        promptVersion: 'v4.0_fixed_rubric_deterministic',
      },
    },
  };
}

function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void> | void) {
  return async () => {
    const prev: Record<string, string | undefined> = {};
    for (const key of Object.keys(vars)) {
      prev[key] = process.env[key];
      if (vars[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = vars[key];
      }
    }
    clearAiResponseCache();
    try {
      await fn();
    } finally {
      for (const key of Object.keys(vars)) {
        if (prev[key] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = prev[key];
        }
      }
      clearAiResponseCache();
    }
  };
}

const BIOLOGY_10_CHUNKS: ReferenceChunk[] = [
  {
    chunkId: 'sinh10_c2',
    referenceId: 'ref_sinh10',
    grade: '10',
    subject: 'sinh_hoc',
    textbookSeries: 'Kết nối tri thức với cuộc sống',
    chapter: 'Chương 2: Thành phần hóa học của tế bào',
    lesson: 'Bài 5: Các phân tử sinh học',
    pageNumber: 32,
    sectionTitle: '2. Vai trò và cấu tạo của protein',
    content:
      'Protein được cấu tạo theo nguyên tắc đa phân mà đơn phân là các amino acid liên kết với nhau bằng liên kết peptide. Protein có 4 bậc cấu trúc không gian và đảm nhiệm vai trò cấu trúc, xúc tác enzyme, vận chuyển, bảo vệ.',
    keywords: ['protein', 'amino acid', 'liên kết peptide', 'enzyme', '4 bậc cấu trúc'],
    learningObjectives: [
      'Nêu được cấu tạo đa phân và đơn phân amino acid của protein',
      'Trình bày được vai trò sinh học chính của protein trong tế bào',
    ],
    conceptTags: ['protein', 'amino acid', 'peptide'],
  },
  {
    chunkId: 'sinh10_c1',
    referenceId: 'ref_sinh10',
    grade: '10',
    subject: 'sinh_hoc',
    textbookSeries: 'Kết nối tri thức với cuộc sống',
    chapter: 'Chương 2: Thành phần hóa học của tế bào',
    lesson: 'Bài 5: Các phân tử sinh học',
    pageNumber: 28,
    sectionTitle: '1. Cấu tạo và vai trò của carbohydrate',
    content:
      'Carbohydrate gồm các nguyên tố C, H, O theo tỉ lệ 1:2:1, chia thành đường đơn (glucose, fructose), đường đôi (sucrose, lactose) và đường đa (tinh bột, glycogen, cellulose). Vai trò: cung cấp năng lượng và cấu tạo thành tế bào thực vật.',
    keywords: ['carbohydrate', 'glucose', 'cellulose', 'tinh bột', 'năng lượng'],
    learningObjectives: [
      'Phân loại được carbohydrate thành đường đơn, đường đôi, đường đa',
      'Nêu được vai trò cung cấp năng lượng và cấu trúc của carbohydrate',
    ],
    conceptTags: ['carbohydrate', 'glucose', 'cellulose'],
  },
  {
    chunkId: 'sinh10_c3',
    referenceId: 'ref_sinh10',
    grade: '10',
    subject: 'sinh_hoc',
    textbookSeries: 'Kết nối tri thức với cuộc sống',
    chapter: 'Chương 2: Thành phần hóa học của tế bào',
    lesson: 'Bài 5: Các phân tử sinh học',
    pageNumber: 36,
    sectionTitle: '3. Nucleic acid (DNA và RNA)',
    content:
      'DNA có cấu trúc xoắn kép gồm 2 mạch polynucleotide song song ngược chiều, liên kết bằng liên kết hydrogen theo nguyên tắc bổ sung A-T và G-C. DNA lưu giữ, bảo quản và truyền đạt thông tin di truyền.',
    keywords: ['dna', 'rna', 'nucleotide', 'nguyên tắc bổ sung', 'thông tin di truyền'],
    learningObjectives: [
      'Mô tả được cấu trúc xoắn kép và nguyên tắc bổ sung của DNA',
    ],
    conceptTags: ['DNA', 'RNA', 'nucleotide'],
  },
];

test('parseAndValidateKnowledgeEvalJson rejects empty, truncated, or missing-claims JSON instead of silent fallback', () => {
  assert.throws(() => parseAndValidateKnowledgeEvalJson(''), /GRADING_JSON_INVALID/);
  assert.throws(() => parseAndValidateKnowledgeEvalJson('{}'), /GRADING_JSON_INVALID/);
  assert.throws(
    () =>
      parseAndValidateKnowledgeEvalJson(
        '{"claims":[{"sourcePage":1,"sourceText":"s = v.t","evaluationStatus":"CORR'
      ),
    /GRADING_JSON_INVALID/
  );
  assert.throws(
    () => parseAndValidateKnowledgeEvalJson('{"coverageItems":[],"strengths":[]}'),
    /GRADING_JSON_INVALID/
  );

  // Valid JSON including unescaped LaTeX backslashes must parse cleanly
  const valid = parseAndValidateKnowledgeEvalJson(
    '```json\n{"claims":[{"sourcePage":1,"sourceText":"\\Delta x = v \\cdot t","chapter":"C1","concept":"Chuyển động","importanceWeight":3,"evaluationStatus":"CORRECT","explanation":"Đúng","correctKnowledge":"\\Delta x = v \\cdot t"}],"coverageItems":[]}\n```'
  );
  assert.equal(valid.claims?.length, 1);
  assert.equal(valid.claims?.[0].evaluationStatus, 'CORRECT');
});

test('Full-document cache hashing detects edits beyond 12,000 chars and canonicalizes nested keys', () => {
  const prefix = 'Kiến thức Vật lý 10 chuyển động thẳng đều. '.repeat(320); // > 13,000 chars
  assert.ok(prefix.length > 12_000);

  const docA = `${prefix} Công thức cuối bài: s = v.t`;
  const docB = `${prefix} Công thức cuối bài: s = v + t`;

  const hashA = computeStableTextDigest(docA);
  const hashB = computeStableTextDigest(docB);
  assert.notEqual(hashA, hashB, 'Changes past 12,000 chars must produce a different digest');

  const key1 = buildDeterministicCacheKey({
    a: 1,
    nested: { z: 'last', a: 'first', deep: { y: 2, x: 1 } },
  });
  const key2 = buildDeterministicCacheKey({
    nested: { deep: { x: 1, y: 2 }, a: 'first', z: 'last' },
    a: 1,
  });
  assert.equal(key1, key2, 'Nested object key order must canonicalize identically');
});

test('retrieveRelevantChunks uses deterministic tie-breaking on pageNumber and chunkId regardless of input order', () => {
  const tiedChunks: ReferenceChunk[] = [
    {
      ...BIOLOGY_10_CHUNKS[0],
      chunkId: 'c_b',
      pageNumber: 20,
      content: 'Liên kết hydrogen trong nước',
      sectionTitle: 'Liên kết hydrogen',
      keywords: ['hydrogen'],
      conceptTags: ['hydrogen'],
    },
    {
      ...BIOLOGY_10_CHUNKS[0],
      chunkId: 'c_a',
      pageNumber: 20,
      content: 'Liên kết hydrogen trong nước',
      sectionTitle: 'Liên kết hydrogen',
      keywords: ['hydrogen'],
      conceptTags: ['hydrogen'],
    },
    {
      ...BIOLOGY_10_CHUNKS[0],
      chunkId: 'c_early',
      pageNumber: 12,
      content: 'Liên kết hydrogen trong nước',
      sectionTitle: 'Liên kết hydrogen',
      keywords: ['hydrogen'],
      conceptTags: ['hydrogen'],
    },
  ];

  const forward = retrieveRelevantChunks('Liên kết hydrogen', tiedChunks, { topK: 10 }).map(
    (h) => h.chunk.chunkId
  );
  const reversed = retrieveRelevantChunks('Liên kết hydrogen', [...tiedChunks].reverse(), {
    topK: 10,
  }).map((h) => h.chunk.chunkId);

  assert.deepEqual(forward, ['c_early', 'c_a', 'c_b']);
  assert.deepEqual(reversed, forward);
});

test('Fixed Pre-Grading Rubric locks weights & denominator and prevents AI from dropping or mutating criteria', () => {
  const rubric1 = buildFixedRubricFromChunks({
    chunks: BIOLOGY_10_CHUNKS,
    subject: 'sinh_hoc',
    grade: '10',
    textbookReferenceId: 'ref_sinh10',
    textbookTitle: 'Sinh học 10 - Kết nối tri thức',
    selectedChapters: ['Chương 2: Thành phần hóa học của tế bào'],
  });

  // Shuffling chunks input must produce identical rubric IDs, order, weights, and hash
  const rubric2 = buildFixedRubricFromChunks({
    chunks: [...BIOLOGY_10_CHUNKS].reverse(),
    subject: 'sinh_hoc',
    grade: '10',
    textbookReferenceId: 'ref_sinh10',
    textbookTitle: 'Sinh học 10 - Kết nối tri thức',
    selectedChapters: ['Chương 2: Thành phần hóa học của tế bào'],
  });

  assert.equal(rubric1.rubricMode, 'fixed_textbook_rubric');
  assert.equal(rubric1.rubricHash, rubric2.rubricHash);
  assert.deepEqual(
    rubric1.criteria.map((c) => [c.criterionId, c.importanceWeight]),
    rubric2.criteria.map((c) => [c.criterionId, c.importanceWeight])
  );
  assert.ok(rubric1.criteria.length >= 5);
  assert.ok(formatFixedRubricForPrompt(rubric1).includes('KT01'));

  // Simulate AI trying to tamper with weights, omit criteria, and invent an extra out-of-rubric item
  const tamperedAiCoverage = [
    {
      criterionId: 'KT01',
      concept: rubric1.criteria[0].concept,
      chapter: rubric1.criteria[0].chapter,
      importanceWeight: 1, // AI tries to downgrade weight!
      status: 'COVERED',
      suggestedAddition: '',
      referenceExcerpt: 'SGK Tr.28',
    },
    {
      criterionId: 'KT02',
      concept: rubric1.criteria[1].concept,
      chapter: rubric1.criteria[1].chapter,
      importanceWeight: 1, // AI tries to downgrade weight!
      status: 'PARTIALLY_COVERED',
      suggestedAddition: 'Thiếu vai trò cấu trúc cellulose',
      referenceExcerpt: 'SGK Tr.28',
    },
    // AI omits KT03..KTn and invents an extra item!
    {
      concept: 'Ý kiến tự bịa ngoài rubric',
      chapter: 'Ngoài khung',
      importanceWeight: 3,
      status: 'MISSING',
      suggestedAddition: 'Không nằm trong rubric',
      referenceExcerpt: '',
    },
  ];

  const { coverageItems, extraObservations } = reconcileCoverageAgainstFixedRubric(
    rubric1,
    tamperedAiCoverage
  );

  // Denominator count & weights MUST strictly equal the fixed rubric
  assert.equal(coverageItems.length, rubric1.criteria.length);
  for (let i = 0; i < rubric1.criteria.length; i += 1) {
    assert.equal(coverageItems[i].criterionId, rubric1.criteria[i].criterionId);
    assert.equal(coverageItems[i].importanceWeight, rubric1.criteria[i].importanceWeight);
  }
  assert.equal(coverageItems[0].status, 'COVERED');
  assert.equal(coverageItems[1].status, 'PARTIALLY_COVERED');
  // Omitted rubric criteria are explicitly marked MISSING rather than dropped
  assert.equal(coverageItems[2].status, 'MISSING');
  assert.equal(extraObservations.length, 1);

  const comp = calculateCompletenessScore(coverageItems, true, {
    rubricMode: 'fixed_textbook_rubric',
    rubricItemCount: rubric1.criteria.length,
    extraObservationsCount: extraObservations.length,
  });
  assert.equal(comp.totalRequiredWeight, rubric1.totalRequiredWeight);
  assert.equal(comp.rubricMode, 'fixed_textbook_rubric');
  assert.equal(comp.extraObservationsCount, 1);

  // Unscoped documents MUST return null completenessScore instead of a fabricated percentage
  const unscoped = calculateCompletenessScore(coverageItems, false, { rubricMode: 'unscoped' });
  assert.equal(unscoped.completenessScore, null);
  assert.equal(unscoped.rubricMode, 'unscoped');
});

test(
  'executeRoutedAiTask strictModelLock blocks silent cross-provider fallback and throws STRICT_GRADING_MODEL_UNAVAILABLE',
  withEnv({ GROQ_API_KEY: 'gsk_test_strict_1', GEMINI_API_KEY: 'AIzaTestStrict1' }, async () => {
    const cfg = makeTestConfig('groq:openai/gpt-oss-120b', 'gemini-2.5-flash');
    const calledModels: string[] = [];

    await assert.rejects(
      () =>
        executeRoutedAiTask({
          taskType: 'knowledge_analysis',
          config: cfg,
          strictModelLock: true,
          allowGroqRescue: false,
          cacheInput: { docHash: 'strict_test_doc' },
          runWithModel: async (modelId) => {
            calledModels.push(modelId);
            throw new Error('503 UNAVAILABLE (Groq): upstream busy');
          },
        }),
      /STRICT_GRADING_MODEL_UNAVAILABLE/
    );

    assert.ok(calledModels.every((m) => m === 'groq:openai/gpt-oss-120b'));
  })
);

test(
  'executeRoutedAiTask cache hits preserve actualModel, usedFallback=true, and systemFingerprint when fallback ran',
  withEnv({ GROQ_API_KEY: 'gsk_test_fb_1', GEMINI_API_KEY: 'AIzaTestFb1' }, async () => {
    const cfg = makeTestConfig('groq:openai/gpt-oss-120b', 'gemini-2.5-flash');
    let invocations = 0;

    const runOnce = () =>
      executeRoutedAiTask<{ ok: boolean; resolvedModel: string; systemFingerprint: string }>({
        taskType: 'knowledge_analysis',
        config: cfg,
        strictModelLock: false,
        cacheInput: { docHash: 'fallback_cache_audit_doc' },
        extractExecutionMeta: (res) => ({
          actualModel: res.resolvedModel,
          systemFingerprint: res.systemFingerprint,
        }),
        runWithModel: async (modelId) => {
          invocations += 1;
          if (modelId === 'groq:openai/gpt-oss-120b') {
            throw new Error('429 RESOURCE_EXHAUSTED');
          }
          return {
            ok: true,
            resolvedModel: modelId,
            systemFingerprint: 'fp_gemini_25_v1',
          };
        },
      });

    const first = await runOnce();
    assert.equal(first.requestedModel, 'groq:openai/gpt-oss-120b');
    assert.equal(first.actualModel, 'gemini-2.5-flash');
    assert.equal(first.usedFallback, true);
    assert.equal(first.cached, false);
    assert.equal(first.systemFingerprint, 'fp_gemini_25_v1');

    // Second call hits cache — MUST NOT lie and say modelId === requestedModel or usedFallback === false!
    const second = await runOnce();
    assert.equal(second.cached, true);
    assert.equal(second.requestedModel, 'groq:openai/gpt-oss-120b');
    assert.equal(second.actualModel, 'gemini-2.5-flash');
    assert.equal(second.modelId, 'gemini-2.5-flash');
    assert.equal(second.usedFallback, true);
    assert.equal(second.systemFingerprint, 'fp_gemini_25_v1');
    assert.equal(invocations, 2, 'Primary failed once, fallback ran once, cache served second call');
  })
);

test(
  '10x Repeatability Harness: grading the same document 10 times yields 100% identical scores, claims, rubric, and audit provenance',
  withEnv({ GROQ_API_KEY: 'gsk_test_repeat_10x', GEMINI_API_KEY: undefined }, async () => {
    const cfg = makeTestConfig('groq:openai/gpt-oss-120b', 'groq:openai/gpt-oss-20b');
    const studentText =
      'Carbohydrate gồm C, H, O tỉ lệ 1:2:1, chia thành đường đơn, đường đôi và đường đa. Protein có đơn phân là amino acid liên kết peptide. DNA có 2 mạch xoắn kép theo nguyên tắc A-U và G-C.';
    const ocrTextHash = crypto.createHash('sha256').update(studentText.normalize('NFC')).digest('hex').slice(0, 24);
    const hits = retrieveRelevantChunks(studentText, BIOLOGY_10_CHUNKS, {
      referenceId: 'ref_sinh10',
      topK: 16,
    });
    const chunkIds = hits.map((h) => h.chunk.chunkId).sort();
    const fixedRubric = buildFixedRubricFromChunks({
      chunks: hits.map((h) => h.chunk),
      subject: 'sinh_hoc',
      grade: '10',
      textbookReferenceId: 'ref_sinh10',
      textbookTitle: 'Sinh học 10 - Kết nối tri thức',
      selectedChapters: ['Chương 2: Thành phần hóa học của tế bào'],
    });

    let liveModelCalls = 0;
    const snapshots: Array<{
      ocrTextHash: string;
      chunkIds: string[];
      rubricHash: string;
      requestedModel: string;
      actualModel: string;
      usedFallback: boolean;
      cached: boolean;
      systemFingerprint?: string;
      accuracyScore: number | null;
      completenessScore: number | null;
      claimSignature: string;
    }> = [];

    for (let run = 1; run <= 10; run += 1) {
      const routed = await executeRoutedAiTask<{
        resolvedModel: string;
        systemFingerprint: string;
        claims: ExtractedClaim[];
        coverage: Array<{
          criterionId: string;
          concept: string;
          chapter: string;
          importanceWeight: 1 | 2 | 3;
          status: string;
          suggestedAddition: string;
          referenceExcerpt: string;
        }>;
      }>({
        taskType: 'knowledge_analysis',
        config: cfg,
        strictModelLock: true,
        cacheInput: {
          ocrTextHash,
          rubricHash: fixedRubric.rubricHash,
          chunkIds,
          promptVersion: 'v4.0_fixed_rubric_deterministic',
        },
        extractExecutionMeta: (res) => ({
          actualModel: res.resolvedModel,
          systemFingerprint: res.systemFingerprint,
        }),
        runWithModel: async (modelId) => {
          liveModelCalls += 1;
          return {
            resolvedModel: modelId,
            systemFingerprint: 'fp_groq_oss120b_det',
            claims: [
              {
                claimId: 'claim_1_carb',
                sourceText: 'Carbohydrate gồm C, H, O tỉ lệ 1:2:1, chia thành đường đơn, đường đôi và đường đa.',
                normalizedMeaning: 'Phân loại carbohydrate',
                subject: 'sinh_hoc',
                chapter: 'Chương 2: Thành phần hóa học của tế bào',
                concept: 'Carbohydrate',
                importanceLevel: 'core',
                importanceWeight: 3,
                sourcePage: 1,
                ocrConfidence: 0.96,
                knowledgeType: 'textbook_core',
                evaluationStatus: 'CORRECT',
                explanation: 'Chính xác theo SGK.',
                correctKnowledge: 'Đúng.',
                evidences: [],
              },
              {
                claimId: 'claim_2_dna',
                sourceText: 'DNA có 2 mạch xoắn kép theo nguyên tắc A-U và G-C.',
                normalizedMeaning: 'Nguyên tắc bổ sung DNA',
                subject: 'sinh_hoc',
                chapter: 'Chương 2: Thành phần hóa học của tế bào',
                concept: 'Cấu trúc DNA',
                importanceLevel: 'core',
                importanceWeight: 3,
                sourcePage: 1,
                ocrConfidence: 0.96,
                knowledgeType: 'textbook_core',
                evaluationStatus: 'INCORRECT',
                explanation: 'DNA bắt cặp A-T và G-C, không có U.',
                correctKnowledge: 'A liên kết với T, G liên kết với C.',
                evidences: [],
              },
            ] as ExtractedClaim[],
            coverage: fixedRubric.criteria.map((c, idx) => ({
              criterionId: c.criterionId,
              concept: c.concept,
              chapter: c.chapter,
              importanceWeight: c.importanceWeight,
              status: idx < 3 ? 'COVERED' : 'MISSING',
              suggestedAddition: idx < 3 ? '' : 'Cần bổ sung',
              referenceExcerpt: c.referenceExcerpt,
            })),
          };
        },
      });

      const { coverageItems } = reconcileCoverageAgainstFixedRubric(
        fixedRubric,
        routed.data.coverage
      );
      const acc = calculateAccuracyScore(routed.data.claims, true);
      const comp = calculateCompletenessScore(coverageItems, true, {
        rubricMode: 'fixed_textbook_rubric',
        rubricItemCount: fixedRubric.criteria.length,
      });

      snapshots.push({
        ocrTextHash,
        chunkIds,
        rubricHash: fixedRubric.rubricHash,
        requestedModel: routed.requestedModel,
        actualModel: routed.actualModel,
        usedFallback: routed.usedFallback,
        cached: routed.cached,
        systemFingerprint: routed.systemFingerprint,
        accuracyScore: acc.accuracyScore,
        completenessScore: comp.completenessScore,
        claimSignature: JSON.stringify(
          routed.data.claims.map((c) => [c.claimId, c.evaluationStatus, c.importanceWeight])
        ),
      });
    }

    assert.equal(liveModelCalls, 1, '10 repeated runs with identical inputs should call the AI model only once');
    assert.equal(snapshots[0].cached, false);
    for (let i = 1; i < snapshots.length; i += 1) {
      assert.equal(snapshots[i].cached, true);
      assert.equal(snapshots[i].ocrTextHash, snapshots[0].ocrTextHash);
      assert.deepEqual(snapshots[i].chunkIds, snapshots[0].chunkIds);
      assert.equal(snapshots[i].rubricHash, snapshots[0].rubricHash);
      assert.equal(snapshots[i].requestedModel, snapshots[0].requestedModel);
      assert.equal(snapshots[i].actualModel, snapshots[0].actualModel);
      assert.equal(snapshots[i].usedFallback, false);
      assert.equal(snapshots[i].systemFingerprint, 'fp_groq_oss120b_det');
      assert.equal(snapshots[i].accuracyScore, snapshots[0].accuracyScore);
      assert.equal(snapshots[i].completenessScore, snapshots[0].completenessScore);
      assert.equal(snapshots[i].claimSignature, snapshots[0].claimSignature);
    }
  })
);
