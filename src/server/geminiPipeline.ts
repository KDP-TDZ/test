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
import { retrieveRelevantChunks } from '../core/retrieval.js';
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
  ImprovementSuggestion,
  KnowledgeCoverageItem,
  KnowledgeUnitType,
  QuizDifficulty,
  QuizQuestion,
  QuizScope,
  ReferenceChunk,
  ReferenceEvidence,
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
  thinkingConfigForModel,
} from './modelRouter.js';
import { callGroqChatCompletion, isGroqModelId } from './groqProvider.js';

export interface TokenTelemetry {
  promptTokens: number;
  candidateTokens: number;
  totalTokens: number;
}

function accumulateTokens(acc: TokenTelemetry, resp: GenerateContentResponse): void {
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

async function generateJsonWithProvider<T>(params: {
  modelId: string;
  prompt: string;
  thinkingTier: 'minimal' | 'low' | 'medium';
  maxOutputTokens: number;
  timeoutMs?: number;
  geminiSchema: Record<string, unknown>;
  groqSchemaHint: string;
  fallbackJson: string;
  tokensOut: TokenTelemetry;
}): Promise<T> {
  if (isGroqModelId(params.modelId)) {
    const resp = await callWithTimeout(
      (signal) =>
        callGroqChatCompletion({
          modelId: params.modelId,
          prompt: params.prompt,
          jsonMode: true,
          jsonSchemaHint: params.groqSchemaHint,
          maxOutputTokens: params.maxOutputTokens,
          signal,
        }),
      params.timeoutMs
    );
    accumulateRawTokens(params.tokensOut, resp);
    return JSON.parse((resp.text || params.fallbackJson).trim()) as T;
  }

  const ai = await createServerAiClient();
  const response = await callWithTimeout(
    (signal) =>
      ai.models.generateContent({
        model: params.modelId,
        contents: params.prompt,
        config: {
          thinkingConfig: thinkingConfigForModel(params.modelId, params.thinkingTier),
          maxOutputTokens: params.maxOutputTokens,
          abortSignal: signal,
          responseMimeType: 'application/json',
          responseSchema: params.geminiSchema,
        },
      }),
    params.timeoutMs
  );
  accumulateTokens(params.tokensOut, response);
  return JSON.parse((response.text || params.fallbackJson).trim()) as T;
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

  const ai = await createServerAiClient();
  const resp = await callWithTimeout(
    (signal) =>
      ai.models.generateContent({
        model: params.modelId,
        contents: params.prompt,
        config: {
          thinkingConfig: thinkingConfigForModel(params.modelId, params.thinkingTier),
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
  runWithModel: (modelId: string) => Promise<T>;
}): Promise<{ data: T; modelId: string }> {
  const cfg = params.config || getAuthoritativeAiConfigSnapshot();
  const res = await executeRoutedAiTask({
    taskType: params.taskType,
    config: cfg,
    consumeOneTimeOverride: (task) => consumeOneTimeModelOverride(task, params.idToken),
    cacheInput: params.cacheInput,
    bypassCache: params.bypassCache,
    allowGroqRescue: params.allowGroqRescue,
    runWithModel: params.runWithModel,
  });
  return { data: res.data, modelId: res.modelId };
}

export class DocumentExtractionService {
  static async extractFromImageBuffers(
    files: Array<{ buffer: Buffer; mimeType: string; originalName: string }>,
    tokensOut: TokenTelemetry,
    opts?: { config?: SystemAiConfig; idToken?: string; pageOffset?: number }
  ): Promise<ExtractedPage[]> {
    const ai = await createServerAiClient();
    const validTypes = new Set(['paragraph', 'heading', 'formula', 'table', 'list', 'handwriting']);
    const pageOffset = Math.max(0, Number(opts?.pageOffset) || 0);
    const pages: ExtractedPage[] = [];

    for (let idx = 0; idx < files.length; idx += 1) {
      const file = files[idx];
      const pageNum = pageOffset + idx + 1;
      const contentHash = crypto.createHash('sha256').update(file.buffer).digest('hex');

      const { data: parsed } = await runTaskWithRouter<{
        blocks: Array<{
          extractedText: string;
          textType: string;
          confidence: number;
          formulaText?: string;
        }>;
      }>({
        taskType: 'curriculum_extraction',
        config: opts?.config,
        idToken: opts?.idToken,
        cacheInput: { ocrKind: 'image', mimeType: file.mimeType, sha256: contentHash },
        runWithModel: async (modelId) => {
          const visionModel = isGroqModelId(modelId) ? 'gemini-4-hydrogen' : modelId;
          const base64 = file.buffer.toString('base64');
          const response = await callWithTimeout((signal) =>
            ai.models.generateContent({
              model: visionModel,
              contents: {
                parts: [
                  {
                    inlineData: {
                      mimeType: file.mimeType,
                      data: base64,
                    },
                  },
                  {
                    text: [
                      'Trích xuất toàn bộ văn bản, công thức, bảng biểu và chữ viết tay từ trang tài liệu này.',
                      '- Giữ nguyên chính tả và nội dung gốc của học sinh, KHÔNG tự sửa lỗi kiến thức, KHÔNG thêm bình luận.',
                      '- Chia thành các khối theo thứ tự đọc và ghi nhận textType + confidence (0.0-1.0). Nếu chữ mờ/khó đọc đặt confidence < 0.65.',
                    ].join('\n'),
                  },
                ],
              },
              config: {
                thinkingConfig: thinkingConfigForModel(visionModel, 'minimal'),
                maxOutputTokens: 2048,
                abortSignal: signal,
                responseMimeType: 'application/json',
                responseSchema: {
                  type: Type.OBJECT,
                  properties: {
                    blocks: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          extractedText: { type: Type.STRING },
                          textType: {
                            type: Type.STRING,
                            description: 'paragraph | heading | formula | table | list | handwriting',
                          },
                          confidence: { type: Type.NUMBER },
                          formulaText: { type: Type.STRING },
                        },
                        required: ['extractedText', 'textType', 'confidence'],
                      },
                    },
                  },
                  required: ['blocks'],
                },
              },
            })
          );
          accumulateTokens(tokensOut, response);
          return JSON.parse((response.text || '{"blocks":[]}').trim()) as {
            blocks: Array<{
              extractedText: string;
              textType: string;
              confidence: number;
              formulaText?: string;
            }>;
          };
        },
      });

      const blocks: ExtractedTextBlock[] = (parsed.blocks || [])
        .filter((b) => b.extractedText && b.extractedText.trim().length > 0)
        .map((b, bIdx) => ({
          blockId: `p${pageNum}_b${bIdx + 1}`,
          pageNumber: pageNum,
          extractedText: b.extractedText.trim(),
          textType: (validTypes.has(b.textType) ? b.textType : 'paragraph') as ExtractedTextBlock['textType'],
          confidence: Math.max(0, Math.min(1, Number(b.confidence) || 0.8)),
          readingOrder: bIdx + 1,
          ...(b.formulaText ? { formulaText: b.formulaText } : {}),
          boundingBox: null,
        }));

      const avgConf =
        blocks.length > 0
          ? Math.round((blocks.reduce((s, b) => s + b.confidence, 0) / blocks.length) * 100) / 100
          : 0;

      pages.push({
        pageNumber: pageNum,
        rawText: blocks.map((b) => b.extractedText).join('\n'),
        blocks,
        ocrAverageConfidence: avgConf,
      });
    }

    return pages;
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
      if (totalChars >= 80) {
        return textPages.map((p) => {
          const paragraphs = p.text
            .split(/\n+/)
            .map((t) => t.trim())
            .filter(Boolean);
          const blocks: ExtractedTextBlock[] = paragraphs.map((line, i) => ({
            blockId: `p${p.pageNumber}_b${i + 1}`,
            pageNumber: p.pageNumber,
            extractedText: line,
            textType: i === 0 && line.length < 90 ? 'heading' : 'paragraph',
            confidence: 0.98,
            readingOrder: i + 1,
            boundingBox: null,
          }));
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

    const ai = await createServerAiClient();
    const pdfHash = crypto.createHash('sha256').update(buffer).digest('hex');
    const { data: parsed } = await runTaskWithRouter<{
      pages: Array<{
        pageNumber: number;
        blocks: Array<{
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
      cacheInput: { ocrKind: 'pdf_scan', sha256: pdfHash },
      runWithModel: async (modelId) => {
        const visionModel = isGroqModelId(modelId) ? 'gemini-4-hydrogen' : modelId;
        const base64 = buffer.toString('base64');
        const response = await callWithTimeout((signal) =>
          ai.models.generateContent({
            model: visionModel,
            contents: {
              parts: [
                {
                  inlineData: {
                    mimeType: 'application/pdf',
                    data: base64,
                  },
                },
                {
                  text: 'Trích xuất văn bản, công thức và bảng biểu theo từng trang của file PDF học tập này. Giữ nguyên nội dung gốc (không tự sửa lỗi kiến thức, không thêm bình luận). Trả về danh sách trang và từng đoạn văn bản kèm độ tin cậy OCR.',
                },
              ],
            },
            config: {
              thinkingConfig: thinkingConfigForModel(visionModel, 'minimal'),
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
                        blocks: {
                          type: Type.ARRAY,
                          items: {
                            type: Type.OBJECT,
                            properties: {
                              extractedText: { type: Type.STRING },
                              textType: { type: Type.STRING },
                              confidence: { type: Type.NUMBER },
                              formulaText: { type: Type.STRING },
                            },
                            required: ['extractedText', 'textType', 'confidence'],
                          },
                        },
                      },
                      required: ['pageNumber', 'blocks'],
                    },
                  },
                },
                required: ['pages'],
              },
            },
          })
        );
        accumulateTokens(tokensOut, response);
        return JSON.parse((response.text || '{"pages":[]}').trim()) as {
          pages: Array<{
            pageNumber: number;
            blocks: Array<{
              extractedText: string;
              textType: string;
              confidence: number;
              formulaText?: string;
            }>;
          }>;
        };
      },
    });

    const validTypes = new Set(['paragraph', 'heading', 'formula', 'table', 'list', 'handwriting']);
    return (parsed.pages || []).map((p, idx) => {
      const pageNum = p.pageNumber || idx + 1;
      const blocks: ExtractedTextBlock[] = (p.blocks || []).map((b, bIdx) => ({
        blockId: `p${pageNum}_b${bIdx + 1}`,
        pageNumber: pageNum,
        extractedText: b.extractedText.trim(),
        textType: (validTypes.has(b.textType) ? b.textType : 'paragraph') as ExtractedTextBlock['textType'],
        confidence: Math.max(0, Math.min(1, Number(b.confidence) || 0.78)),
        readingOrder: bIdx + 1,
        ...(b.formulaText ? { formulaText: b.formulaText } : {}),
        boundingBox: null,
      }));
      const avgConf =
        blocks.length > 0
          ? Math.round((blocks.reduce((s, b) => s + b.confidence, 0) / blocks.length) * 100) / 100
          : 0.75;
      return {
        pageNumber: pageNum,
        rawText: blocks.map((b) => b.extractedText).join('\n'),
        blocks,
        ocrAverageConfidence: avgConf,
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
      const blocks: ExtractedTextBlock[] = slice.map((text, idx) => ({
        blockId: `p${pageNum}_b${idx + 1}`,
        pageNumber: pageNum,
        extractedText: text,
        textType: idx === 0 && text.length < 90 ? 'heading' : 'paragraph',
        confidence: 0.99,
        readingOrder: idx + 1,
        boundingBox: null,
      }));
      pages.push({
        pageNumber: pageNum,
        rawText: slice.join('\n'),
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
          thinkingTier: 'low',
          maxOutputTokens: 384,
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
              `[blockId=${b.blockId} | page=${p.pageNumber} | ocrConf=${b.confidence}] ${b.extractedText}`
          )
          .join('\n');
        return `--- TRANG ${p.pageNumber} ---\n${blocksStr}`;
      })
      .join('\n\n');

    const fullText = pages.map((p) => p.rawText).join('\n');
    const retrievedHits = retrieveRelevantChunks(fullText, referenceChunks, {
      referenceId: textbookReferenceId || undefined,
      selectedChapters: selectedChapters.length > 0 ? selectedChapters : undefined,
      topK: 10,
    });

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

    if (enableWebGrounding === true) {
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
          cacheInput: { webSearchText: fullText.slice(0, 2000), grade, subject, scope },
          runWithModel: async (modelId) => {
            const searchModel = isGroqModelId(modelId) ? 'gemini-3.1-flash-lite' : modelId;
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

    const hasIndexedTextbookChunks = retrievedHits.length > 0;
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
      'LỚP 1 — TÁCH MỆNH ĐỀ & RÀ TỪNG CÂU / TỪNG VẾ:',
      '- Tách tài liệu học sinh thành từng đơn vị kiến thức độc lập theo đúng từng câu, từng công thức và từng đoạn giải thích "Trong đó..." (không gộp nhiều lỗi khác nhau vào chung 1 claim).',
      '- Kiểm tra kỹ mọi từ khóa mang tính bản chất: "không đổi" vs "thay đổi", "tỉ lệ thuận" vs "tỉ lệ nghịch", "tăng" vs "giảm", "cùng chiều" vs "ngược chiều", "bảo toàn" vs "không bảo toàn", điều kiện áp dụng.',
      '- Đối chiếu theo nghĩa học thuật (không bắt bẻ cách diễn đạt tương đương nếu đúng bản chất).',
      '',
      'LỚP 2 — SOI TỪNG CÔNG THỨC & PHÉP TOÁN:',
      '- Kiểm tra từng dấu phép toán (+, -, ×, ., /, ^), dấu âm/dương, hệ số, chỉ số dưới và kiểm tra thứ nguyên vật lý/toán học (ví dụ: v [m/s] không thể cộng với t [s] trong s = v + t; công thức đúng phải là s = v.t).',
      '- Tách riêng claim cho công thức và claim cho phần chú thích "Trong đó..." đi kèm để phân biệt rõ: công thức đúng nhưng thiếu giải thích biến số khác với công thức viết sai.',
      '',
      'LỚP 3 — KIỂM TRA ĐỘ ĐẦY ĐỦ CHÚ THÍCH KÝ HIỆU & ĐƠN VỊ CỦA MỌI CÔNG THỨC:',
      '- Với MỌI công thức xuất hiện trong tài liệu (ví dụ s = v.t, x = x0 + v.t, F = m.a...), liệt kê TẤT CẢ các ký hiệu/biến số có mặt trong công thức đó và đối chiếu với phần giải thích ("Trong đó...") ngay kế tiếp.',
      '- Nếu học sinh BỎ SÓT giải thích ý nghĩa HOẶC thiếu đơn vị đo của bất kỳ ký hiệu nào (ví dụ: viết s và v nhưng không giải thích thời gian t và đơn vị giây s; hoặc viết x0 và x nhưng không giải thích vận tốc v trong phương trình chuyển động):',
      '  + Đánh giá phần giải thích đó là PARTIALLY_CORRECT (Thiếu thông tin / Điều kiện), nêu ĐÍCH DANH ký hiệu và đơn vị còn thiếu trong explanation, và viết trọn bộ chú thích đầy đủ trong suggestedFix.',
      '  + BẮT BUỘC thêm từng mục thiếu đó vào coverageItems với status = "MISSING" (hoặc "PARTIALLY_COVERED") và vào weaknesses để hiển thị rõ trong danh sách "Thiếu thông tin".',
      '',
      'LỚP 4 — TỰ KIỂM CHÉO NHẤT QUÁN TRƯỚC KHI TRẢ KẾT QUẢ:',
      '- Phân loại trạng thái chuẩn:',
      '  + CORRECT: hoàn toàn đúng bản chất, không thiếu ký hiệu hay điều kiện quan trọng.',
      '  + INCORRECT: sai bản chất kiến thức, sai quan hệ, sai công thức/phép toán.',
      '  + PARTIALLY_CORRECT: có phần đúng nhưng thiếu thông tin quan trọng (thiếu giải thích ký hiệu/đơn vị, thiếu điều kiện áp dụng, phát biểu chưa trọn vẹn).',
      '  + UNVERIFIED: CHỈ dùng khi thông tin riêng lẻ/mơ hồ/không đủ ngữ cảnh để xác minh. KHÔNG dùng cho định nghĩa/công thức phổ thông.',
      '  + OCR_UNCERTAIN: độ tin cậy OCR < 0.65.',
      '  + OUT_OF_SCOPE: nội dung lạc đề hoàn toàn khỏi môn học.',
      '- KIỂM TRA CHÉO: Nếu explanation chỉ ra học sinh viết sai → evaluationStatus BẮT BUỘC là INCORRECT. Nếu explanation chỉ ra học sinh viết thiếu ký hiệu/đơn vị/điều kiện → evaluationStatus BẮT BUỘC là PARTIALLY_CORRECT. CẤM TUYỆT ĐỐI việc giải thích 1 đằng mà chấm trạng thái 1 nẻo.',
      '- Gán trọng số importanceWeight: 3 (cốt lõi), 2 (hỗ trợ/chú thích ký hiệu), 1 (chi tiết mở rộng).',
      '- Tuyệt đối KHÔNG bịa URL hay số trang SGK nếu không có trong ngữ cảnh.',
      '- Viết rõ ràng, trực diện, súc tích (mỗi explanation/correctKnowledge/suggestedFix tối đa 2-3 câu ngắn gọn đi thẳng vào điểm sai hoặc điểm thiếu; weaknesses tối đa 8 ý; coverageItems tối đa 10 ý; strengths tối đa 4 ý; suggestions tối đa 4 ý).',
      '',
      '=== TÀI LIỆU CỦA HỌC SINH ===',
      formattedStudentBlocks.slice(0, 22000),
      '',
      '=== ĐOẠN TRÍCH SÁCH GIÁO KHOA THAM CHIẾU ===',
      textbookContext.slice(0, 14000),
      '',
      webGroundingSummary
        ? `=== TỔNG HỢP NGUỒN INTERNET ĐÃ GROUNDING ===\n${webGroundingSummary.slice(0, 3500)}`
        : '',
    ].join('\n');

    type RawEvalResult = {
      claims?: Array<{
        blockId?: string;
        sourcePage: number;
        sourceText: string;
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
        concept: string;
        chapter: string;
        importanceWeight: number;
        status: string;
        suggestedAddition: string;
        referenceExcerpt: string;
        referencePage?: number;
      }>;
      strengths?: AnalysisStrength[];
      weaknesses?: Array<{ title: string; detail: string; pageNumber?: number }>;
      suggestions?: Array<{ priority: number; title: string; description: string }>;
    };

    const { data: rawEval, modelId: modelUsed } = await runTaskWithRouter<RawEvalResult>({
      taskType: 'knowledge_analysis',
      config,
      idToken,
      allowGroqRescue: true,
      cacheInput: {
        promptRev: 'v3_audit4layer',
        studentText: formattedStudentBlocks.slice(0, 12000),
        textbookRef: textbookReferenceId,
        grade,
        subject,
        scope,
        chunksDigest: retrievedHits.map((h) => h.chunk.chunkId).join(','),
      },
      runWithModel: async (modelId) =>
        generateJsonWithProvider<RawEvalResult>({
          modelId,
          prompt: analysisPrompt,
          thinkingTier: 'medium',
          maxOutputTokens: 6144,
          timeoutMs: 45_000,
          tokensOut,
          fallbackJson: '{"claims":[],"coverageItems":[],"strengths":[],"weaknesses":[],"suggestions":[]}',
          groqSchemaHint:
            '{"claims":[{"blockId":"...","sourcePage":1,"sourceText":"...","chapter":"...","concept":"...","importanceWeight":1|2|3,"knowledgeType":"textbook_core|advanced_extension|insufficient_evidence","evaluationStatus":"CORRECT|PARTIALLY_CORRECT|INCORRECT|MISSING|UNVERIFIED|AMBIGUOUS|OCR_UNCERTAIN|OUT_OF_SCOPE","explanation":"...","correctKnowledge":"...","suggestedFix":"..."}],"coverageItems":[{"concept":"...","chapter":"...","importanceWeight":1|2|3,"status":"COVERED|PARTIALLY_COVERED|MISSING|OUT_OF_SCOPE","suggestedAddition":"...","referenceExcerpt":"...","referencePage":1}],"strengths":[{"title":"...","detail":"...","sourceExcerpt":"...","pageNumber":1}],"weaknesses":[{"title":"...","detail":"...","pageNumber":1}],"suggestions":[{"priority":1,"title":"...","description":"..."}]}',
          geminiSchema: {
            type: Type.OBJECT,
            properties: {
              claims: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    blockId: { type: Type.STRING },
                    sourcePage: { type: Type.INTEGER },
                    sourceText: { type: Type.STRING },
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

    const claims: ExtractedClaim[] = (rawEval.claims || []).map((c, idx) => {
      const matchedBlock = c.blockId ? blockMap.get(c.blockId) : undefined;
      const ocrConf = matchedBlock ? matchedBlock.confidence : 0.9;
      let status: ClaimStatus = validStatuses.has(c.evaluationStatus as ClaimStatus)
        ? (c.evaluationStatus as ClaimStatus)
        : 'UNVERIFIED';

      if (ocrConf < 0.65 && status === 'INCORRECT') {
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

      return {
        claimId: `claim_${idx + 1}_${crypto.randomBytes(2).toString('hex')}`,
        sourceText: c.sourceText,
        normalizedMeaning: c.sourceText,
        subject,
        chapter: c.chapter || selectedChapters[0] || 'Tổng hợp',
        concept: c.concept || 'Khái niệm chính',
        importanceLevel: importanceWeight === 3 ? 'core' : importanceWeight === 1 ? 'detail' : 'supporting',
        importanceWeight,
        sourcePage: c.sourcePage || matchedBlock?.pageNumber || 1,
        ...(matchedBlock?.blockId ? { blockId: matchedBlock.blockId } : {}),
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

    const coverageItems: KnowledgeCoverageItem[] = (rawEval.coverageItems || []).map((item, idx) => {
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
        suggestedAddition: item.suggestedAddition,
        referenceExcerpt: item.referenceExcerpt,
        ...(typeof item.referencePage === 'number' && item.referencePage > 0
          ? { referencePage: item.referencePage }
          : {}),
      };
    });

    const hasTextbook = Boolean(textbookReferenceId && referenceChunks.length > 0);
    const hasValidScope = Boolean(
      hasTextbook || selectedChapters.length > 0 || scope.trim().length > 0 || coverageItems.length > 0
    );

    const accuracyBreakdown = calculateAccuracyScore(claims, hasTextbook);
    const completenessBreakdown = calculateCompletenessScore(coverageItems, hasValidScope);

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
        textExcerpt: claim.sourceText,
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

    return {
      questions: validation.questions.slice(0, totalWanted),
      supplementedFromTextbook: needsTextbookSupplement,
      supplementNotice: needsTextbookSupplement
        ? `Nội dung tải lên chỉ tạo được ít hơn 5 câu hỏi khác nhau (${distinctUploadConcepts.size} ý). Hệ thống đã tự động bổ sung thêm từ kiến thức sách giáo khoa / tham chiếu chuẩn để đủ ${Math.min(validation.questions.length, baseTargetCount)} câu.`
        : undefined,
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

    let extractedTextContent = '';
    const inlineParts: Array<{ inlineData: { mimeType: string; data: string } }> = [];

    if (first.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const mammothMod = await import('mammoth');
      const mammothApi = mammothMod.default || mammothMod;
      const result = await mammothApi.extractRawText({ buffer: first.buffer });
      extractedTextContent = (result.value || '').trim();
      if (!extractedTextContent) {
        throw new Error('File DOCX không có văn bản đọc được.');
      }
    } else if (first.mimeType === 'application/pdf') {
      try {
        const { extractPdfPagesFromBuffer } = await import('./referenceIngestService.js');
        const textPages = await extractPdfPagesFromBuffer(first.buffer);
        const joined = textPages.map((p) => `--- TRANG ${p.pageNumber} ---\n${p.text}`).join('\n\n');
        if (joined.replace(/\s+/g, '').length >= 80) {
          extractedTextContent = joined;
        }
      } catch {
        // Fall back to multimodal PDF below
      }
      if (!extractedTextContent) {
        inlineParts.push({
          inlineData: {
            mimeType: 'application/pdf',
            data: first.buffer.toString('base64'),
          },
        });
      }
    } else {
      for (const f of files) {
        inlineParts.push({
          inlineData: {
            mimeType: f.mimeType,
            data: f.buffer.toString('base64'),
          },
        });
      }
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

    const ai = await createServerAiClient();
    const { data: parsed } = await runTaskWithRouter<{
      detectedTitle?: string;
      questions: RawCopiedQuestion[];
    }>({
      taskType: 'curriculum_extraction',
      config,
      idToken,
      bypassCache: true,
      runWithModel: async (modelId) => {
        const safeModel =
          inlineParts.length > 0 && isGroqModelId(modelId) ? 'gemini-4-hydrogen' : modelId;
        const contents =
          inlineParts.length > 0
            ? { parts: [...inlineParts, { text: promptText }] }
            : promptText;
        const resp = await callWithTimeout((signal) =>
          ai.models.generateContent({
            model: safeModel,
            contents,
            config: {
              thinkingConfig: thinkingConfigForModel(safeModel, 'minimal'),
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
        return JSON.parse((resp.text || '{"questions":[]}').trim()) as {
          detectedTitle?: string;
          questions: RawCopiedQuestion[];
        };
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
