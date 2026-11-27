import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildColdStartReadinessReport,
  detectProviderFromModelId,
  getColdStartEnvTemplate,
} from './singleKeyService.js';
import { executeRoutedAiTask } from './modelRouter.js';
import { DEFAULT_TASK_MODELS } from './modelDefaults.js';
import type { SystemAiConfig } from '../core/types.js';

function makeTestConfig(activeModel: string, fallbackModel: string): SystemAiConfig {
  const taskModels = { ...DEFAULT_TASK_MODELS };
  for (const key of Object.keys(taskModels) as Array<keyof typeof taskModels>) {
    taskModels[key] = {
      ...taskModels[key],
      defaultModel: activeModel,
      fallbackModel,
      enableFallback: true,
    };
  }
  return {
    enabled: true,
    disabledReason: '',
    maintenanceMessage: '',
    updatedAt: new Date().toISOString(),
    updatedBy: 'admin@example.com',
    rateLimitConfig: {
      requestsPerMinute: 15,
      requestsPerHour: 120,
      analysesPerDay: 35,
      cooldownSeconds: 2,
      maximumConcurrentJobs: 3,
      maximumPagesPerAnalysis: 25,
      maximumFileSizeMb: 20,
    },
    activeModel,
    configVersion: 1,
    allowedOrigins: [],
    taskModels,
  };
}

test('detectProviderFromModelId identifies mistral, groq, and cloudflare models accurately', () => {
  assert.equal(detectProviderFromModelId('mistral:mistral-small-latest'), 'mistral');
  assert.equal(detectProviderFromModelId('groq:openai/gpt-oss-120b'), 'groq');
  assert.equal(detectProviderFromModelId('cf:@cf/meta/llama-3.3-70b-instruct-fp8-fast'), 'cloudflare');
});

test('buildColdStartReadinessReport flags at_risk when only Admin UI keys exist without server env vars', () => {
  const report = buildColdStartReadinessReport({
    activeModel: 'mistral:mistral-small-latest',
    runtimePlatform: 'vercel',
    encryptionSecretConfigured: false,
    mistralEnvConfigured: false,
    mistralAdminOverrideActive: true,
    groqEnvConfigured: false,
    groqAdminOverrideActive: false,
    cloudflareEnvConfigured: false,
    cloudflareAdminOverrideActive: false,
  });

  assert.equal(report.overallStatus, 'at_risk');
  assert.equal(report.anyProviderCoveredByEnv, false);
  assert.equal(report.activeModelCoveredByEnv, false);
  assert.equal(report.providers.mistral.survivesColdStartWhenAdminOffline, false);
  assert.ok(report.warnings.length >= 2);
});

test('buildColdStartReadinessReport flags partial_risk when fallback provider has env but primary or encryption secret is missing', () => {
  const reportMissingPrimary = buildColdStartReadinessReport({
    activeModel: 'groq:openai/gpt-oss-120b',
    runtimePlatform: 'render',
    encryptionSecretConfigured: true,
    mistralEnvConfigured: true,
    mistralAdminOverrideActive: false,
    groqEnvConfigured: false,
    groqAdminOverrideActive: true,
    cloudflareEnvConfigured: false,
    cloudflareAdminOverrideActive: false,
  });

  assert.equal(reportMissingPrimary.overallStatus, 'partial_risk');
  assert.equal(reportMissingPrimary.anyProviderCoveredByEnv, true);
  assert.equal(reportMissingPrimary.activeModelCoveredByEnv, false);
  assert.equal(reportMissingPrimary.providers.mistral.survivesColdStartWhenAdminOffline, true);

  const reportMissingEnc = buildColdStartReadinessReport({
    activeModel: 'mistral:mistral-small-latest',
    runtimePlatform: 'vercel',
    encryptionSecretConfigured: false,
    mistralEnvConfigured: true,
    mistralAdminOverrideActive: false,
    groqEnvConfigured: true,
    groqAdminOverrideActive: false,
    cloudflareEnvConfigured: false,
    cloudflareAdminOverrideActive: false,
  });

  assert.equal(reportMissingEnc.overallStatus, 'partial_risk');
  assert.equal(reportMissingEnc.activeModelCoveredByEnv, true);
  assert.equal(reportMissingEnc.encryptionSecretConfigured, false);
});

test('buildColdStartReadinessReport returns ready_24_7 when active provider env and KEY_ENCRYPTION_SECRET are configured', () => {
  const report = buildColdStartReadinessReport({
    activeModel: 'mistral:mistral-small-latest',
    runtimePlatform: 'vercel',
    encryptionSecretConfigured: true,
    mistralEnvConfigured: true,
    mistralAdminOverrideActive: false,
    groqEnvConfigured: true,
    groqAdminOverrideActive: false,
    cloudflareEnvConfigured: false,
    cloudflareAdminOverrideActive: false,
  });

  assert.equal(report.overallStatus, 'ready_24_7');
  assert.equal(report.activeModelCoveredByEnv, true);
  assert.equal(report.encryptionSecretConfigured, true);
  assert.equal(report.warnings.length, 0);
});

test('getColdStartEnvTemplate lists required 3-provider env var names without leaking any values or Gemini keys', () => {
  const tpl = getColdStartEnvTemplate();
  assert.match(tpl, /^MISTRAL_API_KEY=$/m);
  assert.match(tpl, /^GROQ_API_KEY=$/m);
  assert.match(tpl, /^CLOUDFLARE_ACCOUNT_ID=$/m);
  assert.match(tpl, /^CLOUDFLARE_API_TOKEN=$/m);
  assert.match(tpl, /^KEY_ENCRYPTION_SECRET=$/m);
  assert.match(tpl, /^ALLOWED_ORIGIN=$/m);
  assert.equal(/GEMINI_API_KEY/i.test(tpl), false);
});

test('executeRoutedAiTask rescues immediately via env-configured Mistral provider after cold start when Groq key is absent', async () => {
  const prevGroq = process.env.GROQ_API_KEY;
  const prevMistral = process.env.MISTRAL_API_KEY;
  const prevCfAcc = process.env.CLOUDFLARE_ACCOUNT_ID;
  const prevCfTok = process.env.CLOUDFLARE_API_TOKEN;

  try {
    delete process.env.GROQ_API_KEY;
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_API_TOKEN;
    process.env.MISTRAL_API_KEY = 'mistral_test_env_cold_start_key_123456';

    const attemptedModels: string[] = [];
    const cfg = makeTestConfig('groq:openai/gpt-oss-120b', 'groq:qwen/qwen3.8-27b');

    const result = await executeRoutedAiTask({
      taskType: 'knowledge_analysis',
      config: cfg,
      bypassCache: true,
      runWithModel: async (modelId) => {
        attemptedModels.push(modelId);
        return { ok: true, modelId };
      },
    });

    assert.equal(result.modelId.startsWith('mistral:'), true);
    assert.equal(attemptedModels.length, 1);
    assert.equal(attemptedModels[0].startsWith('mistral:'), true);
    assert.equal(attemptedModels.some((m) => m.startsWith('groq:')), false);
  } finally {
    if (prevGroq === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = prevGroq;
    if (prevMistral === undefined) delete process.env.MISTRAL_API_KEY;
    else process.env.MISTRAL_API_KEY = prevMistral;
    if (prevCfAcc === undefined) delete process.env.CLOUDFLARE_ACCOUNT_ID;
    else process.env.CLOUDFLARE_ACCOUNT_ID = prevCfAcc;
    if (prevCfTok === undefined) delete process.env.CLOUDFLARE_API_TOKEN;
    else process.env.CLOUDFLARE_API_TOKEN = prevCfTok;
  }
});
