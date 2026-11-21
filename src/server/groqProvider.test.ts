import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractJsonStringFromModelOutput,
  isGroqChatModelId,
  isGroqModelId,
  normalizeGroqModelId,
  pickBestAvailableGroqModel,
  stripGroqPrefix,
} from './groqProvider.js';
import {
  buildCloudflareChatEndpoint,
  isCloudflareModelId,
  stripCloudflarePrefix,
} from './cloudflareProvider.js';
import {
  decryptSecretPayload,
  encryptSecretPayload,
  maskCloudflareIdentifier,
  validateApiKeyInput,
  validateCloudflareAccountId,
  validateCloudflareToken,
} from './singleKeyService.js';
import { MODEL_CATALOG } from './modelDefaults.js';

test('isGroqModelId, isCloudflareModelId, and prefix strippers handle groq:*, cf:*, and gemini-* IDs cleanly', () => {
  assert.equal(isGroqModelId('groq:openai/gpt-oss-120b'), true);
  assert.equal(isGroqModelId('GROQ:openai/gpt-oss-20b'), true);
  assert.equal(isGroqModelId('gemini-4-hydrogen'), false);
  assert.equal(stripGroqPrefix('groq:openai/gpt-oss-120b'), 'openai/gpt-oss-120b');
  assert.equal(stripGroqPrefix('gemini-4-hydrogen'), 'gemini-4-hydrogen');

  assert.equal(isCloudflareModelId('cf:@cf/meta/llama-3.3-70b-instruct-fp8-fast'), true);
  assert.equal(isCloudflareModelId('CF:@cf/meta/llama-3.1-8b-instruct-fast'), true);
  assert.equal(isCloudflareModelId('gemini-4-hydrogen'), false);
  assert.equal(
    stripCloudflarePrefix('cf:@cf/meta/llama-3.3-70b-instruct-fp8-fast'),
    '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
  );
  assert.match(buildCloudflareChatEndpoint('acc_123'), /accounts\/acc_123\/ai\/v1\/chat\/completions/);
});

test('normalizeGroqModelId upgrades retired/legacy Groq IDs and preserves active models', () => {
  assert.equal(normalizeGroqModelId('groq:llama-3.3-70b-versatile'), 'groq:openai/gpt-oss-120b');
  assert.equal(normalizeGroqModelId('groq:llama-3.1-8b-instant'), 'groq:openai/gpt-oss-20b');
  assert.equal(normalizeGroqModelId('groq:openai/gpt-oss-120b'), 'groq:openai/gpt-oss-120b');
  assert.equal(normalizeGroqModelId('gemini-4-hydrogen'), 'gemini-4-hydrogen');
});

test('isGroqChatModelId and pickBestAvailableGroqModel filter non-chat models and select preferred fallback', () => {
  assert.equal(isGroqChatModelId('whisper-large-v3'), false);
  assert.equal(isGroqChatModelId('playai-tts'), false);
  assert.equal(isGroqChatModelId('meta-llama/llama-guard-4-12b'), false);
  assert.equal(isGroqChatModelId('openai/gpt-oss-120b'), true);
  assert.equal(isGroqChatModelId('qwen/qwen3-32b'), true);

  assert.equal(
    pickBestAvailableGroqModel(['qwen/qwen3-32b', 'openai/gpt-oss-20b', 'openai/gpt-oss-120b']),
    'openai/gpt-oss-120b'
  );
  assert.equal(
    pickBestAvailableGroqModel(['qwen/qwen3-32b', 'openai/gpt-oss-20b'], 'openai/gpt-oss-20b'),
    'qwen/qwen3-32b'
  );
});

test('extractJsonStringFromModelOutput strips markdown fences and surrounding prose', () => {
  assert.equal(
    extractJsonStringFromModelOutput('```json\n{"ok":true,"count":3}\n```'),
    '{"ok":true,"count":3}'
  );
  assert.equal(
    extractJsonStringFromModelOutput('Đây là kết quả:\n{"suggestedGrade":"10"}\nXong.'),
    '{"suggestedGrade":"10"}'
  );
  assert.equal(extractJsonStringFromModelOutput(''), '{}');
});

test('MODEL_CATALOG contains active free-tier Gemini, Groq, and Cloudflare Workers AI models', () => {
  assert.ok(MODEL_CATALOG.every((m) => m.tier === 'free'));
  const ids = MODEL_CATALOG.map((m) => m.modelId);
  assert.ok(ids.includes('gemini-4-hydrogen'));
  assert.ok(ids.includes('gemini-3.1-flash-lite'));
  assert.ok(ids.includes('groq:openai/gpt-oss-120b'));
  assert.ok(ids.includes('groq:openai/gpt-oss-20b'));
  assert.ok(ids.includes('cf:@cf/meta/llama-3.3-70b-instruct-fp8-fast'));
  assert.ok(ids.includes('cf:@cf/meta/llama-3.1-8b-instruct-fast'));

  // Groq and Cloudflare text models must be marked non-multimodal so OCR always routes to Gemini
  for (const m of MODEL_CATALOG.filter((item) => item.provider !== 'gemini')) {
    assert.equal(m.supportsMultimodal, false);
  }
});

test('provider secret encryption, validation, and Firestore maskedIdentifier constraints hold', () => {
  const samplePayload = JSON.stringify({
    accountId: '0123456789abcdef0123456789abcdef',
    apiToken: 'cf_test_token_1234567890abcdef',
  });
  const enc = encryptSecretPayload(samplePayload);
  assert.ok(enc.ciphertext.length >= 16 && enc.ciphertext.length <= 1024);
  assert.ok(enc.iv.length >= 8 && enc.iv.length <= 64);
  assert.ok(enc.authTag.length >= 16 && enc.authTag.length <= 64);
  assert.equal(decryptSecretPayload(enc), samplePayload);

  const masked = maskCloudflareIdentifier(
    '0123456789abcdef0123456789abcdef',
    'cf_test_token_1234567890abcdef'
  );
  assert.ok(masked.length > 0 && masked.length <= 40);

  assert.equal(validateApiKeyInput('gsk_1234567890abcdefghij').valid, true);
  assert.equal(validateApiKeyInput('short').valid, false);
  assert.equal(validateApiKeyInput('gsk_1234567890 abcdefghij').valid, false);

  assert.equal(validateCloudflareAccountId('0123456789abcdef0123456789abcdef').valid, true);
  assert.equal(validateCloudflareAccountId('../etc/passwd123456').valid, false);
  assert.equal(validateCloudflareAccountId('short').valid, false);

  assert.equal(validateCloudflareToken('cf_token_1234567890').valid, true);
  assert.equal(validateCloudflareToken('bad token with spaces 12345').valid, false);
});

