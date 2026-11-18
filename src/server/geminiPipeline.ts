import crypto from 'node:crypto';
import { GoogleGenAI, ThinkingLevel, Type, type GenerateContentResponse } from '@google/genai';
import mammoth from 'mammoth';
import {
  calculateAccuracyScore,
  calculateCompletenessScore,
} from '../core/scoring';
import { retrieveRelevantChunks } from '../core/retrieval';
import type {
  AnalysisStrength,
  AnalysisWeakness,
  AnnotationItem,
  ClaimStatus,
  ExtractedClaim,
  ExtractedPage,
  ExtractedTextBlock,
  GradeLevel,
  ImprovementSuggestion,
  KnowledgeCoverageItem,
  QuizDifficulty,
  QuizQuestion,
  QuizScope,
  ReferenceChunk,
  ReferenceEvidence,
  SubjectId,
} from '../core/types';
import { SUBJECT_LABELS } from '../core/types';
import { resolveActiveGeminiApiKey } from './singleKeyService';
import { getActiveModel } from './aiGuardService';

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

async function createAiClient(): Promise<GoogleGenAI> {
  const apiKey = await resolveActiveGeminiApiKey();
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function isTransientError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('429') ||
    msg.includes('500') ||
    msg.includes('502') ||
    msg.includes('503') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('DEADLINE_EXCEEDED') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('ECONNRESET')
  );
}

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt += 1;
      if (attempt > maxRetries || !isTransientError(err)) {
        throw err;
      }
      const delayMs = 600 * Math.pow(2, attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

export class DocumentExtractionService {
  static async extractFromImageBuffers(
    files: Array<{ buffer: Buffer; mimeType: string; originalName: string }>,
    tokensOut: TokenTelemetry
  ): Promise<ExtractedPage[]> {
    const ai = await createAiClient();
    const pages: ExtractedPage[] = [];

    for (let idx = 0; idx < files.length; idx++) {
      const file = files[idx];
      const pageNum = idx + 1;
      const base64 = file.buffer.toString('base64');

      const response = await withRetry(() =>
        ai.models.generateContent({
          model: getActiveModel(),
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
                  'Hãy trích xuất toàn bộ nội dung văn bản, công thức, bảng biểu và chữ viết tay (nếu có) từ trang tài liệu học tập này.',
                  'Yêu cầu:',
                  '- Giữ nguyên chính tả và nội dung gốc của học sinh, KHÔNG tự sửa lỗi kiến thức trong tài liệu.',
                  '- Phân tách thành các khối văn bản có thứ tự đọc (readingOrder).',
                  '- Cung cấp tọa độ chuẩn hóa boundingBox (x, y, width, height từ 0.0 đến 1.0 theo kích thước ảnh). Nếu không chắc chắn vùng tọa độ, hãy ước lượng cẩn thận hoặc đặt null.',
                  '- Đánh giá độ tin cậy OCR (confidence từ 0.0 đến 1.0) trung thực: chữ viết tay mờ hoặc bị cắt thì đánh confidence < 0.65.',
                ].join('\n'),
              },
            ],
          },
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
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
                      x: { type: Type.NUMBER },
                      y: { type: Type.NUMBER },
                      width: { type: Type.NUMBER },
                      height: { type: Type.NUMBER },
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
      const parsed = JSON.parse((response.text || '{"blocks":[]}').trim()) as {
        blocks: Array<{
          extractedText: string;
          textType: string;
          confidence: number;
          formulaText?: string;
          x?: number;
          y?: number;
          width?: number;
          height?: number;
        }>;
      };

      const validTypes = new Set(['paragraph', 'heading', 'formula', 'table', 'list', 'handwriting']);
      const blocks: ExtractedTextBlock[] = (parsed.blocks || [])
        .filter((b) => b.extractedText && b.extractedText.trim().length > 0)
        .map((b, bIdx) => {
          const hasBox =
            typeof b.x === 'number' &&
            typeof b.y === 'number' &&
            typeof b.width === 'number' &&
            typeof b.height === 'number' &&
            b.width > 0.01 &&
            b.height > 0.01;
          return {
            blockId: `p${pageNum}_b${bIdx + 1}`,
            pageNumber: pageNum,
            extractedText: b.extractedText.trim(),
            textType: (validTypes.has(b.textType) ? b.textType : 'paragraph') as ExtractedTextBlock['textType'],
            confidence: Math.max(0, Math.min(1, Number(b.confidence) || 0.8)),
            readingOrder: bIdx + 1,
            formulaText: b.formulaText || undefined,
            boundingBox: hasBox
              ? {
                  x: Math.max(0, Math.min(0.95, b.x!)),
                  y: Math.max(0, Math.min(0.95, b.y!)),
                  width: Math.max(0.03, Math.min(1 - Math.max(0, b.x!), b.width!)),
                  height: Math.max(0.02, Math.min(1 - Math.max(0, b.y!), b.height!)),
                }
              : null,
          };
        });

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

  static async extractFromPdfBuffer(buffer: Buffer, tokensOut: TokenTelemetry): Promise<ExtractedPage[]> {
    // First attempt direct PDF text layer extraction via pdfjs-dist
    try {
      const { extractPdfPagesFromBuffer } = await import('./referenceIngestService');
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

    const ai = await createAiClient();
    const base64 = buffer.toString('base64');
    const response = await withRetry(() =>
      ai.models.generateContent({
        model: getActiveModel(),
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: 'application/pdf',
                data: base64,
              },
            },
            {
              text: 'Trích xuất văn bản, công thức và bảng biểu theo từng trang của file PDF học tập này. Giữ nguyên nội dung gốc của học sinh (không tự sửa lỗi kiến thức). Trả về danh sách các trang và từng đoạn văn bản với độ tin cậy OCR.',
            },
          ],
        },
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
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
    const parsed = JSON.parse((response.text || '{"pages":[]}').trim()) as {
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
        formulaText: b.formulaText || undefined,
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
    const result = await mammoth.extractRawText({ buffer });
    const raw = (result.value || '').trim();
    if (!raw) {
      throw new Error('File DOCX không có văn bản đọc được hoặc bị hỏng.');
    }
    const paragraphs = raw
      .split(/\n+/)
      .map((l) => l.trim())
      .filter(Boolean);

    // Group into logical preview pages (~18 blocks per page) so long DOCX doesn't truncate
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
    tokensOut: TokenTelemetry
  ): Promise<{
    suggestedGrade: GradeLevel;
    suggestedSubject: SubjectId;
    suggestedChapters: string[];
    suggestedTitle: string;
  }> {
    const ai = await createAiClient();
    const response = await withRetry(() =>
      ai.models.generateContent({
        model: getActiveModel(),
        contents: `Phân tích đoạn ghi chép học tập sau đây để đề xuất lớp (10, 11 hoặc 12), môn học THPT và tên chủ đề/chương phù hợp:\n\n${sampleText.slice(0, 4000)}`,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
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
        },
      })
    );
    accumulateTokens(tokensOut, response);

    const parsed = JSON.parse((response.text || '{}').trim()) as {
      suggestedGrade?: string;
      suggestedSubject?: string;
      suggestedChapters?: string[];
      suggestedTitle?: string;
    };

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
    } = params;

    const ai = await createAiClient();
    const subjectName = SUBJECT_LABELS[subject];

    // Prepare full student text across ALL pages (never drop middle pages!)
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

    // Retrieve top textbook chunks across the document
    const fullText = pages.map((p) => p.rawText).join('\n');
    const retrievedHits = retrieveRelevantChunks(fullText, referenceChunks, {
      referenceId: textbookReferenceId || undefined,
      selectedChapters: selectedChapters.length > 0 ? selectedChapters : undefined,
      topK: 14,
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

    // Optional Pass: Real Google Search Grounding for advanced / beyond-textbook verification
    let webSources: ReferenceEvidence[] = [];
    let webGroundingSummary = '';
    let usedWebGrounding = false;
    let webGroundingNotice: string | undefined;

    if (enableWebGrounding) {
      try {
        const searchPrompt = [
          `Kiểm chứng các khái niệm nâng cao hoặc nội dung chưa có đủ trong sách giáo khoa đối với môn ${subjectName} lớp ${grade}, phạm vi: ${scope || selectedChapters.join(', ') || 'Tổng hợp'}.`,
          'Ưu tiên tuyệt đối nguồn chính thống: Bộ GD&ĐT, đại học, viện nghiên cứu, tạp chí khoa học, nhà xuất bản giáo dục uy tín.',
          'Tóm tắt các điểm kiến thức chuẩn kèm trích dẫn thực tế để đối chiếu với bài ghi sau:',
          fullText.slice(0, 6000),
        ].join('\n\n');

        const groundResp = await withRetry(() =>
          ai.models.generateContent({
            model: getActiveModel(),
            contents: searchPrompt,
            config: {
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
              tools: [{ googleSearch: {} }],
            },
          })
        );
        accumulateTokens(tokensOut, groundResp);

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
            'Google Search Grounding không trả về nguồn web trích dẫn cụ thể cho nội dung này; hệ thống chỉ đánh giá dựa trên kho sách tham chiếu.';
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        webGroundingNotice = `Không thể truy vấn Google Search Grounding (${msg.slice(0, 90)}). Đánh giá được thực hiện dựa trên kho sách tham chiếu.`;
      }
    }

    // Multi-pass structured Claim Extraction + Verification + Completeness Mapping
    const analysisPrompt = [
      'Bạn là chuyên gia kiểm định kiến thức giáo dục THPT Việt Nam của StudyCheck AI.',
      `Môn học: ${subjectName} | Lớp: ${grade} | Sách tham chiếu: ${textbookTitle || 'Chưa chọn sách cố định'} | Phạm vi: ${scope || selectedChapters.join(', ') || 'Chưa chỉ định phạm vi cụ thể'}`,
      '',
      'NGUYÊN TẮC BẮT BUỘC:',
      '1. Chia tài liệu học sinh thành các đơn vị kiến thức (claims) có nghĩa, không cắt vụn vô nghĩa và không bỏ qua các trang giữa.',
      '2. Phân biệt rõ: CORRECT (đúng bản chất, dù diễn đạt khác sách giáo khoa), PARTIALLY_CORRECT (đúng một phần nhưng thiếu điều kiện/phạm vi), INCORRECT (sai có căn cứ rõ ràng), MISSING (kiến thức quan trọng trong phạm vi bị thiếu), UNVERIFIED (chưa đủ nguồn kiểm chứng - TUYỆT ĐỐI KHÔNG tự kết luận là sai), AMBIGUOUS (mơ hồ nhiều nghĩa), OCR_UNCERTAIN (độ tin cậy OCR < 0.65 - KHÔNG kết luận lỗi kiến thức), OUT_OF_SCOPE (ngoài phạm vi chương trình đang xét).',
      '3. Gán trọng số importanceWeight: 3 (cốt lõi), 2 (hỗ trợ), 1 (chi tiết mở rộng).',
      '4. Với mỗi claim, chỉ gắn evidence từ các đoạn trích sách giáo khoa hoặc nguồn web được cung cấp bên dưới. Tuyệt đối KHÔNG bịa URL hay số trang không có trong ngữ cảnh.',
      '5. Xây dựng Knowledge Coverage Map (coverageItems) đánh giá mức độ đầy đủ (COVERED, PARTIALLY_COVERED, MISSING) của tài liệu so với phạm vi tham chiếu.',
      '6. Tổng hợp ưu điểm (phải dẫn trích đoạn gốc), nhược điểm (tách lỗi kiến thức và lỗi trình bày), và đề xuất cải thiện cụ thể.',
      '',
      '=== TÀI LIỆU CỦA HỌC SINH ===',
      formattedStudentBlocks.slice(0, 28000),
      '',
      '=== ĐOẠN TRÍCH SÁCH GIÁO KHOA THAM CHIẾU ===',
      textbookContext.slice(0, 18000),
      '',
      webGroundingSummary
        ? `=== TỔNG HỢP NGUỒN INTERNET ĐÃ GROUNDING ===\n${webGroundingSummary.slice(0, 5000)}`
        : '',
    ].join('\n');

    const evalResp = await withRetry(() =>
      ai.models.generateContent({
        model: getActiveModel(),
        contents: analysisPrompt,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
          responseMimeType: 'application/json',
          responseSchema: {
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
                    normalizedMeaning: { type: Type.STRING },
                    chapter: { type: Type.STRING },
                    concept: { type: Type.STRING },
                    importanceLevel: { type: Type.STRING, description: 'core | supporting | detail' },
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
                    reason: { type: Type.STRING },
                    matchedChunkId: { type: Type.STRING },
                    matchedExcerpt: { type: Type.STRING },
                    matchedPage: { type: Type.INTEGER },
                  },
                  required: [
                    'sourcePage',
                    'sourceText',
                    'normalizedMeaning',
                    'chapter',
                    'concept',
                    'importanceLevel',
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
                    lesson: { type: Type.STRING },
                    importanceWeight: { type: Type.INTEGER },
                    status: { type: Type.STRING, description: 'COVERED | PARTIALLY_COVERED | MISSING | OUT_OF_SCOPE' },
                    suggestedAddition: { type: Type.STRING },
                    referenceExcerpt: { type: Type.STRING },
                    referencePage: { type: Type.INTEGER },
                  },
                  required: ['concept', 'chapter', 'importanceWeight', 'status', 'suggestedAddition', 'referenceExcerpt'],
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
                    category: {
                      type: Type.STRING,
                      description: 'knowledge_error | missing_content | partial_condition | unverified | presentation',
                    },
                    detail: { type: Type.STRING },
                    pageNumber: { type: Type.INTEGER },
                  },
                  required: ['title', 'category', 'detail'],
                },
              },
              suggestions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    priority: { type: Type.INTEGER },
                    actionType: {
                      type: Type.STRING,
                      description: 'fix_error | add_missing | review_partial | practice_weak | explore_extension',
                    },
                    title: { type: Type.STRING },
                    description: { type: Type.STRING },
                  },
                  required: ['priority', 'actionType', 'title', 'description'],
                },
              },
            },
            required: ['claims', 'coverageItems', 'strengths', 'weaknesses', 'suggestions'],
          },
        },
      })
    );

    accumulateTokens(tokensOut, evalResp);

    const rawEval = JSON.parse((evalResp.text || '{}').trim()) as {
      claims?: Array<{
        blockId?: string;
        sourcePage: number;
        sourceText: string;
        normalizedMeaning: string;
        chapter: string;
        concept: string;
        importanceLevel: string;
        importanceWeight: number;
        knowledgeType?: string;
        evaluationStatus: string;
        explanation: string;
        correctKnowledge: string;
        reason?: string;
        matchedChunkId?: string;
        matchedExcerpt?: string;
        matchedPage?: number;
      }>;
      coverageItems?: Array<{
        concept: string;
        chapter: string;
        lesson?: string;
        importanceWeight: number;
        status: string;
        suggestedAddition: string;
        referenceExcerpt: string;
        referencePage?: number;
      }>;
      strengths?: AnalysisStrength[];
      weaknesses?: AnalysisWeakness[];
      suggestions?: ImprovementSuggestion[];
    };

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

      // Enforce OCR safety guard: never penalize low-confidence OCR as INCORRECT
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
          sourceType: textbookReferenceId ? 'textbook' : 'web',
          referenceId: textbookReferenceId || undefined,
          title: textbookTitle || 'Tài liệu tham chiếu',
          pageNumber: c.matchedPage,
          excerpt: c.matchedExcerpt,
        });
      }

      if (usedWebGrounding && c.knowledgeType === 'advanced_extension' && webSources.length > 0) {
        evidences.push(webSources[0]);
      }

      return {
        claimId: `claim_${idx + 1}_${crypto.randomBytes(2).toString('hex')}`,
        sourceText: c.sourceText,
        normalizedMeaning: c.normalizedMeaning,
        subject,
        chapter: c.chapter || selectedChapters[0] || 'Tổng hợp',
        concept: c.concept || 'Khái niệm chính',
        importanceLevel:
          c.importanceLevel === 'core' ? 'core' : c.importanceLevel === 'detail' ? 'detail' : 'supporting',
        importanceWeight,
        sourcePage: c.sourcePage || matchedBlock?.pageNumber || 1,
        blockId: matchedBlock?.blockId,
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
        reason: c.reason,
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
        lesson: item.lesson,
        importanceWeight,
        status: validCov,
        suggestedAddition: item.suggestedAddition,
        referenceExcerpt: item.referenceExcerpt,
        referencePage: item.referencePage,
      };
    });

    const hasTextbook = Boolean(textbookReferenceId && referenceChunks.length > 0);
    const hasValidScope = Boolean(hasTextbook || selectedChapters.length > 0 || scope.trim().length > 0);

    const accuracyBreakdown = calculateAccuracyScore(claims, hasTextbook);
    const completenessBreakdown = calculateCompletenessScore(coverageItems, hasValidScope);

    // Deterministic annotation mapping (never invents random coordinates)
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
        blockId: claim.blockId,
        textExcerpt: claim.sourceText,
        claimId: claim.claimId,
        referenceId: claim.evidences[0]?.referenceId,
        boundingBox: claim.boundingBox || null,
        annotationColor: color,
        reason: claim.explanation,
        evidenceId: claim.evidences[0]?.evidenceId,
      });
    }

    return {
      claims,
      coverageItems,
      annotations,
      strengths: rawEval.strengths || [],
      weaknesses: rawEval.weaknesses || [],
      suggestions: rawEval.suggestions || [],
      webSources,
      usedWebGrounding,
      webGroundingNotice,
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
    count: number;
    difficulty: QuizDifficulty;
    scope: QuizScope;
    chapterFilter?: string;
    tokensOut: TokenTelemetry;
  }): Promise<QuizQuestion[]> {
    const {
      subject,
      grade,
      textbookTitle,
      claims,
      coverageItems,
      count,
      difficulty,
      scope,
      chapterFilter,
      tokensOut,
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

    const contextLines = [
      ...targetClaims.map(
        (c) =>
          `[Claim ${c.claimId} | ${c.evaluationStatus} | ${c.chapter} | ${c.concept}] Học sinh viết: "${c.sourceText}" | Chuẩn: "${c.correctKnowledge}" | Giải thích: "${c.explanation}"`
      ),
      ...missingItems.map(
        (m) =>
          `[Missing | ${m.chapter} | ${m.concept}] Gợi ý: "${m.suggestedAddition}" | Trích dẫn: "${m.referenceExcerpt}"`
      ),
    ];

    const effectiveContext =
      contextLines.length > 0
        ? contextLines.join('\n')
        : claims.map((c) => `${c.concept}: ${c.correctKnowledge}`).join('\n');

    const ai = await createAiClient();
    const diffLabel =
      difficulty === 'basic'
        ? 'Cơ bản (Nhận biết, Thông hiểu)'
        : difficulty === 'medium'
        ? 'Trung bình (Thông hiểu, Vận dụng)'
        : difficulty === 'advanced'
        ? 'Nâng cao (Vận dụng, Vận dụng cao)'
        : 'Hỗn hợp từ Cơ bản đến Vận dụng cao';

    const prompt = [
      `Tạo chính xác ${count} câu hỏi trắc nghiệm ABCD cho học sinh lớp ${grade}, môn ${SUBJECT_LABELS[subject]}.`,
      `Độ khó yêu cầu: ${diffLabel}. Nguồn tham chiếu: ${textbookTitle || 'Kiến thức chuẩn THPT'}.`,
      'YÊU CẦU CHẤT LƯỢNG NGHIÊM NGẶT:',
      '- Mỗi câu CHỈ CÓ DUY NHẤT 1 đáp án đúng (A, B, C hoặc D).',
      '- Không tạo 2 lựa chọn cùng đúng hoặc đáp án nhiễu vô lý.',
      '- Đa dạng góc độ (nhận biết, phân biệt điều kiện, vận dụng tình huống thực tế), không lặp lại 1 khuôn mẫu câu.',
      '- Giải thích rõ vì sao đáp án đúng là chính xác và vì sao các lựa chọn khác sai.',
      '',
      'NGỮ CẢNH KIẾN THỨC CẦN KIỂM TRA:',
      effectiveContext.slice(0, 16000),
    ].join('\n');

    const response = await withRetry(() =>
      ai.models.generateContent({
        model: getActiveModel(),
        contents: prompt,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
          responseMimeType: 'application/json',
          responseSchema: {
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
                    difficulty: { type: Type.STRING, description: 'basic | medium | advanced' },
                    chapter: { type: Type.STRING },
                    concept: { type: Type.STRING },
                    sourceReference: { type: Type.STRING },
                    relatedClaimId: { type: Type.STRING },
                  },
                  required: [
                    'questionText',
                    'optionA',
                    'optionB',
                    'optionC',
                    'optionD',
                    'correctAnswer',
                    'explanation',
                    'difficulty',
                    'chapter',
                    'concept',
                    'sourceReference',
                  ],
                },
              },
            },
            required: ['questions'],
          },
        },
      })
    );

    accumulateTokens(tokensOut, response);

    const parsed = JSON.parse((response.text || '{"questions":[]}').trim()) as {
      questions: Array<{
        questionText: string;
        optionA: string;
        optionB: string;
        optionC: string;
        optionD: string;
        correctAnswer: string;
        explanation: string;
        difficulty: string;
        chapter: string;
        concept: string;
        sourceReference: string;
        relatedClaimId?: string;
      }>;
    };

    const now = new Date().toISOString();
    return (parsed.questions || []).slice(0, count).map((q, idx) => {
      const ans =
        q.correctAnswer === 'A' || q.correctAnswer === 'B' || q.correctAnswer === 'C' || q.correctAnswer === 'D'
          ? q.correctAnswer
          : 'A';
      const diff: QuizQuestion['difficulty'] =
        q.difficulty === 'basic' || q.difficulty === 'advanced' ? q.difficulty : 'medium';

      return {
        questionId: `q_${Date.now()}_${idx + 1}_${crypto.randomBytes(2).toString('hex')}`,
        questionText: q.questionText,
        optionA: q.optionA,
        optionB: q.optionB,
        optionC: q.optionC,
        optionD: q.optionD,
        correctAnswer: ans,
        explanation: q.explanation,
        difficulty: diff,
        subject,
        grade,
        chapter: q.chapter || chapterFilter || 'Tổng hợp',
        concept: q.concept || 'Khái niệm trọng tâm',
        sourceReference: q.sourceReference || textbookTitle || 'Tài liệu tham chiếu',
        relatedClaimId: q.relatedClaimId,
        createdAt: now,
      };
    });
  }
}
