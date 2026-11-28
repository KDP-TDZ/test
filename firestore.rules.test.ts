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
  assert.match(rules, /match\s+\/adminSecrets\/\{secretId\}[\s\S]*allow\s+get:\s*if\s+isValidId\(secretId\)\s*&&\s*isSuperAdmin\(\);/);
  assert.match(rules, /!?\('isSuperAdmin'\s+in\s+incoming\(\)\)\s*\|\|\s*incoming\(\)\.isSuperAdmin\s*==\s*false/);
  assert.match(rules, /function\s+isValidUsageDaily\(data,\s*uid\)/);
  assert.match(rules, /incoming\(\)\.totalScore\s*<=\s*existing\(\)\.totalScore\s*\+\s*100/);
  assert.match(rules, /match\s+\/systemConfig\/\{configId\}/);
  assert.match(rules, /match\s+\/practiceItems\/\{itemId\}/);
  assert.match(rules, /match\s+\/examBlueprints\/\{blueprintId\}/);
  assert.match(rules, /match\s+\/exams\/\{examId\}/);
  assert.match(rules, /match\s+\/examAttempts\/\{attemptId\}[\s\S]*allow\s+update,\s*delete:\s*if\s+false;/);
  assert.match(rules, /match\s+\/leaderboard\/\{uid\}/);
  assert.match(rules, /match\s+\/flashcards\/\{flashcardId\}/);
  assert.match(rules, /match\s+\/feedback\/\{feedbackId\}/);
  assert.match(rules, /match\s+\/aiJobs\/\{jobId\}/);
  assert.match(rules, /match\s+\/auditLogs\/\{logId\}[\s\S]*allow\s+update,\s*delete:\s*if\s+false;/);
  assert.match(rules, /function\s+isValidExperienceRating\(data,\s*ratingId\)/);
  assert.match(rules, /match\s+\/experienceRatings\/\{ratingId\}/);
  assert.match(rules, /resource\.data\.visibility\s*==\s*'public'/);
  assert.match(rules, /data\.stars\s+is\s+int\s*&&\s*data\.stars\s*>=\s*1\s*&&\s*data\.stars\s*<=\s*5/);
  assert.match(rules, /data\.comment\s+is\s+string\s*&&\s*data\.comment\.trim\(\)\.size\(\)\s*>=\s*5\s*&&\s*data\.comment\.size\(\)\s*<=\s*400/);
  assert.match(rules, /'experienceRatingEnabled'/);
  assert.match(rules, /data\.experienceRatingEnabled\s+is\s+bool/);
});
