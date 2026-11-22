import assert from 'node:assert/strict';
import test from 'node:test';
import { repairUtf8Mojibake } from './textEncoding';

test('repairUtf8Mojibake restores Latin-1 mangled Vietnamese filenames from Multer', () => {
  const mangled = Buffer.from('SC-09_sinh_học_10.pdf', 'utf8').toString('latin1');
  assert.equal(mangled, 'SC-09_sinh_há»\u008dc_10.pdf');
  assert.equal(repairUtf8Mojibake(mangled), 'SC-09_sinh_học_10.pdf');

  const complexMangled = Buffer.from(
    'Đề kiểm tra Tiếng Việt — Chương trình mới.docx',
    'utf8'
  ).toString('latin1');
  assert.equal(
    repairUtf8Mojibake(complexMangled),
    'Đề kiểm tra Tiếng Việt — Chương trình mới.docx'
  );
});

test('repairUtf8Mojibake preserves already-valid Vietnamese Unicode strings without corruption', () => {
  const validSamples = [
    'SC-09_sinh_học_10',
    'Câu thử nghiệm về số phức',
    'Lỗi trong phép biến đổi tương đương',
    'Bài kiểm tra Hóa học & Vật lý lớp 12 — Toán học',
    'bài toán đại số hàm số mũ và logarit',
  ];
  for (const sample of validSamples) {
    assert.equal(repairUtf8Mojibake(sample), sample);
  }
});
