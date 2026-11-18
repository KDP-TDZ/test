import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

/**
 * Static and structural verification of firestore.rules invariants & Dirty Dozen coverage.
 */
test('firestore.rules enforces Eight Pillars and Dirty Dozen defenses', () => {
  const rulesPath = fs.existsSync('firestore.rules') ? 'firestore.rules' : 'DRAFT_firestore.rules';
  const rules = fs.readFileSync(rulesPath, 'utf8');

  assert.match(rules, /rules_version\s*=\s*'2';/);
  assert.match(rules, /match\s+\/\{document=\*\*\}\s*\{\s*allow\s+read,\s*write:\s*if\s+false;/);
  assert.match(rules, /function\s+isValidId\(id\)/);
  assert.match(rules, /email_verified\s*==\s*true/);
  assert.match(rules, /affectedKeys\(\)\.hasOnly/);
  assert.match(rules, /incoming\(\)\.ownerUid\s*==\s*existing\(\)\.ownerUid/);
  assert.match(rules, /resource\.data\.ownerUid\s*==\s*request\.auth\.uid/);
  assert.match(rules, /match\s+\/adminSecrets\/\{secretId\}/);
  assert.match(rules, /match\s+\/systemConfig\/\{configId\}/);
  assert.match(rules, /match\s+\/practiceItems\/\{itemId\}/);
  assert.match(rules, /match\s+\/auditLogs\/\{logId\}[\s\S]*allow\s+update,\s*delete:\s*if\s+false;/);
});
