import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateAccuracyScore, computeClaimScoreSummary } from './scoring.js';
import {
  computeInlineHighlightSegments,
  sortClaimsByDocumentPosition,
  verifyAndAnchorErrorSpan,
} from './semanticBlocks.js';
import {
  anchorClaimsAndBuildAnnotations,
  hasMeaningfulReadableContent,
  isBlockOcrUncertain,
  validateAndApplyVerifierAdjustments,
} from './verificationPostProcess.js';
import type { ExtractedClaim, ExtractedPage } from './types.js';

function makeClaim(overrides: Partial<ExtractedClaim> = {}): ExtractedClaim {
  return {
    claimId: overrides.claimId || 'c1',
    sourceText: overrides.sourceText || 's = v + t',
    normalizedMeaning: overrides.normalizedMeaning || 's = v + t',
    subject: overrides.subject || 'vat_ly',
    chapter: overrides.chapter || 'Chuyển động thẳng đều',
    concept: overrides.concept || 'Công thức tính quãng đường',
    importanceLevel: overrides.importanceLevel || 'core',
    importanceWeight: overrides.importanceWeight || 3,
    sourcePage: overrides.sourcePage ?? 1,
    blockId: overrides.blockId,
    blockIds: overrides.blockIds,
    errorSpan: overrides.errorSpan,
    startOffset: overrides.startOffset,
    endOffset: overrides.endOffset,
    contextBefore: overrides.contextBefore,
    contextAfter: overrides.contextAfter,
    locationStatus: overrides.locationStatus,
    verificationNote: overrides.verificationNote,
    shortFix: overrides.shortFix,
    ocrConfidence: overrides.ocrConfidence ?? 0.96,
    knowledgeType: overrides.knowledgeType || 'textbook_core',
    evaluationStatus: overrides.evaluationStatus || 'INCORRECT',
    explanation: overrides.explanation || 'Sai phép toán: phải nhân vận tốc với thời gian.',
    correctKnowledge: overrides.correctKnowledge || 's = v.t',
    suggestedFix: overrides.suggestedFix || 'Sửa s = v + t thành s = v.t',
    evidences: overrides.evidences || [],
  };
}

function makePage(
  pageNumber: number,
  blocks: Array<Omit<ExtractedPage['blocks'][number], 'readingOrder'> & { readingOrder?: number }>,
  avgConf = 0.95
): ExtractedPage {
  const normalizedBlocks = blocks.map((b, idx) => ({
    ...b,
    readingOrder: b.readingOrder ?? idx + 1,
  }));
  return {
    pageNumber,
    rawText: normalizedBlocks.map((b) => b.extractedText).join('\n'),
    blocks: normalizedBlocks,
    ocrAverageConfidence: avgConf,
  };
}

// ============================================================================
// CASE A: Formula error (s = v + t) -> INCORRECT, red, exact errorSpan, verbatim
// ============================================================================
test('Case A: formula error s = v + t is anchored with exact verified offsets, red color, and 100% verbatim text', () => {
  const blockText = 'Công thức tính quãng đường:\ns = v + t';
  const pages: ExtractedPage[] = [
    makePage(1, [
      {
        blockId: 'p1_b1',
        pageNumber: 1,
        textType: 'formula',
        extractedText: blockText,
        formulaText: 's = v + t',
        confidence: 0.98,
      },
    ]),
  ];

  const { claims, annotations } = anchorClaimsAndBuildAnnotations({
    pages,
    ocrConfirmed: false,
    claims: [
      makeClaim({
        claimId: 'c_formula',
        blockId: 'p1_b1',
        sourceText: blockText,
        errorSpan: 's = v + t',
        shortFix: 'Sửa thành s = v.t (quãng đường bằng tốc độ nhân thời gian).',
        evaluationStatus: 'INCORRECT',
      }),
    ],
  });

  assert.equal(claims[0].evaluationStatus, 'INCORRECT');
  assert.equal(claims[0].locationStatus, 'verified');
  assert.equal(claims[0].errorSpan, 's = v + t');
  assert.equal(blockText.slice(claims[0].startOffset!, claims[0].endOffset!), 's = v + t');

  assert.equal(annotations.length, 1);
  assert.equal(annotations[0].annotationColor, 'red');
  assert.equal(annotations[0].annotationKind, 'error');
  assert.equal(annotations[0].locationStatus, 'verified');

  const segs = computeInlineHighlightSegments(blockText, 'p1_b1', [
    {
      claimId: claims[0].claimId,
      blockId: claims[0].blockId,
      errorSpan: claims[0].errorSpan,
      textExcerpt: claims[0].sourceText,
      startOffset: claims[0].startOffset,
      endOffset: claims[0].endOffset,
      locationStatus: claims[0].locationStatus,
      annotationColor: 'red',
      orderNumber: 1,
    },
  ]);
  assert.equal(segs.segments.map((s) => s.text).join(''), blockText);
  const redSegs = segs.segments.filter((s) => s.annotationColor === 'red');
  assert.equal(redSegs.length, 1);
  assert.equal(redSegs[0].text, 's = v + t');
});

// ============================================================================
// CASE B: Missing unit ("v là tốc độ") -> PARTIALLY_CORRECT, orange, verbatim
// ============================================================================
test('Case B: missing unit on "v là tốc độ" is anchored as PARTIALLY_CORRECT orange without mutating student text', () => {
  const blockText = 'Trong đó:\n• s là quãng đường (m)\n• v là tốc độ';
  const pages = [
    makePage(1, [
      {
        blockId: 'p1_b2',
        pageNumber: 1,
        textType: 'list',
        extractedText: blockText,
        confidence: 0.96,
      },
    ]),
  ];

  const { claims, annotations } = anchorClaimsAndBuildAnnotations({
    pages,
    ocrConfirmed: false,
    claims: [
      makeClaim({
        claimId: 'c_unit',
        blockId: 'p1_b2',
        sourceText: 'v là tốc độ',
        errorSpan: 'v là tốc độ',
        shortFix: 'Bổ sung đơn vị tốc độ: v là tốc độ (m/s).',
        evaluationStatus: 'PARTIALLY_CORRECT',
        explanation: 'Thiếu đơn vị đo của tốc độ v (m/s).',
      }),
    ],
  });

  assert.equal(claims[0].evaluationStatus, 'PARTIALLY_CORRECT');
  assert.equal(claims[0].locationStatus, 'verified');
  assert.equal(blockText.slice(claims[0].startOffset!, claims[0].endOffset!), 'v là tốc độ');
  assert.equal(annotations[0].annotationColor, 'orange');
  assert.equal(annotations[0].annotationKind, 'partial');
  assert.match(claims[0].shortFix || '', /m\/s/);
});

// ============================================================================
// CASE C: Cross-provider Verifier catches missed error on CORRECT claim & blocks ungrounded downgrade
// ============================================================================
test('Case C: Verifier catches missed formula error marked CORRECT and rejects ungrounded INCORRECT->CORRECT downgrade', () => {
  const pages = [
    makePage(1, [
      {
        blockId: 'p1_b1',
        pageNumber: 1,
        textType: 'formula',
        extractedText: 's = v + t',
        confidence: 0.98,
      },
      {
        blockId: 'p1_b2',
        pageNumber: 1,
        textType: 'paragraph',
        extractedText: 'Quãng đường tỉ lệ nghịch với thời gian.',
        confidence: 0.97,
      },
    ]),
  ];

  const gradedClaims: ExtractedClaim[] = [
    makeClaim({
      claimId: 'c1',
      blockId: 'p1_b1',
      sourceText: 's = v + t',
      evaluationStatus: 'CORRECT',
      explanation: 'Công thức hợp lý.',
    }),
    makeClaim({
      claimId: 'c2',
      blockId: 'p1_b2',
      sourceText: 'Quãng đường tỉ lệ nghịch với thời gian.',
      errorSpan: 'tỉ lệ nghịch',
      evaluationStatus: 'INCORRECT',
      explanation: 'Sai bản chất: phải là tỉ lệ thuận.',
    }),
  ];

  const reconciled = validateAndApplyVerifierAdjustments(
    gradedClaims,
    [
      // Valid catch of missed error (CORRECT -> INCORRECT)
      {
        claimIndex: 0,
        claimId: 'c1',
        previousStatus: 'CORRECT',
        evaluationStatus: 'INCORRECT',
        reason: 'Phát hiện lỗi sai phép toán bị bỏ sót: v + t sai thứ nguyên.',
        evidenceBasis: 'Trong chuyển động thẳng đều: s = v.t.',
        errorSpan: 's = v + t',
        shortFix: 'Sửa thành s = v.t.',
        explanation: 'Sai phép toán: không thể cộng vận tốc với thời gian.',
        correctKnowledge: 's = v.t',
      },
      // Ungrounded attempt to downgrade INCORRECT -> CORRECT without evidenceBasis -> MUST be rejected!
      {
        claimIndex: 1,
        claimId: 'c2',
        previousStatus: 'INCORRECT',
        evaluationStatus: 'CORRECT',
        reason: 'Có vẻ ổn',
        evidenceBasis: '',
      },
    ],
    pages
  );

  assert.equal(reconciled.appliedCount, 1);
  assert.equal(reconciled.rejectedCount, 1);
  assert.equal(reconciled.claims[0].evaluationStatus, 'INCORRECT');
  assert.equal(reconciled.claims[0].errorSpan, 's = v + t');
  assert.equal(reconciled.claims[0].locationStatus, 'verified');
  // Second claim remains protected as INCORRECT
  assert.equal(reconciled.claims[1].evaluationStatus, 'INCORRECT');
});

// ============================================================================
// CASE D: Invalid / hallucinated errorSpan -> marked unverified, ZERO fake underline, card preserved
// ============================================================================
test('Case D: hallucinated or fixed errorSpan is marked unverified with zero false underline while keeping right card', () => {
  const blockText = 'Công thức tính quãng đường là s = v + t trong chuyển động thẳng đều.';
  const pages = [
    makePage(1, [
      {
        blockId: 'p1_b1',
        pageNumber: 1,
        textType: 'paragraph',
        extractedText: blockText,
        confidence: 0.97,
      },
    ]),
  ];

  const { claims, annotations } = anchorClaimsAndBuildAnnotations({
    pages,
    ocrConfirmed: false,
    claims: [
      makeClaim({
        claimId: 'c_bad_span',
        blockId: 'p1_b1',
        sourceText: blockText,
        // AI mistakenly put corrected formula instead of verbatim student error!
        errorSpan: 's = v * t',
        evaluationStatus: 'INCORRECT',
      }),
    ],
  });

  assert.equal(claims[0].locationStatus, 'unverified');
  assert.equal(claims[0].startOffset, undefined);
  assert.equal(claims[0].endOffset, undefined);

  // Annotation card is still preserved for the right column
  assert.equal(annotations.length, 1);
  assert.equal(annotations[0].locationStatus, 'unverified');

  // Left column MUST NOT draw any fake highlight or underline the whole block
  const res = computeInlineHighlightSegments(blockText, 'p1_b1', [
    {
      claimId: claims[0].claimId,
      blockId: claims[0].blockId,
      errorSpan: claims[0].errorSpan,
      textExcerpt: claims[0].sourceText,
      locationStatus: claims[0].locationStatus,
      annotationColor: 'red',
      orderNumber: 1,
    },
  ]);
  assert.equal(res.matchedClaimIds.length, 0);
  assert.equal(res.segments.length, 1);
  assert.equal(res.segments[0].claimId, undefined);
  assert.equal(res.segments[0].text, blockText);
});

// ============================================================================
// CASE E: Duplicate text in multiple blocks & within one block -> context disambiguation vs unverified
// ============================================================================
test('Case E: duplicate phrases are disambiguated by blockId and contextBefore/contextAfter, never blindly picking index 0', () => {
  const dupBlockText = 'Lần 1 viết s = v + t ở đầu câu, lần 2 viết s = v + t ở cuối câu.';
  const secondIdx = dupBlockText.lastIndexOf('s = v + t');

  // E1: With contextBefore/contextAfter, uniquely anchors SECOND occurrence (NOT first!)
  const disambiguated = verifyAndAnchorErrorSpan({
    blockText: dupBlockText,
    errorSpan: 's = v + t',
    contextBefore: 'lần 2 viết ',
    contextAfter: ' ở cuối câu',
  });
  assert.equal(disambiguated.locationStatus, 'verified');
  assert.equal(disambiguated.startOffset, secondIdx);
  assert.equal(disambiguated.endOffset, secondIdx + 's = v + t'.length);

  // E2: Without any disambiguator, duplicate occurrence MUST be unverified (never blindly picking first)
  const ambiguous = verifyAndAnchorErrorSpan({
    blockText: dupBlockText,
    errorSpan: 's = v + t',
  });
  assert.equal(ambiguous.locationStatus, 'unverified');
  assert.equal(ambiguous.reason, 'ambiguous_duplicate_span');

  // E3: Duplicate across two blocks with explicit blockId ONLY highlights target block p1_b2
  const pages = [
    makePage(1, [
      { blockId: 'p1_b1', pageNumber: 1, textType: 'paragraph', extractedText: 's = v + t', confidence: 0.98 },
      { blockId: 'p1_b2', pageNumber: 1, textType: 'paragraph', extractedText: 's = v + t', confidence: 0.98 },
    ]),
  ];
  const { claims } = anchorClaimsAndBuildAnnotations({
    pages,
    ocrConfirmed: false,
    claims: [
      makeClaim({
        claimId: 'c_b2',
        blockId: 'p1_b2',
        sourceText: 's = v + t',
        errorSpan: 's = v + t',
        evaluationStatus: 'INCORRECT',
      }),
    ],
  });
  const target = {
    claimId: claims[0].claimId,
    blockId: claims[0].blockId,
    errorSpan: claims[0].errorSpan,
    textExcerpt: claims[0].sourceText,
    startOffset: claims[0].startOffset,
    endOffset: claims[0].endOffset,
    locationStatus: claims[0].locationStatus,
    annotationColor: 'red' as const,
    orderNumber: 1,
  };
  assert.equal(computeInlineHighlightSegments('s = v + t', 'p1_b1', [target]).matchedClaimIds.length, 0);
  assert.equal(computeInlineHighlightSegments('s = v + t', 'p1_b2', [target]).matchedClaimIds.length, 1);
});

// ============================================================================
// CASE F: MISSING claim -> anchor_missing marker, no fake underline, no double-count in scoring
// ============================================================================
test('Case F: MISSING claim gets anchor_missing marker without fake underline and is not double-counted in Accuracy', () => {
  const pages = [
    makePage(1, [
      {
        blockId: 'p1_b1',
        pageNumber: 1,
        textType: 'paragraph',
        extractedText: 'Chuyển động thẳng đều có tốc độ không đổi.',
        confidence: 0.98,
      },
    ]),
  ];

  const { claims, annotations } = anchorClaimsAndBuildAnnotations({
    pages,
    ocrConfirmed: false,
    claims: [
      makeClaim({
        claimId: 'c_ok',
        blockId: 'p1_b1',
        sourceText: 'Chuyển động thẳng đều có tốc độ không đổi.',
        evaluationStatus: 'CORRECT',
      }),
      makeClaim({
        claimId: 'c_miss',
        blockId: 'p1_b1',
        sourceText: '',
        concept: 'Thiếu điều kiện quỹ đạo là đường thẳng',
        errorSpan: 'tốc độ không đổi', // must be stripped for MISSING!
        evaluationStatus: 'MISSING',
        explanation: 'Thiếu điều kiện quỹ đạo thẳng.',
        shortFix: 'Bổ sung: quỹ đạo là đường thẳng.',
      }),
    ],
  });

  const missingClaim = claims.find((c) => c.claimId === 'c_miss')!;
  assert.equal(missingClaim.locationStatus, 'anchor_missing');
  assert.equal(missingClaim.errorSpan, undefined);
  assert.equal(missingClaim.startOffset, undefined);

  const missingAnn = annotations.find((a) => a.claimId === 'c_miss')!;
  assert.ok(missingAnn);
  assert.equal(missingAnn.annotationKind, 'missing');
  assert.equal(missingAnn.annotationColor, 'orange');
  assert.equal(missingAnn.locationStatus, 'anchor_missing');

  // Ensure computeInlineHighlightSegments never underlines MISSING
  const inlineRes = computeInlineHighlightSegments(pages[0].blocks[0].extractedText, 'p1_b1', [
    {
      claimId: missingClaim.claimId,
      blockId: missingClaim.blockId,
      textExcerpt: 'Chuyển động thẳng đều có tốc độ không đổi.',
      locationStatus: missingClaim.locationStatus,
      annotationColor: 'orange',
      orderNumber: 1,
    },
  ]);
  assert.equal(inlineRes.matchedClaimIds.length, 0);

  // Scoring counts MISSING in counts.missing / summary.missingCount without double-counting into evaluatedTotal
  const acc = calculateAccuracyScore(claims, true);
  assert.equal(acc.evaluatedTotal, 1);
  assert.equal(acc.counts.missing, 1);
  assert.equal(acc.exactCorrectPercent, 100);
  const summary = computeClaimScoreSummary(claims, acc);
  assert.equal(summary.missingCount, 1);
});

// ============================================================================
// CASE G: Block-level & page-level OCR low confidence + [KHÔNG NHÌN RÕ]
// ============================================================================
test('Case G: low-confidence block & [KHÔNG NHÌN RÕ] become OCR_UNCERTAIN while readable block on same page still grades', () => {
  const pages = [
    makePage(
      1,
      [
        {
          blockId: 'p1_b1_clear',
          pageNumber: 1,
          textType: 'formula',
          extractedText: 's = v + t',
          confidence: 0.97,
        },
        {
          blockId: 'p1_b2_blurry',
          pageNumber: 1,
          textType: 'paragraph',
          extractedText: 'vận tốc trung bình...',
          confidence: 0.42, // low confidence on high-average page!
        },
        {
          blockId: 'p1_b3_unreadable',
          pageNumber: 1,
          textType: 'paragraph',
          extractedText: 'Công thức [KHÔNG NHÌN RÕ] m/s',
          confidence: 0.85,
        },
      ],
      0.84 // high page average!
    ),
  ];

  assert.equal(isBlockOcrUncertain(pages[0].blocks[0], false), false);
  assert.equal(isBlockOcrUncertain(pages[0].blocks[1], false), true);
  assert.equal(isBlockOcrUncertain(pages[0].blocks[2], false), true);

  const { claims, lowConfidenceBlockIds } = anchorClaimsAndBuildAnnotations({
    pages,
    ocrConfirmed: false,
    claims: [
      makeClaim({
        claimId: 'c_clear',
        blockId: 'p1_b1_clear',
        sourceText: 's = v + t',
        errorSpan: 's = v + t',
        evaluationStatus: 'INCORRECT',
      }),
      makeClaim({
        claimId: 'c_blurry',
        blockId: 'p1_b2_blurry',
        sourceText: 'vận tốc trung bình...',
        errorSpan: 'vận tốc trung bình...',
        evaluationStatus: 'INCORRECT',
      }),
      makeClaim({
        claimId: 'c_unreadable',
        blockId: 'p1_b3_unreadable',
        sourceText: 'Công thức [KHÔNG NHÌN RÕ] m/s',
        errorSpan: '[KHÔNG NHÌN RÕ]',
        evaluationStatus: 'CORRECT',
      }),
    ],
  });

  assert.deepEqual(lowConfidenceBlockIds, ['p1_b2_blurry', 'p1_b3_unreadable']);
  assert.equal(claims.find((c) => c.claimId === 'c_clear')!.evaluationStatus, 'INCORRECT');
  assert.equal(claims.find((c) => c.claimId === 'c_blurry')!.evaluationStatus, 'OCR_UNCERTAIN');
  assert.equal(claims.find((c) => c.claimId === 'c_unreadable')!.evaluationStatus, 'OCR_UNCERTAIN');

  // OCR_UNCERTAIN excluded from evaluatedTotal; readable INCORRECT claim IS evaluated
  const acc = calculateAccuracyScore(claims, true);
  assert.equal(acc.evaluatedTotal, 1);
  assert.equal(acc.counts.incorrect, 1);
  assert.equal(acc.counts.ocrUncertain, 2);
});

// ============================================================================
// CASE H: Overlapping & co-located annotations + deterministic document order
// ============================================================================
test('Case H: overlapping and co-located annotations drop zero badges, keep verbatim text, and sort by document order', () => {
  const text = 'Công thức s = v + t thiếu đơn vị';
  const res = computeInlineHighlightSegments(text, 'p1_b1', [
    {
      claimId: 'c_outer',
      blockId: 'p1_b1',
      errorSpan: 's = v + t thiếu đơn vị',
      textExcerpt: text,
      annotationColor: 'orange',
      orderNumber: 2,
    },
    {
      claimId: 'c_inner_red',
      blockId: 'p1_b1',
      errorSpan: 's = v + t',
      textExcerpt: text,
      annotationColor: 'red',
      orderNumber: 1,
    },
    {
      claimId: 'c_same_red_span',
      blockId: 'p1_b1',
      errorSpan: 's = v + t',
      textExcerpt: text,
      annotationColor: 'orange',
      orderNumber: 3,
    },
  ]);

  // 100% verbatim text preserved across split segments
  assert.equal(res.segments.map((s) => s.text).join(''), text);
  assert.equal(res.matchedClaimIds.length, 3);

  // Collect all emitted badges across segments -> all 3 badges (#1, #2, #3) must appear ONCE each!
  const allBadges = res.segments.flatMap((s) => s.coLocatedBadges || []);
  assert.deepEqual(
    allBadges.map((b) => b.orderNumber).sort((a, b) => (a ?? 0) - (b ?? 0)),
    [1, 2, 3]
  );

  // Document-order sorting
  const pages = [
    makePage(1, [
      { blockId: 'p1_b1', pageNumber: 1, textType: 'paragraph', extractedText: 'Block 1', confidence: 0.99 },
      { blockId: 'p1_b2', pageNumber: 1, textType: 'paragraph', extractedText: 'Block 2', confidence: 0.99 },
    ]),
    makePage(2, [
      { blockId: 'p2_b1', pageNumber: 2, textType: 'paragraph', extractedText: 'Block 3', confidence: 0.99 },
    ]),
  ];
  const unordered = [
    makeClaim({ claimId: 'late', sourcePage: 2, blockId: 'p2_b1', startOffset: 0 }),
    makeClaim({ claimId: 'b1_second', sourcePage: 1, blockId: 'p1_b1', startOffset: 20 }),
    makeClaim({ claimId: 'b2_first', sourcePage: 1, blockId: 'p1_b2', startOffset: 2 }),
    makeClaim({ claimId: 'b1_first', sourcePage: 1, blockId: 'p1_b1', startOffset: 4 }),
  ];
  const ordered = sortClaimsByDocumentPosition(unordered, pages);
  assert.deepEqual(
    ordered.map((c) => c.claimId),
    ['b1_first', 'b1_second', 'b2_first', 'late']
  );
});

// ============================================================================
// CASE I: Unicode, Vietnamese NFD/NFC, math symbols, Greek, subscripts, chemical formulas, newlines
// ============================================================================
test('Case I: Unicode Vietnamese NFD/NFC, Greek letters, subscripts, chemical formulas preserve exact String.slice offsets', () => {
  // Construct Vietnamese text with NFD combining diacritics + math/Greek/chemical subscripts + newline
  const nfdWord = 'Chuyển động'.normalize('NFD');
  const text = `${nfdWord} có Δx = x₀ + v₀·t + ½a·t² với ω ≤ √(k/m)\nPhản ứng: H₂SO₄ + 2NaOH → Na₂SO₄ + 2H₂O`;

  // NFC needle matching NFD haystack
  const res1 = verifyAndAnchorErrorSpan({
    blockText: text,
    errorSpan: 'Chuyển động',
  });
  assert.equal(res1.locationStatus, 'verified');
  assert.equal(text.slice(res1.startOffset!, res1.endOffset!), nfdWord);

  // Greek + subscript + math operators
  const res2 = verifyAndAnchorErrorSpan({
    blockText: text,
    errorSpan: 'Δx = x₀ + v₀·t + ½a·t²',
  });
  assert.equal(res2.locationStatus, 'verified');
  assert.equal(text.slice(res2.startOffset!, res2.endOffset!), 'Δx = x₀ + v₀·t + ½a·t²');

  // Chemical formula after newline
  const res3 = verifyAndAnchorErrorSpan({
    blockText: text,
    errorSpan: 'H₂SO₄ + 2NaOH → Na₂SO₄ + 2H₂O',
  });
  assert.equal(res3.locationStatus, 'verified');
  assert.equal(text.slice(res3.startOffset!, res3.endOffset!), 'H₂SO₄ + 2NaOH → Na₂SO₄ + 2H₂O');

  // Full inline highlight preserves exact string byte-for-byte
  const highlighted = computeInlineHighlightSegments(text, 'p1_uni', [
    {
      claimId: 'u1',
      blockId: 'p1_uni',
      errorSpan: 'ω ≤ √(k/m)',
      textExcerpt: text,
      annotationColor: 'red',
      orderNumber: 1,
    },
    {
      claimId: 'u2',
      blockId: 'p1_uni',
      errorSpan: 'H₂SO₄ + 2NaOH → Na₂SO₄ + 2H₂O',
      textExcerpt: text,
      annotationColor: 'orange',
      orderNumber: 2,
    },
  ]);
  assert.equal(highlighted.segments.map((s) => s.text).join(''), text);
  assert.deepEqual(highlighted.matchedClaimIds.sort(), ['u1', 'u2']);
});

// ============================================================================
// BONUS: Empty-claims guard helper & 3-group 100.0% sum invariant
// ============================================================================
test('hasMeaningfulReadableContent distinguishes readable docs from empty/unreadable docs and 3-group percentages always sum to 100%', () => {
  assert.equal(
    hasMeaningfulReadableContent([
      makePage(1, [{ blockId: 'b1', pageNumber: 1, textType: 'paragraph', extractedText: '[KHÔNG NHÌN RÕ]   ', confidence: 0.2 }]),
    ]),
    false
  );
  assert.equal(
    hasMeaningfulReadableContent([
      makePage(1, [{ blockId: 'b1', pageNumber: 1, textType: 'paragraph', extractedText: 'Công thức tính quãng đường s = v + t', confidence: 0.95 }]),
    ]),
    true
  );

  // 1/3, 1/3, 1/3 -> must sum to exact 100.0!
  const threeWay = calculateAccuracyScore(
    [
      makeClaim({ claimId: '1', evaluationStatus: 'CORRECT' }),
      makeClaim({ claimId: '2', evaluationStatus: 'PARTIALLY_CORRECT' }),
      makeClaim({ claimId: '3', evaluationStatus: 'INCORRECT' }),
    ],
    true
  );
  const sum3 = Math.round(
    ((threeWay.exactCorrectPercent ?? 0) +
      (threeWay.partialPercent ?? 0) +
      (threeWay.exactIncorrectPercent ?? 0)) *
      10
  ) / 10;
  assert.equal(sum3, 100);

  // Zero-count bucket must stay strictly 0 while non-zero buckets sum to 100.0
  const zeroCorrect = calculateAccuracyScore(
    [
      makeClaim({ claimId: '1', evaluationStatus: 'PARTIALLY_CORRECT' }),
      makeClaim({ claimId: '2', evaluationStatus: 'INCORRECT' }),
      makeClaim({ claimId: '3', evaluationStatus: 'INCORRECT' }),
    ],
    true
  );
  assert.equal(zeroCorrect.exactCorrectPercent, 0);
  assert.equal(
    Math.round(((zeroCorrect.partialPercent ?? 0) + (zeroCorrect.exactIncorrectPercent ?? 0)) * 10) / 10,
    100
  );
});

// ============================================================================
// CASE J: Whole-Document Context Inheritance prevents false downstream omission errors
// ============================================================================
test('Case J: downstream formula/paragraph inherits conditions and units already stated in upstream blocks instead of being falsely flagged as PARTIALLY_CORRECT or MISSING', () => {
  const pages = [
    makePage(1, [
      {
        blockId: 'p1_b1',
        pageNumber: 1,
        textType: 'paragraph',
        extractedText:
          'Xét chuyển động thẳng đều trên quỹ đạo thẳng với tốc độ v (m/s) không đổi theo thời gian t (s), quãng đường đi được là s (m).',
        confidence: 0.98,
      },
      {
        blockId: 'p1_b2',
        pageNumber: 1,
        textType: 'formula',
        extractedText: 'Do đó công thức tính quãng đường ở đoạn sau là: s = v.t',
        confidence: 0.98,
      },
    ]),
  ];

  const { claims, annotations } = anchorClaimsAndBuildAnnotations({
    pages,
    ocrConfirmed: false,
    claims: [
      makeClaim({
        claimId: 'c_upstream',
        blockId: 'p1_b1',
        sourceText:
          'Xét chuyển động thẳng đều trên quỹ đạo thẳng với tốc độ v (m/s) không đổi theo thời gian t (s), quãng đường đi được là s (m).',
        evaluationStatus: 'CORRECT',
        explanation: 'Đã nêu đầy đủ định nghĩa, điều kiện quỹ đạo thẳng và đơn vị m/s, s, m.',
      }),
      makeClaim({
        claimId: 'c_downstream_false_partial',
        blockId: 'p1_b2',
        sourceText: 'Do đó công thức tính quãng đường ở đoạn sau là: s = v.t',
        errorSpan: 's = v.t',
        evaluationStatus: 'PARTIALLY_CORRECT',
        explanation: 'Thiếu đơn vị đo m/s của tốc độ v và chưa nêu rõ điều kiện chuyển động thẳng đều trên quỹ đạo thẳng.',
        shortFix: 'Bổ sung đơn vị m/s và điều kiện quỹ đạo thẳng.',
      }),
      makeClaim({
        claimId: 'c_downstream_false_missing',
        blockId: 'p1_b2',
        sourceText: '',
        concept: 'Đơn vị tốc độ m/s trong chuyển động thẳng đều',
        evaluationStatus: 'MISSING',
        explanation: 'Thiếu nêu đơn vị tốc độ m/s và thời gian s.',
      }),
    ],
  });

  // Downstream false PARTIALLY_CORRECT must be upgraded to CORRECT via whole-document context inheritance,
  // and redundant false MISSING claim must be dropped!
  assert.equal(claims.length, 2);
  assert.equal(claims[0].evaluationStatus, 'CORRECT');
  assert.equal(claims[1].claimId, 'c_downstream_false_partial');
  assert.equal(claims[1].evaluationStatus, 'CORRECT');
  assert.equal(claims[1].errorSpan, undefined);
  // Zero false error/partial annotations!
  assert.equal(annotations.length, 0);
});

