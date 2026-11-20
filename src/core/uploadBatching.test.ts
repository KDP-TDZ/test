import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildFileNameSuggestionCacheKey,
  DEFAULT_MAX_BATCH_BYTES,
  getEffectiveUploadLimits,
  inferGradeAndSubjectFromFileNames,
  isGenericCameraFileNames,
  splitFilesIntoByteBudgetBatches,
  validateUploadFileSize,
} from './uploadBatching.js';

const MB = 1024 * 1024;

test('getEffectiveUploadLimits caps images at 5MB and documents at 4MB while respecting smaller admin cap', () => {
  const standard = getEffectiveUploadLimits(20);
  assert.equal(standard.maxImageMb, 5);
  assert.equal(standard.maxDocumentMb, 4);

  const strictAdmin = getEffectiveUploadLimits(3);
  assert.equal(strictAdmin.maxImageMb, 3);
  assert.equal(strictAdmin.maxDocumentMb, 3);
});

test('validateUploadFileSize accepts 4.9MB image and rejects 5.1MB image', () => {
  const okImg = validateUploadFileSize({ name: 'page1.jpg', type: 'image/jpeg', size: 4.9 * MB }, 20);
  assert.equal(okImg.ok, true);

  const bigImg = validateUploadFileSize({ name: 'page2.png', type: 'image/png', size: 5.1 * MB }, 20);
  assert.equal(bigImg.ok, false);
  if (!bigImg.ok) {
    assert.equal(bigImg.isDocumentLimit, false);
    assert.match(bigImg.error, /5MB/);
  }
});

test('validateUploadFileSize accepts 3.9MB PDF/DOCX and rejects 4.2MB PDF/DOCX with helpful guidance', () => {
  const okPdf = validateUploadFileSize({ name: 'notes.pdf', type: 'application/pdf', size: 3.9 * MB }, 20);
  assert.equal(okPdf.ok, true);

  const bigPdf = validateUploadFileSize({ name: 'book.pdf', type: 'application/pdf', size: 4.2 * MB }, 20);
  assert.equal(bigPdf.ok, false);
  if (!bigPdf.ok) {
    assert.equal(bigPdf.isDocumentLimit, true);
    assert.match(bigPdf.error, /4MB/);
    assert.match(bigPdf.error, /5MB/);
  }

  const bigDocx = validateUploadFileSize({ name: 'essay.docx', type: '', size: 4.1 * MB }, 20);
  assert.equal(bigDocx.ok, false);
});

test('splitFilesIntoByteBudgetBatches keeps page order and enforces both byte budget and max files per batch', () => {
  const files = [
    { id: 1, size: 900 * 1024 },
    { id: 2, size: 900 * 1024 },
    { id: 3, size: 900 * 1024 }, // 2.7MB > 2.6MB -> starts batch 2
    { id: 4, size: 500 * 1024 },
    { id: 5, size: 500 * 1024 },
    { id: 6, size: 500 * 1024 },
    { id: 7, size: 500 * 1024 }, // 4 files in batch 2 -> starts batch 3
  ];

  const batches = splitFilesIntoByteBudgetBatches(files, {
    maxBatchBytes: DEFAULT_MAX_BATCH_BYTES,
    maxFilesPerBatch: 4,
  });

  assert.equal(batches.length, 3);
  assert.deepEqual(
    batches.map((b) => b.map((f) => f.id)),
    [[1, 2], [3, 4, 5, 6], [7]]
  );
  for (const batch of batches) {
    const sum = batch.reduce((acc, f) => acc + f.size, 0);
    assert.ok(sum <= DEFAULT_MAX_BATCH_BYTES);
    assert.ok(batch.length <= 4);
  }
});

test('splitFilesIntoByteBudgetBatches isolates an oversized single file without dropping it', () => {
  const files = [
    { id: 'a', size: 400 * 1024 },
    { id: 'huge', size: 3.1 * MB },
    { id: 'b', size: 400 * 1024 },
  ];
  const batches = splitFilesIntoByteBudgetBatches(files, {
    maxBatchBytes: DEFAULT_MAX_BATCH_BYTES,
    maxFilesPerBatch: 4,
  });
  assert.deepEqual(
    batches.map((b) => b.map((f) => f.id)),
    [['a'], ['huge'], ['b']]
  );
});

test('inferGradeAndSubjectFromFileNames detects grade and subject from accented and unaccented Vietnamese filenames', () => {
  const physics = inferGradeAndSubjectFromFileNames(['De_cuong_Vat_ly_12_Dao_dong_co.pdf']);
  assert.equal(physics.grade, '12');
  assert.equal(physics.subject, 'vat_ly');
  assert.equal(physics.confidence, 'high');

  const chem = inferGradeAndSubjectFromFileNames(['hoa-11-este-lipit.docx']);
  assert.equal(chem.grade, '11');
  assert.equal(chem.subject, 'hoa_hoc');
  assert.equal(chem.confidence, 'high');

  const math = inferGradeAndSubjectFromFileNames(['Toan10_Ham_so_bac_hai.jpg']);
  assert.equal(math.grade, '10');
  assert.equal(math.subject, 'toan');

  const unknown = inferGradeAndSubjectFromFileNames(['IMG_20250318_001.jpg']);
  assert.equal(unknown.grade, null);
  assert.equal(unknown.subject, null);
  assert.equal(unknown.confidence, 'low');
});

test('isGenericCameraFileNames and buildFileNameSuggestionCacheKey optimize API calls by filtering camera numbers and normalizing keys', () => {
  assert.equal(isGenericCameraFileNames(['IMG_20250318_001.jpg', 'DSC_0042.png']), true);
  assert.equal(isGenericCameraFileNames(['Screenshot 2026-11-20 142000.png']), true);
  assert.equal(isGenericCameraFileNames(['chuong_1_dao_dong_dieu_hoa.pdf']), false);

  const key1 = buildFileNameSuggestionCacheKey(['Đề-cương_Vật_Lý_12.pdf'], '12');
  const key2 = buildFileNameSuggestionCacheKey(['de cuong vat ly 12.docx'], '12');
  assert.equal(key1, key2);
});


