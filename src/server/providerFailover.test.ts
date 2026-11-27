import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyProviderFailure,
  clearAiResponseCache,
  clearProviderCooldown,
  DEFAULT_TASK_MODELS,
  executeRoutedAiTask,
  getProviderHealthSnapshot,
  isProviderCoolingDown,
  type RoutedAttemptTrace,
} from './modelRouter.js';
import type { SystemAiConfig } from '../core/types.js';

function createBaseConfig(): SystemAiConfig {
  return {
    enabled: true,
    disabledReason: '',
    maintenanceMessage: '',
    allowedOrigins: [],
    activeModel: 'mistral-small-latest',
    adaptiveLongTextThresholdChars: 1500,
    configVersion: 1,
    rateLimitConfig: {
      requestsPerMinute: 20,
      requestsPerHour: 120,
      analysesPerDay: 50,
      cooldownSeconds: 5,
      maximumConcurrentJobs: 3,
      maximumPagesPerAnalysis: 25,
      maximumFileSizeMb: 20,
    },
    taskModels: DEFAULT_TASK_MODELS,
    updatedAt: new Date().toISOString(),
    updatedBy: 'test',
  };
}

test('classifyProviderFailure detects Mistral HTTP 402 subscription errors for billing cooldown', () => {
  const c1 = classifyProviderFailure(
    new Error('Mistral 402 MISTRAL_BILLING_REQUIRED (mistral-small-latest): You need a subscription to access this API.')
  );
  assert.equal(c1.code, 'MISTRAL_BILLING_REQUIRED');
  assert.equal(c1.shouldCooldown, true);
  assert.equal(c1.cooldownStatus, 'billing_blocked');

  const c2 = classifyProviderFailure(
    new Error('Mistral HTTP 402 (mistral-small-latest): You need a subscription to access this API.')
  );
  assert.equal(c2.code, 'MISTRAL_BILLING_REQUIRED');
  assert.equal(c2.shouldCooldown, true);

  const c3 = classifyProviderFailure(new Error('Mistral 429 RESOURCE_EXHAUSTED (mistral-small-latest): rate limit'));
  assert.equal(c3.code, 'PROVIDER_QUOTA_EXCEEDED');
  assert.equal(c3.shouldCooldown, false);
});

test('Mistral 402 auto-fails over to Groq, cools down Mistral, and bypasses Mistral on subsequent requests until reset', async () => {
  const prevMistral = process.env.MISTRAL_API_KEY;
  const prevGroq = process.env.GROQ_API_KEY;
  const prevCfAcc = process.env.CLOUDFLARE_ACCOUNT_ID;
  const prevCfTok = process.env.CLOUDFLARE_API_TOKEN;

  process.env.MISTRAL_API_KEY = 'mistral_test_key_for_unit_test_123456';
  process.env.GROQ_API_KEY = 'gsk_test_key_for_unit_test_1234567890';
  delete process.env.CLOUDFLARE_ACCOUNT_ID;
  delete process.env.CLOUDFLARE_API_TOKEN;

  clearProviderCooldown();
  clearAiResponseCache();

  try {
    const cfg = createBaseConfig();
    const calledModelsRun1: string[] = [];

    const firstResult = await executeRoutedAiTask({
      taskType: 'knowledge_analysis',
      config: cfg,
      bypassCache: true,
      runWithModel: async (modelId) => {
        calledModelsRun1.push(modelId);
        if (!modelId.startsWith('groq:')) {
          throw new Error(
            'Mistral 402 MISTRAL_BILLING_REQUIRED (mistral-small-latest): You need a subscription to access this API.'
          );
        }
        return { ok: true, used: modelId };
      },
    });

    assert.equal(firstResult.usedFallback, true);
    assert.ok(firstResult.actualModel.startsWith('groq:'));
    assert.equal(calledModelsRun1.length, 2);
    assert.equal(isProviderCoolingDown('mistral'), true);
    const snapshot = getProviderHealthSnapshot();
    assert.equal(snapshot.mistral.status, 'billing_blocked');
    assert.equal(snapshot.groq.status, 'healthy');

    // Second request must route directly to Groq without calling Mistral again
    const calledModelsRun2: string[] = [];
    const secondResult = await executeRoutedAiTask({
      taskType: 'knowledge_analysis',
      config: cfg,
      bypassCache: true,
      runWithModel: async (modelId) => {
        calledModelsRun2.push(modelId);
        return { ok: true, used: modelId };
      },
    });

    assert.equal(calledModelsRun2.length, 1);
    assert.ok(calledModelsRun2[0].startsWith('groq:'));
    assert.ok(secondResult.actualModel.startsWith('groq:'));

    // After Admin resets provider health, Mistral is eligible again
    clearProviderCooldown('mistral');
    assert.equal(isProviderCoolingDown('mistral'), false);
    const calledModelsRun3: string[] = [];
    await executeRoutedAiTask({
      taskType: 'knowledge_analysis',
      config: cfg,
      bypassCache: true,
      runWithModel: async (modelId) => {
        calledModelsRun3.push(modelId);
        return { ok: true, used: modelId };
      },
    });
    assert.equal(calledModelsRun3[0], 'mistral:mistral-small-latest');
  } finally {
    clearProviderCooldown();
    clearAiResponseCache();
    if (prevMistral === undefined) delete process.env.MISTRAL_API_KEY;
    else process.env.MISTRAL_API_KEY = prevMistral;
    if (prevGroq === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = prevGroq;
    if (prevCfAcc === undefined) delete process.env.CLOUDFLARE_ACCOUNT_ID;
    else process.env.CLOUDFLARE_ACCOUNT_ID = prevCfAcc;
    if (prevCfTok === undefined) delete process.env.CLOUDFLARE_API_TOKEN;
    else process.env.CLOUDFLARE_API_TOKEN = prevCfTok;
  }
});

test('executeRoutedAiTask attaches multi-hop attemptTrace when all configured providers fail', async () => {
  const prevMistral = process.env.MISTRAL_API_KEY;
  const prevGroq = process.env.GROQ_API_KEY;
  const prevCfAcc = process.env.CLOUDFLARE_ACCOUNT_ID;
  const prevCfTok = process.env.CLOUDFLARE_API_TOKEN;

  process.env.MISTRAL_API_KEY = 'mistral_test_key_for_unit_test_123456';
  process.env.GROQ_API_KEY = 'gsk_test_key_for_unit_test_1234567890';
  delete process.env.CLOUDFLARE_ACCOUNT_ID;
  delete process.env.CLOUDFLARE_API_TOKEN;

  clearProviderCooldown();
  clearAiResponseCache();

  try {
    const cfg = createBaseConfig();
    let caught: (Error & { attemptTrace?: RoutedAttemptTrace[] }) | null = null;
    try {
      await executeRoutedAiTask({
        taskType: 'knowledge_analysis',
        config: cfg,
        bypassCache: true,
        runWithModel: async (modelId) => {
          if (modelId.startsWith('groq:')) {
            throw new Error('Groq 401 API_KEY_INVALID (openai/gpt-oss-120b): Invalid API Key');
          }
          throw new Error(
            'Mistral 402 MISTRAL_BILLING_REQUIRED (mistral-small-latest): You need a subscription to access this API.'
          );
        },
      });
    } catch (err) {
      caught = err as Error & { attemptTrace?: RoutedAttemptTrace[] };
    }

    assert.ok(caught);
    assert.ok(Array.isArray(caught.attemptTrace));
    assert.equal(caught.attemptTrace.length, 2);
    assert.equal(caught.attemptTrace[0].provider, 'mistral');
    assert.equal(caught.attemptTrace[0].errorCode, 'MISTRAL_BILLING_REQUIRED');
    assert.equal(caught.attemptTrace[1].provider, 'groq');
    assert.equal(caught.attemptTrace[1].errorCode, 'PROVIDER_AUTH_ERROR');
  } finally {
    clearProviderCooldown();
    clearAiResponseCache();
    if (prevMistral === undefined) delete process.env.MISTRAL_API_KEY;
    else process.env.MISTRAL_API_KEY = prevMistral;
    if (prevGroq === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = prevGroq;
    if (prevCfAcc === undefined) delete process.env.CLOUDFLARE_ACCOUNT_ID;
    else process.env.CLOUDFLARE_ACCOUNT_ID = prevCfAcc;
    if (prevCfTok === undefined) delete process.env.CLOUDFLARE_API_TOKEN;
    else process.env.CLOUDFLARE_API_TOKEN = prevCfTok;
  }
});
