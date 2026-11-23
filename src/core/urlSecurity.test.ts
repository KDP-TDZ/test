import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isAllowedCorsOrigin,
  isPrivateOrLoopbackHost,
  isValidFirestoreDocId,
  sanitizeExternalHttpUrl,
  validateReferenceUrl,
} from './urlSecurity';

test('sanitizeExternalHttpUrl permits valid http/https links and blocks script/data schemes', () => {
  assert.equal(sanitizeExternalHttpUrl('https://moet.gov.vn/doc?id=1'), 'https://moet.gov.vn/doc?id=1');
  assert.equal(sanitizeExternalHttpUrl('http://example.edu.vn/guide'), 'http://example.edu.vn/guide');
  assert.equal(sanitizeExternalHttpUrl('javascript:alert(1)'), null);
  assert.equal(sanitizeExternalHttpUrl('  JaVaScRiPt:alert(document.cookie)  '), null);
  assert.equal(sanitizeExternalHttpUrl('data:text/html,<script>alert(1)</script>'), null);
  assert.equal(sanitizeExternalHttpUrl('vbscript:msgbox(1)'), null);
  assert.equal(sanitizeExternalHttpUrl('https://user:pass@example.com/secret'), null);
  assert.equal(sanitizeExternalHttpUrl(''), null);
  assert.equal(sanitizeExternalHttpUrl(undefined), null);
});

test('isPrivateOrLoopbackHost and validateReferenceUrl block IPv4-mapped IPv6 and cloud metadata endpoints', () => {
  assert.equal(isPrivateOrLoopbackHost('::ffff:127.0.0.1'), true);
  assert.equal(isPrivateOrLoopbackHost('::ffff:7f00:1'), true);
  assert.equal(isPrivateOrLoopbackHost('::ffff:a9fe:a9fe'), true);
  assert.equal(isPrivateOrLoopbackHost('::ffff:10.0.0.5'), true);
  assert.equal(isPrivateOrLoopbackHost('::ffff:c0a8:0101'), true);
  assert.equal(isPrivateOrLoopbackHost('::'), true);
  assert.equal(isPrivateOrLoopbackHost('fe80::1'), true);
  assert.equal(isPrivateOrLoopbackHost('febf::1'), true);

  assert.equal(validateReferenceUrl('https://[::ffff:127.0.0.1]/admin').valid, false);
  assert.equal(validateReferenceUrl('https://[::ffff:169.254.169.254]/latest/meta-data/').valid, false);
  assert.equal(validateReferenceUrl('https://[::ffff:10.0.0.1]/internal').valid, false);
  assert.equal(validateReferenceUrl('https://metadata.google.internal/computeMetadata/v1/').valid, false);
  assert.equal(validateReferenceUrl('https://hanhtrangso.nxbgd.vn/sach-dien-tu').valid, true);
});

test('isAllowedCorsOrigin allows same-origin and explicit allowlist entries but blocks untrusted origins and wildcards', () => {
  // Same-origin match works even when allowlist is empty
  assert.equal(isAllowedCorsOrigin('http://localhost:3000', 'localhost:3000', []), true);
  assert.equal(isAllowedCorsOrigin('https://studycheck.vercel.app', 'studycheck.vercel.app', []), true);

  // Untrusted origin is rejected when allowlist is empty or contains wildcard '*'
  assert.equal(isAllowedCorsOrigin('https://evil.example.com', 'localhost:3000', []), false);
  assert.equal(isAllowedCorsOrigin('https://evil.example.com', 'localhost:3000', ['*']), false);

  // Explicit allowlist entry is permitted (normalizing trailing slashes)
  assert.equal(
    isAllowedCorsOrigin('https://app.studycheck.vn', 'api.studycheck.vn', ['https://app.studycheck.vn/']),
    true
  );
  assert.equal(
    isAllowedCorsOrigin('https://app.studycheck.vn.evil.com', 'api.studycheck.vn', ['https://app.studycheck.vn']),
    false
  );
});

test('isValidFirestoreDocId rejects path traversal and malformed identifiers', () => {
  assert.equal(isValidFirestoreDocId('user_abc-123'), true);
  assert.equal(isValidFirestoreDocId('../systemConfig/aiService'), false);
  assert.equal(isValidFirestoreDocId('uid/../../adminSecrets/primary'), false);
  assert.equal(isValidFirestoreDocId(''), false);
  assert.equal(isValidFirestoreDocId('a'.repeat(129)), false);
});
