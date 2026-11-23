import crypto from 'node:crypto';
import { Type, type GenerateContentResponse } from '@google/genai';
import {
  calculateAccuracyScore,
  calculateCompletenessScore,
} from '../core/scoring.js';
import {
  distributeExamQuestionScores,
  normalizeCognitiveLevel,
  validateExamBlueprint,
  validateQuizQuestionSet,
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
import type {
  AiTaskType,
  AnalysisStrength,
  AnalysisWeakness,
  AnnotationItem,
  ClaimStatus,
  CognitiveLevel,
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
  createServerAiClient,
  executeRoutedAiTask,
  generateGeminiContentWithFallback,
  thinkingConfigForModel,
  type RoutedAiTaskResult,
} from './modelRouter.js';
import {
  callGroqChatCompletion,
  GROQ_VISION_MODEL,
  isGroqConfigured,
  isGroqModelId,
} from './groqProvider.js';
import {
  callCloudflareChatCompletion,
  CF_VISION_MODEL,
  isCloudflareConfigured,
  isCloudflareModelId,
} from './cloudflareProvider.js';
import { isGeminiConfigured } from './singleKeyService.js';

export interface TokenTelemetry {
  promptTokens: number;
  candidateTokens: number;
  totalTokens: number;
}

function accumulateTokens(
  acc: TokenTelemetry,
  resp: {
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      totalTokenCount?: number;
    };
  }
): void {
  const meta = resp.usageMetadata;
  if (!meta) return;
  acc.promptTokens += meta.promptTokenCount || 0;
  acc.candidateTokens += meta.candidatesTokenCount || 0;
  acc.totalTokens += meta.totalTokenCount || 0;
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
export const GRADING_PROMPT_VERSION = 'v4.1_semantic_inline_deterministic';
export const MAX_STUDENT_GRADING_CHARS = 48_000;
export const MAX_TEXTBOOK_GRADING_CHARS = 24_000;

export interface RawKnowledgeEvalResult {
  claims?: Array<{
    blockId?: string;
    blockIds?: string[];
    sourcePage: number;
    sourceText: string;
    errorSpan?: string;
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
  geminiSchema: Record<string, unknown>;
  groqSchemaHint: string;
  fallbackJson: string;
  strictJsonParser?: (rawText: string) => T;
  temperature?: number;
  seed?: number;
  strictModelLock?: boolean;
  tokensOut: TokenTelemetry;
}): Promise<ProviderJsonResult<T>> {
  const parseOutput = (rawText: string): T =>
    params.strictJsonParser
      ? params.strictJsonParser(rawText)
      : safeParseModelJson<T>(rawText, params.fallbackJson);

  if (isGroqModelId(params.modelId)) {
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

  const ai = await createServerAiClient();
  const response = await callWithTimeout(
    (signal) =>
      generateGeminiContentWithFallback({
        ai,
        model: params.modelId,
        contents: params.prompt,
        thinkingTier: params.thinkingTier,
        temperature: params.temperature,
        seed: params.seed,
        strictModelLock: params.strictModelLock,
        config: {
          maxOutputTokens: params.maxOutputTokens,
          abortSignal: signal,
          responseMimeType: 'application/json',
          responseSchema: params.geminiSchema,
        },
      }),
    params.timeoutMs
  );
  accumulateTokens(params.tokensOut, response);
  return {
    data: parseOutput(response.text),
    resolvedModel: response.resolvedModel || params.modelId,
    ...(response.systemFingerprint ? { systemFingerprint: response.systemFingerprint } : {}),
  };
}

async function generateJsonWithProvider<T>(params: {
  modelId: string;
  prompt: string;
  thinkingTier: 'minimal' | 'low' | 'medium';
  maxOutputTokens: number;
  timeoutMs?: number;
  geminiSchema: Record<string, unknown>;
  groqSchemaHint: string;
  fallbackJson: string;
  strictJsonParser?: (rawText: string) => T;
  temperature?: number;
  seed?: number;
  strictModelLock?: boolean;
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
  tokensOut: TokenTelemetry;
}): Promise<string> {
  if (isGroqModelId(params.modelId)) {
    const resp = await callWithTimeout(
      (signal) =>
        callGroqChatCompletion({
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

  const ai = await createServerAiClient();
  const resp = await callWithTimeout(
    (signal) =>
      generateGeminiContentWithFallback({
        ai,
        model: params.modelId,
        contents: params.prompt,
        thinkingTier: params.thinkingTier,
        config: {
          maxOutputTokens: params.maxOutputTokens,
          abortSignal: signal,
        },
      }),
    params.timeoutMs
  );
  accumulateTokens(params.tokensOut, resp);
  return (resp.text || '').trim();
}

async function runTaskWithRouter<T>(params: {
  taskType: AiTaskType;
  config?: SystemAiConfig;
  idToken?: string;
  cacheInput?: Record<string, unknown>;
  bypassCache?: boolean;
  allowGroqRescue?: boolean;
  groqRescueModelId?: string;
  strictModelLock?: boolean;
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
    strictModelLock: params.strictModelLock,
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

const OCR_FAST_TIMEOUT_MS = 30_000;

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

    const results = await Promise.all(
      files.map(async (file, idx) => {
        const pageNum = pageOffset + idx + 1;
        const contentHash = crypto.createHash('sha256').update(file.buffer).digest('hex');

        const { data: parsed } = await runTaskWithRouter<{
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
        }>({
          taskType: 'curriculum_extraction',
          config: opts?.config,
          idToken: opts?.idToken,
          allowGroqRescue: true,
          groqRescueModelId: GROQ_VISION_MODEL,
          cacheInput: { ocrKind: 'image_fast_v3', mimeType: file.mimeType, sha256: contentHash },
          runWithModel: async (modelId) => {
            const base64 = file.buffer.toString('base64');
            const ocrPrompt = [
              'Đọc OCR toàn bộ văn bản, công thức và chữ viết tay trong trang ảnh này.',
              '- Giữ nguyên 100% chính tả và công thức gốc của học sinh theo từng dòng xuống hàng (\\n), KHÔNG tự sửa lỗi kiến thức, KHÔNG bình luận.',
              '- Chấm độ rõ nét chữ viết ocrConfidence (0.0-1.0; nếu mờ/khó đọc đặt < 0.65).',
              '- Nhận diện luôn lớp ("10"|"11"|"12"), môn học THPT, tên chương và tiêu đề bài ghi.',
            ].join('\n');

            const jsonHint =
              '{"rawText":"...","ocrConfidence":0.95,"suggestedGrade":"10|11|12","suggestedSubject":"toan|vat_ly|hoa_hoc|sinh_hoc|ngu_van|lich_su|dia_ly|tieng_anh|tin_hoc|gdkt_pl|khac","suggestedChapters":["..."],"suggestedTitle":"..."}';

            const runGroqVision = async () => {
              const resp = await callWithTimeout(
                (signal) =>
                  callGroqChatCompletion({
                    modelId: isGroqModelId(modelId) ? modelId : GROQ_VISION_MODEL,
                    prompt: ocrPrompt,
                    images: [{ mimeType: file.mimeType, base64 }],
                    jsonMode: true,
                    jsonSchemaHint: jsonHint,
                    maxOutputTokens: 2048,
                    temperature: 0,
                    seed: DETERMINISTIC_GRADING_SEED,
                    signal,
                  }),
                OCR_FAST_TIMEOUT_MS
              );
              accumulateRawTokens(tokensOut, resp);
              return parseOcrResponsePayload(resp.text || '');
            };

            const runCloudflareVision = async () => {
              const resp = await callWithTimeout(
                (signal) =>
                  callCloudflareChatCompletion({
                    modelId: isCloudflareModelId(modelId) ? modelId : CF_VISION_MODEL,
                    prompt: ocrPrompt,
                    images: [{ mimeType: file.mimeType, base64 }],
                    jsonMode: true,
                    jsonSchemaHint: jsonHint,
                    maxOutputTokens: 2048,
                    temperature: 0,
                    seed: DETERMINISTIC_GRADING_SEED,
                    signal,
                  }),
                OCR_FAST_TIMEOUT_MS
              );
              accumulateRawTokens(tokensOut, resp);
              return parseOcrResponsePayload(resp.text || '');
            };

            const runGeminiVision = async () => {
              const ai = await createServerAiClient();
              const visionModel =
                isGroqModelId(modelId) || isCloudflareModelId(modelId)
                  ? 'gemini-2.5-flash'
                  : modelId;
              const response = await callWithTimeout(
                (signal) =>
                  generateGeminiContentWithFallback({
                    ai,
                    model: visionModel,
                    thinkingTier: 'minimal',
                    temperature: 0,
                    seed: DETERMINISTIC_GRADING_SEED,
                    contents: [
                      {
                        role: 'user',
                        parts: [
                          {
                            inlineData: {
                              mimeType: file.mimeType,
                              data: base64,
                            },
                          },
                          {
                            text: `${ocrPrompt}\n\nCấu trúc JSON bắt buộc:\n${jsonHint}`,
                          },
                        ],
                      },
                    ],
                    config: {
                      maxOutputTokens: 2048,
                      abortSignal: signal,
                      responseMimeType: 'application/json',
                      responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                          rawText: { type: Type.STRING },
                          ocrConfidence: { type: Type.NUMBER },
                          suggestedGrade: { type: Type.STRING, description: '10 | 11 | 12' },
                          suggestedSubject: {
                            type: Type.STRING,
                            description:
                              'toan | vat_ly | hoa_hoc | sinh_hoc | ngu_van | lich_su | dia_ly | tieng_anh | tin_hoc | gdkt_pl | khac',
                          },
                          suggestedChapters: {
                            type: Type.ARRAY,
                            items: { type: Type.STRING },
                          },
                          suggestedTitle: { type: Type.STRING },
                        },
                        required: [
                          'rawText',
                          'ocrConfidence',
                          'suggestedGrade',
                          'suggestedSubject',
                          'suggestedChapters',
                          'suggestedTitle',
                        ],
                      },
                    },
                  }),
                OCR_FAST_TIMEOUT_MS
              );
              accumulateTokens(tokensOut, response);
              return parseOcrResponsePayload(response.text || '');
            };

            const visionOrder: Array<{
              name: string;
              enabled: boolean;
              run: () => Promise<ParsedOcrPayload>;
            }> = isGroqModelId(modelId)
              ? [
                  { name: 'Groq', enabled: isGroqConfigured(), run: runGroqVision },
                  { name: 'Gemini', enabled: isGeminiConfigured(), run: runGeminiVision },
                  { name: 'Cloudflare', enabled: isCloudflareConfigured(), run: runCloudflareVision },
                ]
              : isCloudflareModelId(modelId)
                ? [
                    { name: 'Cloudflare', enabled: isCloudflareConfigured(), run: runCloudflareVision },
                    { name: 'Groq', enabled: isGroqConfigured(), run: runGroqVision },
                    { name: 'Gemini', enabled: isGeminiConfigured(), run: runGeminiVision },
                  ]
                : [
                    { name: 'Gemini', enabled: isGeminiConfigured(), run: runGeminiVision },
                    { name: 'Groq', enabled: isGroqConfigured(), run: runGroqVision },
                    { name: 'Cloudflare', enabled: isCloudflareConfigured(), run: runCloudflareVision },
                  ];

            let firstVisionError: unknown = null;
            const errorSummary: string[] = [];
            for (const provider of visionOrder) {
              if (!provider.enabled) continue;
              try {
                return await provider.run();
              } catch (err) {
                if (!firstVisionError) firstVisionError = err;
                const msg = err instanceof Error ? err.message : String(err);
                errorSummary.push(`${provider.name}: ${msg.slice(0, 320)}`);
              }
            }

            if (errorSummary.length > 1) {
              throw new Error(errorSummary.join(' | '));
            }
            if (firstVisionError) {
              throw firstVisionError;
            }
            // Fallback to primary call to emit standard unconfigured-key error code
            if (isGroqModelId(modelId)) return await runGroqVision();
            if (isCloudflareModelId(modelId)) return await runCloudflareVision();
            return await runGeminiVision();
          },
        });

        let rawText = (parsed.rawText || '').trim();
        let blocks: ExtractedTextBlock[] = [];
        let avgConf = Math.max(0.1, Math.min(1, Number(parsed.ocrConfidence) || 0.9));

        if (!rawText && Array.isArray(parsed.blocks) && parsed.blocks.length > 0) {
          rawText = parsed.blocks
            .map((b) => (b.extractedText || '').trim())
            .filter(Boolean)
            .join('\n');
        }

        blocks = buildExtractedBlocksFromRawText(rawText, pageNum, avgConf);
        if (blocks.length === 0) {
          avgConf = 0;
        }

        if (rawText && parsed.suggestedSubject) {
          const grade: GradeLevel =
            parsed.suggestedGrade === '11' || parsed.suggestedGrade === '12'
              ? parsed.suggestedGrade
              : '10';
          const subject: SubjectId =
            parsed.suggestedSubject in SUBJECT_LABELS
              ? (parsed.suggestedSubject as SubjectId)
              : 'khac';
          const textHash = crypto.createHash('sha256').update(rawText.slice(0, 1200)).digest('hex');
          const suggestionObj: InlineScopeSuggestion = {
            suggestedGrade: grade,
            suggestedSubject: subject,
            suggestedChapters: Array.isArray(parsed.suggestedChapters)
              ? parsed.suggestedChapters.slice(0, 4)
              : [],
            suggestedTitle:
              (parsed.suggestedTitle || '').trim() ||
              file.originalName.replace(/\.[^.]+$/, '') ||
              'Tài liệu ôn tập',
          };
          recentInlineScopeByTextHash.set(textHash, suggestionObj);
          lastExtractedInlineScope = {
            textPrefix: rawText.slice(0, 160),
            suggestion: suggestionObj,
          };
          if (recentInlineScopeByTextHash.size > 100) {
            const oldestKey = recentInlineScopeByTextHash.keys().next().value;
            if (oldestKey) recentInlineScopeByTextHash.delete(oldestKey);
          }
        }

        return {
          pageNumber: pageNum,
          rawText,
          blocks,
          ocrAverageConfidence: avgConf,
        } satisfies ExtractedPage;
      })
    );

    return results.sort((a, b) => a.pageNumber - b.pageNumber);
  }

  static async extractFromPdfBuffer(
    buffer: Buffer,
    tokensOut: TokenTelemetry,
    opts?: { config?: SystemAiConfig; idToken?: string }
  ): Promise<ExtractedPage[]> {
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
    } catch {
      // Fall back to Gemini multimodal PDF OCR for scanned PDFs
    }

    if (!isGeminiConfigured()) {
      throw new Error(
        'Tệp PDF này là bản scan ảnh (không chứa văn bản nhúng), trong khi hệ thống hiện chỉ cấu hình Groq/Cloudflare (chưa có Gemini API Key cho OCR tệp PDF scan). Vui lòng tải lên dưới dạng ảnh JPG/PNG hoặc thêm Gemini API Key tại tab Quản trị → API Key & Bảo mật.'
      );
    }

    const pdfHash = crypto.createHash('sha256').update(buffer).digest('hex');
    const { data: parsed } = await runTaskWithRouter<{
      pages: Array<{
        pageNumber: number;
        rawText?: string;
        ocrConfidence?: number;
        blocks?: Array<{
          extractedText: string;
          textType: string;
          confidence: number;
          formulaText?: string;
        }>;
      }>;
    }>({
      taskType: 'curriculum_extraction',
      config: opts?.config,
      idToken: opts?.idToken,
      cacheInput: { ocrKind: 'pdf_scan_v3', sha256: pdfHash },
      runWithModel: async (modelId) => {
        const ai = await createServerAiClient();
        const visionModel =
          isGroqModelId(modelId) || isCloudflareModelId(modelId)
            ? 'gemini-2.5-flash'
            : modelId;
        const base64 = buffer.toString('base64');
        const response = await callWithTimeout(
          (signal) =>
            generateGeminiContentWithFallback({
              ai,
              model: visionModel,
              thinkingTier: 'minimal',
              temperature: 0,
              seed: DETERMINISTIC_GRADING_SEED,
              contents: [
                {
                  role: 'user',
                  parts: [
                    {
                      inlineData: {
                        mimeType: 'application/pdf',
                        data: base64,
                      },
                    },
                    {
                      text: 'Trích xuất toàn bộ văn bản, công thức và chữ viết tay theo từng trang của file PDF này. Giữ nguyên chính tả và nội dung gốc theo từng dòng xuống hàng (\\n), không tự sửa lỗi kiến thức, không thêm bình luận.',
                    },
                  ],
                },
              ],
              config: {
                maxOutputTokens: 4096,
                abortSignal: signal,
                responseMimeType: 'application/json',
                responseSchema: {
                  type: Type.OBJECT,
                  properties: {
                    pages: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          pageNumber: { type: Type.INTEGER },
                          rawText: { type: Type.STRING },
                          ocrConfidence: { type: Type.NUMBER },
                        },
                        required: ['pageNumber', 'rawText', 'ocrConfidence'],
                      },
                    },
                  },
                  required: ['pages'],
                },
              },
            }),
          30_000
        );
        accumulateTokens(tokensOut, response);
        return safeParseModelJson<{
          pages: Array<{
            pageNumber: number;
            rawText?: string;
            ocrConfidence?: number;
            blocks?: Array<{
              extractedText: string;
              textType: string;
              confidence: number;
              formulaText?: string;
            }>;
          }>;
        }>(response.text || '', '{"pages":[]}');
      },
    });

    return (parsed.pages || []).map((p, idx) => {
      const pageNum = p.pageNumber || idx + 1;
      const rawText =
        (p.rawText || '').trim() ||
        (p.blocks || [])
          .map((b) => (b.extractedText || '').trim())
          .filter(Boolean)
          .join('\n');
      const avgConf = Math.max(0.1, Math.min(1, Number(p.ocrConfidence) || 0.85));
      const blocks = buildExtractedBlocksFromRawText(rawText, pageNum, avgConf);
      return {
        pageNumber: pageNum,
        rawText,
        blocks,
        ocrAverageConfidence: blocks.length > 0 ? avgConf : 0,
      };
    });
  }

  static async extractFromDocxBuffer(buffer: Buffer): Promise<ExtractedPage[]> {
    const mammothMod = await import('mammoth');
    const mammothApi = mammothMod.default || mammothMod;
    const result = await mammothApi.extractRawText({ buffer });
    const raw = (result.value || '').trim();
    if (!raw) {
      throw new Error('File DOCX không có văn bản đọc được hoặc bị hỏng.');
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

    const { data: parsed } = await runTaskWithRouter<{
      suggestedGrade?: string;
      suggestedSubject?: string;
      suggestedChapters?: string[];
      suggestedTitle?: string;
    }>({
      taskType: 'subject_classification',
      config: opts?.config,
      idToken: opts?.idToken,
      allowGroqRescue: true,
      cacheInput: { sample: sampleText.slice(0, 1500), rev: 'v3_topic_strict' },
      runWithModel: async (modelId) =>
        generateJsonWithProvider({
          modelId,
          prompt: scopePrompt,
          thinkingTier: 'minimal',
          maxOutputTokens: 384,
          timeoutMs: 15_000,
          tokensOut,
          fallbackJson: '{}',
          groqSchemaHint:
            '{"suggestedGrade":"10|11|12","suggestedSubject":"toan|vat_ly|hoa_hoc|sinh_hoc|ngu_van|lich_su|dia_ly|tieng_anh|tin_hoc|gdkt_pl|khac","suggestedChapters":["..."],"suggestedTitle":"..."}',
          geminiSchema: {
            type: Type.OBJECT,
            properties: {
              suggestedGrade: { type: Type.STRING, description: '10 | 11 | 12' },
              suggestedSubject: {
                type: Type.STRING,
                description:
                  'toan | vat_ly | hoa_hoc | sinh_hoc | ngu_van | lich_su | dia_ly | tieng_anh | tin_hoc | gdkt_pl | khac',
              },
              suggestedChapters: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              suggestedTitle: { type: Type.STRING },
            },
            required: ['suggestedGrade', 'suggestedSubject', 'suggestedChapters', 'suggestedTitle'],
          },
        }),
    });

    const grade: GradeLevel =
      parsed.suggestedGrade === '11' || parsed.suggestedGrade === '12' ? parsed.suggestedGrade : '10';
    const subject: SubjectId =
      parsed.suggestedSubject && parsed.suggestedSubject in SUBJECT_LABELS
        ? (parsed.suggestedSubject as SubjectId)
        : 'khac';

    return {
      suggestedGrade: grade,
      suggestedSubject: subject,
      suggestedChapters: (parsed.suggestedChapters || []).slice(0, 5),
      suggestedTitle: parsed.suggestedTitle || 'Tài liệu ôn tập',
    };
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
      strictModelLock = true,
      ocrConfirmed = false,
      ocrTextHash: providedOcrTextHash,
      tokensOut,
      config,
      idToken,
    } = params;

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

    let webSources: ReferenceEvidence[] = [];
    let webGroundingSummary = '';
    let usedWebGrounding = false;
    let webGroundingNotice: string | undefined;

    if (enableWebGrounding === true && isGeminiConfigured()) {
      try {
        const ai = await createServerAiClient();
        const searchPrompt = [
          `Kiểm chứng các khái niệm nâng cao hoặc nội dung chưa có đủ trong sách giáo khoa đối với môn ${subjectName} lớp ${grade}, phạm vi: ${scope || selectedChapters.join(', ') || 'Tổng hợp'}.`,
          'Ưu tiên nguồn chính thống (Bộ GD&ĐT, NXB Giáo dục, đại học). Tóm tắt thật súc tích tối đa 6 gạch đầu dòng kiến thức chuẩn kèm trích dẫn để đối chiếu với bài ghi sau:',
          fullText.slice(0, 3500),
        ].join('\n\n');

        const { data: groundResp } = await runTaskWithRouter({
          taskType: 'claim_validation',
          config,
          idToken,
          cacheInput: { webSearchTextHash: computedOcrTextHash, grade, subject, scope },
          runWithModel: async (modelId) => {
            const searchModel =
              isGroqModelId(modelId) || isCloudflareModelId(modelId)
                ? 'gemini-2.5-flash'
                : modelId;
            const resp = await callWithTimeout((signal) =>
              ai.models.generateContent({
                model: searchModel,
                contents: searchPrompt,
                config: {
                  thinkingConfig: thinkingConfigForModel(searchModel, 'minimal'),
                  maxOutputTokens: 1024,
                  abortSignal: signal,
                  tools: [{ googleSearch: {} }],
                },
              })
            );
            accumulateTokens(tokensOut, resp);
            return resp;
          },
        });

        const gChunks = groundResp.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
        const nowIso = new Date().toISOString();
        const extractedWeb: ReferenceEvidence[] = [];
        for (let i = 0; i < gChunks.length; i++) {
          const web = gChunks[i]?.web;
          if (web?.uri) {
            let domain = '';
            try {
              domain = new URL(web.uri).hostname;
            } catch {
              domain = '';
            }
            extractedWeb.push({
              evidenceId: `web_${i + 1}`,
              sourceType: 'web',
              title: web.title || domain || 'Nguồn học thuật',
              url: web.uri,
              domain,
              excerpt: (groundResp.text || '').slice(0, 420),
              accessedAt: nowIso,
            });
          }
        }
        if (extractedWeb.length > 0) {
          webSources = extractedWeb.slice(0, 8);
          webGroundingSummary = groundResp.text || '';
          usedWebGrounding = true;
        } else {
          webGroundingNotice =
            'Google Search Grounding không trả về nguồn web trích dẫn cụ thể cho nội dung này; hệ thống đánh giá dựa trên kho sách tham chiếu.';
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        webGroundingNotice = `Không thể truy vấn Google Search Grounding (${msg.slice(0, 90)}). Đánh giá dựa trên kho sách tham chiếu.`;
      }
    }

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

    const analysisPrompt = [
      'Bạn là chuyên gia kiểm định kiến thức giáo dục THPT Việt Nam của StudyCheck AI. Hãy chấm cực kỳ chính xác, chặt chẽ, nhất quán tuyệt đối giữa trạng thái, lời giải thích và đáp án sửa chuẩn.',
      `Môn học: ${subjectName} | Lớp: ${grade} | Sách tham chiếu: ${textbookTitle || 'Chuẩn chương trình GDPT 2018 & kiến thức khoa học phổ thông'} | Phạm vi: ${scope || selectedChapters.join(', ') || 'Theo đúng chủ đề chính trong tài liệu'}`,
      '',
      'NGUỒN CĂN CỨ ĐỐI CHIẾU:',
      hasIndexedTextbookChunks
        ? '- Ưu tiên đối chiếu trực tiếp các đoạn trích SGK bên dưới và gắn đúng matchedChunkId, matchedPage. Với kiến thức khoa học phổ thông không xuất hiện trực tiếp trong đoạn trích nhưng thuộc chuẩn GDPT 2018, vẫn kiểm định chuẩn xác theo khoa học phổ thông.'
        : '- Hiện chưa có đoạn trích SGK trong kho cho bài này. BẮT BUỘC dùng chuẩn kiến thức khoa học chính thống và chương trình GDPT 2018 của Bộ GD&ĐT để kiểm định dứt khoát mọi định nghĩa, định luật, công thức, tính chất và đơn vị đo. TUYỆT ĐỐI KHÔNG đánh UNVERIFIED với lỗi sai kiến thức hay sai công thức phổ thông rõ ràng (ví dụ: sai "tốc độ thay đổi" trong chuyển động thẳng đều, sai "tỉ lệ nghịch", sai phép toán "s = v + t").',
      '',
      'QUY TRÌNH KIỂM ĐỊNH 4 LỚP BẮT BUỘC:',
      'LỚP 1 — TÁCH MỆNH ĐỀ NGỮ NGHĨA & CẤM CHẤM TIÊU ĐỀ DẪN NHẬP:',
      '- Tách tài liệu học sinh thành từng đơn vị kiến thức độc lập theo đúng từng câu, từng cụm công thức (nhãn dẫn nhập + công thức) và từng cụm giải thích "Trong đó: ..." (không gộp nhiều lỗi khác nhau vào chung 1 claim).',
      '- TUYỆT ĐỐI KHÔNG tạo claim độc lập cho dòng nhãn dẫn nhập / tiêu đề ngắn kết thúc bằng dấu hai chấm (ví dụ: "Công thức tính quãng đường:", "Phương trình chuyển động thẳng đều:", "Trong đó:", "Định nghĩa:"). Hãy giữ nhãn dẫn nhập gắn liền với công thức hoặc nội dung phía sau thành 1 claim duy nhất để không bơm điểm Chính xác ảo.',
      '- Kiểm tra kỹ mọi từ khóa mang tính bản chất: "không đổi" vs "thay đổi", "tỉ lệ thuận" vs "tỉ lệ nghịch", "tăng" vs "giảm", "cùng chiều" vs "ngược chiều", "bảo toàn" vs "không bảo toàn", điều kiện áp dụng.',
      '- Đối chiếu theo nghĩa học thuật (không bắt bẻ cách diễn đạt tương đương nếu đúng bản chất).',
      '',
      'LỚP 2 — SOI TỪNG CÔNG THỨC, PHÉP TOÁN & TRÍCH CHÍNH XÁC CỤM SAI (errorSpan):',
      '- Kiểm tra từng dấu phép toán (+, -, ×, ., /, ^), dấu âm/dương, hệ số, chỉ số dưới và kiểm tra thứ nguyên vật lý/toán học (ví dụ: v [m/s] không thể cộng với t [s] trong s = v + t; công thức đúng phải là s = v.t).',
      '- Tách riêng claim cho cụm công thức và claim cho cụm chú thích "Trong đó: ..." đi kèm để phân biệt rõ: công thức đúng nhưng thiếu giải thích biến số khác với công thức viết sai.',
      '- Với MỌI claim có trạng thái INCORRECT hoặc PARTIALLY_CORRECT: BẮT BUỘC điền trường "errorSpan" trích NGUYÊN VĂN cụm từ/vế/công thức bị sai hoặc thiếu bên trong sourceText (ví dụ: "tốc độ thay đổi theo thời gian", "tỉ lệ nghịch", "s = v + t") để hệ thống gạch chân/tô đỏ chính xác vị trí lỗi, và điền trường "shortFix" (1 câu thật ngắn gọn, trực diện cách sửa nhanh, tối đa 15–20 từ).',
      '',
      'LỚP 3 — KIỂM TRA ĐỘ ĐẦY ĐỦ CHÚ THÍCH KÝ HIỆU & ĐƠN VỊ CỦA MỌI CÔNG THỨC:',
      '- Với MỌI công thức xuất hiện trong tài liệu (ví dụ s = v.t, x = x0 + v.t, F = m.a...), liệt kê TẤT CẢ các ký hiệu/biến số có mặt trong công thức đó và đối chiếu với cụm chú thích ("Trong đó: ...") ngay kế tiếp.',
      '- Nếu học sinh BỎ SÓT giải thích ý nghĩa HOẶC thiếu đơn vị đo của bất kỳ ký hiệu nào:',
      '  + Đánh giá cụm chú thích đó là PARTIALLY_CORRECT (Thiếu thông tin / Điều kiện), nêu ĐÍCH DANH ký hiệu và đơn vị còn thiếu trong explanation, ghi rõ cách bổ sung ngắn gọn trong shortFix và trọn bộ chú thích đầy đủ trong suggestedFix.',
      '  + Ghi nhận thiếu sót tương ứng vào weaknesses để hiển thị rõ trong danh sách "Thiếu thông tin".',
      '',
      'LỚP 4 — TỰ KIỂM CHÉO NHẤT QUÁN TRƯỚC KHI TRẢ KẾT QUẢ:',
      '- Phân loại trạng thái chuẩn:',
      '  + CORRECT: hoàn toàn đúng bản chất, không thiếu ký hiệu hay điều kiện quan trọng.',
      '  + INCORRECT: sai bản chất kiến thức, sai quan hệ, sai công thức/phép toán.',
      '  + PARTIALLY_CORRECT: có phần đúng nhưng thiếu thông tin quan trọng (thiếu giải thích ký hiệu/đơn vị, thiếu điều kiện áp dụng, phát biểu chưa trọn vẹn).',
      '  + UNVERIFIED: CHỈ dùng khi thông tin riêng lẻ/mơ hồ/không đủ ngữ cảnh để xác minh. KHÔNG dùng cho định nghĩa/công thức phổ thông.',
      ocrConfirmed
        ? '  + Lưu ý OCR: Văn bản đã được người dùng kiểm tra/xác nhận nên KHÔNG tự ý gắn OCR_UNCERTAIN trừ khi câu chữ bị mất ký tự không thể hiểu nghĩa.'
        : '  + OCR_UNCERTAIN: độ tin cậy OCR < 0.65.',
      '  + OUT_OF_SCOPE: nội dung lạc đề hoàn toàn khỏi môn học.',
      '- KIỂM TRA CHÉO: Nếu explanation chỉ ra học sinh viết sai → evaluationStatus BẮT BUỘC là INCORRECT. Nếu explanation chỉ ra học sinh viết thiếu ký hiệu/đơn vị/điều kiện → evaluationStatus BẮT BUỘC là PARTIALLY_CORRECT. CẤM TUYỆT ĐỐI việc giải thích 1 đằng mà chấm trạng thái 1 nẻo.',
      '- Gán trọng số importanceWeight cho claims theo quy tắc cố định: 3 (định nghĩa/định luật/công thức cốt lõi), 2 (hỗ trợ/chú thích ký hiệu/điều kiện), 1 (chi tiết/ví dụ mở rộng).',
      coverageInstruction,
      '- Tuyệt đối KHÔNG bịa URL hay số trang SGK nếu không có trong ngữ cảnh.',
      '- Viết rõ ràng, trực diện, súc tích (mỗi shortFix tối đa 1 câu ngắn gọn; explanation/correctKnowledge/suggestedFix tối đa 2-3 câu đi thẳng vào bản chất khái niệm; weaknesses tối đa 10 ý; strengths tối đa 5 ý; suggestions tối đa 5 ý).',
      '',
      rubricSection,
      '=== TÀI LIỆU CỦA HỌC SINH ===',
      studentSlice,
      '',
      '=== ĐOẠN TRÍCH SÁCH GIÁO KHOA THAM CHIẾU ===',
      textbookSlice,
      '',
      webGroundingSummary
        ? `=== TỔNG HỢP NGUỒN INTERNET ĐÃ GROUNDING ===\n${webGroundingSummary.slice(0, 3500)}`
        : '',
    ].join('\n');

    // Full SHA-256 hash covering ENTIRE student text, ENTIRE prompt, fixed rubric, sorted chunks, and grading flags (never truncated to 12,000 chars!)
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
          seed: DETERMINISTIC_GRADING_SEED,
        }),
        'utf8'
      )
      .digest('hex');

    const routedResult = await runTaskWithRouter<ProviderJsonResult<RawKnowledgeEvalResult>>({
      taskType: 'knowledge_analysis',
      config,
      idToken,
      strictModelLock,
      allowGroqRescue: !strictModelLock,
      extractExecutionMeta: (res) => ({
        actualModel: res.resolvedModel,
        systemFingerprint: res.systemFingerprint,
      }),
      cacheInput: {
        promptVersion: GRADING_PROMPT_VERSION,
        inputHash,
        fullStudentTextHash,
        fullPromptHash,
        rubricHash: fixedRubric.rubricHash,
        chunkIds: sortedChunkIds,
        textbookRef: textbookReferenceId,
        grade,
        subject,
        scope,
        enableWebGrounding: Boolean(enableWebGrounding),
        ocrConfirmed,
      },
      runWithModel: async (modelId) =>
        generateJsonWithProviderDetailed<RawKnowledgeEvalResult>({
          modelId,
          prompt: analysisPrompt,
          thinkingTier: pages.length <= 2 && formattedStudentBlocks.length <= 3500 ? 'low' : 'medium',
          maxOutputTokens: pages.length <= 2 && fixedRubric.criteria.length <= 10 ? 4096 : 7168,
          timeoutMs: 32_000,
          temperature: 0,
          seed: DETERMINISTIC_GRADING_SEED,
          strictModelLock,
          strictJsonParser: parseAndValidateKnowledgeEvalJson,
          tokensOut,
          fallbackJson: '{"claims":[],"coverageItems":[],"strengths":[],"weaknesses":[],"suggestions":[]}',
          groqSchemaHint:
            '{"claims":[{"blockId":"...","blockIds":["..."],"sourcePage":1,"sourceText":"...","errorSpan":"cụm từ/công thức sai trích nguyên văn từ sourceText","shortFix":"câu sửa ngắn gọn 1 dòng","chapter":"...","concept":"...","importanceWeight":1|2|3,"knowledgeType":"textbook_core|advanced_extension|insufficient_evidence","evaluationStatus":"CORRECT|PARTIALLY_CORRECT|INCORRECT|MISSING|UNVERIFIED|AMBIGUOUS|OCR_UNCERTAIN|OUT_OF_SCOPE","explanation":"...","correctKnowledge":"...","suggestedFix":"...","matchedChunkId":"...","matchedExcerpt":"...","matchedPage":1}],"coverageItems":[{"criterionId":"KT01","concept":"...","chapter":"...","importanceWeight":1|2|3,"status":"COVERED|PARTIALLY_COVERED|MISSING|OUT_OF_SCOPE","suggestedAddition":"...","referenceExcerpt":"...","referencePage":1,"matchedChunkId":"..."}],"strengths":[{"title":"...","detail":"...","sourceExcerpt":"...","pageNumber":1}],"weaknesses":[{"title":"...","detail":"...","pageNumber":1}],"suggestions":[{"priority":1,"title":"...","description":"..."}]}',
          geminiSchema: {
            type: Type.OBJECT,
            properties: {
              claims: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    blockId: { type: Type.STRING },
                    blockIds: { type: Type.ARRAY, items: { type: Type.STRING } },
                    sourcePage: { type: Type.INTEGER },
                    sourceText: { type: Type.STRING },
                    errorSpan: { type: Type.STRING },
                    shortFix: { type: Type.STRING },
                    chapter: { type: Type.STRING },
                    concept: { type: Type.STRING },
                    importanceWeight: { type: Type.INTEGER, description: '1 | 2 | 3' },
                    knowledgeType: {
                      type: Type.STRING,
                      description: 'textbook_core | advanced_extension | insufficient_evidence',
                    },
                    evaluationStatus: {
                      type: Type.STRING,
                      description:
                        'CORRECT | PARTIALLY_CORRECT | INCORRECT | MISSING | UNVERIFIED | AMBIGUOUS | OCR_UNCERTAIN | OUT_OF_SCOPE',
                    },
                    explanation: { type: Type.STRING },
                    correctKnowledge: { type: Type.STRING },
                    suggestedFix: { type: Type.STRING },
                    matchedChunkId: { type: Type.STRING },
                    matchedExcerpt: { type: Type.STRING },
                    matchedPage: { type: Type.INTEGER },
                  },
                  required: [
                    'sourcePage',
                    'sourceText',
                    'chapter',
                    'concept',
                    'importanceWeight',
                    'evaluationStatus',
                    'explanation',
                    'correctKnowledge',
                  ],
                },
              },
              coverageItems: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    criterionId: { type: Type.STRING },
                    concept: { type: Type.STRING },
                    chapter: { type: Type.STRING },
                    importanceWeight: { type: Type.INTEGER },
                    status: {
                      type: Type.STRING,
                      description: 'COVERED | PARTIALLY_COVERED | MISSING | OUT_OF_SCOPE',
                    },
                    suggestedAddition: { type: Type.STRING },
                    referenceExcerpt: { type: Type.STRING },
                    referencePage: { type: Type.INTEGER },
                    matchedChunkId: { type: Type.STRING },
                  },
                  required: [
                    'concept',
                    'chapter',
                    'importanceWeight',
                    'status',
                    'suggestedAddition',
                    'referenceExcerpt',
                  ],
                },
              },
              strengths: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    detail: { type: Type.STRING },
                    sourceExcerpt: { type: Type.STRING },
                    pageNumber: { type: Type.INTEGER },
                  },
                  required: ['title', 'detail', 'sourceExcerpt', 'pageNumber'],
                },
              },
              weaknesses: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    detail: { type: Type.STRING },
                    pageNumber: { type: Type.INTEGER },
                  },
                  required: ['title', 'detail'],
                },
              },
              suggestions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    priority: { type: Type.INTEGER },
                    title: { type: Type.STRING },
                    description: { type: Type.STRING },
                  },
                  required: ['priority', 'title', 'description'],
                },
              },
            },
            required: ['claims', 'coverageItems', 'strengths', 'weaknesses', 'suggestions'],
          },
        }),
    });

    const rawEval = routedResult.data.data;
    const modelUsed = routedResult.actualModel;

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

    const claims: ExtractedClaim[] = filteredRawClaims.map((c, idx) => {
      const normalizedBlockIds = Array.isArray(c.blockIds)
        ? c.blockIds.filter((id): id is string => typeof id === 'string' && blockMap.has(id))
        : [];
      const primaryBlockId =
        (c.blockId && blockMap.has(c.blockId) ? c.blockId : normalizedBlockIds[0]) || undefined;
      const matchedBlock = primaryBlockId ? blockMap.get(primaryBlockId) : undefined;
      const rawOcrConf = matchedBlock ? matchedBlock.confidence : 0.9;
      const ocrConf = ocrConfirmed ? Math.max(rawOcrConf, 0.95) : rawOcrConf;
      let status: ClaimStatus = validStatuses.has(c.evaluationStatus as ClaimStatus)
        ? (c.evaluationStatus as ClaimStatus)
        : 'UNVERIFIED';

      // Only apply raw OCR uncertainty guard when the text has NOT been manually confirmed/edited
      if (!ocrConfirmed && ocrConf < 0.65 && status === 'INCORRECT') {
        status = 'OCR_UNCERTAIN';
      }

      const wRaw = Number(c.importanceWeight);
      const importanceWeight: 1 | 2 | 3 = wRaw === 3 ? 3 : wRaw === 1 ? 1 : 2;
      const evidences: ReferenceEvidence[] = [];

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
      } else if (c.matchedExcerpt) {
        evidences.push({
          evidenceId: `ev_${idx + 1}_ref`,
          sourceType: 'textbook',
          ...(textbookReferenceId ? { referenceId: textbookReferenceId } : {}),
          title: textbookTitle || 'Chuẩn chương trình GDPT 2018',
          ...(typeof c.matchedPage === 'number' && c.matchedPage > 0 ? { pageNumber: c.matchedPage } : {}),
          excerpt: c.matchedExcerpt,
        });
      }

      if (usedWebGrounding && c.knowledgeType === 'advanced_extension' && webSources.length > 0) {
        evidences.push(webSources[0]);
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

      // Deterministic claim ID derived from index + page + normalized sourceText + concept (never randomBytes!)
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
          ...(typeof item.referencePage === 'number' && item.referencePage > 0
            ? { referencePage: item.referencePage }
            : {}),
          ...(item.matchedChunkId ? { matchedChunkId: item.matchedChunkId } : {}),
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

    const gradingAudit: GradingAuditMetadata = {
      requestedModel: routedResult.requestedModel,
      actualModel: routedResult.actualModel,
      usedFallback: routedResult.usedFallback,
      usedOverride: routedResult.usedOverride,
      cached: routedResult.cached,
      strictModelLock,
      ...(routedResult.systemFingerprint
        ? { systemFingerprint: routedResult.systemFingerprint }
        : {}),
      promptVersion: GRADING_PROMPT_VERSION,
      configVersion: routedResult.configVersion,
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
    };

    const accuracyBreakdown = {
      ...baseAccuracyBreakdown,
      gradingAudit,
    };

    const annotations: AnnotationItem[] = [];
    for (const claim of claims) {
      if (claim.evaluationStatus === 'MISSING' || claim.evaluationStatus === 'OUT_OF_SCOPE') continue;
      const color: AnnotationItem['annotationColor'] =
        claim.evaluationStatus === 'INCORRECT'
          ? 'red'
          : claim.evaluationStatus === 'PARTIALLY_CORRECT'
          ? 'orange'
          : claim.evaluationStatus === 'UNVERIFIED' ||
            claim.evaluationStatus === 'OCR_UNCERTAIN' ||
            claim.evaluationStatus === 'AMBIGUOUS'
          ? 'yellow'
          : 'green';

      annotations.push({
        annotationId: `ann_${claim.claimId}`,
        pageNumber: claim.sourcePage,
        ...(claim.blockId ? { blockId: claim.blockId } : {}),
        ...(claim.blockIds && claim.blockIds.length > 0 ? { blockIds: claim.blockIds } : {}),
        textExcerpt: claim.sourceText,
        ...(claim.errorSpan ? { errorSpan: claim.errorSpan } : {}),
        claimId: claim.claimId,
        ...(claim.evidences[0]?.referenceId ? { referenceId: claim.evidences[0].referenceId } : {}),
        boundingBox: claim.boundingBox || null,
        annotationColor: color,
        reason: claim.explanation,
        ...(claim.evidences[0]?.evidenceId ? { evidenceId: claim.evidences[0].evidenceId } : {}),
      });
    }

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

    let targetClaims = claims;
    if (scope === 'incorrect') {
      targetClaims = claims.filter((c) => c.evaluationStatus === 'INCORRECT');
    } else if (scope === 'partial') {
      targetClaims = claims.filter((c) => c.evaluationStatus === 'PARTIALLY_CORRECT');
    } else if (scope === 'chapter' && chapterFilter) {
      targetClaims = claims.filter((c) => c.chapter.toLowerCase().includes(chapterFilter.toLowerCase()));
    }

    const missingItems =
      scope === 'missing' || scope === 'all'
        ? coverageItems.filter((i) => i.status === 'MISSING' || i.status === 'PARTIALLY_COVERED')
        : [];

    // Estimate distinct knowledge points available directly from upload
    const distinctUploadConcepts = new Set([
      ...targetClaims.map((c) => (c.concept || c.sourceText.slice(0, 35)).toLowerCase()),
      ...missingItems.map((m) => (m.concept || '').toLowerCase()),
    ].filter(Boolean));

    const needsTextbookSupplement = distinctUploadConcepts.size < 5;
    const safeAdvancedExtra = advancedEnabled ? Math.min(6, Math.max(1, Number(advancedCount) || 2)) : 0;
    const baseTargetCount = Math.min(20, Math.max(5, Number(count) || 5));

    const supplementChunks = needsTextbookSupplement
      ? referenceChunks
          .filter((rc) => rc.grade === grade && rc.subject === subject)
          .slice(0, 8)
      : [];

    const contextLines = [
      ...targetClaims.map(
        (c) =>
          `[UploadClaim ${c.claimId} | ${c.evaluationStatus} | ${c.chapter} | ${c.concept}] Học sinh viết: "${c.sourceText}" | Chuẩn: "${c.correctKnowledge}" | Giải thích: "${c.explanation}"`
      ),
      ...missingItems.map(
        (m) =>
          `[UploadMissing | ${m.chapter} | ${m.concept}] Gợi ý: "${m.suggestedAddition}" | Trích dẫn: "${m.referenceExcerpt}"`
      ),
      ...supplementChunks.map(
        (ch) =>
          `[TextbookSupplement | ${ch.chapter} - ${ch.lesson} | Tr.${ch.pageNumber}] ${ch.content.slice(0, 450)}`
      ),
    ];

    const effectiveContext =
      contextLines.length > 0
        ? contextLines.join('\n')
        : claims.map((c) => `${c.concept}: ${c.correctKnowledge}`).join('\n');

    const diffLabel =
      difficulty === 'basic'
        ? 'Cơ bản (Nhận biết, Thông hiểu)'
        : difficulty === 'medium'
        ? 'Trung bình (Thông hiểu, Vận dụng)'
        : difficulty === 'advanced'
        ? 'Nâng cao (Vận dụng, Vận dụng cao)'
        : 'Hỗn hợp cân bằng (Nhận biết 30% - Thông hiểu 30% - Vận dụng 25% - Vận dụng cao 15%)';

    const prompt = [
      `Soạn ${baseTargetCount} câu hỏi trắc nghiệm ABCD cốt lõi cho học sinh lớp ${grade}, môn ${SUBJECT_LABELS[subject]}.`,
      needsTextbookSupplement
        ? `LƯU Ý ĐẶC BIỆT: Nội dung tải lên chỉ có ${distinctUploadConcepts.size} đơn vị kiến thức khác nhau (< 5). Hãy tạo tối đa số câu hỏi bám sát nội dung tải lên, VÀ TỰ ĐỘNG BỔ SUNG phần còn lại từ kiến thức đã hoàn thiện của chương/sách giáo khoa (${textbookTitle || SUBJECT_LABELS[subject] + ' lớp ' + grade}) để đủ ${baseTargetCount} câu chất lượng không trùng lặp.`
        : `Tất cả ${baseTargetCount} câu cốt lõi bám sát nội dung đã tải lên và phần kiến thức cần củng cố.`,
      safeAdvancedExtra > 0
        ? `YÊU CẦU MỞ RỘNG NÂNG CAO: Ngoài ${baseTargetCount} câu trên, HÃY TẠO THÊM ĐÚNG ${safeAdvancedExtra} câu hỏi NÂNG CAO BÊN NGOÀI (isExternalAdvanced = true, mức Vận dụng / Vận dụng cao) kiểm tra tư duy sâu hơn ở cùng chủ đề môn học.`
        : '',
      `Độ khó: ${diffLabel}. Nguồn tham chiếu: ${textbookTitle || 'Kiến thức chuẩn GDPT 2018'}.`,
      'YÊU CẦU CHẤT LƯỢNG NGHIÊM NGẶT:',
      '- Mỗi câu CHỈ CÓ DUY NHẤT 1 đáp án đúng (A, B, C hoặc D).',
      '- Độ dài 4 lựa chọn A/B/C/D tương đồng hợp lý, không lộ đáp án đúng bằng độ dài quá vượt trội.',
      '- Phân loại đúng cognitiveLevel (nhan_biet | thong_hieu | van_dung | van_dung_cao) và knowledgeUnitType (concept | mechanism | condition | characteristic | formula | problem_type).',
      '- Viết thật ngắn gọn: explanation tối đa 2 câu; mỗi distractorA/B/C/D tối đa 1 câu ngắn giải thích vì sao lựa chọn đó đúng/sai.',
      '',
      'NGỮ CẢNH KIẾN THỨC:',
      effectiveContext.slice(0, 18000),
    ]
      .filter(Boolean)
      .join('\n');

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
    };

    const totalWanted = baseTargetCount + safeAdvancedExtra;
    const quizMaxTokens = Math.min(4096, Math.max(1536, totalWanted * 220));

    const { data: parsed, modelId: modelUsed } = await runTaskWithRouter<{ questions: RawQuizItem[] }>({
      taskType: 'quiz_generation',
      config,
      idToken,
      allowGroqRescue: true,
      cacheInput: {
        subject,
        grade,
        baseTargetCount,
        safeAdvancedExtra,
        difficulty,
        scope,
        chapterFilter: chapterFilter || '',
        ctx: effectiveContext.slice(0, 8000),
      },
      runWithModel: async (modelId) =>
        generateJsonWithProvider<{ questions: RawQuizItem[] }>({
          modelId,
          prompt,
          thinkingTier: 'low',
          maxOutputTokens: quizMaxTokens,
          tokensOut,
          fallbackJson: '{"questions":[]}',
          groqSchemaHint:
            '{"questions":[{"questionText":"...","optionA":"...","optionB":"...","optionC":"...","optionD":"...","correctAnswer":"A|B|C|D","explanation":"...","cognitiveLevel":"nhan_biet|thong_hieu|van_dung|van_dung_cao","chapter":"...","concept":"...","sourceReference":"..."}]}',
          geminiSchema: {
            type: Type.OBJECT,
            properties: {
              questions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    questionText: { type: Type.STRING },
                    optionA: { type: Type.STRING },
                    optionB: { type: Type.STRING },
                    optionC: { type: Type.STRING },
                    optionD: { type: Type.STRING },
                    correctAnswer: { type: Type.STRING, description: 'A | B | C | D' },
                    explanation: { type: Type.STRING },
                    distractorA: { type: Type.STRING },
                    distractorB: { type: Type.STRING },
                    distractorC: { type: Type.STRING },
                    distractorD: { type: Type.STRING },
                    cognitiveLevel: {
                      type: Type.STRING,
                      description: 'nhan_biet | thong_hieu | van_dung | van_dung_cao',
                    },
                    knowledgeUnitType: {
                      type: Type.STRING,
                      description: 'concept | mechanism | condition | characteristic | formula | problem_type',
                    },
                    chapter: { type: Type.STRING },
                    concept: { type: Type.STRING },
                    sourceReference: { type: Type.STRING },
                    isExternalAdvanced: { type: Type.BOOLEAN },
                  },
                  required: [
                    'questionText',
                    'optionA',
                    'optionB',
                    'optionC',
                    'optionD',
                    'correctAnswer',
                    'explanation',
                    'cognitiveLevel',
                    'chapter',
                    'concept',
                    'sourceReference',
                  ],
                },
              },
            },
            required: ['questions'],
          },
        }),
    });

    const now = new Date().toISOString();
    const mapped: QuizQuestion[] = (parsed.questions || []).slice(0, totalWanted + 2).map((q, idx) => {
      const ans =
        q.correctAnswer === 'A' || q.correctAnswer === 'B' || q.correctAnswer === 'C' || q.correctAnswer === 'D'
          ? q.correctAnswer
          : 'A';
      const fallbackDiff: QuizQuestion['difficulty'] =
        difficulty === 'basic' || difficulty === 'advanced' ? difficulty : 'medium';
      const cog = normalizeCognitiveLevel(q.cognitiveLevel, fallbackDiff);
      const diff: QuizQuestion['difficulty'] =
        cog === 'nhan_biet' ? 'basic' : cog === 'thong_hieu' ? 'medium' : 'advanced';
      const unitTypes = new Set<KnowledgeUnitType>([
        'concept',
        'mechanism',
        'condition',
        'characteristic',
        'formula',
        'problem_type',
      ]);

      return {
        questionId: `q_${Date.now()}_${idx + 1}_${crypto.randomBytes(2).toString('hex')}`,
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
        sourceType: q.isExternalAdvanced ? 'external_extension' : 'textbook_reference',
        modelId: modelUsed,
        isExternalAdvanced: Boolean(q.isExternalAdvanced),
        createdAt: now,
      };
    });

    const validation = validateQuizQuestionSet(mapped);

    const hasActualTextbookChunks = needsTextbookSupplement && supplementChunks.length > 0;
    const finalQuestions = validation.questions.slice(0, totalWanted);

    let supplementNotice: string | undefined;
    if (needsTextbookSupplement) {
      if (hasActualTextbookChunks) {
        supplementNotice = `Nội dung tải lên chỉ có ${distinctUploadConcepts.size} đơn vị kiến thức khác nhau (< 5). Hệ thống đã tự động bổ sung thêm từ sách giáo khoa tham chiếu (${textbookTitle || 'Thư viện SGK'}) để đủ ${Math.min(finalQuestions.length, baseTargetCount)} câu.`;
      } else {
        supplementNotice = `Phạm vi lọc hiện tại chỉ có ${distinctUploadConcepts.size} đơn vị kiến thức (< 5). Hệ thống đã tự động mở rộng câu hỏi dựa trên toàn bộ tài liệu tải lên và chuẩn chương trình GDPT 2018 môn ${SUBJECT_LABELS[subject]} Lớp ${grade} để đủ ${Math.min(finalQuestions.length, baseTargetCount)} câu.`;
      }
    }

    return {
      questions: finalQuestions,
      supplementedFromTextbook: hasActualTextbookChunks,
      supplementNotice,
      modelUsed,
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
          geminiSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              rows: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    chapter: { type: Type.STRING },
                    topic: { type: Type.STRING },
                    cognitiveLevel: {
                      type: Type.STRING,
                      description: 'nhan_biet | thong_hieu | van_dung | van_dung_cao',
                    },
                    questionType: {
                      type: Type.STRING,
                      description: 'abcd | true_false | short_answer',
                    },
                    questionCount: { type: Type.INTEGER },
                    scorePerQuestion: { type: Type.NUMBER },
                    learningOutcome: { type: Type.STRING },
                  },
                  required: [
                    'chapter',
                    'topic',
                    'cognitiveLevel',
                    'questionType',
                    'questionCount',
                    'scorePerQuestion',
                    'learningOutcome',
                  ],
                },
              },
            },
            required: ['title', 'rows'],
          },
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
          geminiSchema: {
            type: Type.OBJECT,
            properties: {
              questions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    chapterId: { type: Type.STRING },
                    conceptId: { type: Type.STRING },
                    cognitiveLevel: { type: Type.STRING },
                    questionType: { type: Type.STRING },
                    scoreWeight: { type: Type.NUMBER },
                    questionText: { type: Type.STRING },
                    optionA: { type: Type.STRING },
                    optionB: { type: Type.STRING },
                    optionC: { type: Type.STRING },
                    optionD: { type: Type.STRING },
                    correctAnswer: { type: Type.STRING },
                    trueFalseStatements: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          label: { type: Type.STRING },
                          text: { type: Type.STRING },
                          isTrue: { type: Type.BOOLEAN },
                        },
                        required: ['label', 'text', 'isTrue'],
                      },
                    },
                    shortAnswerAccepted: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                    },
                    explanation: { type: Type.STRING },
                    sourceReference: { type: Type.STRING },
                  },
                  required: [
                    'chapterId',
                    'conceptId',
                    'cognitiveLevel',
                    'questionType',
                    'scoreWeight',
                    'questionText',
                    'explanation',
                    'sourceReference',
                  ],
                },
              },
            },
            required: ['questions'],
          },
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
          geminiSchema: {
            type: Type.OBJECT,
            properties: {
              questionText: { type: Type.STRING },
              optionA: { type: Type.STRING },
              optionB: { type: Type.STRING },
              optionC: { type: Type.STRING },
              optionD: { type: Type.STRING },
              correctAnswer: { type: Type.STRING },
              shortAnswerAccepted: { type: Type.ARRAY, items: { type: Type.STRING } },
              explanation: { type: Type.STRING },
              sourceReference: { type: Type.STRING },
            },
            required: ['questionText', 'explanation'],
          },
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
      allowGroqRescue: inlineParts.every((p) => p.inlineData.mimeType !== 'application/pdf'),
      runWithModel: async (modelId) => {
        const hasPdfBinary = inlineParts.some((p) => p.inlineData.mimeType === 'application/pdf');
        const imageParts = inlineParts
          .filter((p) => p.inlineData.mimeType.startsWith('image/'))
          .map((p) => ({ mimeType: p.inlineData.mimeType, base64: p.inlineData.data }));

        if (isGroqModelId(modelId) && !hasPdfBinary) {
          const resp = await callWithTimeout((signal) =>
            callGroqChatCompletion({
              modelId,
              prompt: promptText,
              images: imageParts.length > 0 ? imageParts : undefined,
              jsonMode: true,
              jsonSchemaHint:
                '{"detectedTitle":"...","questions":[{"questionType":"abcd|short_answer|true_false","questionText":"...","optionA":"...","optionB":"...","optionC":"...","optionD":"...","correctAnswer":"A|B|C|D","shortAnswerAccepted":["..."],"scoreWeight":0.25,"answerFromSource":true,"explanation":"...","chapter":"...","cognitiveLevel":"nhan_biet|thong_hieu|van_dung|van_dung_cao"}]}',
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

        const ai = await createServerAiClient();
        const safeModel =
          isGroqModelId(modelId) || isCloudflareModelId(modelId)
            ? 'gemini-2.5-flash'
            : modelId;
        const contents =
          inlineParts.length > 0
            ? [{ role: 'user', parts: [...inlineParts, { text: promptText }] }]
            : promptText;
        const resp = await callWithTimeout((signal) =>
          generateGeminiContentWithFallback({
            ai,
            model: safeModel,
            contents,
            thinkingTier: 'minimal',
            config: {
              maxOutputTokens: 6144,
              abortSignal: signal,
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  detectedTitle: { type: Type.STRING },
                  questions: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        questionType: {
                          type: Type.STRING,
                          description: includeTrueFalse
                            ? 'abcd | short_answer | true_false'
                            : 'abcd | short_answer',
                        },
                        questionText: { type: Type.STRING },
                        optionA: { type: Type.STRING },
                        optionB: { type: Type.STRING },
                        optionC: { type: Type.STRING },
                        optionD: { type: Type.STRING },
                        correctAnswer: { type: Type.STRING, description: 'A | B | C | D' },
                        ...(includeTrueFalse
                          ? {
                              trueFalseStatements: {
                                type: Type.ARRAY,
                                items: {
                                  type: Type.OBJECT,
                                  properties: {
                                    label: { type: Type.STRING },
                                    text: { type: Type.STRING },
                                    isTrue: { type: Type.BOOLEAN },
                                  },
                                  required: ['label', 'text', 'isTrue'],
                                },
                              },
                            }
                          : {}),
                        shortAnswerAccepted: {
                          type: Type.ARRAY,
                          items: { type: Type.STRING },
                        },
                        scoreWeight: { type: Type.NUMBER },
                        answerFromSource: { type: Type.BOOLEAN },
                        explanation: { type: Type.STRING },
                        chapter: { type: Type.STRING },
                        cognitiveLevel: {
                          type: Type.STRING,
                          description: 'nhan_biet | thong_hieu | van_dung | van_dung_cao',
                        },
                      },
                      required: ['questionType', 'questionText'],
                    },
                  },
                },
                required: ['questions'],
              },
            },
          })
        );
        accumulateTokens(tokensOut, resp);
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
          geminiSchema: {
            type: Type.OBJECT,
            properties: {
              cards: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    front: { type: Type.STRING },
                    back: { type: Type.STRING },
                    chapter: { type: Type.STRING },
                    concept: { type: Type.STRING },
                    cardType: {
                      type: Type.STRING,
                      description: 'concept | formula | condition | mistake_fix | example',
                    },
                    sourceReference: { type: Type.STRING },
                  },
                  required: ['front', 'back', 'chapter', 'concept', 'cardType'],
                },
              },
            },
            required: ['cards'],
          },
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

    let webTocContext = '';
    const selectedOutlineModel =
      config?.taskModels?.curriculum_extraction?.defaultModel || config?.activeModel || '';
    const shouldSearchWithGemini =
      isGeminiConfigured() &&
      !isGroqModelId(selectedOutlineModel) &&
      !isCloudflareModelId(selectedOutlineModel);

    if (shouldSearchWithGemini && (!customTocHint || customTocHint.trim().length < 20)) {
      try {
        const ai = await createServerAiClient();
        const searchQuery = `Mục lục các chương và bài học sách giáo khoa ${subjectName} lớp ${grade} bộ sách ${textbookSeries} chương trình GDPT 2018`;
        const searchResp = await callWithTimeout(
          (signal) =>
            generateGeminiContentWithFallback({
              ai,
              model: 'gemini-2.5-flash',
              contents: searchQuery,
              thinkingTier: 'minimal',
              config: {
                maxOutputTokens: 1024,
                abortSignal: signal,
                tools: [{ googleSearch: {} }],
              },
            }),
          14_000
        );
        accumulateTokens(tokensOut, searchResp);
        webTocContext = (searchResp.text || '').trim().slice(0, 4000);
      } catch {
        // Proceed with model's built-in GDPT 2018 curriculum knowledge if search grounding times out
      }
    }

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
          geminiSchema: {
            type: Type.OBJECT,
            properties: {
              bookTitle: { type: Type.STRING },
              chapters: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    chapterIndex: { type: Type.INTEGER },
                    chapterTitle: { type: Type.STRING },
                    lessons: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                    },
                    estimatedPageStart: { type: Type.INTEGER },
                  },
                  required: ['chapterIndex', 'chapterTitle', 'lessons', 'estimatedPageStart'],
                },
              },
            },
            required: ['bookTitle', 'chapters'],
          },
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
          geminiSchema: {
            type: Type.OBJECT,
            properties: {
              chunks: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    lesson: { type: Type.STRING },
                    pageNumber: { type: Type.INTEGER },
                    sectionTitle: { type: Type.STRING },
                    content: { type: Type.STRING },
                    keywords: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                    },
                    learningObjectives: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                    },
                    conceptTags: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                    },
                  },
                  required: ['lesson', 'pageNumber', 'sectionTitle', 'content', 'keywords', 'learningObjectives'],
                },
              },
            },
            required: ['chunks'],
          },
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

