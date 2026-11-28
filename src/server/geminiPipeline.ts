import crypto from 'node:crypto';
import {
  CF_VISION_MODEL as ADAPTIVE_CF_VISION_MODEL,
  GROQ_GRADE_FALLBACK_MODEL,
  GROQ_SCAN_VISION_MODEL,
  MISTRAL_GRADE_MODEL,
  MISTRAL_VISION_MODEL,
  computeAdaptiveApiPlan,
  computeNormalizedTextLength,
  createAdaptiveAuditMetadata,
  detectProviderIdFromModel,
  selectCrossProviderVerifierModel,
  type AdaptiveSlotNumber,
  type AdaptiveStageCode,
} from '../core/adaptiveApiPlan.js';
import {
  calculateAccuracyScore,
  calculateCompletenessScore,
} from '../core/scoring.js';
import {
  distributeExamQuestionScores,
  normalizeCognitiveLevel,
  normalizeQuizQuestionOrigin,
  resolveQuizScopeStrategy,
  runQuizGenerationWithTopUp,
  salvageQuestionsFromTruncatedJson,
  validateExamBlueprint,
} from '../core/quizValidation.js';
import {
  retrieveRelevantChunks,
  sanitizeReferenceChunkForFirestore,
} from '../core/retrieval.js';
import {
  buildFixedRubricFromChunks,
  formatFixedRubricForPrompt,
  reconcileCoverageAgainstFixedRubric,
} from '../core/rubric.js';
import {
  groupRawTextIntoSemanticBlocks,
  isNonGradableLeadInClaim,
} from '../core/semanticBlocks.js';
import {
  anchorClaimsAndBuildAnnotations,
  hasMeaningfulReadableContent,
  validateAndApplyVerifierAdjustments,
  type VerifierAdjustment,
} from '../core/verificationPostProcess.js';
import { inferScopeFromContentHeuristic } from '../core/uploadBatching.js';
import type {
  AiProviderId,
  AiTaskType,
  AnalysisStrength,
  AnalysisWeakness,
  AnnotationItem,
  ClaimStatus,
  CognitiveLevel,
  CoverageStatus,
  ExamBlueprint,
  ExamBlueprintRow,
  ExamDocument,
  ExamQuestion,
  ExamQuestionType,
  ExamType,
  ExtractedClaim,
  ExtractedPage,
  ExtractedTextBlock,
  FlashcardItem,
  GradeLevel,
  GradingAuditMetadata,
  ImprovementSuggestion,
  KnowledgeCoverageItem,
  KnowledgeUnitType,
  QuizDifficulty,
  QuizQuestion,
  QuizQuestionOrigin,
  QuizScope,
  ReferenceChunk,
  ReferenceEvidence,
  RubricMode,
  SubjectId,
  SystemAiConfig,
} from '../core/types.js';
import { EXAM_TYPE_LABELS, SUBJECT_LABELS } from '../core/types.js';
import {
  consumeOneTimeModelOverride,
  getAuthoritativeAiConfigSnapshot,
} from './aiGuardService.js';
import {
  callWithTimeout,
  classifyProviderFailure,
  executeRoutedAiTask,
  isProviderCoolingDown,
  markProviderUnhealthy,
  type RoutedAiTaskResult,
} from './modelRouter.js';
import {
  callMistralChatCompletion,
  isMistralConfigured,
  isMistralModelId,
  MISTRAL_PRIMARY_MODEL,
} from './mistralProvider.js';
import {
  callGroqChatCompletion,
  isGroqConfigured,
  isGroqModelId,
} from './groqProvider.js';
import {
  callCloudflareChatCompletion,
  isCloudflareConfigured,
  isCloudflareModelId,
} from './cloudflareProvider.js';
import { resolveScopedApiKeyForStage } from './singleKeyService.js';

export interface TokenTelemetry {
  promptTokens: number;
  candidateTokens: number;
  totalTokens: number;
}

function accumulateRawTokens(
  acc: TokenTelemetry,
  usage: { promptTokens: number; candidateTokens: number; totalTokens: number }
): void {
  acc.promptTokens += usage.promptTokens || 0;
  acc.candidateTokens += usage.candidateTokens || 0;
  acc.totalTokens += usage.totalTokens || 0;
}

function repairJsonLikeText(rawText: string): string {
  const trimmed = (rawText || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  if (!trimmed) return '{}';
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  let candidate = fenced && fenced[1] ? fenced[1].trim() : trimmed;
  const fb = candidate.indexOf('{');
  const lb = candidate.lastIndexOf('}');
  if (fb >= 0 && lb > fb) {
    candidate = candidate.slice(fb, lb + 1);
  }
  return candidate;
}

function normalizeJsonEscapeAndControlChars(jsonCandidate: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  const isHex = (ch: string) => /^[0-9a-fA-F]$/.test(ch);

  for (let i = 0; i < jsonCandidate.length; i += 1) {
    const ch = jsonCandidate[i];
    if (inString) {
      if (escaped) {
        out += ch;
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        const next = jsonCandidate[i + 1] || '';
        const isStandardEscape =
          next === '"' ||
          next === '\\' ||
          next === '/' ||
          next === 'b' ||
          next === 'f' ||
          next === 'n' ||
          next === 'r' ||
          next === 't' ||
          (next === 'u' &&
            i + 5 < jsonCandidate.length &&
            isHex(jsonCandidate[i + 2]) &&
            isHex(jsonCandidate[i + 3]) &&
            isHex(jsonCandidate[i + 4]) &&
            isHex(jsonCandidate[i + 5]));
        if (isStandardEscape) {
          out += ch;
          escaped = true;
        } else {
          // Escape invalid backslashes commonly emitted in LaTeX formulas (\sqrt, \alpha, \Delta, \cdot, ...)
          out += '\\\\';
        }
        continue;
      }
      if (ch === '"') {
        inString = false;
        out += ch;
        continue;
      }
      if (ch === '\n') {
        out += '\\n';
        continue;
      }
      if (ch === '\r') {
        out += '\\r';
        continue;
      }
      if (ch === '\t') {
        out += '\\t';
        continue;
      }
      const code = ch.charCodeAt(0);
      if (code < 0x20) {
        out += ' ';
        continue;
      }
      out += ch;
    } else {
      if (ch === '"') {
        inString = true;
      }
      out += ch;
    }
  }

  return out.replace(/,\s*([}\]])/g, '$1');
}

export const DETERMINISTIC_GRADING_SEED = 20261123;
export const GRADING_PROMPT_VERSION = 'v4.4_strict_audit_anchored';
export const MAX_STUDENT_GRADING_CHARS = 48_000;
export const MAX_TEXTBOOK_GRADING_CHARS = 24_000;

export interface RawKnowledgeEvalResult {
  claims?: Array<{
    blockId?: string;
    blockIds?: string[];
    sourcePage: number;
    sourceText: string;
    errorSpan?: string;
    contextBefore?: string;
    contextAfter?: string;
    startOffset?: number;
    endOffset?: number;
    shortFix?: string;
    chapter: string;
    concept: string;
    importanceWeight: number;
    knowledgeType?: string;
    evaluationStatus: string;
    explanation: string;
    correctKnowledge: string;
    suggestedFix?: string;
    matchedChunkId?: string;
    matchedExcerpt?: string;
    matchedPage?: number;
  }>;
  coverageItems?: Array<{
    criterionId?: string;
    concept: string;
    chapter: string;
    importanceWeight?: number;
    status: string;
    suggestedAddition?: string;
    referenceExcerpt?: string;
    referencePage?: number;
    matchedChunkId?: string;
  }>;
  strengths?: AnalysisStrength[];
  weaknesses?: Array<{ title: string; detail: string; pageNumber?: number }>;
  suggestions?: Array<{ priority: number; title: string; description: string }>;
}

/**
 * Strictly parses and validates KnowledgeAnalysis JSON output.
 * Never silently falls back to empty `{ claims: [], coverageItems: [] }` when the model output
 * is empty, truncated, or malformed — throws a retryable `GRADING_JSON_INVALID` error instead.
 */
export function parseAndValidateKnowledgeEvalJson(rawText: string): RawKnowledgeEvalResult {
  const trimmed = (rawText || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  if (!trimmed || trimmed === '{}') {
    throw new Error(
      'GRADING_JSON_INVALID: Mô hình AI trả về phản hồi rỗng khi kiểm định kiến thức. Vui lòng thử chấm lại.'
    );
  }

  const candidate = repairJsonLikeText(trimmed);
  let parsed: unknown = null;
  let lastParseErr: unknown = null;

  for (const attempt of [candidate, normalizeJsonEscapeAndControlChars(candidate)]) {
    try {
      parsed = JSON.parse(attempt);
      lastParseErr = null;
      break;
    } catch (err) {
      lastParseErr = err;
    }
  }

  if (lastParseErr || !parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const detail = lastParseErr instanceof Error ? lastParseErr.message : 'Cấu trúc JSON không hợp lệ';
    throw new Error(
      `GRADING_JSON_INVALID: Phản hồi chấm điểm từ AI bị cắt cụt hoặc sai định dạng JSON (${detail.slice(0, 120)}). Hệ thống không trả kết quả rỗng giả — vui lòng thử lại.`
    );
  }

  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.claims)) {
    throw new Error(
      'GRADING_JSON_INVALID: Phản hồi kiểm định thiếu mảng mệnh đề (claims). Vui lòng thử chấm lại.'
    );
  }

  if (obj.coverageItems !== undefined && !Array.isArray(obj.coverageItems)) {
    throw new Error(
      'GRADING_JSON_INVALID: Trường coverageItems trong phản hồi kiểm định không đúng định dạng mảng.'
    );
  }

  return obj as RawKnowledgeEvalResult;
}

function safeParseModelJson<T>(rawText: string, fallbackJson: string): T {
  const source = (rawText || '').trim() || fallbackJson;
  const candidate = repairJsonLikeText(source);
  try {
    return JSON.parse(candidate) as T;
  } catch {
    const repaired = normalizeJsonEscapeAndControlChars(candidate);
    try {
      return JSON.parse(repaired) as T;
    } catch {
      return JSON.parse(fallbackJson) as T;
    }
  }
}

interface ParsedOcrPayload {
  rawText?: string;
  ocrConfidence?: number;
  suggestedGrade?: string;
  suggestedSubject?: string;
  suggestedChapters?: string[];
  suggestedTitle?: string;
  blocks?: Array<{
    extractedText: string;
    textType: string;
    confidence: number;
    formulaText?: string;
  }>;
}

function parseOcrResponsePayload(rawText: string): ParsedOcrPayload {
  const trimmed = (rawText || '').trim();
  if (!trimmed) {
    return { rawText: '', ocrConfidence: 0.85 };
  }

  const candidate = repairJsonLikeText(trimmed);
  for (const attemptText of [candidate, normalizeJsonEscapeAndControlChars(candidate)]) {
    try {
      const obj = JSON.parse(attemptText) as ParsedOcrPayload;
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        return obj;
      }
    } catch {
      // Try next repair or plain-text fallback
    }
  }

  // Try extracting `"rawText": "..."` if JSON was truncated mid-object (e.g. hit maxOutputTokens)
  const rawFieldMatch = trimmed.match(/"rawText"\s*:\s*"((?:[^"\\]|\\.)*)/);
  if (rawFieldMatch && rawFieldMatch[1]) {
    const recoveredText = rawFieldMatch[1]
      .replace(/\\n/g, '\n')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
      .trim();
    if (recoveredText.length > 0) {
      return { rawText: recoveredText, ocrConfidence: 0.8 };
    }
  }

  // Plain-text fallback when a multimodal vision model returns direct OCR text instead of JSON
  const cleanedPlain = trimmed
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^```[a-zA-Z]*\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  if (!cleanedPlain || cleanedPlain === '{}') {
    throw new Error('Mô hình AI trả về dữ liệu OCR rỗng.');
  }
  return { rawText: cleanedPlain, ocrConfidence: 0.85 };
}

interface ProviderJsonResult<T> {
  data: T;
  resolvedModel: string;
  systemFingerprint?: string;
}

async function generateJsonWithProviderDetailed<T>(params: {
  modelId: string;
  prompt: string;
  thinkingTier: 'minimal' | 'low' | 'medium';
  maxOutputTokens: number;
  timeoutMs?: number;
  groqSchemaHint: string;
  fallbackJson: string;
  strictJsonParser?: (rawText: string) => T;
  temperature?: number;
  seed?: number;
  strictModelLock?: boolean;
  stage?: AdaptiveStageCode;
  slot?: AdaptiveSlotNumber;
  tokensOut: TokenTelemetry;
}): Promise<ProviderJsonResult<T>> {
  const parseOutput = (rawText: string): T =>
    params.strictJsonParser
      ? params.strictJsonParser(rawText)
      : safeParseModelJson<T>(rawText, params.fallbackJson);

  if (isGroqModelId(params.modelId)) {
    const apiKeyOverride =
      params.stage && params.slot
        ? resolveScopedApiKeyForStage('groq', params.stage, params.slot) || undefined
        : undefined;
    const resp = await callWithTimeout(
      (signal) =>
        callGroqChatCompletion({
          modelId: params.modelId,
          prompt: params.prompt,
          jsonMode: true,
          jsonSchemaHint: params.groqSchemaHint,
          maxOutputTokens: params.maxOutputTokens,
          temperature: params.temperature ?? 0,
          seed: params.seed,
          strictModelLock: params.strictModelLock,
          apiKeyOverride,
          signal,
        }),
      params.timeoutMs
    );
    accumulateRawTokens(params.tokensOut, resp);
    return {
      data: parseOutput(resp.text),
      resolvedModel: resp.resolvedModel || params.modelId,
      ...(resp.systemFingerprint ? { systemFingerprint: resp.systemFingerprint } : {}),
    };
  }

  if (isCloudflareModelId(params.modelId)) {
    const resp = await callWithTimeout(
      (signal) =>
        callCloudflareChatCompletion({
          modelId: params.modelId,
          prompt: params.prompt,
          jsonMode: true,
          jsonSchemaHint: params.groqSchemaHint,
          maxOutputTokens: params.maxOutputTokens,
          temperature: params.temperature ?? 0,
          seed: params.seed,
          strictModelLock: params.strictModelLock,
          signal,
        }),
      params.timeoutMs
    );
    accumulateRawTokens(params.tokensOut, resp);
    return {
      data: parseOutput(resp.text),
      resolvedModel: resp.resolvedModel || params.modelId,
      ...(resp.systemFingerprint ? { systemFingerprint: resp.systemFingerprint } : {}),
    };
  }

  const mistralModel = isMistralModelId(params.modelId) ? params.modelId : MISTRAL_PRIMARY_MODEL;
  const apiKeyOverride =
    params.stage && params.slot
      ? resolveScopedApiKeyForStage('mistral', params.stage, params.slot) || undefined
      : undefined;
  const resp = await callWithTimeout(
    (signal) =>
      callMistralChatCompletion({
        modelId: mistralModel,
        prompt: params.prompt,
        jsonMode: true,
        jsonSchemaHint: params.groqSchemaHint,
        maxOutputTokens: params.maxOutputTokens,
        temperature: params.temperature ?? 0,
        seed: params.seed,
        strictModelLock: params.strictModelLock,
        apiKeyOverride,
        signal,
      }),
    params.timeoutMs
  );
  accumulateRawTokens(params.tokensOut, resp);
  return {
    data: parseOutput(resp.text),
    resolvedModel: resp.resolvedModel || mistralModel,
    ...(resp.systemFingerprint ? { systemFingerprint: resp.systemFingerprint } : {}),
  };
}

async function generateJsonWithProvider<T>(params: {
  modelId: string;
  prompt: string;
  thinkingTier: 'minimal' | 'low' | 'medium';
  maxOutputTokens: number;
  timeoutMs?: number;
  groqSchemaHint: string;
  fallbackJson: string;
  strictJsonParser?: (rawText: string) => T;
  temperature?: number;
  seed?: number;
  strictModelLock?: boolean;
  stage?: AdaptiveStageCode;
  slot?: AdaptiveSlotNumber;
  tokensOut: TokenTelemetry;
}): Promise<T> {
  const res = await generateJsonWithProviderDetailed(params);
  return res.data;
}

async function generatePlainTextWithProvider(params: {
  modelId: string;
  prompt: string;
  thinkingTier: 'minimal' | 'low' | 'medium';
  maxOutputTokens: number;
  timeoutMs?: number;
  stage?: AdaptiveStageCode;
  slot?: AdaptiveSlotNumber;
  tokensOut: TokenTelemetry;
}): Promise<string> {
  if (isGroqModelId(params.modelId)) {
    const apiKeyOverride =
      params.stage && params.slot
        ? resolveScopedApiKeyForStage('groq', params.stage, params.slot) || undefined
        : undefined;
    const resp = await callWithTimeout(
      (signal) =>
        callGroqChatCompletion({
          modelId: params.modelId,
          prompt: params.prompt,
          jsonMode: false,
          maxOutputTokens: params.maxOutputTokens,
          apiKeyOverride,
          signal,
        }),
      params.timeoutMs
    );
    accumulateRawTokens(params.tokensOut, resp);
    return resp.text.trim();
  }

  if (isCloudflareModelId(params.modelId)) {
    const resp = await callWithTimeout(
      (signal) =>
        callCloudflareChatCompletion({
          modelId: params.modelId,
          prompt: params.prompt,
          jsonMode: false,
          maxOutputTokens: params.maxOutputTokens,
          signal,
        }),
      params.timeoutMs
    );
    accumulateRawTokens(params.tokensOut, resp);
    return resp.text.trim();
  }

  const mistralModel = isMistralModelId(params.modelId) ? params.modelId : MISTRAL_PRIMARY_MODEL;
  const apiKeyOverride =
    params.stage && params.slot
      ? resolveScopedApiKeyForStage('mistral', params.stage, params.slot) || undefined
      : undefined;
  const resp = await callWithTimeout(
    (signal) =>
      callMistralChatCompletion({
        modelId: mistralModel,
        prompt: params.prompt,
        jsonMode: false,
        maxOutputTokens: params.maxOutputTokens,
        apiKeyOverride,
        signal,
      }),
    params.timeoutMs
  );
  accumulateRawTokens(params.tokensOut, resp);
  return resp.text.trim();
}

async function runTaskWithRouter<T>(params: {
  taskType: AiTaskType;
  config?: SystemAiConfig;
  idToken?: string;
  cacheInput?: Record<string, unknown>;
  bypassCache?: boolean;
  allowGroqRescue?: boolean;
  groqRescueModelId?: string;
  preferredPrimaryModelId?: string;
  preferredFallbackModelId?: string;
  strictModelLock?: boolean;
  overallTimeoutMs?: number;
  maxFallbackRetries?: number;
  extractExecutionMeta?: (data: T) => { actualModel?: string; systemFingerprint?: string };
  runWithModel: (modelId: string) => Promise<T>;
}): Promise<RoutedAiTaskResult<T>> {
  const cfg = params.config || getAuthoritativeAiConfigSnapshot();
  return executeRoutedAiTask({
    taskType: params.taskType,
    config: cfg,
    consumeOneTimeOverride: (task) => consumeOneTimeModelOverride(task, params.idToken),
    cacheInput: params.cacheInput,
    bypassCache: params.bypassCache,
    allowGroqRescue: params.allowGroqRescue,
    groqRescueModelId: params.groqRescueModelId,
    preferredPrimaryModelId: params.preferredPrimaryModelId,
    preferredFallbackModelId: params.preferredFallbackModelId,
    strictModelLock: params.strictModelLock,
    overallTimeoutMs: params.overallTimeoutMs,
    maxFallbackRetries: params.maxFallbackRetries,
    extractExecutionMeta: params.extractExecutionMeta,
    runWithModel: params.runWithModel,
  });
}

export interface InlineScopeSuggestion {
  suggestedGrade: GradeLevel;
  suggestedSubject: SubjectId;
  suggestedChapters: string[];
  suggestedTitle: string;
}

const OCR_FAST_TIMEOUT_MS = 22_000;

function buildExtractedBlocksFromRawText(
  rawText: string,
  pageNumber: number,
  confidence: number
): ExtractedTextBlock[] {
  return groupRawTextIntoSemanticBlocks(rawText, pageNumber, confidence);
}

const recentInlineScopeByTextHash = new Map<string, InlineScopeSuggestion>();
let lastExtractedInlineScope: { textPrefix: string; suggestion: InlineScopeSuggestion } | null = null;

export function getInlineScopeSuggestionForText(text: string): InlineScopeSuggestion | null {
  const trimmed = (text || '').trim();
  if (!trimmed) return null;
  const hash = crypto.createHash('sha256').update(trimmed.slice(0, 1200)).digest('hex');
  const direct = recentInlineScopeByTextHash.get(hash);
  if (direct) return direct;
  if (
    lastExtractedInlineScope &&
    trimmed.includes(lastExtractedInlineScope.textPrefix)
  ) {
    return lastExtractedInlineScope.suggestion;
  }
  return null;
}

export class DocumentExtractionService {
  static async extractFromImageBuffers(
    files: Array<{ buffer: Buffer; mimeType: string; originalName: string }>,
    tokensOut: TokenTelemetry,
    opts?: { config?: SystemAiConfig; idToken?: string; pageOffset?: number }
  ): Promise<ExtractedPage[]> {
    const pageOffset = Math.max(0, Number(opts?.pageOffset) || 0);
    const cfg = opts?.config || getAuthoritativeAiConfigSnapshot();

    const jsonHint =
      '{"rawText":"...","ocrConfidence":0.95,"suggestedGrade":"10|11|12","suggestedSubject":"toan|vat_ly|hoa_hoc|sinh_hoc|ngu_van|lich_su|dia_ly|tieng_anh|tin_hoc|gdkt_pl|khac","suggestedChapters":["..."],"suggestedTitle":"..."}';

    const runVisionWithFallback = async (params: {
      base64: string;
      mimeType: string;
      prompt: string;
      order: Array<'groq' | 'cloudflare' | 'mistral'>;
      slot: AdaptiveSlotNumber;
    }): Promise<ParsedOcrPayload> => {
      const runners: Record<
        'groq' | 'cloudflare' | 'mistral',
        { name: string; enabled: boolean; run: () => Promise<ParsedOcrPayload> }
      > = {
        groq: {
          name: 'Groq',
          enabled: isGroqConfigured(),
          run: async () => {
            const apiKeyOverride =
              resolveScopedApiKeyForStage('groq', 'QUET', params.slot) || undefined;
            const resp = await callWithTimeout(
              (signal) =>
                callGroqChatCompletion({
                  modelId: GROQ_SCAN_VISION_MODEL,
                  prompt: params.prompt,
                  images: [{ mimeType: params.mimeType, base64: params.base64 }],
                  jsonMode: true,
                  jsonSchemaHint: jsonHint,
                  maxOutputTokens: 3500,
                  temperature: 0,
                  seed: DETERMINISTIC_GRADING_SEED,
                  apiKeyOverride,
                  signal,
                }),
              OCR_FAST_TIMEOUT_MS
            );
            accumulateRawTokens(tokensOut, resp);
            return parseOcrResponsePayload(resp.text || '');
          },
        },
        cloudflare: {
          name: 'Cloudflare',
          enabled: isCloudflareConfigured(),
          run: async () => {
            const resp = await callWithTimeout(
              (signal) =>
                callCloudflareChatCompletion({
                  modelId: ADAPTIVE_CF_VISION_MODEL,
                  prompt: params.prompt,
                  images: [{ mimeType: params.mimeType, base64: params.base64 }],
                  jsonMode: true,
                  jsonSchemaHint: jsonHint,
                  maxOutputTokens: 3500,
                  temperature: 0,
                  seed: DETERMINISTIC_GRADING_SEED,
                  signal,
                }),
              OCR_FAST_TIMEOUT_MS
            );
            accumulateRawTokens(tokensOut, resp);
            return parseOcrResponsePayload(resp.text || '');
          },
        },
        mistral: {
          name: 'Mistral',
          enabled: isMistralConfigured(),
          run: async () => {
            const apiKeyOverride =
              resolveScopedApiKeyForStage('mistral', 'QUET', params.slot) || undefined;
            const resp = await callWithTimeout(
              (signal) =>
                callMistralChatCompletion({
                  modelId: MISTRAL_VISION_MODEL,
                  prompt: params.prompt,
                  images: [{ mimeType: params.mimeType, base64: params.base64 }],
                  jsonMode: true,
                  jsonSchemaHint: jsonHint,
                  maxOutputTokens: 3500,
                  temperature: 0,
                  seed: DETERMINISTIC_GRADING_SEED,
                  apiKeyOverride,
                  signal,
                }),
              OCR_FAST_TIMEOUT_MS
            );
            accumulateRawTokens(tokensOut, resp);
            return parseOcrResponsePayload(resp.text || '');
          },
        },
      };

      const healthyOrder = params.order.filter(
        (k) => runners[k].enabled && !isProviderCoolingDown(k)
      );
      const effectiveOrder =
        healthyOrder.length > 0
          ? healthyOrder
          : params.order.filter((k) => runners[k].enabled);

      let firstVisionError: unknown = null;
      const errorSummary: string[] = [];
      for (const providerKey of effectiveOrder) {
        const provider = runners[providerKey];
        try {
          return await provider.run();
        } catch (err) {
          if (!firstVisionError) firstVisionError = err;
          const msg = err instanceof Error ? err.message : String(err);
          const classified = classifyProviderFailure(err);
          if (classified.shouldCooldown) {
            markProviderUnhealthy(providerKey, classified.code, msg, {
              status: classified.cooldownStatus,
              ttlMs: classified.cooldownMs,
            });
          }
          errorSummary.push(`${provider.name}: ${msg.slice(0, 320)}`);
        }
      }

      if (errorSummary.length > 1) {
        throw new Error(errorSummary.join(' | '));
      }
      if (firstVisionError) {
        throw firstVisionError;
      }
      // Emit standard unconfigured-key error code from the top preferred provider
      return await runners[params.order[0]].run();
    };

    // Fixed 1-API Scan (QUET Slot 1): Groq Vision -> Cloudflare Vision -> Mistral Vision
    const pass1Results = await Promise.all(
      files.map(async (file, idx) => {
        const pageNum = pageOffset + idx + 1;
        const contentHash = crypto.createHash('sha256').update(file.buffer).digest('hex');
        const base64 = file.buffer.toString('base64');

        const { data: parsed } = await runTaskWithRouter<ParsedOcrPayload>({
          taskType: 'curriculum_extraction',
          config: cfg,
          idToken: opts?.idToken,
          preferredPrimaryModelId: GROQ_SCAN_VISION_MODEL,
          preferredFallbackModelId: ADAPTIVE_CF_VISION_MODEL,
          allowGroqRescue: true,
          groqRescueModelId: GROQ_SCAN_VISION_MODEL,
          cacheInput: { ocrKind: 'image_fast_v5_verbatim_1api', mimeType: file.mimeType, sha256: contentHash },
          runWithModel: async (modelId) => {
            const ocrPrompt = [
              'SAO CHÉP NGUYÊN VĂN 100% toàn bộ văn bản, công thức, ký hiệu, dấu câu và chữ viết tay trong trang ảnh này từ trên xuống dưới.',
              '- CẤM TUYỆT ĐỐI bỏ sót bất kỳ dòng, đoạn, ký hiệu hay công thức nào.',
              '- CẤM TUYỆT ĐỐI tự ý sửa lỗi chính tả, sửa lỗi kiến thức, sửa công thức sai hay viết lại câu của học sinh — học sinh viết sai thế nào PHẢI chép y hệt như vậy, giữ nguyên xuống dòng (\\n).',
              '- NẾU ảnh bị mờ, tối, lóa, bị che khuất hoặc không thể nhìn rõ chữ: KHÔNG ĐƯỢC tự đoán hay bịa nội dung; đặt "ocrConfidence" <= 0.35, để "rawText": "" (nếu toàn trang không đọc được) hoặc ghi đúng nhãn "[KHÔNG NHÌN RÕ]" tại vị trí không đọc được.',
              '- Nhận diện luôn lớp ("10"|"11"|"12"), môn học THPT, tên chương và tiêu đề bài ghi.',
            ].join('\n');

            const order: Array<'groq' | 'cloudflare' | 'mistral'> = isCloudflareModelId(modelId)
              ? ['cloudflare', 'groq', 'mistral']
              : isMistralModelId(modelId)
                ? ['mistral', 'groq', 'cloudflare']
                : ['groq', 'cloudflare', 'mistral'];

            return runVisionWithFallback({
              base64,
              mimeType: file.mimeType,
              prompt: ocrPrompt,
              order,
              slot: 1,
            });
          },
        });

        let rawText = (parsed.rawText || '').trim();
        let avgConf = Math.max(0.1, Math.min(1, Number(parsed.ocrConfidence) || 0.9));

        if (!rawText && Array.isArray(parsed.blocks) && parsed.blocks.length > 0) {
          rawText = parsed.blocks
            .map((b) => (b.extractedText || '').trim())
            .filter(Boolean)
            .join('\n');
        }

        const readableWithoutMarker = rawText.replace(/\[KHÔNG NHÌN RÕ\]/gi, '').trim();
        if (!readableWithoutMarker) {
          avgConf = Math.min(avgConf, 0.25);
        }

        return {
          file,
          base64,
          contentHash,
          pageNum,
          parsed,
          rawText,
          avgConf,
        };
      })
    );

    const pages: ExtractedPage[] = pass1Results.map((item) => {
      const blocks = buildExtractedBlocksFromRawText(item.rawText, item.pageNum, item.avgConf);
      const finalConf = blocks.length > 0 ? item.avgConf : 0;

      if (item.rawText && item.parsed.suggestedSubject) {
        const grade: GradeLevel =
          item.parsed.suggestedGrade === '11' || item.parsed.suggestedGrade === '12'
            ? item.parsed.suggestedGrade
            : '10';
        const subject: SubjectId =
          item.parsed.suggestedSubject in SUBJECT_LABELS
            ? (item.parsed.suggestedSubject as SubjectId)
            : 'khac';
        const textHash = crypto.createHash('sha256').update(item.rawText.slice(0, 1200)).digest('hex');
        const suggestionObj: InlineScopeSuggestion = {
          suggestedGrade: grade,
          suggestedSubject: subject,
          suggestedChapters: Array.isArray(item.parsed.suggestedChapters)
            ? item.parsed.suggestedChapters.slice(0, 4)
            : [],
          suggestedTitle:
            (item.parsed.suggestedTitle || '').trim() ||
            item.file.originalName.replace(/\.[^.]+$/, '') ||
            'Tài liệu ôn tập',
        };
        recentInlineScopeByTextHash.set(textHash, suggestionObj);
        lastExtractedInlineScope = {
          textPrefix: item.rawText.slice(0, 160),
          suggestion: suggestionObj,
        };
        if (recentInlineScopeByTextHash.size > 100) {
          const oldestKey = recentInlineScopeByTextHash.keys().next().value;
          if (oldestKey) recentInlineScopeByTextHash.delete(oldestKey);
        }
      }

      return {
        pageNumber: item.pageNum,
        rawText: item.rawText,
        blocks,
        ocrAverageConfidence: finalConf,
      } satisfies ExtractedPage;
    });

    return pages.sort((a, b) => a.pageNumber - b.pageNumber);
  }

  static async extractFromPdfBuffer(
    buffer: Buffer,
    _tokensOut: TokenTelemetry,
    _opts?: { config?: SystemAiConfig; idToken?: string }
  ): Promise<ExtractedPage[]> {
    let parseErrorDetail = '';
    try {
      const { extractPdfPagesFromBuffer } = await import('./referenceIngestService.js');
      const textPages = await extractPdfPagesFromBuffer(buffer);
      const totalChars = textPages.reduce((sum, p) => sum + p.text.trim().length, 0);
      if (totalChars >= 12) {
        return textPages.map((p) => {
          const blocks = buildExtractedBlocksFromRawText(p.text, p.pageNumber, 0.98);
          return {
            pageNumber: p.pageNumber,
            rawText: p.text,
            blocks,
            ocrAverageConfidence: 0.98,
          };
        });
      }
    } catch (pdfErr) {
      parseErrorDetail = pdfErr instanceof Error ? pdfErr.message : String(pdfErr);
      console.warn('Server-side PDF text extraction error:', parseErrorDetail);
    }

    if (parseErrorDetail) {
      throw new Error(
        `Không thể đọc cấu trúc tệp PDF trên máy chủ (${parseErrorDetail.slice(0, 120)}). Vui lòng thử lại hoặc tải tệp lên trên trình duyệt để hệ thống tự động trích xuất.`
      );
    }

    throw new Error(
      'Tệp PDF này là bản scan ảnh (không có lớp văn bản nhúng). Vui lòng chụp hoặc xuất từng trang sang ảnh JPG/PNG/WEBP (hoặc dùng tệp PDF/DOCX có chữ chọn được) để hệ thống OCR đa mô hình (Groq / Cloudflare / Mistral Vision) quét chính xác hơn.'
    );
  }

  static async extractFromDocxBuffer(buffer: Buffer): Promise<ExtractedPage[]> {
    let raw = '';
    try {
      const mammothMod = await import('mammoth');
      const mammothApi = mammothMod.default || mammothMod;
      const result = await mammothApi.extractRawText({ buffer });
      raw = (result.value || '').trim();
    } catch (docxErr) {
      const detail = docxErr instanceof Error ? docxErr.message : String(docxErr);
      throw new Error(
        `Không thể đọc cấu trúc tệp Word (.docx). Vui lòng lưu lại dưới định dạng .docx chuẩn hoặc xuất sang PDF/ảnh rồi tải lên lại. (${detail.slice(0, 90)})`
      );
    }
    if (!raw) {
      throw new Error('File DOCX không có văn bản đọc được (có thể chỉ chứa ảnh chụp bên trong). Hãy lưu thành PDF/ảnh và tải lên lại.');
    }
    const paragraphs = raw
      .split(/\n+/)
      .map((l) => l.trim())
      .filter(Boolean);

    const pageSize = 18;
    const pages: ExtractedPage[] = [];
    for (let i = 0; i < paragraphs.length; i += pageSize) {
      const pageNum = Math.floor(i / pageSize) + 1;
      const slice = paragraphs.slice(i, i + pageSize);
      const rawSlice = slice.join('\n');
      const blocks = buildExtractedBlocksFromRawText(rawSlice, pageNum, 0.99);
      pages.push({
        pageNumber: pageNum,
        rawText: rawSlice,
        blocks,
        ocrAverageConfidence: 0.99,
      });
    }
    return pages;
  }
}

export class SubjectDetectionService {
  static async detectScope(
    sampleText: string,
    tokensOut: TokenTelemetry,
    opts?: { config?: SystemAiConfig; idToken?: string }
  ): Promise<{
    suggestedGrade: GradeLevel;
    suggestedSubject: SubjectId;
    suggestedChapters: string[];
    suggestedTitle: string;
  }> {
    const inlineCached = getInlineScopeSuggestionForText(sampleText);
    if (inlineCached) {
      return inlineCached;
    }

    const scopePrompt = [
      'Phân tích đoạn ghi chép học tập sau để xác định ĐÚNG lớp (10, 11 hoặc 12), môn học THPT, tiêu đề ngắn và tối đa 3 chương/chủ đề phù hợp.',
      'LƯU Ý QUAN TRỌNG: Xác định chủ đề dựa trên KHÁI NIỆM/ĐỐI TƯỢNG CHÍNH mà tài liệu đang trình bày hoặc định nghĩa (ví dụ: nếu đoạn văn viết "Chuyển động thẳng đều là..." nhưng học sinh viết nhầm chi tiết bên trong thành "tốc độ thay đổi", chủ đề VẪN LÀ "Chuyển động thẳng đều", TUYỆT ĐỐI KHÔNG bị lỗi sai của học sinh đánh lừa sang chương khác như "Chuyển động biến đổi").',
      '',
      sampleText.slice(0, 1800),
    ].join('\n');

    const heuristicFallback = inferScopeFromContentHeuristic(sampleText);

    try {
      const { data: parsed } = await callWithTimeout(
        () =>
          runTaskWithRouter<{
            suggestedGrade?: string;
            suggestedSubject?: string;
            suggestedChapters?: string[];
            suggestedTitle?: string;
          }>({
            taskType: 'subject_classification',
            config: opts?.config,
            idToken: opts?.idToken,
            allowGroqRescue: false,
            overallTimeoutMs: 4_000,
            maxFallbackRetries: 0,
            cacheInput: { sample: sampleText.slice(0, 1500), rev: 'v4_3provider_topic_strict' },
            runWithModel: async (modelId) =>
              generateJsonWithProvider({
                modelId,
                prompt: scopePrompt,
                thinkingTier: 'minimal',
                maxOutputTokens: 280,
                timeoutMs: 3_500,
                tokensOut,
                fallbackJson: '{}',
                groqSchemaHint:
                  '{"suggestedGrade":"10|11|12","suggestedSubject":"toan|vat_ly|hoa_hoc|sinh_hoc|ngu_van|lich_su|dia_ly|tieng_anh|tin_hoc|gdkt_pl|khac","suggestedChapters":["..."],"suggestedTitle":"..."}',
              }),
          }),
        4_500
      );

      const grade: GradeLevel =
        parsed.suggestedGrade === '11' || parsed.suggestedGrade === '12'
          ? parsed.suggestedGrade
          : parsed.suggestedGrade === '10'
            ? '10'
            : heuristicFallback.suggestedGrade;
      const subject: SubjectId =
        parsed.suggestedSubject && parsed.suggestedSubject in SUBJECT_LABELS
          ? (parsed.suggestedSubject as SubjectId)
          : heuristicFallback.suggestedSubject;

      return {
        suggestedGrade: grade,
        suggestedSubject: subject,
        suggestedChapters:
          Array.isArray(parsed.suggestedChapters) && parsed.suggestedChapters.length > 0
            ? parsed.suggestedChapters.slice(0, 5)
            : heuristicFallback.suggestedChapters,
        suggestedTitle: parsed.suggestedTitle?.trim() || heuristicFallback.suggestedTitle,
      };
    } catch {
      return heuristicFallback;
    }
  }
}

export class KnowledgeAnalysisService {
  static async runFullVerification(params: {
    pages: ExtractedPage[];
    grade: GradeLevel;
    subject: SubjectId;
    textbookReferenceId: string;
    textbookTitle: string;
    selectedChapters: string[];
    scope: string;
    referenceChunks: ReferenceChunk[];
    enableWebGrounding: boolean;
    strictModelLock?: boolean;
    ocrConfirmed?: boolean;
    ocrTextHash?: string;
    tokensOut: TokenTelemetry;
    config?: SystemAiConfig;
    idToken?: string;
  }): Promise<{
    claims: ExtractedClaim[];
    coverageItems: KnowledgeCoverageItem[];
    annotations: AnnotationItem[];
    strengths: AnalysisStrength[];
    weaknesses: AnalysisWeakness[];
    suggestions: ImprovementSuggestion[];
    webSources: ReferenceEvidence[];
    usedWebGrounding: boolean;
    webGroundingNotice?: string;
    modelUsed: string;
    accuracyScore: number | null;
    completenessScore: number | null;
    evidenceCoverage: number | null;
    confidenceLevel: ReturnType<typeof calculateAccuracyScore>['confidenceLevel'];
    confidenceReason: string;
    accuracyBreakdown: ReturnType<typeof calculateAccuracyScore>;
    completenessBreakdown: ReturnType<typeof calculateCompletenessScore>;
    gradingAudit: GradingAuditMetadata;
  }> {
    const {
      pages,
      grade,
      subject,
      textbookReferenceId,
      textbookTitle,
      selectedChapters,
      scope,
      referenceChunks,
      enableWebGrounding,
      strictModelLock = false,
      ocrConfirmed = false,
      ocrTextHash: providedOcrTextHash,
      tokensOut,
      config,
      idToken,
    } = params;

    const effectiveConfig = config || getAuthoritativeAiConfigSnapshot();
    const subjectName = SUBJECT_LABELS[subject];

    const formattedStudentBlocks = pages
      .map((p) => {
        const blocksStr = p.blocks
          .map(
            (b) =>
              `[blockId=${b.blockId} | page=${p.pageNumber} | ocrConf=${ocrConfirmed ? Math.max(b.confidence, 0.95) : b.confidence}] ${b.extractedText}`
          )
          .join('\n');
        return `--- TRANG ${p.pageNumber} ---\n${blocksStr}`;
      })
      .join('\n\n');

    const fullText = pages.map((p) => p.rawText).join('\n').normalize('NFC');
    const normalizedTextLength = computeNormalizedTextLength(pages);
    const adaptivePlan = computeAdaptiveApiPlan(
      normalizedTextLength,
      effectiveConfig.adaptiveLongTextThresholdChars
    );

    const computedOcrTextHash = crypto
      .createHash('sha256')
      .update(fullText, 'utf8')
      .digest('hex')
      .slice(0, 24);
    const ocrTextHash = (providedOcrTextHash || '').trim() || computedOcrTextHash;

    // Retrieve up to 16 relevant textbook chunks with deterministic tie-breaking sort
    const retrievedHits = retrieveRelevantChunks(fullText, referenceChunks, {
      referenceId: textbookReferenceId || undefined,
      selectedChapters: selectedChapters.length > 0 ? selectedChapters : undefined,
      topK: 16,
    });
    const retrievedChunks = retrievedHits.map((h) => h.chunk);
    const sortedChunkIds = retrievedChunks.map((c) => c.chunkId).sort();

    // Build pre-grading FixedRubric directly from indexed textbook chunks BEFORE invoking the AI
    const fixedRubric = buildFixedRubricFromChunks({
      chunks: retrievedChunks,
      subject,
      grade,
      textbookReferenceId,
      textbookTitle,
      selectedChapters,
      maxCriteria: 24,
    });

    const hasIndexedTextbookChunks = retrievedHits.length > 0;
    const rubricMode: RubricMode =
      fixedRubric.criteria.length > 0
        ? 'fixed_textbook_rubric'
        : selectedChapters.length > 0 || scope.trim().length > 0
        ? 'scope_guided'
        : 'unscoped';

    const textbookContext =
      retrievedHits.length > 0
        ? retrievedHits
            .map(
              (h) =>
                `[chunkId=${h.chunk.chunkId} | Trang ${h.chunk.pageNumber} | ${h.chunk.chapter} - ${h.chunk.lesson} | ${h.chunk.sectionTitle}]\n${h.chunk.content}`
            )
            .join('\n\n')
        : 'Không có đoạn trích sách giáo khoa được lập chỉ mục trong kho tham chiếu cho phạm vi này.';

    const webSources: ReferenceEvidence[] = [];
    const usedWebGrounding = false;
    const webGroundingNotice: string | undefined =
      enableWebGrounding === true
        ? 'Hệ thống kiểm định vận hành trên cụm 3 nhà cung cấp AI độc lập (Mistral AI, Cloudflare Workers AI, Groq) và đối chiếu trực tiếp với kho sách giáo khoa tham chiếu & chuẩn GDPT 2018.'
        : undefined;

    const studentTruncated = formattedStudentBlocks.length > MAX_STUDENT_GRADING_CHARS;
    const textbookTruncated = textbookContext.length > MAX_TEXTBOOK_GRADING_CHARS;
    const truncationApplied = studentTruncated || textbookTruncated;
    const studentSlice = formattedStudentBlocks.slice(0, MAX_STUDENT_GRADING_CHARS);
    const textbookSlice = textbookContext.slice(0, MAX_TEXTBOOK_GRADING_CHARS);

    const rubricSection =
      rubricMode === 'fixed_textbook_rubric'
        ? [
            '=== RUBRIC KIỂM ĐỊNH ĐỘ ĐẦY ĐỦ CỐ ĐỊNH (ĐÃ KHÓA TRƯỚC KHI CHẤM) ===',
            formatFixedRubricForPrompt(fixedRubric),
            '',
          ].join('\n')
        : '';

    const coverageInstruction =
      rubricMode === 'fixed_textbook_rubric'
        ? `- ĐÁNH GIÁ ĐỘ ĐẦY ĐỦ (coverageItems): BẮT BUỘC chấm đủ TẤT CẢ ${fixedRubric.criteria.length} tiêu chí KT01..KT${String(fixedRubric.criteria.length).padStart(2, '0')} từ bảng Rubric cố định bên dưới. Ghi đúng trường "criterionId", giữ nguyên "importanceWeight" của rubric, trích dẫn đúng "matchedChunkId" & "referenceExcerpt". KHÔNG giới hạn 10 ý và KHÔNG bỏ sót tiêu chí nào.`
        : rubricMode === 'scope_guided'
        ? '- ĐÁNH GIÁ ĐỘ ĐẦY ĐỦ (coverageItems): Đánh giá đầy đủ các ý trọng tâm theo phạm vi chương đã chọn (không tự cắt ngắn khi tài liệu dài), phân loại rõ COVERED / PARTIALLY_COVERED / MISSING.'
        : '- Không có SGK hay phạm vi chương cố định: chỉ ghi nhận các thiếu sót trực tiếp trong bài viết (như thiếu chú thích ký hiệu/đơn vị của công thức) nếu thực sự tồn tại.';

    const buildGradingPrompt = (studentBodyText: string, partNote?: string): string =>
      [
        'Bạn là chuyên gia kiểm định kiến thức giáo dục THPT Việt Nam của StudyCheck AI. Hãy chấm cực kỳ chính xác, chặt chẽ, khách quan theo sự thật khoa học — TUYỆT ĐỐI CHỐNG CHẤM DỄ DÃI.',
        `Môn học: ${subjectName} | Lớp: ${grade} | Sách tham chiếu: ${textbookTitle || 'Chuẩn chương trình GDPT 2018 & kiến thức khoa học phổ thông'} | Phạm vi: ${scope || selectedChapters.join(', ') || 'Theo đúng chủ đề chính trong tài liệu'}`,
        partNote ? `PHẠM VI PHẦN ĐANG CHẤM: ${partNote}` : '',
        '',
        'NGUYÊN TẮC CHỐNG CHẤM DỄ DÃI (ANTI-LENIENCY) & ĐÁNH GIÁ THEO NGỮ CẢNH:',
        '- KHÔNG BAO GIỜ mặc định nội dung học sinh là CORRECT. Phải tự kiểm chứng lại từng định nghĩa, tính chất, quan hệ, công thức, phép toán, đơn vị, điều kiện áp dụng và suy luận dựa trên kiến thức khoa học chuẩn xác.',
        '- Đánh giá từng mệnh đề đặt trong TOÀN BỘ NGỮ CẢNH liên quan của bài làm (không chỉ đọc rời rạc từng dòng):',
        '  + Nếu học sinh ĐÃ nêu rõ đơn vị/ký hiệu/điều kiện ở đoạn trước cùng ngữ cảnh bài làm → KHÔNG bắt lỗi lặp lại oan.',
        '  + Nếu học sinh KHÔNG nêu đơn vị bắt buộc, điều kiện áp dụng hoặc giải thích ký hiệu ở BẤT KỲ ĐÂU trong ngữ cảnh liên quan → BẮT BUỘC đánh PARTIALLY_CORRECT.',
        '- CẤM hạ nhẹ lỗi sai kiến thức/sai công thức (ví dụ "s = v + t", "tốc độ thay đổi", "tỉ lệ nghịch") xuống PARTIALLY_CORRECT hay CORRECT.',
        '- KHÔNG suy đoán các vùng có ký hiệu "[KHÔNG NHÌN RÕ]" hoặc chữ OCR quá mờ để ép chấm CORRECT/INCORRECT — hãy gắn OCR_UNCERTAIN cho đoạn mờ đó, đồng thời VẪN chấm nghiêm túc các đoạn đọc rõ khác trong cùng bài.',
        '',
        'NGUỒN CĂN CỨ ĐỐI CHIẾU:',
        hasIndexedTextbookChunks
          ? '- Ưu tiên đối chiếu trực tiếp các đoạn trích SGK bên dưới và chỉ gắn matchedChunkId, matchedPage khi trích đúng từ đoạn trích SGK có thật bên dưới. Với kiến thức khoa học phổ thông chuẩn GDPT 2018 ngoài đoạn trích, vẫn kiểm định dứt khoát theo khoa học phổ thông nhưng KHÔNG bịa matchedPage.'
          : '- Hiện chưa có đoạn trích SGK trong kho cho bài này. BẮT BUỘC dùng chuẩn kiến thức khoa học chính thống và chương trình GDPT 2018 của Bộ GD&ĐT để kiểm định dứt khoát mọi định nghĩa, định luật, công thức, tính chất và đơn vị đo. TUYỆT ĐỐI KHÔNG đánh UNVERIFIED cho lỗi sai kiến thức/công thức phổ thông rõ ràng (ví dụ: "tốc độ thay đổi" trong chuyển động thẳng đều, "tỉ lệ nghịch", "s = v + t"), và KHÔNG bịa matchedPage/matchedChunkId.',
        '',
        'QUY TRÌNH KIỂM ĐỊNH 4 LỚP BẮT BUỘC:',
        'LỚP 1 — TÁCH MỆNH ĐỀ NGỮ NGHĨA & CẤM CHẤM TIÊU ĐỀ DẪN NHẬP:',
        '- Tách tài liệu học sinh thành từng đơn vị kiến thức độc lập theo từng câu, từng cụm công thức và từng cụm giải thích "Trong đó: ..." (không gộp nhiều lỗi khác nhau vào chung 1 claim). Gắn đúng blockId từ [BLOCK id=...].',
        '- TUYỆT ĐỐI KHÔNG tạo claim độc lập cho dòng nhãn dẫn nhập / tiêu đề ngắn kết thúc bằng dấu hai chấm (ví dụ: "Công thức tính quãng đường:", "Phương trình chuyển động thẳng đều:", "Trong đó:", "Định nghĩa:"). Hãy giữ nhãn dẫn nhập gắn liền với công thức hoặc nội dung phía sau thành 1 claim duy nhất để không bơm điểm ảo.',
        '- Soi kỹ mọi từ khóa bản chất: "không đổi" vs "thay đổi", "tỉ lệ thuận" vs "tỉ lệ nghịch", "tăng" vs "giảm", "cùng chiều" vs "ngược chiều", "bảo toàn" vs "không bảo toàn", miền xác định, điều kiện áp dụng, nguyên nhân – hệ quả.',
        '- Chấp nhận cách diễn đạt tương đương nếu đúng bản chất khoa học; không bắt bẻ lỗi chính tả vặt nếu không làm sai nghĩa học thuật.',
        '',
        'LỚP 2 — SOI TỪNG CÔNG THỨC, PHÉP TOÁN & TRÍCH NGUYÊN VĂN errorSpan (CẤM SỬA BẢN GỐC):',
        '- NGUYÊN TẮC BẤT DI BẤT DỊCH: "sourceText" và "errorSpan" BẮT BUỘC phải là bản SAO CHÉP NGUYÊN VĂN 100% từ bài làm học sinh — CẤM tự sửa chữ, sửa công thức, đổi dấu hay điền đáp án đúng vào errorSpan! Ví dụ: nếu học sinh viết "s = v + t", thì errorSpan PHẢI là "s = v + t" (TUYỆT ĐỐI KHÔNG viết "s = v.t" trong errorSpan). Phần sửa đúng chỉ ghi ở "shortFix" và "suggestedFix".',
        '- Kiểm tra từng dấu phép toán (+, -, ×, ., /, ^), dấu âm/dương, hệ số, chỉ số dưới/trên, cân bằng phương trình hóa học, thứ nguyên vật lý/toán học (ví dụ: v [m/s] không thể cộng với t [s] trong s = v + t; công thức đúng phải là s = v.t).',
        '- Tách riêng claim cho công thức và claim cho cụm chú thích "Trong đó: ..." để phân biệt rõ công thức sai (INCORRECT) với thiếu đơn vị/giải thích ký hiệu (PARTIALLY_CORRECT).',
        '- Với MỌI claim INCORRECT hoặc PARTIALLY_CORRECT:',
        '  + BẮT BUỘC điền "errorSpan" là chuỗi con NGUYÊN VĂN ngắn gọn, chính xác của phần bị sai/thiếu trong block tương ứng.',
        '  + Nếu cụm từ lỗi có thể lặp lại nhiều lần trong cùng đoạn, BẮT BUỘC điền thêm "contextBefore" và "contextAfter" (5–20 ký tự nguyên văn ngay trước/sau errorSpan) để định vị chính xác 100%.',
        '  + BẮT BUỘC điền "shortFix" (1 câu ngắn gọn, trực diện cách sửa chuẩn, tối đa 15–20 từ).',
        '',
        'LỚP 3 — KIỂM TRA CHÚ THÍCH KÝ HIỆU, ĐƠN VỊ & ĐIỀU KIỆN ÁP DỤNG:',
        '- Với MỌI công thức xuất hiện trong bài (s = v.t, x = x0 + v.t, F = m.a, ...), đối chiếu toàn bộ biến số/ký hiệu với phần giải thích và đơn vị trong ngữ cảnh liên quan.',
        '- Nếu thiếu đơn vị đo bắt buộc (ví dụ chỉ viết "v là tốc độ" mà không có m/s hay đơn vị hợp lệ nào trong ngữ cảnh), thiếu giải thích ký hiệu, hoặc thiếu điều kiện áp dụng quan trọng → đánh PARTIALLY_CORRECT, chỉ đích danh thiếu gì trong explanation và cách bổ sung chuẩn trong shortFix.',
        '',
        'LỚP 4 — RANH GIỚI TRẠNG THÁI CHẶT CHẼ & TỰ KIỂM CHÉO NHẤT QUÁN:',
        '- CORRECT: Đúng bản chất kiến thức, đúng công thức/phép toán/lập luận, đầy đủ đơn vị & điều kiện bắt buộc trong ngữ cảnh.',
        '- INCORRECT: Sai bản chất kiến thức, sai quan hệ, sai công thức/phép toán/dấu/định luật, sai phương trình hoặc sai bước suy luận.',
        '- PARTIALLY_CORRECT: Ý cốt lõi đúng nhưng thiếu đơn vị, thiếu điều kiện áp dụng, thiếu miền xác định, thiếu giải thích biến số hoặc diễn đạt thiếu ý quan trọng.',
        rubricMode === 'unscoped'
          ? '- MISSING: KHÔNG tự bịa claim MISSING khi không có đề bài hay phạm vi rubric cố định yêu cầu.'
          : '- MISSING: CHỈ dùng khi thiếu hẳn một ý/yêu cầu bắt buộc theo phạm vi hoặc rubric đã cho; KHÔNG tạo errorSpan giả cho MISSING.',
        '- UNVERIFIED / AMBIGUOUS: CHỈ dùng khi mệnh đề thực sự mơ hồ hoặc không đủ ngữ cảnh xác minh. CẤM dùng cho kiến thức/công thức phổ thông cơ bản.',
        ocrConfirmed
          ? '- OCR_UNCERTAIN: Văn bản đã được người học xác nhận nên CHỈ dùng khi còn dấu "[KHÔNG NHÌN RÕ]" hoặc mất ký tự không đọc được nghĩa.'
          : '- OCR_UNCERTAIN: Dùng khi đoạn chứa "[KHÔNG NHÌN RÕ]" hoặc chữ OCR quá mờ/độ tin cậy < 0.65 — không đoán bừa.',
        '- OUT_OF_SCOPE: Nội dung hoàn toàn lạc đề ngoài môn học.',
        '- KIỂM TRA CHÉO NHẤT QUÁN: Nếu explanation nêu lỗi sai → evaluationStatus BẮT BUỘC là INCORRECT. Nếu explanation nêu thiếu đơn vị/ký hiệu/điều kiện → evaluationStatus BẮT BUỘC là PARTIALLY_CORRECT. CẤM giải thích chỉ lỗi mà lại gắn CORRECT.',
        '- Gán importanceWeight: 3 (định nghĩa/định luật/công thức cốt lõi), 2 (chú thích ký hiệu/đơn vị/điều kiện), 1 (ví dụ/chi tiết phụ).',
        coverageInstruction,
        '- Tuyệt đối KHÔNG bịa URL, tên sách, hay số trang SGK nếu không có trong đoạn trích SGK thật bên dưới.',
        '- Viết súc tích, đi thẳng vào bản chất (shortFix 1 dòng ngắn; explanation/correctKnowledge/suggestedFix tối đa 2-3 câu; weaknesses tối đa 10 ý; strengths tối đa 5 ý; suggestions tối đa 5 ý).',
        '',
        rubricSection,
        '=== TÀI LIỆU CỦA HỌC SINH ===',
        studentBodyText,
        '',
        '=== ĐOẠN TRÍCH SÁCH GIÁO KHOA THAM CHIẾU ===',
        textbookSlice,
      ]
        .filter((line) => line !== undefined)
        .join('\n');

    const analysisPrompt = buildGradingPrompt(studentSlice);

    const gradeSchemaHint =
      '{"claims":[{"blockId":"...","blockIds":["..."],"sourcePage":1,"sourceText":"nguyên văn từ bài học sinh","errorSpan":"cụm sai/thiếu trích nguyên văn từ bài","contextBefore":"5-15 ký tự ngay trước errorSpan","contextAfter":"5-15 ký tự ngay sau errorSpan","shortFix":"câu sửa ngắn gọn 1 dòng","chapter":"...","concept":"...","importanceWeight":1|2|3,"knowledgeType":"textbook_core|advanced_extension|insufficient_evidence","evaluationStatus":"CORRECT|PARTIALLY_CORRECT|INCORRECT|MISSING|UNVERIFIED|AMBIGUOUS|OCR_UNCERTAIN|OUT_OF_SCOPE","explanation":"...","correctKnowledge":"...","suggestedFix":"...","matchedChunkId":"...","matchedExcerpt":"...","matchedPage":1}],"coverageItems":[{"criterionId":"KT01","concept":"...","chapter":"...","importanceWeight":1|2|3,"status":"COVERED|PARTIALLY_COVERED|MISSING|OUT_OF_SCOPE","suggestedAddition":"...","referenceExcerpt":"...","referencePage":1,"matchedChunkId":"..."}],"strengths":[{"title":"...","detail":"...","sourceExcerpt":"...","pageNumber":1}],"weaknesses":[{"title":"...","detail":"...","pageNumber":1}],"suggestions":[{"priority":1,"title":"...","description":"..."}]}';

    // Full SHA-256 hash covering ENTIRE student text, ENTIRE prompt, fixed rubric, sorted chunks, and grading flags
    const fullStudentTextHash = crypto
      .createHash('sha256')
      .update(formattedStudentBlocks, 'utf8')
      .digest('hex');
    const fullPromptHash = crypto
      .createHash('sha256')
      .update(analysisPrompt, 'utf8')
      .digest('hex');
    const inputHash = crypto
      .createHash('sha256')
      .update(
        JSON.stringify({
          promptVersion: GRADING_PROMPT_VERSION,
          fullStudentTextHash,
          fullPromptHash,
          ocrTextHash,
          ocrConfirmed,
          textbookReferenceId,
          grade,
          subject,
          scope,
          selectedChapters: [...selectedChapters].sort(),
          chunkIds: sortedChunkIds,
          rubricHash: fixedRubric.rubricHash,
          enableWebGrounding: Boolean(enableWebGrounding),
          strictModelLock,
          adaptiveMode: 'fixed_1_1_1',
          adaptiveThreshold: adaptivePlan.thresholdChars,
          seed: DETERMINISTIC_GRADING_SEED,
        }),
        'utf8'
      )
      .digest('hex');

    const runGradeSlot = async (slotParams: {
      promptText: string;
      preferredPrimaryModelId: string;
      preferredFallbackModelId: string;
      slot: AdaptiveSlotNumber;
      partKey: string;
      maxOutputTokens: number;
      thinkingTier: 'low' | 'medium';
    }) =>
      runTaskWithRouter<ProviderJsonResult<RawKnowledgeEvalResult>>({
        taskType: 'knowledge_analysis',
        config: effectiveConfig,
        idToken,
        strictModelLock,
        allowGroqRescue: !strictModelLock,
        preferredPrimaryModelId: slotParams.preferredPrimaryModelId,
        preferredFallbackModelId: slotParams.preferredFallbackModelId,
        extractExecutionMeta: (res) => ({
          actualModel: res.resolvedModel,
          systemFingerprint: res.systemFingerprint,
        }),
        cacheInput: {
          promptVersion: GRADING_PROMPT_VERSION,
          partKey: slotParams.partKey,
          inputHash,
          fullStudentTextHash,
          fullPromptHash,
          rubricHash: fixedRubric.rubricHash,
          chunkIds: sortedChunkIds,
          textbookRef: textbookReferenceId,
          grade,
          subject,
          scope,
          ocrConfirmed,
        },
        runWithModel: async (modelId) =>
          generateJsonWithProviderDetailed<RawKnowledgeEvalResult>({
            modelId,
            prompt: slotParams.promptText,
            thinkingTier: slotParams.thinkingTier,
            maxOutputTokens: slotParams.maxOutputTokens,
            timeoutMs: 28_000,
            temperature: 0,
            seed: DETERMINISTIC_GRADING_SEED,
            strictModelLock,
            strictJsonParser: parseAndValidateKnowledgeEvalJson,
            stage: 'CHAM',
            slot: slotParams.slot,
            tokensOut,
            fallbackJson: '{"claims":[],"coverageItems":[],"strengths":[],"weaknesses":[],"suggestions":[]}',
            groqSchemaHint: gradeSchemaHint,
          }),
      });

    // Stage 2 — Fixed 1-API Grading regardless of document length (fast & consistent)
    const singleGradeRes = await runGradeSlot({
      promptText: analysisPrompt,
      preferredPrimaryModelId: MISTRAL_GRADE_MODEL,
      preferredFallbackModelId: GROQ_GRADE_FALLBACK_MODEL,
      slot: 1,
      partKey: 'single_grade',
      maxOutputTokens:
        formattedStudentBlocks.length <= 2800 && fixedRubric.criteria.length <= 10 ? 4096 : 6144,
      thinkingTier: 'low',
    });
    const primaryRoutedResult = singleGradeRes;
    const rawEval: RawKnowledgeEvalResult = singleGradeRes.data.data;
    const gradeModelsUsed: string[] = [singleGradeRes.actualModel];
    const gradeProvidersUsed: AiProviderId[] = [
      detectProviderIdFromModel(singleGradeRes.actualModel),
    ];

    const validStatuses = new Set<ClaimStatus>([
      'CORRECT',
      'PARTIALLY_CORRECT',
      'INCORRECT',
      'MISSING',
      'UNVERIFIED',
      'AMBIGUOUS',
      'OCR_UNCERTAIN',
      'OUT_OF_SCOPE',
    ]);

    // Filter out non-gradable standalone lead-in headers (e.g. "Công thức tính quãng đường:", "Trong đó:")
    // so bare labels can never be scored as CORRECT and inflate accuracyScore.
    const filteredRawClaims = (rawEval.claims || []).filter(
      (c) => !isNonGradableLeadInClaim(c.sourceText || '')
    );

    // Guard against silent empty-claims completion when student document clearly has readable content
    const docHasReadableContent = hasMeaningfulReadableContent(pages);
    if (docHasReadableContent && filteredRawClaims.length === 0) {
      throw new Error(
        'GRADING_JSON_INVALID: Bài làm có nội dung hợp lệ nhưng AI không trích xuất được mệnh đề kiểm định nào. Hệ thống không lưu báo cáo rỗng giả — vui lòng kiểm định lại.'
      );
    }

    const blockMap = new Map<string, ExtractedTextBlock>();
    for (const p of pages) {
      for (const b of p.blocks) {
        blockMap.set(b.blockId, b);
      }
    }

    const chunkMap = new Map<string, ReferenceChunk>();
    for (const c of referenceChunks) {
      chunkMap.set(c.chunkId, c);
    }

    // Build initial typed ExtractedClaim[] before running independent Cross-Provider Verification
    const initialClaims: ExtractedClaim[] = filteredRawClaims.map((c, idx) => {
      const normalizedBlockIds = Array.isArray(c.blockIds)
        ? c.blockIds.filter((id): id is string => typeof id === 'string' && blockMap.has(id))
        : [];
      const primaryBlockId =
        (c.blockId && blockMap.has(c.blockId) ? c.blockId : normalizedBlockIds[0]) || undefined;
      const matchedBlock = primaryBlockId ? blockMap.get(primaryBlockId) : undefined;
      const rawOcrConf = matchedBlock ? matchedBlock.confidence : 0.9;
      const ocrConf = ocrConfirmed ? Math.max(rawOcrConf, 0.95) : rawOcrConf;
      const status: ClaimStatus = validStatuses.has(c.evaluationStatus as ClaimStatus)
        ? (c.evaluationStatus as ClaimStatus)
        : 'UNVERIFIED';

      const wRaw = Number(c.importanceWeight);
      const importanceWeight: 1 | 2 | 3 = wRaw === 3 ? 3 : wRaw === 1 ? 1 : 2;
      const evidences: ReferenceEvidence[] = [];

      // Only cite textbook page/chunk when genuinely grounded in retrieved textbook chunks
      if (c.matchedChunkId && chunkMap.has(c.matchedChunkId)) {
        const ch = chunkMap.get(c.matchedChunkId)!;
        evidences.push({
          evidenceId: `ev_${idx + 1}_tb`,
          sourceType: 'textbook',
          referenceId: ch.referenceId,
          chunkId: ch.chunkId,
          title: textbookTitle || ch.textbookSeries,
          chapter: ch.chapter,
          lesson: ch.lesson,
          pageNumber: ch.pageNumber,
          excerpt: c.matchedExcerpt || ch.content.slice(0, 320),
        });
      } else if (hasIndexedTextbookChunks && c.matchedExcerpt) {
        evidences.push({
          evidenceId: `ev_${idx + 1}_ref`,
          sourceType: 'textbook',
          ...(textbookReferenceId ? { referenceId: textbookReferenceId } : {}),
          title: textbookTitle || 'Chuẩn chương trình GDPT 2018',
          excerpt: c.matchedExcerpt,
        });
      }

      const resolvedSuggestedFix =
        c.suggestedFix && c.suggestedFix.trim()
          ? c.suggestedFix.trim()
          : status !== 'CORRECT' && c.correctKnowledge
          ? c.correctKnowledge
          : null;

      const resolvedErrorSpan =
        typeof c.errorSpan === 'string' && c.errorSpan.trim().length >= 2
          ? c.errorSpan.trim()
          : undefined;
      const resolvedShortFix =
        typeof c.shortFix === 'string' && c.shortFix.trim().length > 0
          ? c.shortFix.trim()
          : undefined;

      // Deterministic claim ID derived from index + page + normalized sourceText + concept
      const claimDigest = crypto
        .createHash('sha256')
        .update(
          `${idx + 1}|${c.sourcePage || matchedBlock?.pageNumber || 1}|${(c.sourceText || '').trim().normalize('NFC')}|${(c.concept || '').trim().normalize('NFC')}`,
          'utf8'
        )
        .digest('hex')
        .slice(0, 8);

      return {
        claimId: `claim_${idx + 1}_${claimDigest}`,
        sourceText: c.sourceText,
        normalizedMeaning: c.sourceText,
        subject,
        chapter: c.chapter || selectedChapters[0] || 'Tổng hợp',
        concept: c.concept || 'Khái niệm chính',
        importanceLevel: importanceWeight === 3 ? 'core' : importanceWeight === 1 ? 'detail' : 'supporting',
        importanceWeight,
        sourcePage: c.sourcePage || matchedBlock?.pageNumber || 1,
        ...(matchedBlock?.blockId ? { blockId: matchedBlock.blockId } : {}),
        ...(normalizedBlockIds.length > 0 ? { blockIds: normalizedBlockIds } : {}),
        ...(resolvedErrorSpan ? { errorSpan: resolvedErrorSpan } : {}),
        ...(typeof c.startOffset === 'number' ? { startOffset: c.startOffset } : {}),
        ...(typeof c.endOffset === 'number' ? { endOffset: c.endOffset } : {}),
        ...(typeof c.contextBefore === 'string' && c.contextBefore.trim()
          ? { contextBefore: c.contextBefore.trim() }
          : {}),
        ...(typeof c.contextAfter === 'string' && c.contextAfter.trim()
          ? { contextAfter: c.contextAfter.trim() }
          : {}),
        ...(resolvedShortFix ? { shortFix: resolvedShortFix } : {}),
        boundingBox: matchedBlock?.boundingBox || null,
        ocrConfidence: ocrConf,
        knowledgeType:
          c.knowledgeType === 'advanced_extension'
            ? 'advanced_extension'
            : c.knowledgeType === 'insufficient_evidence'
            ? 'insufficient_evidence'
            : 'textbook_core',
        evaluationStatus: status,
        explanation: c.explanation,
        correctKnowledge: c.correctKnowledge,
        ...(resolvedSuggestedFix ? { suggestedFix: resolvedSuggestedFix } : {}),
        evidences,
      };
    });

    // Stage 3 — Fixed 1-API Independent Two-Way Cross-Provider Verification
    type VerifyBatchOutput = { adjustments?: VerifierAdjustment[] };

    const rawConfiguredProviders = {
      mistral: isMistralConfigured(),
      cloudflare: isCloudflareConfigured(),
      groq: isGroqConfigured(),
    };
    const healthyConfiguredProviders = {
      mistral: rawConfiguredProviders.mistral && !isProviderCoolingDown('mistral'),
      cloudflare: rawConfiguredProviders.cloudflare && !isProviderCoolingDown('cloudflare'),
      groq: rawConfiguredProviders.groq && !isProviderCoolingDown('groq'),
    };
    const configuredProviders =
      healthyConfiguredProviders.mistral ||
      healthyConfiguredProviders.cloudflare ||
      healthyConfiguredProviders.groq
        ? healthyConfiguredProviders
        : rawConfiguredProviders;
    const verifySchemaHint =
      '{"adjustments":[{"claimIndex":0,"claimId":"...","previousStatus":"CORRECT","evaluationStatus":"CORRECT|PARTIALLY_CORRECT|INCORRECT|MISSING|UNVERIFIED|AMBIGUOUS|OCR_UNCERTAIN|OUT_OF_SCOPE","reason":"lý do cụ thể","evidenceBasis":"căn cứ khoa học/SGK cụ thể","blockId":"...","sourceText":"...","errorSpan":"trích nguyên văn từ bài học sinh","contextBefore":"...","contextAfter":"...","shortFix":"...","explanation":"...","correctKnowledge":"...","suggestedFix":"..."}]}';

    const verifyModelsUsed: string[] = [];
    let verifyExecutedApiCount = 0;
    let verifyAdjustmentsCount = 0;

    // Build compact verbatim student blocks payload so Verifier can audit independently against raw student text
    const verifierStudentBlocksPayload = pages.flatMap((page) =>
      (page.blocks || []).map((block) => ({
        blockId: block.blockId,
        pageNumber: page.pageNumber,
        confidence: Math.round((block.confidence ?? 1) * 100) / 100,
        text: block.extractedText,
      }))
    );
    const verifierStudentBlocksJson = JSON.stringify(verifierStudentBlocksPayload).slice(0, 12_000);
    const verifierRubricSummary =
      fixedRubric.criteria.length > 0
        ? fixedRubric.criteria
            .slice(0, 20)
            .map((cr) => `${cr.criterionId}: ${cr.concept} (${cr.chapter})`)
            .join('\n')
        : '';

    const runVerifySlice = async (verifyParams: {
      indexedClaims: Array<{ index: number; claim: ExtractedClaim }>;
      gradedByProvider: AiProviderId;
      slot: AdaptiveSlotNumber;
      slot1VerifyModel?: string;
    }): Promise<{ adjustments: VerifierAdjustment[]; modelUsed?: string; executed: boolean }> => {
      if (verifyParams.indexedClaims.length === 0) {
        return { adjustments: [], executed: false };
      }
      const verifierChoice = selectCrossProviderVerifierModel({
        gradedByProvider: verifyParams.gradedByProvider,
        slot: verifyParams.slot,
        configuredProviders,
        slot1VerifyModel: verifyParams.slot1VerifyModel,
      });

      const fullClaimsPayload = verifyParams.indexedClaims.map(({ index, claim }) => ({
        claimIndex: index,
        claimId: claim.claimId,
        blockId: claim.blockId || '',
        sourcePage: claim.sourcePage,
        sourceText: claim.sourceText,
        concept: claim.concept,
        evaluationStatus: claim.evaluationStatus,
        errorSpan: claim.errorSpan || '',
        shortFix: claim.shortFix || '',
        explanation: claim.explanation,
        correctKnowledge: claim.correctKnowledge,
      }));

      const verifyPrompt = [
        `Bạn là Hội đồng Dò Chéo Độc Lập (Cross-Provider Verifier) của StudyCheck AI cho môn ${subjectName} lớp ${grade}.`,
        'BẮT BUỘC kiểm tra ĐỘC LẬP dựa trên BÀI LÀM NGUYÊN BẢN CỦA HỌC SINH bên dưới theo ĐỦ 2 CHIỀU:',
        '',
        'CHIỀU 1 — SĂN LỖI BỊ BỎ SÓT (CHỐNG CHẤM DỄ DÃI):',
        '- Rà soát ĐỘC LẬP TẤT CẢ các mệnh đề đang bị chấm "CORRECT" so với bài làm nguyên bản.',
        '- Nếu học sinh viết sai kiến thức, sai công thức/phép toán (vd: s = v + t), sai quan hệ ("tỉ lệ nghịch", "tốc độ thay đổi"), sai dấu/hệ số → BẮT BUỘC trả adjustment chuyển thành INCORRECT (kèm previousStatus="CORRECT", reason, evidenceBasis, errorSpan NGUYÊN VĂN từ bài học sinh, shortFix chuẩn).',
        '- Nếu học sinh thiếu đơn vị đo bắt buộc, thiếu điều kiện áp dụng hoặc thiếu giải thích ký hiệu mà KHÔNG xuất hiện ở đâu trong ngữ cảnh bài làm → BẮT BUỘC trả adjustment chuyển thành PARTIALLY_CORRECT.',
        '- Nếu phát hiện mâu thuẫn giữa explanation (đang chỉ lỗi) và evaluationStatus="CORRECT" → sửa ngay trạng thái cho nhất quán.',
        '- Nếu trong bài làm nguyên bản có lỗi rõ ràng mà danh sách claims hoàn toàn bỏ sót chưa tạo claim → có thể thêm phần tử với claimIndex: -1, blockId, sourceText, errorSpan nguyên văn, shortFix, reason, evidenceBasis.',
        '',
        'CHIỀU 2 — RÀ SOÁT LỖI BẮT OAN, TRÙNG LẶP & ĐỘ CHÍNH XÁC CỦA errorSpan:',
        '- Kiểm tra mọi claim INCORRECT / PARTIALLY_CORRECT / MISSING:',
        '  + Có bắt oan học sinh khi đơn vị/điều kiện đã nêu rõ ở câu trước cùng ngữ cảnh không?',
        '  + Có bịa MISSING khi không có yêu cầu/rubric không?',
        '  + "errorSpan" có phải là chuỗi con NGUYÊN VĂN 100% có thật trong block bài làm không? Nếu AI chấm lỡ điền đáp án sửa vào errorSpan, hãy sửa errorSpan về đúng cụm sai nguyên văn trên bài làm (kèm contextBefore/contextAfter nếu cụm đó lặp lại).',
        '  + "shortFix" và "correctKnowledge" có đúng khoa học không?',
        '- QUY TẮC CHẶT: KHÔNG hạ một lỗi từ INCORRECT xuống CORRECT nếu không có evidenceBasis khoa học cụ thể chứng minh học sinh viết đúng.',
        '- CHỈ trả về các mục thực sự cần điều chỉnh trong mảng "adjustments" (nếu tất cả đã chuẩn, trả {"adjustments":[]}).',
        '',
        '=== BÀI LÀM NGUYÊN BẢN THEO BLOCK ===',
        verifierStudentBlocksJson,
        '',
        '=== DANH SÁCH CLAIMS ĐÃ CHẤM CẦN DÒ CHÉO ===',
        JSON.stringify(fullClaimsPayload),
        verifierRubricSummary ? `\n=== RUBRIC YÊU CẦU ===\n${verifierRubricSummary}` : '',
        textbookSlice ? `\n=== ĐOẠN TRÍCH SGK THAM CHIẾU ===\n${textbookSlice.slice(0, 4500)}` : '',
      ]
        .filter(Boolean)
        .join('\n');

      try {
        const res = await runTaskWithRouter<ProviderJsonResult<VerifyBatchOutput>>({
          taskType: 'claim_validation',
          config: effectiveConfig,
          idToken,
          strictModelLock: false,
          allowGroqRescue: true,
          preferredPrimaryModelId: verifierChoice.primaryModel,
          preferredFallbackModelId: verifierChoice.fallbackModel,
          extractExecutionMeta: (out) => ({
            actualModel: out.resolvedModel,
            systemFingerprint: out.systemFingerprint,
          }),
          cacheInput: {
            verifyRev: 'v4.4_two_way_independent_verify',
            slot: verifyParams.slot,
            inputHash,
            gradedByProvider: verifyParams.gradedByProvider,
            claimDigest: crypto
              .createHash('sha256')
              .update(JSON.stringify(fullClaimsPayload), 'utf8')
              .digest('hex')
              .slice(0, 24),
          },
          runWithModel: async (modelId) =>
            generateJsonWithProviderDetailed<VerifyBatchOutput>({
              modelId,
              prompt: verifyPrompt,
              thinkingTier: 'low',
              maxOutputTokens: 2560,
              timeoutMs: 18_000,
              temperature: 0,
              seed: DETERMINISTIC_GRADING_SEED,
              strictModelLock: false,
              stage: 'DO',
              slot: verifyParams.slot,
              tokensOut,
              fallbackJson: '{"adjustments":[]}',
              groqSchemaHint: verifySchemaHint,
            }),
        });
        return {
          adjustments: Array.isArray(res.data.data?.adjustments) ? res.data.data.adjustments : [],
          modelUsed: res.actualModel,
          executed: true,
        };
      } catch (verifyErr) {
        console.warn(`Cross-provider verification non-fatal fallback (slot ${verifyParams.slot}):`, verifyErr);
        return { adjustments: [], executed: false };
      }
    };

    const indexedAllClaims = initialClaims.map((claim, index) => ({ index, claim }));
    const collectedAdjustments: VerifierAdjustment[] = [];

    // Fixed 1-API Verify regardless of document length
    if (indexedAllClaims.length > 0) {
      const slot1Provider = gradeProvidersUsed[0] || 'mistral';
      const v1 = await runVerifySlice({
        indexedClaims: indexedAllClaims,
        gradedByProvider: slot1Provider,
        slot: 1,
      });
      if (v1.executed) {
        verifyExecutedApiCount += 1;
        if (v1.modelUsed) verifyModelsUsed.push(v1.modelUsed);
        collectedAdjustments.push(...v1.adjustments);
      }
    }

    // Strictly validate & reconcile verifier adjustments before anchoring
    const reconciliation = validateAndApplyVerifierAdjustments(
      initialClaims,
      collectedAdjustments,
      pages
    );
    verifyAdjustmentsCount = reconciliation.appliedCount;

    // Enforce block-level OCR safeguard, verify exact errorSpan offsets, sort by document order, and build deduplicated annotations
    const anchoredResult = anchorClaimsAndBuildAnnotations({
      claims: reconciliation.claims,
      pages,
      ocrConfirmed,
    });
    const claims = anchoredResult.claims;
    const annotations = anchoredResult.annotations;

    const modelUsed =
      gradeModelsUsed.length > 1
        ? Array.from(new Set(gradeModelsUsed)).join(' + ')
        : primaryRoutedResult.actualModel;

    // Reconcile coverageItems strictly against the pre-built FixedRubric when textbook rubric exists
    let coverageItems: KnowledgeCoverageItem[] = [];
    let extraCoverageCount = 0;

    if (rubricMode === 'fixed_textbook_rubric') {
      const reconciled = reconcileCoverageAgainstFixedRubric(
        fixedRubric,
        rawEval.coverageItems || []
      );
      coverageItems = reconciled.coverageItems;
      extraCoverageCount = reconciled.extraObservations.length;
    } else {
      coverageItems = (rawEval.coverageItems || []).map((item, idx) => {
        const wRaw = Number(item.importanceWeight);
        const importanceWeight: 1 | 2 | 3 = wRaw === 3 ? 3 : wRaw === 1 ? 1 : 2;
        const validCov =
          item.status === 'COVERED' ||
          item.status === 'PARTIALLY_COVERED' ||
          item.status === 'MISSING' ||
          item.status === 'OUT_OF_SCOPE'
            ? item.status
            : 'PARTIALLY_COVERED';
        return {
          itemId: `cov_${idx + 1}`,
          concept: item.concept,
          chapter: item.chapter,
          importanceWeight,
          status: validCov,
          suggestedAddition: item.suggestedAddition || '',
          referenceExcerpt: item.referenceExcerpt || '',
          ...(hasIndexedTextbookChunks &&
          typeof item.referencePage === 'number' &&
          item.referencePage > 0
            ? { referencePage: item.referencePage }
            : {}),
          ...(item.matchedChunkId && chunkMap.has(item.matchedChunkId)
            ? { matchedChunkId: item.matchedChunkId }
            : {}),
        };
      });
    }

    const hasTextbook = Boolean(textbookReferenceId && retrievedHits.length > 0);
    const hasValidScope = rubricMode !== 'unscoped';

    const baseAccuracyBreakdown = calculateAccuracyScore(claims, hasTextbook);
    const completenessBreakdown = calculateCompletenessScore(coverageItems, hasValidScope, {
      rubricMode,
      rubricItemCount:
        rubricMode === 'fixed_textbook_rubric' ? fixedRubric.criteria.length : coverageItems.length,
      extraObservationsCount: extraCoverageCount,
    });

    const adaptiveApiPlanAudit = createAdaptiveAuditMetadata(adaptivePlan, {
      gradeModels: gradeModelsUsed,
      verifyModels: verifyModelsUsed,
      verifyExecutedApiCount,
      verifyAdjustmentsCount,
    });

    const gradingAudit: GradingAuditMetadata = {
      requestedModel: primaryRoutedResult.requestedModel,
      actualModel: modelUsed,
      usedFallback: primaryRoutedResult.usedFallback,
      usedOverride: primaryRoutedResult.usedOverride,
      cached: primaryRoutedResult.cached,
      strictModelLock,
      ...(primaryRoutedResult.systemFingerprint
        ? { systemFingerprint: primaryRoutedResult.systemFingerprint }
        : {}),
      promptVersion: GRADING_PROMPT_VERSION,
      configVersion: primaryRoutedResult.configVersion,
      inputHash: inputHash.slice(0, 24),
      ocrTextHash,
      ocrConfirmed,
      rubricMode,
      ...(fixedRubric.criteria.length > 0 ? { rubricHash: fixedRubric.rubricHash.slice(0, 24) } : {}),
      rubricItemCount: fixedRubric.criteria.length,
      extraCoverageCount,
      chunkIds: sortedChunkIds,
      truncationApplied,
      studentCharCount: formattedStudentBlocks.length,
      textbookCharCount: textbookContext.length,
      webGroundingEnabled: Boolean(enableWebGrounding),
      deterministicSeed: DETERMINISTIC_GRADING_SEED,
      adaptiveApiPlan: adaptiveApiPlanAudit,
    };

    const accuracyBreakdown = {
      ...baseAccuracyBreakdown,
      gradingAudit,
    };

    const mappedWeaknesses: AnalysisWeakness[] = (rawEval.weaknesses || []).map((w) => ({
      title: w.title,
      category: 'knowledge_error',
      detail: w.detail,
      ...(typeof w.pageNumber === 'number' && w.pageNumber > 0 ? { pageNumber: w.pageNumber } : {}),
    }));

    const mappedSuggestions: ImprovementSuggestion[] = (rawEval.suggestions || []).map((s, idx) => ({
      priority: Number(s.priority) || idx + 1,
      actionType: 'fix_error',
      title: s.title,
      description: s.description,
    }));

    return {
      claims,
      coverageItems,
      annotations,
      strengths: rawEval.strengths || [],
      weaknesses: mappedWeaknesses,
      suggestions: mappedSuggestions,
      webSources,
      usedWebGrounding,
      ...(webGroundingNotice ? { webGroundingNotice } : {}),
      modelUsed,
      accuracyScore: accuracyBreakdown.accuracyScore,
      completenessScore: completenessBreakdown.completenessScore,
      evidenceCoverage: accuracyBreakdown.evidenceCoverage,
      confidenceLevel: accuracyBreakdown.confidenceLevel,
      confidenceReason: accuracyBreakdown.confidenceReason,
      accuracyBreakdown,
      completenessBreakdown,
      gradingAudit,
    };
  }
}

export class QuizGenerationService {
  static async generateQuiz(params: {
    subject: SubjectId;
    grade: GradeLevel;
    textbookTitle: string;
    claims: ExtractedClaim[];
    coverageItems: KnowledgeCoverageItem[];
    referenceChunks?: ReferenceChunk[];
    count: number;
    difficulty: QuizDifficulty;
    scope: QuizScope;
    chapterFilter?: string;
    advancedEnabled?: boolean;
    advancedCount?: number;
    tokensOut: TokenTelemetry;
    config?: SystemAiConfig;
    idToken?: string;
  }): Promise<{
    questions: QuizQuestion[];
    supplementedFromTextbook: boolean;
    supplementNotice?: string;
    modelUsed: string;
  }> {
    const {
      subject,
      grade,
      textbookTitle,
      claims,
      coverageItems,
      referenceChunks = [],
      count,
      difficulty,
      scope,
      chapterFilter,
      advancedEnabled = false,
      advancedCount = 0,
      tokensOut,
      config,
      idToken,
    } = params;

    const safeAdvancedExtra = advancedEnabled ? Math.min(6, Math.max(1, Number(advancedCount) || 2)) : 0;
    const baseTargetCount = Math.min(20, Math.max(5, Number(count) || 5));
    const totalWanted = baseTargetCount + safeAdvancedExtra;

    const strategy = resolveQuizScopeStrategy({
      scope,
      baseTargetCount,
      claims,
      coverageItems,
      chapterFilter,
    });

    const querySeedText = [
      chapterFilter || '',
      ...strategy.targetClaims.map((c) => `${c.chapter} ${c.concept} ${c.correctKnowledge}`),
      ...strategy.missingItems.map((m) => `${m.chapter} ${m.concept} ${m.suggestedAddition}`),
    ]
      .join(' ')
      .trim();

    const sameSubjectChunks = referenceChunks.filter(
      (rc) => rc.grade === grade && rc.subject === subject
    );
    const retrievedSupplementHits =
      sameSubjectChunks.length > 0 && querySeedText
        ? retrieveRelevantChunks(querySeedText, sameSubjectChunks, {
            selectedChapters: chapterFilter?.trim() ? [chapterFilter.trim()] : undefined,
            topK: 10,
          })
        : [];
    const supplementChunks: ReferenceChunk[] =
      retrievedSupplementHits.length > 0
        ? retrievedSupplementHits.map((h) => h.chunk)
        : sameSubjectChunks.slice(0, 10);

    const buildContextText = (includeTextbookChunks: boolean): string => {
      const lines = [
        ...strategy.targetClaims.map(
          (c) =>
            `[UploadClaim ${c.claimId} | ${c.evaluationStatus} | ${c.chapter} | ${c.concept}] Học sinh viết: "${c.sourceText}" | Chuẩn: "${c.correctKnowledge}" | Giải thích: "${c.explanation}"`
        ),
        ...strategy.missingItems.map(
          (m) =>
            `[UploadMissing | ${m.chapter} | ${m.concept}] Gợi ý: "${m.suggestedAddition}" | Trích dẫn: "${m.referenceExcerpt}"`
        ),
        ...(includeTextbookChunks
          ? supplementChunks.map(
              (ch) =>
                `[TextbookSupplement | ${ch.chapter} - ${ch.lesson} | Tr.${ch.pageNumber}] ${ch.content.slice(0, 420)}`
            )
          : []),
      ];

      if (lines.length > 0) return lines.join('\n').slice(0, 18000);
      return claims
        .map((c) => `[FallbackClaim | ${c.chapter} | ${c.concept}] ${c.correctKnowledge}`)
        .join('\n')
        .slice(0, 18000);
    };

    const diffLabel =
      difficulty === 'basic'
        ? 'Cơ bản (Nhận biết, Thông hiểu)'
        : difficulty === 'medium'
        ? 'Trung bình (Thông hiểu, Vận dụng)'
        : difficulty === 'advanced'
        ? 'Nâng cao (Vận dụng, Vận dụng cao)'
        : 'Hỗn hợp cân bằng (Nhận biết 30% - Thông hiểu 30% - Vận dụng 25% - Vận dụng cao 15%)';

    const scopeHumanLabel =
      scope === 'incorrect'
        ? 'chỗ làm sai'
        : scope === 'partial'
        ? 'phần thiếu điều kiện'
        : scope === 'missing'
        ? 'phần kiến thức còn thiếu'
        : scope === 'chapter' && chapterFilter?.trim()
        ? `chương "${chapterFilter.trim()}"`
        : 'toàn bộ nội dung đã phân tích';

    type RawQuizItem = {
      questionText: string;
      optionA: string;
      optionB: string;
      optionC: string;
      optionD: string;
      correctAnswer: string;
      explanation: string;
      distractorA?: string;
      distractorB?: string;
      distractorC?: string;
      distractorD?: string;
      cognitiveLevel?: string;
      knowledgeUnitType?: string;
      chapter: string;
      concept: string;
      sourceReference: string;
      isExternalAdvanced?: boolean;
      questionOrigin?: string;
    };

    const quizGroqSchemaHint =
      '{"questions":[{"questionText":"...","optionA":"...","optionB":"...","optionC":"...","optionD":"...","correctAnswer":"A|B|C|D","explanation":"...","distractorA":"...","distractorB":"...","distractorC":"...","distractorD":"...","cognitiveLevel":"nhan_biet|thong_hieu|van_dung|van_dung_cao","chapter":"...","concept":"...","sourceReference":"...","isExternalAdvanced":false,"questionOrigin":"upload|mistake_variation|textbook_supplement|external_advanced"}]}';

    const unitTypes = new Set<KnowledgeUnitType>([
      'concept',
      'mechanism',
      'condition',
      'characteristic',
      'formula',
      'problem_type',
    ]);

    const refLabel = textbookTitle || `SGK & chuẩn chương trình GDPT 2018 môn ${SUBJECT_LABELS[subject]} Lớp ${grade}`;

    const runResult = await runQuizGenerationWithTopUp({
      baseTargetCount,
      advancedTargetCount: safeAdvancedExtra,
      maxTopUpPasses: 2,
      generateBatch: async ({ attempt, missingBase, missingAdvanced, existingQuestions }) => {
        const batchTotal = missingBase + missingAdvanced;
        const allowTextbookOnThisPass =
          strategy.needsTextbookSupplement ||
          strategy.mode === 'empty_scope_fallback' ||
          (strategy.mode === 'mistake_variation' && attempt >= 2) ||
          (strategy.mode !== 'mistake_variation' && attempt >= 1);

        const effectiveContext = buildContextText(allowTextbookOnThisPass);

        let strategyInstruction = '';
        if (strategy.mode === 'mistake_variation') {
          if (attempt < 2) {
            strategyInstruction = [
              `CHIẾN LƯỢC PHẠM VI (${scopeHumanLabel}): Ưu tiên TẠO CÁC CÂU HỎI BIẾN THỂ ĐA GÓC ĐỘ xoay quanh chính các lỗi sai/ý thiếu trong ngữ cảnh (ví dụ: nhận diện phát biểu đúng/sai về lỗi đó, sửa sai công thức/điều kiện, giải thích bản chất, bài tập tính toán/vận dụng ngắn với số liệu mới, tình huống gây nhầm lẫn tương tự) để đạt CHÍNH XÁC ${missingBase} câu cơ bản.`,
              'Gán questionOrigin = "mistake_variation" cho các câu biến thể từ lỗi sai/ý thiếu.',
            ].join('\n');
          } else {
            strategyInstruction = [
              `LƯỢT BỔ SUNG CUỐI (${scopeHumanLabel}): Tiếp tục tạo biến thể mới từ lỗi sai/ý thiếu (questionOrigin = "mistake_variation"). Nếu đã khai thác hết các góc độ biến thể tự nhiên, được phép bổ sung phần còn thiếu từ kiến thức cùng bài trong ${refLabel} và gán questionOrigin = "textbook_supplement" để đạt ĐÚNG ${missingBase} câu cơ bản.`,
            ].join('\n');
          }
        } else if (strategy.mode === 'upload_plus_textbook' || strategy.mode === 'empty_scope_fallback') {
          strategyInstruction =
            attempt === 0
              ? [
                  `CHIẾN LƯỢC PHẠM VI (${scopeHumanLabel}): Tài liệu tải lên hiện có ${strategy.distinctConceptCount} đơn vị kiến thức (ít hơn ${baseTargetCount} câu cần tạo).`,
                  `- Trước tiên, khai thác tối đa các ý trong tài liệu tải lên (gán questionOrigin = "upload").`,
                  `- Tự động bổ sung các câu còn lại từ ${refLabel} đúng chủ đề/chương đang học (gán questionOrigin = "textbook_supplement") sao cho TỔNG SỐ CÂU CƠ BẢN đạt CHÍNH XÁC ${missingBase} câu.`,
                ].join('\n')
              : [
                  `LƯỢT SINH BÙ ${attempt}: Tạo thêm CHÍNH XÁC ${missingBase} câu cơ bản mới hoàn toàn (không trùng câu đã có), ưu tiên ý chưa hỏi trong tài liệu (questionOrigin = "upload") và bổ sung từ ${refLabel} (questionOrigin = "textbook_supplement").`,
                ].join('\n');
        } else {
          strategyInstruction =
            attempt === 0
              ? `CHIẾN LƯỢC PHẠM VI (${scopeHumanLabel}): Tạo CHÍNH XÁC ${missingBase} câu cốt lõi bám sát toàn bộ nội dung tài liệu tải lên (gán questionOrigin = "upload"). Nếu vẫn cần mở rộng thêm để tránh trùng ý, bổ sung từ ${refLabel} và gán questionOrigin = "textbook_supplement".`
              : `LƯỢT SINH BÙ ${attempt}: Tạo thêm CHÍNH XÁC ${missingBase} câu cơ bản mới hoàn toàn (không trùng câu đã có) từ các ý chưa khai thác trong tài liệu (questionOrigin = "upload") hoặc bổ sung từ ${refLabel} (questionOrigin = "textbook_supplement").`;
        }

        const existingExclusionBlock =
          existingQuestions.length > 0
            ? [
                'DANH SÁCH CÂU HỎI ĐÃ TẠO (TUYỆT ĐỐI KHÔNG ĐƯỢC LẶP LẠI CÂU HỎI HOẶC Ý HỎI TƯƠNG TỰ):',
                ...existingQuestions.map(
                  (q, i) => `${i + 1}. [${q.concept}] ${q.questionText.slice(0, 140)}`
                ),
              ].join('\n')
            : '';

        const countRequirementLines: string[] = [];
        if (missingBase > 0) {
          countRequirementLines.push(
            `- PHẢI TẠO ĐÚNG ${missingBase} câu hỏi cơ bản (isExternalAdvanced = false).`
          );
        }
        if (missingAdvanced > 0) {
          countRequirementLines.push(
            `- PHẢI TẠO ĐÚNG ${missingAdvanced} câu hỏi NÂNG CAO BÊN NGOÀI (isExternalAdvanced = true, questionOrigin = "external_advanced", mức Vận dụng / Vận dụng cao, mở rộng tư duy giải quyết vấn đề ở cùng chủ đề môn học).`
          );
        }

        const prompt = [
          `Soạn CHÍNH XÁC ${batchTotal} câu hỏi trắc nghiệm ABCD cho học sinh lớp ${grade}, môn ${SUBJECT_LABELS[subject]}.`,
          `QUY TẮC SỐ LƯỢNG BẮT BUỘC: Mảng "questions" trong JSON PHẢI CÓ ĐÚNG ${batchTotal} PHẦN TỬ, TUYỆT ĐỐI KHÔNG ÍT HƠN.`,
          ...countRequirementLines,
          missingBase > 0 ? strategyInstruction : '',
          `Độ khó: ${diffLabel}. Nguồn tham chiếu: ${refLabel}.`,
          'YÊU CẦU CHẤT LƯỢNG & CÔ ĐỌNG:',
          '- Mỗi câu CHỈ CÓ DUY NHẤT 1 đáp án đúng (A, B, C hoặc D); 4 phương án A/B/C/D khác nhau rõ ràng và có độ dài tương đồng hợp lý.',
          '- Phân loại đúng cognitiveLevel (nhan_biet | thong_hieu | van_dung | van_dung_cao), knowledgeUnitType và questionOrigin.',
          '- Giữ văn phong ngắn gọn để bảo đảm đủ số câu: explanation tối đa 1-2 câu; mỗi distractorA/B/C/D tối đa 1 câu thật ngắn (<= 14 từ).',
          existingExclusionBlock,
          '',
          'NGỮ CẢNH KIẾN THỨC:',
          effectiveContext,
        ]
          .filter(Boolean)
          .join('\n');

        // Generous output token budget so reasoning models (Mistral Small, GPT-OSS 120B, Qwen 3.8) never truncate mid-array
        const quizMaxTokens = Math.min(8192, Math.max(3072, batchTotal * 520));

        const { data: parsed, modelId: batchModelUsed } = await runTaskWithRouter<{
          questions: RawQuizItem[];
        }>({
          taskType: 'quiz_generation',
          config,
          idToken,
          allowGroqRescue: true,
          bypassCache: attempt > 0,
          cacheInput:
            attempt === 0
              ? {
                  rev: 'v4_scope_adaptive_topup',
                  subject,
                  grade,
                  baseTargetCount,
                  safeAdvancedExtra,
                  difficulty,
                  scope,
                  chapterFilter: chapterFilter || '',
                  ctx: effectiveContext.slice(0, 8000),
                }
              : undefined,
          runWithModel: async (modelId) =>
            generateJsonWithProvider<{ questions: RawQuizItem[] }>({
              modelId,
              prompt,
              thinkingTier: 'minimal',
              maxOutputTokens: quizMaxTokens,
              tokensOut,
              fallbackJson: '{"questions":[]}',
              strictJsonParser: (rawText) => {
                const salvaged = salvageQuestionsFromTruncatedJson<RawQuizItem>(rawText);
                if (salvaged.length === 0) {
                  throw new Error(
                    'QUIZ_EMPTY_RESPONSE: Mô hình AI trả về danh sách câu hỏi rỗng hoặc JSON bị lỗi.'
                  );
                }
                return { questions: salvaged };
              },
              groqSchemaHint: quizGroqSchemaHint,
            }),
        });

        const now = new Date().toISOString();
        const defaultBaseOrigin: QuizQuestionOrigin =
          strategy.mode === 'mistake_variation'
            ? attempt >= 2
              ? 'textbook_supplement'
              : 'mistake_variation'
            : strategy.mode === 'upload_sufficient' && attempt === 0
            ? 'upload'
            : 'textbook_supplement';

        const mapped: QuizQuestion[] = (parsed.questions || [])
          .slice(0, batchTotal + 4)
          .map((q, idx) => {
            const ans =
              q.correctAnswer === 'A' ||
              q.correctAnswer === 'B' ||
              q.correctAnswer === 'C' ||
              q.correctAnswer === 'D'
                ? q.correctAnswer
                : 'A';
            const fallbackDiff: QuizQuestion['difficulty'] =
              difficulty === 'basic' || difficulty === 'advanced' ? difficulty : 'medium';
            const cog = normalizeCognitiveLevel(q.cognitiveLevel, fallbackDiff);
            const diff: QuizQuestion['difficulty'] =
              cog === 'nhan_biet' ? 'basic' : cog === 'thong_hieu' ? 'medium' : 'advanced';

            const isAdv =
              missingBase === 0 && missingAdvanced > 0
                ? true
                : missingAdvanced === 0
                ? false
                : Boolean(q.isExternalAdvanced || q.questionOrigin === 'external_advanced');

            const fallbackOriginForIdx: QuizQuestionOrigin = isAdv
              ? 'external_advanced'
              : attempt === 0 &&
                strategy.mode === 'upload_plus_textbook' &&
                idx < strategy.expectedUploadSlots
              ? 'upload'
              : defaultBaseOrigin;

            const origin = normalizeQuizQuestionOrigin(
              q.questionOrigin,
              isAdv,
              fallbackOriginForIdx
            );

            return {
              questionId: `q_${Date.now()}_${attempt}_${idx + 1}_${crypto.randomBytes(2).toString('hex')}`,
              questionText: q.questionText,
              optionA: q.optionA,
              optionB: q.optionB,
              optionC: q.optionC,
              optionD: q.optionD,
              correctAnswer: ans,
              explanation: q.explanation,
              distractorExplanations:
                q.distractorA || q.distractorB || q.distractorC || q.distractorD
                  ? {
                      A: q.distractorA,
                      B: q.distractorB,
                      C: q.distractorC,
                      D: q.distractorD,
                    }
                  : undefined,
              difficulty: diff,
              cognitiveLevel: cog,
              knowledgeUnitType: unitTypes.has(q.knowledgeUnitType as KnowledgeUnitType)
                ? (q.knowledgeUnitType as KnowledgeUnitType)
                : 'concept',
              subject,
              grade,
              chapter: q.chapter || chapterFilter || 'Tổng hợp',
              concept: q.concept || 'Khái niệm trọng tâm',
              sourceReference: q.sourceReference || textbookTitle || 'Tài liệu tham chiếu',
              sourceType:
                origin === 'external_advanced' ? 'external_extension' : 'textbook_reference',
              questionOrigin: origin,
              modelId: batchModelUsed,
              isExternalAdvanced: isAdv,
              createdAt: now,
            };
          });

        return {
          questions: mapped,
          modelUsed: batchModelUsed,
        };
      },
    });

    const finalQuestions = runResult.questions;
    const baseFinal = runResult.baseQuestions;
    const uploadCount = baseFinal.filter((q) => q.questionOrigin === 'upload').length;
    const variationCount = baseFinal.filter((q) => q.questionOrigin === 'mistake_variation').length;
    const supplementCount = baseFinal.filter((q) => q.questionOrigin === 'textbook_supplement').length;

    const noticeParts: string[] = [];
    if (strategy.mode === 'empty_scope_fallback') {
      noticeParts.push(
        `Bài phân tích không có mục nào khớp bộ lọc "${scopeHumanLabel}". Hệ thống đã tự động tổng hợp từ toàn bộ tài liệu và ${refLabel} để tạo ${baseFinal.length} câu cơ bản.`
      );
    } else if (strategy.mode === 'mistake_variation') {
      if (supplementCount > 0) {
        noticeParts.push(
          `Đã tạo ${variationCount} câu biến thể đa góc độ từ ${scopeHumanLabel} và bổ sung ${supplementCount} câu cùng chủ đề từ ${refLabel} để đủ ${baseFinal.length} câu cơ bản.`
        );
      } else if (variationCount > 0) {
        noticeParts.push(
          `Đã tạo ${variationCount} câu hỏi biến thể đa góc độ xoay quanh đúng ${scopeHumanLabel} trong bài phân tích để giúp bạn khắc phục triệt để lỗ hổng.`
        );
      }
    } else if (supplementCount > 0) {
      noticeParts.push(
        `Nội dung tải lên có ${strategy.distinctConceptCount} đơn vị kiến thức. Bộ đề gồm ${uploadCount} câu bám sát tài liệu tải lên và ${supplementCount} câu bổ sung từ ${refLabel} để đủ ${baseFinal.length} câu cơ bản.`
      );
    }

    if (finalQuestions.length < totalWanted) {
      noticeParts.push(
        `Hệ thống đã tự động sinh bù ${runResult.topUpPassesUsed} lượt nhưng chỉ thu được ${finalQuestions.length}/${totalWanted} câu hợp lệ không trùng lặp.`
      );
    }

    const supplementNotice = noticeParts.length > 0 ? noticeParts.join(' ') : undefined;

    return {
      questions: finalQuestions,
      supplementedFromTextbook: supplementCount > 0 || Boolean(supplementNotice),
      supplementNotice,
      modelUsed: runResult.modelUsed || 'unknown',
    };
  }
}

export class ExamPipelineService {
  static async generateBlueprint(params: {
    title?: string;
    grade: GradeLevel;
    subject: SubjectId;
    textbookSeries: string;
    examType: ExamType;
    academicYear: string;
    semester: '1' | '2';
    chapters: string[];
    durationMinutes: number;
    totalScore: number;
    referenceChunks: ReferenceChunk[];
    actorUid: string;
    tokensOut: TokenTelemetry;
    config?: SystemAiConfig;
    idToken?: string;
  }): Promise<ExamBlueprint> {
    const {
      title,
      grade,
      subject,
      textbookSeries,
      examType,
      academicYear,
      semester,
      chapters,
      durationMinutes,
      totalScore,
      referenceChunks,
      actorUid,
      tokensOut,
      config,
      idToken,
    } = params;

    const relevant = referenceChunks
      .filter((c) => c.grade === grade && c.subject === subject)
      .slice(0, 10)
      .map((c) => `${c.chapter} - ${c.lesson}: ${c.content.slice(0, 220)}`)
      .join('\n');

    const prompt = [
      `Lập MA TRẬN ĐỀ KIỂM TRA chuẩn GDPT 2018 cho môn ${SUBJECT_LABELS[subject]} lớp ${grade} (${textbookSeries}).`,
      `Loại kỳ thi: ${EXAM_TYPE_LABELS[examType]} | Học kỳ ${semester} | Thời gian: ${durationMinutes} phút | Tổng điểm bắt buộc: ${totalScore}.`,
      `Phạm vi chương/bài: ${chapters.length > 0 ? chapters.join(', ') : 'Toàn bộ học kỳ'}.`,
      'Yêu cầu bắt buộc:',
      '- Tạo từ 4 đến 10 dòng ma trận phân bổ rõ ràng giữa các chương, mức độ nhận thức (nhan_biet ~30%, thong_hieu ~30%, van_dung ~25%, van_dung_cao ~15%) và dạng câu hỏi (abcd, true_false, short_answer).',
      `- Tổng của (questionCount * scorePerQuestion) qua TẤT CẢ các dòng PHẢI BẰNG ĐÚNG ${totalScore}. learningOutcome viết ngắn gọn tối đa 1 câu.`,
      relevant ? `Nội dung tham chiếu có sẵn:\n${relevant}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    const { data: parsed } = await runTaskWithRouter<{
      title?: string;
      rows?: Array<{
        chapter: string;
        topic: string;
        cognitiveLevel: string;
        questionType: string;
        questionCount: number;
        scorePerQuestion: number;
        learningOutcome: string;
      }>;
    }>({
      taskType: 'quiz_blueprint',
      config,
      idToken,
      allowGroqRescue: true,
      cacheInput: {
        grade,
        subject,
        textbookSeries,
        examType,
        semester,
        chapters: [...chapters].sort().join('|'),
        durationMinutes,
        totalScore,
        relevantDigest: relevant.slice(0, 1200),
      },
      runWithModel: async (modelId) =>
        generateJsonWithProvider({
          modelId,
          prompt,
          thinkingTier: 'low',
          maxOutputTokens: 1536,
          tokensOut,
          fallbackJson: '{"title":"","rows":[]}',
          groqSchemaHint:
            '{"title":"...","rows":[{"chapter":"...","topic":"...","cognitiveLevel":"nhan_biet|thong_hieu|van_dung|van_dung_cao","questionType":"abcd|true_false|short_answer","questionCount":2,"scorePerQuestion":0.25,"learningOutcome":"..."}]}',
        }),
    });

    const validCogs = new Set<CognitiveLevel>(['nhan_biet', 'thong_hieu', 'van_dung', 'van_dung_cao']);
    const validTypes = new Set<ExamQuestionType>(['abcd', 'true_false', 'short_answer']);

    const rows: ExamBlueprintRow[] = (parsed.rows || []).map((r, idx) => ({
      rowId: `row_${idx + 1}`,
      chapter: r.chapter || chapters[0] || 'Chương 1',
      topic: r.topic || 'Chủ đề trọng tâm',
      cognitiveLevel: validCogs.has(r.cognitiveLevel as CognitiveLevel)
        ? (r.cognitiveLevel as CognitiveLevel)
        : 'thong_hieu',
      questionType: validTypes.has(r.questionType as ExamQuestionType)
        ? (r.questionType as ExamQuestionType)
        : 'abcd',
      questionCount: Math.max(1, Math.round(Number(r.questionCount) || 2)),
      scorePerQuestion: Math.max(0.25, Number(r.scorePerQuestion) || 0.25),
      learningOutcome: r.learningOutcome || 'Nắm vững kiến thức và vận dụng giải bài tập.',
    }));

    // Auto-normalize final row's scorePerQuestion if minor rounding variance occurred
    const bpCheck = validateExamBlueprint({
      blueprintId: 'tmp',
      title: title || parsed.title || `${EXAM_TYPE_LABELS[examType]} - ${SUBJECT_LABELS[subject]} ${grade}`,
      grade,
      subject,
      textbookSeries,
      examType,
      academicYear,
      semester,
      chapters,
      durationMinutes,
      totalScore,
      cognitiveDistribution: { nhan_biet: 30, thong_hieu: 30, van_dung: 25, van_dung_cao: 15 },
      rows,
      status: 'draft',
      createdBy: actorUid,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    if (!bpCheck.valid && rows.length > 0) {
      // Scale row scores proportionally so sum equals totalScore strictly
      const currentSum = rows.reduce((s, r) => s + r.questionCount * r.scorePerQuestion, 0);
      if (currentSum > 0) {
        const factor = totalScore / currentSum;
        for (const r of rows) {
          r.scorePerQuestion = Math.round(r.scorePerQuestion * factor * 100) / 100;
        }
        const afterSum = rows.reduce((s, r) => s + r.questionCount * r.scorePerQuestion, 0);
        const diff = Math.round((totalScore - afterSum) * 100) / 100;
        if (Math.abs(diff) > 0.001) {
          const last = rows[rows.length - 1];
          last.scorePerQuestion = Math.round((last.scorePerQuestion + diff / last.questionCount) * 100) / 100;
        }
      }
    }

    const now = new Date().toISOString();
    return {
      blueprintId: `bp_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      title:
        title?.trim() ||
        parsed.title ||
        `${EXAM_TYPE_LABELS[examType]} - ${SUBJECT_LABELS[subject]} ${grade}`,
      grade,
      subject,
      textbookSeries,
      examType,
      academicYear,
      semester,
      chapters,
      durationMinutes,
      totalScore,
      cognitiveDistribution: { nhan_biet: 30, thong_hieu: 30, van_dung: 25, van_dung_cao: 15 },
      rows,
      status: 'draft',
      createdBy: actorUid,
      createdAt: now,
      updatedAt: now,
    };
  }

  static async generateExamFromBlueprint(params: {
    blueprint: ExamBlueprint;
    referenceChunks: ReferenceChunk[];
    tokensOut: TokenTelemetry;
    config?: SystemAiConfig;
    idToken?: string;
  }): Promise<{ questions: ExamQuestion[]; validationStatus: 'passed' | 'repaired' | 'needs_review' }> {
    const { blueprint, referenceChunks, tokensOut, config, idToken } = params;

    const contextChunks = referenceChunks
      .filter((c) => c.grade === blueprint.grade && c.subject === blueprint.subject)
      .slice(0, 12)
      .map((c) => `[${c.chapter} | Tr.${c.pageNumber}] ${c.content.slice(0, 350)}`)
      .join('\n');

    const rowsSpec = blueprint.rows
      .map(
        (r, idx) =>
          `${idx + 1}. Chương "${r.chapter}" | Chủ đề "${r.topic}" | Mức: ${r.cognitiveLevel} | Dạng: ${r.questionType} | Số câu: ${r.questionCount} | Điểm/câu: ${r.scorePerQuestion} | Yêu cầu cần đạt: ${r.learningOutcome}`
      )
      .join('\n');

    const prompt = [
      `Soạn ĐỀ KIỂM TRA hoàn chỉnh tuân thủ CHÍNH XÁC Ma trận đề sau (${SUBJECT_LABELS[blueprint.subject]} lớp ${blueprint.grade}, bộ sách ${blueprint.textbookSeries}):`,
      rowsSpec,
      '',
      'QUY ĐỊNH DẠNG CÂU HỎI:',
      '- Dạng abcd: có optionA, optionB, optionC, optionD và correctAnswer ("A"|"B"|"C"|"D").',
      '- Dạng true_false: có đúng 4 ý a, b, c, d trong trueFalseStatements [{ label: "a"|"b"|"c"|"d", text, isTrue }].',
      '- Dạng short_answer: có shortAnswerAccepted (mảng các đáp án ngắn chuẩn, ví dụ ["0.5", "0,5"] hoặc từ khóa ngắn).',
      '- Mỗi câu ghi rõ explanation (ngắn gọn tối đa 2 câu) và sourceReference.',
      contextChunks ? `\nNGỮ LIỆU SÁCH GIÁO KHOA THAM CHIẾU:\n${contextChunks}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    type RawExamQuestion = {
      chapterId: string;
      conceptId: string;
      learningOutcome?: string;
      cognitiveLevel: string;
      questionType: string;
      scoreWeight: number;
      questionText: string;
      optionA?: string;
      optionB?: string;
      optionC?: string;
      optionD?: string;
      correctAnswer?: string;
      trueFalseStatements?: Array<{ label: string; text: string; isTrue: boolean }>;
      shortAnswerAccepted?: string[];
      explanation: string;
      sourceReference: string;
    };

    const { data: parsed } = await runTaskWithRouter<{ questions: RawExamQuestion[] }>({
      taskType: 'quiz_generation',
      config,
      idToken,
      bypassCache: true,
      allowGroqRescue: true,
      runWithModel: async (modelId) =>
        generateJsonWithProvider<{ questions: RawExamQuestion[] }>({
          modelId,
          prompt,
          thinkingTier: 'low',
          maxOutputTokens: 4096,
          tokensOut,
          fallbackJson: '{"questions":[]}',
          groqSchemaHint:
            '{"questions":[{"chapterId":"...","conceptId":"...","cognitiveLevel":"nhan_biet|thong_hieu|van_dung|van_dung_cao","questionType":"abcd|true_false|short_answer","scoreWeight":0.25,"questionText":"...","optionA":"...","optionB":"...","optionC":"...","optionD":"...","correctAnswer":"A|B|C|D","trueFalseStatements":[{"label":"a","text":"...","isTrue":true}],"shortAnswerAccepted":["..."],"explanation":"...","sourceReference":"..."}]}',
        }),
    });

    const validCogs = new Set<CognitiveLevel>(['nhan_biet', 'thong_hieu', 'van_dung', 'van_dung_cao']);
    const validTypes = new Set<ExamQuestionType>(['abcd', 'true_false', 'short_answer']);
    let needsReview = false;

    const questions: ExamQuestion[] = (parsed.questions || []).map((q, idx) => {
      const qType: ExamQuestionType = validTypes.has(q.questionType as ExamQuestionType)
        ? (q.questionType as ExamQuestionType)
        : 'abcd';
      const cog: CognitiveLevel = validCogs.has(q.cognitiveLevel as CognitiveLevel)
        ? (q.cognitiveLevel as CognitiveLevel)
        : 'thong_hieu';

      const ans =
        q.correctAnswer === 'A' || q.correctAnswer === 'B' || q.correctAnswer === 'C' || q.correctAnswer === 'D'
          ? q.correctAnswer
          : 'A';

      const stmts =
        qType === 'true_false'
          ? (['a', 'b', 'c', 'd'] as const).map((lbl, sIdx) => ({
              label: lbl,
              text: q.trueFalseStatements?.[sIdx]?.text || `Phát biểu ${lbl}`,
              isTrue: Boolean(q.trueFalseStatements?.[sIdx]?.isTrue),
            }))
          : undefined;

      const accepted =
        qType === 'short_answer'
          ? (q.shortAnswerAccepted && q.shortAnswerAccepted.length > 0
              ? q.shortAnswerAccepted
              : ['0'])
          : undefined;

      if (!q.questionText || !q.explanation) {
        needsReview = true;
      }

      return {
        questionId: `eq_${Date.now()}_${idx + 1}_${crypto.randomBytes(2).toString('hex')}`,
        orderIndex: idx + 1,
        chapterId: q.chapterId || blueprint.chapters[0] || 'Tổng hợp',
        conceptId: q.conceptId || 'Kiến thức trọng tâm',
        learningOutcome: q.learningOutcome || 'Đạt chuẩn kiến thức kỹ năng',
        cognitiveLevel: cog,
        questionType: qType,
        scoreWeight: Math.max(0.1, Number(q.scoreWeight) || 0.25),
        questionText: q.questionText,
        optionA: qType === 'abcd' ? q.optionA || 'Phương án A' : undefined,
        optionB: qType === 'abcd' ? q.optionB || 'Phương án B' : undefined,
        optionC: qType === 'abcd' ? q.optionC || 'Phương án C' : undefined,
        optionD: qType === 'abcd' ? q.optionD || 'Phương án D' : undefined,
        correctAnswer: qType === 'abcd' ? ans : undefined,
        trueFalseStatements: stmts,
        shortAnswerAccepted: accepted,
        explanation: q.explanation,
        sourceReference: q.sourceReference || blueprint.textbookSeries,
        sourceType: 'textbook_reference',
        validationStatus: q.questionText && q.explanation ? 'passed' : 'needs_review',
      };
    });

    return {
      questions,
      validationStatus: needsReview ? 'needs_review' : 'passed',
    };
  }

  static async rewriteSingleQuestion(params: {
    question: ExamQuestion;
    instruction: string;
    grade: GradeLevel;
    subject: SubjectId;
    textbookSeries: string;
    tokensOut: TokenTelemetry;
    config?: SystemAiConfig;
    idToken?: string;
  }): Promise<ExamQuestion> {
    const { question, instruction, grade, subject, textbookSeries, tokensOut, config, idToken } = params;

    const prompt = [
      `Viết lại câu hỏi kiểm tra môn ${SUBJECT_LABELS[subject]} lớp ${grade} (${textbookSeries}) theo yêu cầu của Admin.`,
      `Yêu cầu chỉnh sửa: ${instruction || 'Làm câu hỏi rõ ràng, chính xác, phương án nhiễu hợp lý hơn.'}`,
      `Giữ nguyên questionType="${question.questionType}", scoreWeight=${question.scoreWeight}, cognitiveLevel="${question.cognitiveLevel}". explanation ngắn gọn tối đa 2 câu.`,
      `Câu hỏi hiện tại:\n${JSON.stringify(question)}`,
    ].join('\n\n');

    const { data: updated } = await runTaskWithRouter<Partial<ExamQuestion>>({
      taskType: 'quiz_validation',
      config,
      idToken,
      bypassCache: true,
      allowGroqRescue: true,
      runWithModel: async (modelId) =>
        generateJsonWithProvider<Partial<ExamQuestion>>({
          modelId,
          prompt,
          thinkingTier: 'minimal',
          maxOutputTokens: 768,
          tokensOut,
          fallbackJson: '{}',
          groqSchemaHint:
            '{"questionText":"...","optionA":"...","optionB":"...","optionC":"...","optionD":"...","correctAnswer":"A|B|C|D","shortAnswerAccepted":["..."],"explanation":"...","sourceReference":"..."}',
        }),
    });

    return {
      ...question,
      questionText: updated.questionText || question.questionText,
      optionA: question.questionType === 'abcd' ? updated.optionA || question.optionA : undefined,
      optionB: question.questionType === 'abcd' ? updated.optionB || question.optionB : undefined,
      optionC: question.questionType === 'abcd' ? updated.optionC || question.optionC : undefined,
      optionD: question.questionType === 'abcd' ? updated.optionD || question.optionD : undefined,
      correctAnswer:
        question.questionType === 'abcd' &&
        (updated.correctAnswer === 'A' ||
          updated.correctAnswer === 'B' ||
          updated.correctAnswer === 'C' ||
          updated.correctAnswer === 'D')
          ? updated.correctAnswer
          : question.correctAnswer,
      shortAnswerAccepted:
        question.questionType === 'short_answer' && updated.shortAnswerAccepted?.length
          ? updated.shortAnswerAccepted
          : question.shortAnswerAccepted,
      explanation: updated.explanation || question.explanation,
      sourceReference: updated.sourceReference || question.sourceReference,
      validationStatus: 'repaired',
    };
  }

  static async extractQuestionsFromSampleExam(params: {
    files: Array<{ buffer: Buffer; mimeType: string; originalName: string }>;
    title?: string;
    grade: GradeLevel;
    subject: SubjectId;
    textbookSeries: string;
    examType: ExamType;
    academicYear: string;
    semester: '1' | '2';
    durationMinutes: number;
    totalScore: number;
    includeTrueFalse?: boolean;
    actorUid: string;
    tokensOut: TokenTelemetry;
    config?: SystemAiConfig;
    idToken?: string;
  }): Promise<{
    exam: ExamDocument;
    summary: {
      totalExtracted: number;
      abcdCount: number;
      shortAnswerCount: number;
      trueFalseCount: number;
      inferredAnswersCount: number;
    };
  }> {
    const {
      files,
      title,
      grade,
      subject,
      textbookSeries,
      examType,
      academicYear,
      semester,
      durationMinutes,
      totalScore,
      includeTrueFalse = false,
      actorUid,
      tokensOut,
      config,
      idToken,
    } = params;

    const first = files[0];
    if (!first) {
      throw new Error('Vui lòng chọn ít nhất một tệp đề mẫu.');
    }

    const extractedChunks: string[] = [];
    const inlineParts: Array<{ inlineData: { mimeType: string; data: string } }> = [];

    for (const f of files) {
      if (f.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        const mammothMod = await import('mammoth');
        const mammothApi = mammothMod.default || mammothMod;
        const result = await mammothApi.extractRawText({ buffer: f.buffer });
        const txt = (result.value || '').trim();
        if (txt) {
          extractedChunks.push(`=== TỆP DOCX: ${f.originalName} ===\n${txt}`);
        }
      } else if (f.mimeType === 'application/pdf') {
        let pdfExtracted = '';
        try {
          const { extractPdfPagesFromBuffer } = await import('./referenceIngestService.js');
          const textPages = await extractPdfPagesFromBuffer(f.buffer);
          const joined = textPages.map((p) => `--- TRANG ${p.pageNumber} ---\n${p.text}`).join('\n\n');
          if (joined.replace(/\s+/g, '').length >= 80) {
            pdfExtracted = joined;
          }
        } catch {
          // Fall back to multimodal PDF below
        }
        if (pdfExtracted) {
          extractedChunks.push(`=== TỆP PDF: ${f.originalName} ===\n${pdfExtracted}`);
        } else {
          inlineParts.push({
            inlineData: {
              mimeType: 'application/pdf',
              data: f.buffer.toString('base64'),
            },
          });
        }
      } else {
        inlineParts.push({
          inlineData: {
            mimeType: f.mimeType,
            data: f.buffer.toString('base64'),
          },
        });
      }
    }

    const extractedTextContent = extractedChunks.join('\n\n');
    if (!extractedTextContent && inlineParts.length === 0) {
      throw new Error('Không đọc được nội dung văn bản hoặc hình ảnh từ tệp đề mẫu đã chọn.');
    }

    const allowedFormatsDesc = includeTrueFalse
      ? 'Trắc nghiệm 4 lựa chọn (abcd), Trắc nghiệm Đúng/Sai 4 ý (true_false) và Trả lời ngắn (short_answer). BỎ QUA phần tự luận dài.'
      : 'CHỈ 2 dạng: Trắc nghiệm 4 lựa chọn ABCD (questionType = "abcd") và Trả lời ngắn / điền đáp số (questionType = "short_answer"). BỎ QUA phần Đúng/Sai và Tự luận dài.';

    const promptText = [
      `NHIỆM VỤ: Đọc file đề kiểm tra mẫu môn ${SUBJECT_LABELS[subject]} lớp ${grade} và SAO CHÉP NGUYÊN VĂN các câu hỏi theo đúng đề gốc.`,
      `Phạm vi trích xuất: ${allowedFormatsDesc}`,
      'QUY TẮC SAO CHÉP NGHIÊM NGẶT:',
      '1. Giữ nguyên văn nội dung câu hỏi (questionText), công thức, số liệu từ đề mẫu — TUYỆT ĐỐI KHÔNG tự chế hay bịa thêm câu mới.',
      '2. Với câu "abcd": chép nguyên văn 4 phương án vào optionA, optionB, optionC, optionD (loại bỏ tiền tố "A.", "B.", "C.", "D." ở đầu nếu có để tránh lặp khi hiển thị).',
      '3. Với câu "short_answer": chép nguyên văn đề bài vào questionText và điền đáp án ngắn vào shortAnswerAccepted (nếu là số thập phân hãy ghi cả dạng dấu chấm và dấu phẩy, ví dụ ["0.5", "0,5"]).',
      includeTrueFalse
        ? '4. Với câu "true_false": chép 4 mệnh đề a, b, c, d vào trueFalseStatements [{ label, text, isTrue }].'
        : '',
      '5. Đáp án: Nếu file đề có bảng đáp án/đánh dấu sẵn đáp án đúng thì chép chính xác và đặt answerFromSource = true. Nếu file chưa kèm đáp án thì giải nhanh chính xác để điền correctAnswer / shortAnswerAccepted và đặt answerFromSource = false.',
      '6. Nếu đề gốc có ghi điểm từng câu (ví dụ 0.25đ, 0.5đ), điền vào scoreWeight; nếu không ghi thì đặt 0.25.',
      '7. Tối đa 60 câu hỏi. Giữ đúng thứ tự từ đầu đến cuối đề. explanation viết ngắn gọn tối đa 1-2 câu.',
      extractedTextContent
        ? `\n=== NỘI DUNG FILE ĐỀ MẪU ===\n${extractedTextContent.slice(0, 48000)}`
        : '',
    ]
      .filter(Boolean)
      .join('\n');

    type RawCopiedQuestion = {
      questionType: string;
      questionText: string;
      optionA?: string;
      optionB?: string;
      optionC?: string;
      optionD?: string;
      correctAnswer?: string;
      trueFalseStatements?: Array<{ label: string; text: string; isTrue: boolean }>;
      shortAnswerAccepted?: string[];
      scoreWeight?: number;
      answerFromSource?: boolean;
      explanation?: string;
      chapter?: string;
      cognitiveLevel?: string;
    };

    const { data: parsed } = await runTaskWithRouter<{
      detectedTitle?: string;
      questions: RawCopiedQuestion[];
    }>({
      taskType: 'curriculum_extraction',
      config,
      idToken,
      bypassCache: true,
      allowGroqRescue: true,
      runWithModel: async (modelId) => {
        const hasPdfBinary = inlineParts.some((p) => p.inlineData.mimeType === 'application/pdf');
        if (hasPdfBinary) {
          throw new Error(
            'Tệp đề mẫu PDF này là bản scan ảnh (không chứa lớp văn bản nhúng). Vui lòng chụp hoặc xuất từng trang sang ảnh JPG/PNG/WEBP (hoặc tải tệp PDF/DOCX có văn bản chọn được) để hệ thống trích xuất câu hỏi chính xác.'
          );
        }

        const imageParts = inlineParts
          .filter((p) => p.inlineData.mimeType.startsWith('image/'))
          .map((p) => ({ mimeType: p.inlineData.mimeType, base64: p.inlineData.data }));

        const sampleSchemaHint =
          '{"detectedTitle":"...","questions":[{"questionType":"abcd|short_answer|true_false","questionText":"...","optionA":"...","optionB":"...","optionC":"...","optionD":"...","correctAnswer":"A|B|C|D","shortAnswerAccepted":["..."],"scoreWeight":0.25,"answerFromSource":true,"explanation":"...","chapter":"...","cognitiveLevel":"nhan_biet|thong_hieu|van_dung|van_dung_cao"}]}';

        if (isGroqModelId(modelId)) {
          const resp = await callWithTimeout((signal) =>
            callGroqChatCompletion({
              modelId: imageParts.length > 0 ? GROQ_SCAN_VISION_MODEL : modelId,
              prompt: promptText,
              images: imageParts.length > 0 ? imageParts : undefined,
              jsonMode: true,
              jsonSchemaHint: sampleSchemaHint,
              maxOutputTokens: 6144,
              signal,
            })
          );
          accumulateRawTokens(tokensOut, resp);
          return safeParseModelJson<{
            detectedTitle?: string;
            questions: RawCopiedQuestion[];
          }>(resp.text || '', '{"questions":[]}');
        }

        if (isCloudflareModelId(modelId)) {
          const resp = await callWithTimeout((signal) =>
            callCloudflareChatCompletion({
              modelId: imageParts.length > 0 ? ADAPTIVE_CF_VISION_MODEL : modelId,
              prompt: promptText,
              images: imageParts.length > 0 ? imageParts : undefined,
              jsonMode: true,
              jsonSchemaHint: sampleSchemaHint,
              maxOutputTokens: 6144,
              signal,
            })
          );
          accumulateRawTokens(tokensOut, resp);
          return safeParseModelJson<{
            detectedTitle?: string;
            questions: RawCopiedQuestion[];
          }>(resp.text || '', '{"questions":[]}');
        }

        const resp = await callWithTimeout((signal) =>
          callMistralChatCompletion({
            modelId: imageParts.length > 0 ? MISTRAL_VISION_MODEL : isMistralModelId(modelId) ? modelId : MISTRAL_PRIMARY_MODEL,
            prompt: promptText,
            images: imageParts.length > 0 ? imageParts : undefined,
            jsonMode: true,
            jsonSchemaHint: sampleSchemaHint,
            maxOutputTokens: 6144,
            signal,
          })
        );
        accumulateRawTokens(tokensOut, resp);
        return safeParseModelJson<{
          detectedTitle?: string;
          questions: RawCopiedQuestion[];
        }>(resp.text || '', '{"questions":[]}');
      },
    });

    const allowedTypes = new Set<ExamQuestionType>(
      includeTrueFalse ? ['abcd', 'short_answer', 'true_false'] : ['abcd', 'short_answer']
    );
    const validCogs = new Set<CognitiveLevel>(['nhan_biet', 'thong_hieu', 'van_dung', 'van_dung_cao']);
    const cleanOptionPrefix = (raw: string | undefined, fallback: string) =>
      (raw || fallback).trim().replace(/^[A-Da-d][.):\-]\s*/, '').trim() || fallback;

    let abcdCount = 0;
    let shortAnswerCount = 0;
    let trueFalseCount = 0;
    let inferredAnswersCount = 0;
    let hasExplicitWeights = false;

    const rawMapped: ExamQuestion[] = [];
    for (const q of parsed.questions || []) {
      if (rawMapped.length >= 60) break;
      const qText = (q.questionText || '').trim();
      if (!qText) continue;

      const qType: ExamQuestionType = allowedTypes.has(q.questionType as ExamQuestionType)
        ? (q.questionType as ExamQuestionType)
        : q.optionA || q.optionB
          ? 'abcd'
          : q.shortAnswerAccepted && q.shortAnswerAccepted.length > 0
            ? 'short_answer'
            : 'abcd';

      if (!allowedTypes.has(qType)) continue;

      const cog: CognitiveLevel = validCogs.has(q.cognitiveLevel as CognitiveLevel)
        ? (q.cognitiveLevel as CognitiveLevel)
        : 'thong_hieu';

      const ansLetter: 'A' | 'B' | 'C' | 'D' =
        q.correctAnswer === 'A' || q.correctAnswer === 'B' || q.correctAnswer === 'C' || q.correctAnswer === 'D'
          ? q.correctAnswer
          : 'A';

      let shortAccepted: string[] | undefined;
      if (qType === 'short_answer') {
        const baseList = (q.shortAnswerAccepted || []).map((s) => String(s).trim()).filter(Boolean);
        const expanded = new Set<string>(baseList);
        for (const item of baseList) {
          if (item.includes('.')) expanded.add(item.replace(/\./g, ','));
          if (item.includes(',')) expanded.add(item.replace(/,/g, '.'));
        }
        shortAccepted = expanded.size > 0 ? Array.from(expanded) : [''];
      }

      const stmts =
        qType === 'true_false'
          ? (['a', 'b', 'c', 'd'] as const).map((lbl, sIdx) => ({
              label: lbl,
              text: q.trueFalseStatements?.[sIdx]?.text || `Phát biểu ${lbl}`,
              isTrue: Boolean(q.trueFalseStatements?.[sIdx]?.isTrue),
            }))
          : undefined;

      const answerKnown = q.answerFromSource !== false;
      if (!answerKnown) inferredAnswersCount += 1;

      if (typeof q.scoreWeight === 'number' && q.scoreWeight > 0) {
        hasExplicitWeights = true;
      }

      if (qType === 'abcd') abcdCount += 1;
      else if (qType === 'short_answer') shortAnswerCount += 1;
      else if (qType === 'true_false') trueFalseCount += 1;

      rawMapped.push({
        questionId: `eq_${Date.now()}_${rawMapped.length + 1}_${crypto.randomBytes(2).toString('hex')}`,
        orderIndex: rawMapped.length + 1,
        chapterId: (q.chapter || 'Theo đề mẫu').slice(0, 120),
        conceptId: 'Theo đề mẫu',
        learningOutcome: 'Theo cấu trúc đề mẫu',
        cognitiveLevel: cog,
        questionType: qType,
        scoreWeight: typeof q.scoreWeight === 'number' && q.scoreWeight > 0 ? q.scoreWeight : 0.25,
        questionText: qText,
        optionA: qType === 'abcd' ? cleanOptionPrefix(q.optionA, 'Phương án A') : undefined,
        optionB: qType === 'abcd' ? cleanOptionPrefix(q.optionB, 'Phương án B') : undefined,
        optionC: qType === 'abcd' ? cleanOptionPrefix(q.optionC, 'Phương án C') : undefined,
        optionD: qType === 'abcd' ? cleanOptionPrefix(q.optionD, 'Phương án D') : undefined,
        correctAnswer: qType === 'abcd' ? ansLetter : undefined,
        trueFalseStatements: stmts,
        shortAnswerAccepted: shortAccepted,
        explanation:
          (q.explanation || '').trim() ||
          (answerKnown ? 'Trích xuất từ đề mẫu.' : 'Đáp án do AI giải từ đề mẫu — Admin vui lòng rà soát lại.'),
        sourceReference: `Đề mẫu: ${first.originalName}`,
        sourceType: 'public_exam_reference',
        validationStatus: answerKnown ? 'passed' : 'needs_review',
      });
    }

    if (rawMapped.length === 0) {
      throw new Error(
        'Không tìm thấy câu hỏi Trắc nghiệm ABCD hoặc Trả lời ngắn nào trong tệp đề mẫu đã tải lên.'
      );
    }

    const sumExplicit = rawMapped.reduce((s, q) => s + q.scoreWeight, 0);
    const shouldRedistribute = !hasExplicitWeights || Math.abs(sumExplicit - totalScore) > 0.25;
    const questions = shouldRedistribute
      ? distributeExamQuestionScores(rawMapped, totalScore)
      : rawMapped;

    const now = new Date().toISOString();
    const fallbackTitle =
      first.originalName.replace(/\.[^.]+$/, '') ||
      `${EXAM_TYPE_LABELS[examType]} - ${SUBJECT_LABELS[subject]} ${grade}`;

    const exam: ExamDocument = {
      examId: `exam_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      blueprintId: 'imported_sample_exam',
      title: (title?.trim() || parsed.detectedTitle?.trim() || fallbackTitle).slice(0, 190),
      description: `Trích xuất nguyên văn từ đề mẫu "${first.originalName}" (${abcdCount} câu ABCD, ${shortAnswerCount} câu Trả lời ngắn${trueFalseCount > 0 ? `, ${trueFalseCount} câu Đúng/Sai` : ''}).`,
      grade,
      subject,
      textbookSeries,
      examType,
      academicYear,
      semester,
      chapters: [],
      durationMinutes,
      totalScore,
      allowRetake: true,
      published: false,
      validationStatus: inferredAnswersCount > 0 ? 'needs_review' : 'passed',
      questions,
      createdBy: actorUid,
      createdAt: now,
      updatedAt: now,
    };

    return {
      exam,
      summary: {
        totalExtracted: questions.length,
        abcdCount,
        shortAnswerCount,
        trueFalseCount,
        inferredAnswersCount,
      },
    };
  }
}

export class FlashcardGenerationService {
  static async generateFromAnalysis(params: {
    ownerUid: string;
    subject: SubjectId;
    grade: GradeLevel;
    textbookTitle: string;
    claims: ExtractedClaim[];
    coverageItems: KnowledgeCoverageItem[];
    count?: number;
    tokensOut: TokenTelemetry;
    config?: SystemAiConfig;
    idToken?: string;
  }): Promise<FlashcardItem[]> {
    const {
      ownerUid,
      subject,
      grade,
      textbookTitle,
      claims,
      coverageItems,
      count = 6,
      tokensOut,
      config,
      idToken,
    } = params;

    const weakClaims = claims.filter(
      (c) =>
        c.evaluationStatus === 'INCORRECT' ||
        c.evaluationStatus === 'PARTIALLY_CORRECT' ||
        c.evaluationStatus === 'UNVERIFIED'
    );
    const missing = coverageItems.filter((m) => m.status === 'MISSING' || m.status === 'PARTIALLY_COVERED');

    const sourceContext = [
      ...weakClaims.map((c) => `[${c.chapter} | ${c.concept}] Sai/Thiếu: "${c.sourceText}" -> Đúng: "${c.correctKnowledge}"`),
      ...missing.map((m) => `[${m.chapter} | ${m.concept}] Bổ sung: "${m.suggestedAddition}"`),
    ];
    if (sourceContext.length === 0) {
      for (const c of claims.slice(0, 6)) {
        sourceContext.push(`[${c.chapter} | ${c.concept}] "${c.correctKnowledge || c.sourceText}"`);
      }
    }

    const safeCount = Math.min(12, Math.max(3, count));
    const prompt = [
      `Tạo ${safeCount} thẻ ghi nhớ (Flashcard) ngắn gọn, súc tích cho học sinh lớp ${grade} môn ${SUBJECT_LABELS[subject]} (${textbookTitle || 'SGK chuẩn'}).`,
      'Mặt trước (front): Tối đa 1 câu ngắn gợi nhớ hoặc tên công thức/điều kiện dễ nhầm.',
      'Mặt sau (back): Tối đa 2 câu ngắn gọn về kiến thức chuẩn, điều kiện áp dụng hoặc cách sửa lỗi sai.',
      '',
      sourceContext.join('\n').slice(0, 8000),
    ].join('\n');

    type RawCard = {
      front: string;
      back: string;
      chapter: string;
      concept: string;
      cardType: string;
      sourceReference: string;
    };

    const { data: parsed } = await runTaskWithRouter<{ cards: RawCard[] }>({
      taskType: 'flashcard_generation',
      config,
      idToken,
      allowGroqRescue: true,
      cacheInput: { subject, grade, safeCount, sourceDigest: sourceContext.join('|').slice(0, 3000) },
      runWithModel: async (modelId) =>
        generateJsonWithProvider<{ cards: RawCard[] }>({
          modelId,
          prompt,
          thinkingTier: 'minimal',
          maxOutputTokens: 1536,
          tokensOut,
          fallbackJson: '{"cards":[]}',
          groqSchemaHint:
            '{"cards":[{"front":"...","back":"...","chapter":"...","concept":"...","cardType":"concept|formula|condition|mistake_fix|example","sourceReference":"..."}]}',
        }),
    });

    const validCardTypes = new Set<FlashcardItem['cardType']>([
      'concept',
      'formula',
      'condition',
      'mistake_fix',
      'example',
    ]);
    const now = new Date().toISOString();
    return (parsed.cards || []).slice(0, safeCount).map((card, idx) => ({
      flashcardId: `fc_${Date.now()}_${idx + 1}_${crypto.randomBytes(2).toString('hex')}`,
      ownerUid,
      front: card.front,
      back: card.back,
      sourceReference: card.sourceReference || textbookTitle || 'Tài liệu tham chiếu',
      subject,
      grade,
      chapter: card.chapter || 'Tổng hợp',
      concept: card.concept || 'Khái niệm trọng tâm',
      cardType: validCardTypes.has(card.cardType as FlashcardItem['cardType'])
        ? (card.cardType as FlashcardItem['cardType'])
        : 'mistake_fix',
      masteryStatus: 'Mới tạo',
      reviewStage: 0,
      nextReviewAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      createdAt: now,
      updatedAt: now,
    }));
  }
}

export class FeedbackAnalysisService {
  static async classifyFeedback(params: {
    targetType: string;
    category: string;
    note: string;
    tokensOut: TokenTelemetry;
    config?: SystemAiConfig;
    idToken?: string;
  }): Promise<string> {
    const { data } = await runTaskWithRouter<string>({
      taskType: 'feedback_analysis',
      config: params.config,
      idToken: params.idToken,
      allowGroqRescue: true,
      cacheInput: { targetType: params.targetType, category: params.category, note: params.note },
      runWithModel: async (modelId) => {
        const text = await generatePlainTextWithProvider({
          modelId,
          prompt: `Tóm tắt ngắn gọn (1 câu tiếng Việt) nguyên nhân & hướng xử lý cho phản hồi học sinh [${params.targetType} | ${params.category}]: "${params.note}"`,
          thinkingTier: 'minimal',
          maxOutputTokens: 120,
          tokensOut: params.tokensOut,
        });
        return text || 'Cần quản trị viên kiểm tra đối chiếu lại nguồn sách giáo khoa.';
      },
    });
    return data;
  }
}

export interface SynthesizedChapterOutline {
  chapterIndex: number;
  chapterTitle: string;
  lessons: string[];
  estimatedPageStart: number;
}

export class TextbookSynthesisService {
  static async synthesizeOutline(params: {
    grade: GradeLevel;
    subject: SubjectId;
    textbookSeries: string;
    title?: string;
    customTocHint?: string;
    tokensOut: TokenTelemetry;
    config?: SystemAiConfig;
    idToken?: string;
  }): Promise<{ bookTitle: string; chapters: SynthesizedChapterOutline[] }> {
    const {
      grade,
      subject,
      textbookSeries,
      title,
      customTocHint,
      tokensOut,
      config,
      idToken,
    } = params;
    const subjectName = SUBJECT_LABELS[subject] || subject;
    const defaultBookTitle =
      title?.trim() || `SGK ${subjectName} ${grade} - ${textbookSeries}`;

    const webTocContext = '';

    const prompt = [
      `Bạn là chuyên gia chương trình Giáo dục phổ thông 2018 (GDPT 2018) của Bộ GD&ĐT Việt Nam.`,
      `Hãy lập danh sách MỤC LỤC CHUẨN gồm đầy đủ các Chương/Chủ đề và danh sách các Bài học cho cuốn sách giáo khoa:`,
      `- Môn học: ${subjectName}`,
      `- Khối lớp: Lớp ${grade}`,
      `- Bộ sách: ${textbookSeries}`,
      `- Tên sách gợi ý: ${defaultBookTitle}`,
      customTocHint?.trim()
        ? `\n[MỤC LỤC DO QUẢN TRỊ VIÊN CUNG CẤP - HÃY BÁM SÁT 100%]:\n${customTocHint.trim().slice(0, 6000)}`
        : '',
      webTocContext
        ? `\n[THÔNG TIN TRA CỨU MỤC LỤC THAM KHẢO]:\n${webTocContext}`
        : '',
      '',
      'YÊU CẦU ĐẦU RA JSON:',
      '- Trả về từ 4 đến 10 Chương/Chủ đề đúng thực tế SGK GDPT 2018.',
      '- Mỗi chương có: chapterIndex (1, 2, 3...), chapterTitle (ví dụ: "Chương 1: Cấu tạo nguyên tử"), lessons (mảng 2-6 tên bài học cụ thể, ví dụ: ["Bài 1: Thành phần của nguyên tử", "Bài 2: Nguyên tố hóa học"]), estimatedPageStart (số trang bắt đầu ước tính tăng dần, ví dụ: 6, 25, 48...).',
    ]
      .filter(Boolean)
      .join('\n');

    type RawOutlineResponse = {
      bookTitle?: string;
      chapters?: Array<{
        chapterIndex?: number;
        chapterTitle?: string;
        lessons?: string[];
        estimatedPageStart?: number;
      }>;
    };

    const { data: parsed } = await runTaskWithRouter<RawOutlineResponse>({
      taskType: 'curriculum_extraction',
      config,
      idToken,
      allowGroqRescue: true,
      cacheInput: {
        outlineTask: 'sgk_outline_v1',
        grade,
        subject,
        textbookSeries,
        customTocHint: (customTocHint || '').trim().slice(0, 1200),
      },
      runWithModel: async (modelId) =>
        generateJsonWithProvider<RawOutlineResponse>({
          modelId,
          prompt,
          thinkingTier: 'low',
          maxOutputTokens: 2048,
          tokensOut,
          fallbackJson: '{"bookTitle":"","chapters":[]}',
          groqSchemaHint:
            '{"bookTitle":"...","chapters":[{"chapterIndex":1,"chapterTitle":"Chương 1: ...","lessons":["Bài 1: ...","Bài 2: ..."],"estimatedPageStart":6}]}',
        }),
    });

    const rawChapters = Array.isArray(parsed.chapters) ? parsed.chapters : [];
    const normalizedChapters: SynthesizedChapterOutline[] = rawChapters
      .filter((ch) => ch && typeof ch.chapterTitle === 'string' && ch.chapterTitle.trim().length > 0)
      .slice(0, 15)
      .map((ch, idx) => {
        const chapterIndex = idx + 1;
        const rawTitle = ch.chapterTitle!.trim().slice(0, 180);
        const chapterTitle = /^(chương|chủ đề|chuyên đề)/i.test(rawTitle)
          ? rawTitle
          : `Chương ${chapterIndex}: ${rawTitle}`;
        const lessons = Array.isArray(ch.lessons)
          ? ch.lessons
              .map((l) => (typeof l === 'string' ? l.trim().slice(0, 160) : ''))
              .filter(Boolean)
              .slice(0, 10)
          : [`Bài ${chapterIndex}.1: Kiến thức trọng tâm ${chapterTitle}`];
        const estimatedPageStart = Math.max(
          1,
          Number(ch.estimatedPageStart) || 6 + idx * 22
        );
        return {
          chapterIndex,
          chapterTitle,
          lessons: lessons.length > 0 ? lessons : [`Bài 1: Nội dung trọng tâm`],
          estimatedPageStart,
        };
      });

    if (normalizedChapters.length === 0) {
      throw new Error('AI không tạo được mục lục chương hợp lệ. Vui lòng thử lại hoặc dán gợi ý mục lục.');
    }

    return {
      bookTitle: (parsed.bookTitle?.trim() || defaultBookTitle).slice(0, 190),
      chapters: normalizedChapters,
    };
  }

  static async synthesizeChapterChunks(params: {
    referenceId: string;
    grade: GradeLevel;
    subject: SubjectId;
    textbookSeries: string;
    chapterIndex: number;
    chapterTitle: string;
    lessons: string[];
    estimatedPageStart: number;
    tokensOut: TokenTelemetry;
    config?: SystemAiConfig;
    idToken?: string;
  }): Promise<ReferenceChunk[]> {
    const {
      referenceId,
      grade,
      subject,
      textbookSeries,
      chapterIndex,
      chapterTitle,
      lessons,
      estimatedPageStart,
      tokensOut,
      config,
      idToken,
    } = params;

    const subjectName = SUBJECT_LABELS[subject] || subject;
    const lessonListStr =
      lessons.length > 0
        ? lessons.map((l, i) => `${i + 1}. ${l}`).join('\n')
        : '1. Kiến thức cốt lõi trong chương';

    const prompt = [
      `Bạn là biên tập viên Sách giáo khoa chuẩn chương trình GDPT 2018 môn ${subjectName} Lớp ${grade} (Bộ sách: ${textbookSeries}).`,
      `Hãy biên soạn các đoạn tri thức chuẩn (ReferenceChunk) cho DUY NHẤT chương sau để phục vụ hệ thống kiểm định bài làm của học sinh:`,
      `- Chương: ${chapterTitle}`,
      `- Danh sách bài học trong chương:\n${lessonListStr}`,
      `- Trang bắt đầu ước lượng: trang ${estimatedPageStart}`,
      '',
      'YÊU CẦU NỘI DUNG TỪNG ĐOẠN TRI THỨC (CHUNKS):',
      '- Tạo từ 3 đến 8 đoạn tri thức (chunks) bao phủ toàn bộ các bài học trong chương trên.',
      '- Mỗi đoạn (content) dài khoảng 350–1200 ký tự, trình bày rõ ràng, chính xác tuyệt đối theo SGK GDPT 2018:',
      '  1. Khái niệm / Định nghĩa / Định lý chuẩn SGK.',
      '  2. Công thức / Phương trình / Quy tắc (nếu có) kèm giải thích ký hiệu & đơn vị chuẩn SI.',
      '  3. Điều kiện áp dụng / Điều kiện tồn tại (rất quan trọng để chấm lỗi thiếu điều kiện).',
      '  4. Lưu ý các nhầm lẫn hoặc lỗi sai học sinh THPT thường gặp.',
      '- learningObjectives: 2–4 mục tiêu cần đạt của bài học (dùng để chấm Độ đầy đủ - Completeness).',
      '- keywords: 4–8 thuật ngữ trọng tâm.',
      '- conceptTags: 2–4 tên khái niệm ngắn gọn.',
    ].join('\n');

    type RawChapterChunksResponse = {
      chunks?: Array<{
        lesson?: string;
        pageNumber?: number;
        sectionTitle?: string;
        content?: string;
        keywords?: string[];
        learningObjectives?: string[];
        conceptTags?: string[];
      }>;
    };

    const { data: parsed } = await runTaskWithRouter<RawChapterChunksResponse>({
      taskType: 'curriculum_extraction',
      config,
      idToken,
      allowGroqRescue: true,
      cacheInput: {
        chapterTask: 'sgk_chapter_v1',
        grade,
        subject,
        textbookSeries,
        chapterIndex,
        chapterTitle,
        lessons: lessons.join('|'),
      },
      runWithModel: async (modelId) =>
        generateJsonWithProvider<RawChapterChunksResponse>({
          modelId,
          prompt,
          thinkingTier: 'low',
          maxOutputTokens: 4096,
          tokensOut,
          fallbackJson: '{"chunks":[]}',
          groqSchemaHint:
            '{"chunks":[{"lesson":"Bài 1: ...","pageNumber":10,"sectionTitle":"1. Khái niệm & Công thức","content":"...","keywords":["..."],"learningObjectives":["..."],"conceptTags":["..."]}]}',
        }),
    });

    const rawChunks = Array.isArray(parsed.chunks) ? parsed.chunks : [];
    const safeRefId = referenceId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);

    const sanitizedChunks: ReferenceChunk[] = rawChunks
      .filter((c) => c && typeof c.content === 'string' && c.content.trim().length >= 30)
      .slice(0, 12)
      .map((c, idx) =>
        sanitizeReferenceChunkForFirestore({
          chunkId: `${safeRefId}_ch${chapterIndex}_${idx + 1}`,
          referenceId: safeRefId,
          grade,
          subject,
          textbookSeries,
          chapter: chapterTitle,
          lesson: c.lesson || lessons[idx % Math.max(1, lessons.length)] || `Bài ${chapterIndex}.${idx + 1}`,
          pageNumber: Math.max(1, Number(c.pageNumber) || estimatedPageStart + idx * 3),
          sectionTitle: c.sectionTitle || c.lesson || 'Kiến thức chuẩn SGK',
          content: c.content!,
          keywords: c.keywords,
          learningObjectives: c.learningObjectives,
          conceptTags: c.conceptTags,
          fallbackIndex: chapterIndex * 100 + idx + 1,
        })
      );

    if (sanitizedChunks.length === 0) {
      throw new Error(`Không tạo được đoạn tri thức nào cho "${chapterTitle}". Vui lòng bấm Thử lại chương này.`);
    }

    return sanitizedChunks;
  }

  static async ocrScannedTextbookPages(params: {
    files: Array<{ buffer: Buffer; mimeType: string; pageNumber: number }>;
    grade: GradeLevel;
    subject: SubjectId;
    textbookSeries: string;
    tokensOut: TokenTelemetry;
    config?: SystemAiConfig;
    idToken?: string;
  }): Promise<Array<{ pageNumber: number; text: string }>> {
    const extractedPages = await DocumentExtractionService.extractFromImageBuffers(
      params.files.map((f) => ({
        buffer: f.buffer,
        mimeType: f.mimeType,
        originalName: `page_${f.pageNumber}.jpg`,
      })),
      params.tokensOut,
      {
        config: params.config,
        idToken: params.idToken,
        pageOffset: 0,
      }
    );

    return params.files.map((f, idx) => ({
      pageNumber: f.pageNumber,
      text: (extractedPages[idx]?.rawText || '').trim(),
    }));
  }
}

