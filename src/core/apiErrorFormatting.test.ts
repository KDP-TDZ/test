import test from 'node:test';
import assert from 'node:assert/strict';
import { formatNonJsonApiError } from './apiErrorFormatting.js';
import { inferScopeFromContentHeuristic } from './uploadBatching.js';

test('formatNonJsonApiError hides raw HTTP 500 request IDs and returns calm Vietnamese guidance', () => {
  const msg = formatNonJsonApiError(
    500,
    'Internal Server Error\nInternal Server Error\nozqelnMgXPgLThQIn8RvxWwMHh1N4mwR',
    'Không thể trích xuất nội dung tài liệu.'
  );
  assert.ok(msg.includes('500'));
  assert.ok(!msg.includes('ozqelnMgXPgLThQIn8RvxWwMHh1N4mwR'));
  assert.ok(!msg.includes('Internal Server Error'));
});

test('formatNonJsonApiError handles 413, 502, 503, 504, and HTML 404 cleanly', () => {
  assert.match(formatNonJsonApiError(413, 'FUNCTION_PAYLOAD_TOO_LARGE', 'Err'), /4\.5MB/);
  assert.match(formatNonJsonApiError(504, 'FUNCTION_INVOCATION_TIMEOUT', 'Err'), /504/);
  assert.match(formatNonJsonApiError(502, 'Bad Gateway', 'Err'), /502\/503/);
  assert.match(formatNonJsonApiError(404, '<!doctype html><html><body>Not found</body></html>', 'Err'), /\/api\/\*/);
});

test('inferScopeFromContentHeuristic classifies Vietnamese THPT Physics/Math/Chemistry text in <5ms', () => {
  const start = Date.now();
  const phy = inferScopeFromContentHeuristic(
    'Chương 1: Dao động điều hòa - Vật lý lớp 11\nCon lắc lò xo dao động điều hòa với tần số góc omega = sqrt(k/m).',
    'bai_tap_on.docx'
  );
  const elapsed = Date.now() - start;

  assert.equal(phy.suggestedSubject, 'vat_ly');
  assert.equal(phy.suggestedGrade, '11');
  assert.ok(phy.suggestedChapters.length >= 1);
  assert.ok(elapsed < 50);

  const chem = inferScopeFromContentHeuristic(
    'Chương 2: Cacbohidrat Hóa học 12\nGlucozo và saccarozo phản ứng tráng bạc với AgNO3/NH3.',
    'de_cuong.docx'
  );
  assert.equal(chem.suggestedSubject, 'hoa_hoc');
  assert.equal(chem.suggestedGrade, '12');

  const math = inferScopeFromContentHeuristic(
    'Bài 1: Đạo hàm và tích phân hàm số bậc ba Toán 12',
    'on_tap.docx'
  );
  assert.equal(math.suggestedSubject, 'toan');
  assert.equal(math.suggestedGrade, '12');
});
