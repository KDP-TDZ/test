import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeInlineHighlightSegments,
  findFlexibleSubstringRange,
  getConciseFixText,
  groupRawTextIntoSemanticBlocks,
  isNonGradableLeadInClaim,
  splitFormulaBlockDisplay,
} from './semanticBlocks.js';
import { isGenericCameraFileNames } from './uploadBatching.js';

const PHYSICS_10_SAMPLE = [
  'Chuyển động thẳng đều là chuyển động có quỹ đạo là đường thẳng và có tốc độ thay đổi theo thời gian.',
  'Trong chuyển động thẳng đều, quãng đường đi được tỉ lệ nghịch với thời gian chuyển động.',
  'Công thức tính quãng đường:',
  's = v + t',
  'Trong đó:',
  '• s là quãng đường vật đi được (m).',
  '• v là tốc độ của vật (m/s).',
  'Phương trình chuyển động thẳng đều:',
  'x = x_0 + v.t',
  'Trong đó x_0 là tọa độ ban đầu, x là tọa độ của vật tại thời điểm t.',
].join('\n');

test('groupRawTextIntoSemanticBlocks merges lead-in labels with formulas and groups "Trong đó:" with its bullets', () => {
  const blocks = groupRawTextIntoSemanticBlocks(PHYSICS_10_SAMPLE, 1, 0.95);

  // Expected 6 coherent semantic blocks instead of 10 fragmented lines:
  // 1. Definition sentence
  // 2. Proportionality sentence
  // 3. "Công thức tính quãng đường:\ns = v + t" (formula cluster)
  // 4. "Trong đó:\n• s...\n• v..." (annotation cluster, separate from formula)
  // 5. "Phương trình chuyển động thẳng đều:\nx = x_0 + v.t" (formula cluster)
  // 6. "Trong đó x_0 là tọa độ ban đầu, x là tọa độ của vật tại thời điểm t."
  assert.equal(blocks.length, 6);

  assert.equal(blocks[0].textType, 'paragraph');
  assert.equal(blocks[1].textType, 'paragraph');

  assert.equal(blocks[2].textType, 'formula');
  assert.equal(blocks[2].extractedText, 'Công thức tính quãng đường:\ns = v + t');
  assert.equal(blocks[2].formulaText, 's = v + t');

  assert.equal(blocks[3].textType, 'list');
  assert.equal(
    blocks[3].extractedText,
    'Trong đó:\n• s là quãng đường vật đi được (m).\n• v là tốc độ của vật (m/s).'
  );

  assert.equal(blocks[4].textType, 'formula');
  assert.equal(blocks[4].extractedText, 'Phương trình chuyển động thẳng đều:\nx = x_0 + v.t');
  assert.equal(blocks[4].formulaText, 'x = x_0 + v.t');

  assert.equal(blocks[5].textType, 'paragraph');
  assert.equal(
    blocks[5].extractedText,
    'Trong đó x_0 là tọa độ ban đầu, x là tọa độ của vật tại thời điểm t.'
  );
});

test('splitFormulaBlockDisplay separates lead-in label from formula body without duplicating formula text', () => {
  const merged = splitFormulaBlockDisplay({
    extractedText: 'Công thức tính quãng đường:\ns = v + t',
    textType: 'formula',
    formulaText: 's = v + t',
  });
  assert.equal(merged.leadInLabel, 'Công thức tính quãng đường:');
  assert.equal(merged.formulaBody, 's = v + t');

  const standalone = splitFormulaBlockDisplay({
    extractedText: 's = v + t',
    textType: 'formula',
    formulaText: 's = v + t',
  });
  assert.equal(standalone.leadInLabel, null);
  assert.equal(standalone.formulaBody, 's = v + t');
});

test('isNonGradableLeadInClaim blocks bare lead-in headers from inflating accuracy scores while allowing merged claims', () => {
  assert.equal(isNonGradableLeadInClaim('Công thức tính quãng đường:'), true);
  assert.equal(isNonGradableLeadInClaim('Phương trình chuyển động thẳng đều:'), true);
  assert.equal(isNonGradableLeadInClaim('Trong đó:'), true);
  assert.equal(isNonGradableLeadInClaim('Định nghĩa:'), true);

  assert.equal(isNonGradableLeadInClaim('Công thức tính quãng đường:\ns = v + t'), false);
  assert.equal(isNonGradableLeadInClaim('s = v + t'), false);
  assert.equal(
    isNonGradableLeadInClaim(
      'Chuyển động thẳng đều là chuyển động có quỹ đạo là đường thẳng và có tốc độ thay đổi theo thời gian.'
    ),
    false
  );
});

test('computeInlineHighlightSegments surgically underlines exact errorSpans including short formulas and multiple errors in one paragraph', () => {
  // Multi-sentence paragraph with 2 distinct errors
  const paragraph =
    'Chuyển động thẳng đều có tốc độ thay đổi theo thời gian. Quãng đường đi được tỉ lệ nghịch với thời gian chuyển động.';
  const res = computeInlineHighlightSegments(paragraph, 'p1_b1', [
    {
      claimId: 'c1',
      blockId: 'p1_b1',
      errorSpan: 'tốc độ thay đổi theo thời gian',
      textExcerpt: 'Chuyển động thẳng đều có tốc độ thay đổi theo thời gian.',
      annotationColor: 'red',
      orderNumber: 1,
    },
    {
      claimId: 'c2',
      blockId: 'p1_b1',
      errorSpan: 'tỉ lệ nghịch',
      textExcerpt: 'Quãng đường đi được tỉ lệ nghịch với thời gian chuyển động.',
      annotationColor: 'red',
      orderNumber: 2,
    },
  ]);

  assert.deepEqual(res.matchedClaimIds.sort(), ['c1', 'c2']);
  const highlighted = res.segments.filter((s) => Boolean(s.claimId));
  assert.equal(highlighted.length, 2);
  assert.equal(highlighted[0].text, 'tốc độ thay đổi theo thời gian');
  assert.equal(highlighted[0].orderNumber, 1);
  assert.equal(highlighted[1].text, 'tỉ lệ nghịch');
  assert.equal(highlighted[1].orderNumber, 2);

  // Short formula without spaces ("s=v+t", length 5) must still match "s = v + t" even without blockId
  const formulaRes = computeInlineHighlightSegments('s = v + t', 'p1_b3', [
    {
      claimId: 'c3',
      textExcerpt: 's=v+t',
      annotationColor: 'red',
      orderNumber: 3,
    },
  ]);
  assert.equal(formulaRes.matchedClaimIds.length, 1);
  assert.equal(formulaRes.segments[0].text, 's = v + t');
  assert.equal(formulaRes.segments[0].annotationColor, 'red');
});

test('findFlexibleSubstringRange matches formulas regardless of spacing differences', () => {
  const range = findFlexibleSubstringRange('Công thức: s = v + t (sai)', 's=v+t');
  assert.ok(range);
  assert.equal('Công thức: s = v + t (sai)'.slice(range.start, range.end), 's = v + t');
});

test('getConciseFixText prefers shortFix and keeps collapsed right-column notes brief', () => {
  assert.equal(
    getConciseFixText({
      shortFix: 'Thay "tốc độ thay đổi" thành "tốc độ không đổi".',
      suggestedFix: 'Một đoạn giải thích dài hơn rất nhiều...',
      correctKnowledge: 'Kiến thức đầy đủ...',
      explanation: 'Giải thích dài...',
    }),
    'Thay "tốc độ thay đổi" thành "tốc độ không đổi".'
  );
});

test('isGenericCameraFileNames filters UUID and hex filenames from redundant AI filename inference', () => {
  assert.equal(isGenericCameraFileNames(['5611a480-cad6-4806-9620-b13bee039a7a.jpg']), true);
  assert.equal(isGenericCameraFileNames(['5611a480-cad6-4806-9620-b13bee039a7a_4fd6e1b3.jpg']), true);
  assert.equal(isGenericCameraFileNames(['vat_ly_10_chuyen_dong_thang_deu.jpg']), false);
});
