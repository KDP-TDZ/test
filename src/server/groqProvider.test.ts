import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractJsonStringFromModelOutput,
  isGroqModelId,
  stripGroqPrefix,
} from './groqProvider.js';
import {
  buildCloudflareChatEndpoint,
  isCloudflareModelId,
  stripCloudflarePrefix,
} from './cloudflareProvider.js';
import { MODEL_CATALOG } from './modelDefaults.js';

test('isGroqModelId, isCloudflareModelId, and prefix strippers handle groq:*, cf:*, and gemini-* IDs cleanly', () => {
  assert.equal(isGroqModelId('groq:llama-3.3-70b-versatile'), true);
  assert.equal(isGroqModelId('GROQ:llama-3.1-8b-instant'), true);
  assert.equal(isGroqModelId('gemini-4-hydrogen'), false);
  assert.equal(stripGroqPrefix('groq:llama-3.3-70b-versatile'), 'llama-3.3-70b-versatile');
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

test('MODEL_CATALOG contains verified free-tier Gemini, Groq, and Cloudflare Workers AI models', () => {
  assert.ok(MODEL_CATALOG.every((m) => m.tier === 'free'));
  const ids = MODEL_CATALOG.map((m) => m.modelId);
  assert.ok(ids.includes('gemini-4-hydrogen'));
  assert.ok(ids.includes('gemini-3.1-flash-lite'));
  assert.ok(ids.includes('groq:llama-3.3-70b-versatile'));
  assert.ok(ids.includes('groq:llama-3.1-8b-instant'));
  assert.ok(ids.includes('cf:@cf/meta/llama-3.3-70b-instruct-fp8-fast'));
  assert.ok(ids.includes('cf:@cf/meta/llama-3.1-8b-instruct-fast'));

  // Groq and Cloudflare text models must be marked non-multimodal so OCR always routes to Gemini
  for (const m of MODEL_CATALOG.filter((item) => item.provider !== 'gemini')) {
    assert.equal(m.supportsMultimodal, false);
  }
});

