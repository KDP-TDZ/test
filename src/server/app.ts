import crypto from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import {
  firestoreRestDelete,
  firestoreRestGet,
  firestoreRestList,
  firestoreRestSet,
  getAdminAuth,
  invalidateVerifiedTokenCacheForUid,
  PROTECTED_SUPER_ADMIN_EMAILS,
  verifyFirebaseRequest,
  type AuthenticatedUser,
} from './firebaseServer.js';
import {
  checkAiRequestGuard,
  decrementConcurrentJob,
  getAuditLogs,
  getAuthoritativeAiConfigSnapshot,
  getIdempotentResult,
  getUsageStatistics,
  incrementConcurrentJob,
  loadAuthoritativeAiConfig,
  persistUsageSnapshot,
  recordAuditLog,
  recordUsageEvent,
  rollbackAiRequestGuard,
  setIdempotentResult,
  setOneTimeTaskOverride,
  updateAuthoritativeAiConfig,
} from './aiGuardService.js';
import {
  clearCloudflareCredentials,
  clearGroqApiKey,
  clearSingleGeminiApiKey,
  getProviderKeysStatus,
  getSingleKeyStatus,
  hydrateSingleKeyForSuperAdmin,
  isGeminiConfigured,
  setCloudflareCredentials,
  setGroqApiKey,
  setSingleGeminiApiKey,
  testCloudflareCredentials,
  testGroqApiKey,
  testSingleGeminiKey,
} from './singleKeyService.js';
import {
  DocumentExtractionService,
  ExamPipelineService,
  FeedbackAnalysisService,
  FlashcardGenerationService,
  KnowledgeAnalysisService,
  QuizGenerationService,
  SubjectDetectionService,
  TextbookSynthesisService,
  type TokenTelemetry,
} from './geminiPipeline.js';
import {
  ingestReferenceFromDocxBuffer,
  ingestReferenceFromPdfBuffer,
  ingestReferenceFromTextOrJson,
  ingestReferenceFromUrl,
} from './referenceIngestService.js';
import {
  callWithTimeout,
  createServerAiClient,
  generateGeminiContentWithFallback,
  getRecentExecutionLogs,
  MODEL_CATALOG,
  resolveModelForTask,
  testModelConnectivity,
} from './modelRouter.js';
import {
  callGroqChatCompletion,
  fetchAvailableGroqChatModels,
  getGroqApiKey,
  isGroqConfigured,
} from './groqProvider.js';
import { callCloudflareChatCompletion, isCloudflareConfigured } from './cloudflareProvider.js';
import {
  SUBJECT_LABELS,
  type AiTaskType,
  type ExamBlueprint,
  type ExamDocument,
  type ExamQuestion,
  type ExamType,
  type ExtractedPage,
  type GradeLevel,
  type QuizDifficulty,
  type QuizScope,
  type ReferenceChunk,
  type SubjectId,
} from '../core/types.js';
import {
  buildFileNameSuggestionCacheKey,
  inferGradeAndSubjectFromFileNames,
  isGenericCameraFileNames,
  validateUploadFileSize,
} from '../core/uploadBatching.js';

const filenameScopeServerCache = new Map<
  string,
  { suggestedGrade: GradeLevel; suggestedSubject: 'auto' | SubjectId; source: string }
>();

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthenticatedUser;
    }
  }
}

const ALLOWED_UPLOAD_MIMES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024,
    files: 25,
  },
});

function hasValidMagicSignature(buffer: Buffer, mimeType: string): boolean {
  if (buffer.length < 4) return false;
  if (mimeType === 'application/pdf') {
    return buffer.subarray(0, 4).toString('ascii') === '%PDF';
  }
  if (mimeType === 'image/png') {
    return buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  }
  if (mimeType === 'image/jpeg') {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (mimeType === 'image/webp') {
    return buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  }
  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
  }
  return false;
}

async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const authUser = await verifyFirebaseRequest(req);
    if (!authUser.emailVerified) {
      res.status(403).json({
        code: 'EMAIL_NOT_VERIFIED',
        error: 'Vui lòng xác minh địa chỉ email trước khi sử dụng tính năng xử lý tài liệu.',
      });
      return;
    }
    await hydrateSingleKeyForSuperAdmin(authUser.idToken);
    req.authUser = authUser;
    next();
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unauthorized';
    res.status(401).json({
      code: 'UNAUTHORIZED',
      error: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại.',
      detail: msg,
    });
  }
}

async function requireSuperAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    let authed = false;
    await requireAuth(req, res, () => {
      authed = true;
    });
    if (!authed) return;
    if (!req.authUser?.isSuperAdmin) {
      res.status(403).json({
        code: 'FORBIDDEN_SUPER_ADMIN',
        error: 'Chỉ tài khoản Super Admin được ủy quyền mới có quyền truy cập khu vực quản trị này.',
      });
      return;
    }
    next();
  } catch (err) {
    if (res.headersSent) return;
    res.status(500).json({
      code: 'AUTH_MIDDLEWARE_ERROR',
      error: err instanceof Error ? err.message : 'Lỗi xác thực quyền quản trị.',
    });
  }
}

function mapGeminiErrorResponse(err: unknown): {
  status: number;
  code: string;
  error: string;
  technicalDetail: string;
  debug: {
    activeModel: string;
    configuredProviders: { groq: boolean; gemini: boolean; cloudflare: boolean };
    recentExecutions: ReturnType<typeof getRecentExecutionLogs>;
    timestamp: string;
  };
} {
  const msg = err instanceof Error ? err.message : String(err);
  const cfg = getAuthoritativeAiConfigSnapshot();
  const configuredProviders = {
    groq: isGroqConfigured(),
    gemini: isGeminiConfigured(),
    cloudflare: isCloudflareConfigured(),
  };
  const debug = {
    activeModel: cfg.activeModel,
    configuredProviders,
    recentExecutions: getRecentExecutionLogs().slice(0, 6),
    timestamp: new Date().toISOString(),
  };

  if (msg.includes('vượt quá thời gian chờ') || msg.includes('AbortError') || msg.includes('timed out')) {
    return {
      status: 504,
      code: 'AI_TIMEOUT',
      error: 'AI phản hồi quá thời gian chờ nên hệ thống đã tự động ngắt để bảo vệ kết nối. Vui lòng thử lại.',
      technicalDetail: msg,
      debug,
    };
  }
  if (msg.includes('GROQ_API_KEY_UNCONFIGURED') || msg.includes('Chưa cấu hình Groq API Key')) {
    return {
      status: 503,
      code: 'GROQ_KEY_MISSING',
      error:
        'Hệ thống chưa có Groq API Key. Quản trị viên vui lòng vào Quản trị hệ thống → API Key & Bảo mật để dán Groq API Key (gsk_...).',
      technicalDetail: msg,
      debug,
    };
  }
  if (
    msg.includes('CLOUDFLARE_CREDENTIALS_UNCONFIGURED') ||
    msg.includes('Chưa cấu hình Cloudflare')
  ) {
    return {
      status: 503,
      code: 'CLOUDFLARE_KEY_MISSING',
      error:
        'Hệ thống chưa cấu hình Cloudflare Workers AI. Quản trị viên vui lòng vào Quản trị hệ thống → API Key & Bảo mật để thêm Account ID & Token.',
      technicalDetail: msg,
      debug,
    };
  }
  if (msg.includes('GEMINI_API_KEY_UNCONFIGURED')) {
    return {
      status: 503,
      code: 'GEMINI_KEY_MISSING',
      error:
        'Chưa cấu hình khóa API cho AI đang chọn (ưu tiên thêm Groq API Key hoặc Gemini API Key tại Quản trị hệ thống → API Key & Bảo mật).',
      technicalDetail: msg,
      debug,
    };
  }
  if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('429')) {
    return {
      status: 429,
      code: 'PROVIDER_QUOTA_EXCEEDED',
      error: `Dịch vụ AI tạm thời đạt giới hạn lưu lượng (429). Chi tiết: ${msg.slice(0, 180)}`,
      technicalDetail: msg,
      debug,
    };
  }
  if (msg.includes('API_KEY_INVALID') || msg.includes('PERMISSION_DENIED') || msg.includes('403') || msg.includes('401')) {
    return {
      status: 502,
      code: 'PROVIDER_AUTH_ERROR',
      error: `Khóa API AI hiện tại không hợp lệ hoặc không có quyền truy cập model. Chi tiết: ${msg.slice(0, 220)}`,
      technicalDetail: msg,
      debug,
    };
  }
  if (msg.includes('NOT_FOUND') || msg.includes('404')) {
    const activeProvidersList =
      [
        configuredProviders.groq ? 'Groq' : '',
        configuredProviders.gemini ? 'Gemini' : '',
        configuredProviders.cloudflare ? 'Cloudflare' : '',
      ]
        .filter(Boolean)
        .join(', ') || 'Chưa có khóa nào';
    return {
      status: 502,
      code: 'MODEL_UNAVAILABLE',
      error: `Không tìm thấy model AI khả dụng trên khóa hiện tại (Provider đã cấu hình: ${activeProvidersList}). Chi tiết kỹ thuật: ${msg.slice(0, 280)}`,
      technicalDetail: msg,
      debug,
    };
  }
  return {
    status: 500,
    code: 'AI_PROCESSING_ERROR',
    error: `Không thể hoàn tất xử lý tài liệu: ${msg.slice(0, 260)}`,
    technicalDetail: msg,
    debug,
  };
}

export function createApiApp(): express.Express {
  const app = express();
  app.use(express.json({ limit: '15mb' }));

  const envAllowedOrigins = (process.env.ALLOWED_ORIGIN || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  // Live dynamic CORS combining env var + Admin-managed systemConfig.allowedOrigins (no redeploy required!)
  app.use(async (req, res, next) => {
    try {
      const origin = req.headers.origin;
      const cfg = await loadAuthoritativeAiConfig();
      const combined = Array.from(
        new Set([...envAllowedOrigins, ...(cfg.allowedOrigins || [])].map((o) => o.trim()).filter(Boolean))
      );

      if (origin && (combined.length === 0 || combined.includes('*') || combined.includes(origin))) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      }
      if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
      }
    } catch (err) {
      console.warn('CORS middleware fallback:', err);
    }
    next();
  });

  app.get(['/api', '/api/index', '/api/health'], (_req, res) => {
    res.json({ ok: true, service: 'StudyCheck AI Backend', timestamp: new Date().toISOString() });
  });

  app.get('/api/system/status', async (req, res) => {
    try {
      let token: string | undefined;
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        token = authHeader.slice(7).trim();
      }
      const cfg = await loadAuthoritativeAiConfig(token);
      res.json({
        enabled: cfg.enabled,
        maintenanceMessage: cfg.maintenanceMessage,
        disabledReason: cfg.disabledReason,
        rateLimitConfig: cfg.rateLimitConfig,
        configVersion: cfg.configVersion,
        updatedAt: cfg.updatedAt,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Không thể đọc trạng thái hệ thống.' });
    }
  });

  app.post('/api/auth/session', async (req, res) => {
    try {
      const authUser = await verifyFirebaseRequest(req);
      if (authUser.emailVerified) {
        await hydrateSingleKeyForSuperAdmin(authUser.idToken);
      }
      res.json({
        uid: authUser.uid,
        email: authUser.email,
        emailVerified: authUser.emailVerified,
        isSuperAdmin: authUser.isSuperAdmin,
      });
    } catch {
      res.status(401).json({ error: 'Invalid Firebase ID token' });
    }
  });

  app.post('/api/ai/suggest-from-filename', requireAuth, async (req, res) => {
    const user = req.authUser!;
    const tokens: TokenTelemetry = { promptTokens: 0, candidateTokens: 0, totalTokens: 0 };
    try {
      const rawNames = Array.isArray(req.body?.fileNames) ? req.body.fileNames : [];
      const fileNames: string[] = rawNames
        .map((n: unknown) => (typeof n === 'string' ? n.trim() : ''))
        .filter((n: string) => n.length > 0)
        .slice(0, 25);
      const fallbackGrade: GradeLevel =
        req.body?.defaultGrade === '11' || req.body?.defaultGrade === '12'
          ? req.body.defaultGrade
          : '10';

      if (fileNames.length === 0) {
        res.json({
          suggestedGrade: fallbackGrade,
          suggestedSubject: 'auto',
          source: 'empty',
        });
        return;
      }

      const cacheKey = buildFileNameSuggestionCacheKey(fileNames, fallbackGrade);
      const cached = filenameScopeServerCache.get(cacheKey);
      if (cached) {
        res.json({ ...cached, source: 'cache' });
        return;
      }

      const heuristic = inferGradeAndSubjectFromFileNames(fileNames);
      if (heuristic.confidence === 'high' && heuristic.grade && heuristic.subject) {
        const result = {
          suggestedGrade: heuristic.grade,
          suggestedSubject: heuristic.subject,
          source: 'heuristic',
        };
        filenameScopeServerCache.set(cacheKey, result);
        res.json(result);
        return;
      }

      if (isGenericCameraFileNames(fileNames)) {
        const result = {
          suggestedGrade: heuristic.grade || fallbackGrade,
          suggestedSubject: (heuristic.subject || 'auto') as 'auto' | SubjectId,
          source: 'generic_filename',
        };
        filenameScopeServerCache.set(cacheKey, result);
        res.json(result);
        return;
      }

      const meaningfulText = fileNames
        .map((name) => name.replace(/\.[^.]+$/, '').replace(/[_\-.]+/g, ' ').trim())
        .join(', ');

      const cfg = await loadAuthoritativeAiConfig(user.idToken);
      if (!cfg.enabled) {
        res.json({
          suggestedGrade: heuristic.grade || fallbackGrade,
          suggestedSubject: heuristic.subject || 'auto',
          source: 'heuristic',
        });
        return;
      }

      const aiScope = await SubjectDetectionService.detectScope(
        `Tên tệp tài liệu học tập THPT: ${meaningfulText}`,
        tokens,
        { config: cfg, idToken: user.idToken }
      );

      const finalResult: {
        suggestedGrade: GradeLevel;
        suggestedSubject: 'auto' | SubjectId;
        source: string;
      } = {
        suggestedGrade: heuristic.grade || aiScope.suggestedGrade || fallbackGrade,
        suggestedSubject:
          heuristic.subject ||
          (aiScope.suggestedSubject && aiScope.suggestedSubject !== 'khac'
            ? aiScope.suggestedSubject
            : 'auto'),
        source: 'ai',
      };

      if (filenameScopeServerCache.size >= 200) {
        const firstKey = filenameScopeServerCache.keys().next().value;
        if (firstKey) filenameScopeServerCache.delete(firstKey);
      }
      filenameScopeServerCache.set(cacheKey, finalResult);

      res.json(finalResult);
    } catch {
      const rawNames = Array.isArray(req.body?.fileNames) ? req.body.fileNames : [];
      const heuristic = inferGradeAndSubjectFromFileNames(
        rawNames.filter((n: unknown): n is string => typeof n === 'string')
      );
      res.json({
        suggestedGrade: heuristic.grade || '10',
        suggestedSubject: heuristic.subject || 'auto',
        source: 'heuristic_fallback',
      });
    }
  });

  app.post('/api/ai/extract', requireAuth, upload.array('files', 25), async (req, res) => {
    const user = req.authUser!;
    const tokens: TokenTelemetry = { promptTokens: 0, candidateTokens: 0, totalTokens: 0 };
    try {
      const guard = await checkAiRequestGuard({
        uid: user.uid,
        email: user.email,
        idToken: user.idToken,
        requestType: 'ocr',
      });
      if (!guard.allowed) {
        res.status(guard.httpStatus || 503).json({ code: guard.code, error: guard.message });
        return;
      }

      const uploadedFiles = (req.files as Express.Multer.File[]) || [];
      if (uploadedFiles.length === 0) {
        res.status(400).json({ error: 'Vui lòng chọn ít nhất một tài liệu hợp lệ.' });
        return;
      }

      const adminMaxFileMb = guard.config.rateLimitConfig.maximumFileSizeMb;
      for (const f of uploadedFiles) {
        if (!ALLOWED_UPLOAD_MIMES.has(f.mimetype)) {
          res.status(400).json({
            error: `Định dạng file "${f.originalname}" (${f.mimetype}) không được hỗ trợ. Chỉ chấp nhận PDF, DOCX, JPG, PNG, WEBP.`,
          });
          return;
        }
        const sizeCheck = validateUploadFileSize(
          { name: f.originalname, size: f.size, type: f.mimetype },
          adminMaxFileMb
        );
        if (!sizeCheck.ok) {
          res.status(413).json({
            code: 'PAYLOAD_TOO_LARGE',
            error: sizeCheck.error,
          });
          return;
        }
        if (!hasValidMagicSignature(f.buffer, f.mimetype)) {
          res.status(400).json({
            error: `File "${f.originalname}" có chữ ký nhị phân không khớp định dạng khai báo hoặc bị hỏng.`,
          });
          return;
        }
      }

      const bodyParams = (req.body || {}) as Record<string, string | undefined>;
      const pageOffset = Math.max(0, Number(bodyParams.pageOffset) || 0);
      const skipScope = bodyParams.skipScope === 'true';
      const previousText = (bodyParams.previousText || '').trim();
      const presetGrade: GradeLevel =
        bodyParams.presetGrade === '11' || bodyParams.presetGrade === '12'
          ? bodyParams.presetGrade
          : '10';
      const rawPresetSubject = (bodyParams.presetSubject || '').trim();
      const presetSubject: SubjectId =
        rawPresetSubject && rawPresetSubject in SUBJECT_LABELS
          ? (rawPresetSubject as SubjectId)
          : 'khac';

      const pages: ExtractedPage[] = [];
      const first = uploadedFiles[0];
      const pendingImages: Array<{ buffer: Buffer; mimeType: string; originalName: string }> = [];

      const flushPendingImages = async (): Promise<void> => {
        if (pendingImages.length === 0) return;
        const batch = pendingImages.splice(0, pendingImages.length);
        const extractedImgs = await DocumentExtractionService.extractFromImageBuffers(
          batch,
          tokens,
          {
            config: guard.config,
            idToken: user.idToken,
            pageOffset: pageOffset + pages.length,
          }
        );
        pages.push(...extractedImgs);
      };

      for (const file of uploadedFiles) {
        if (file.mimetype === 'application/pdf') {
          await flushPendingImages();
          const pdfPages = await DocumentExtractionService.extractFromPdfBuffer(file.buffer, tokens, {
            config: guard.config,
            idToken: user.idToken,
          });
          const baseOffset = pageOffset + pages.length;
          for (let i = 0; i < pdfPages.length; i += 1) {
            const pageNum = baseOffset + i + 1;
            const p = pdfPages[i];
            pages.push({
              ...p,
              pageNumber: pageNum,
              blocks: p.blocks.map((b, bIdx) => ({
                ...b,
                blockId: `p${pageNum}_b${bIdx + 1}`,
                pageNumber: pageNum,
              })),
            });
          }
        } else if (
          file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        ) {
          await flushPendingImages();
          const docxPages = await DocumentExtractionService.extractFromDocxBuffer(file.buffer);
          const baseOffset = pageOffset + pages.length;
          for (let i = 0; i < docxPages.length; i += 1) {
            const pageNum = baseOffset + i + 1;
            const p = docxPages[i];
            pages.push({
              ...p,
              pageNumber: pageNum,
              blocks: p.blocks.map((b, bIdx) => ({
                ...b,
                blockId: `p${pageNum}_b${bIdx + 1}`,
                pageNumber: pageNum,
              })),
            });
          }
        } else {
          pendingImages.push({
            buffer: file.buffer,
            mimeType: file.mimetype,
            originalName: file.originalname,
          });
        }
      }
      await flushPendingImages();

      if (pages.length + pageOffset > guard.config.rateLimitConfig.maximumPagesPerAnalysis) {
        res.status(400).json({
          error: `Tài liệu có ${pages.length + pageOffset} trang, vượt quá giới hạn ${guard.config.rateLimitConfig.maximumPagesPerAnalysis} trang cho mỗi lần phân tích.`,
        });
        return;
      }

      const combinedForScope = [previousText, ...pages.map((p) => p.rawText)].filter(Boolean).join('\n');
      const scopeSuggestion =
        !skipScope && combinedForScope.trim().length > 15
          ? await SubjectDetectionService.detectScope(combinedForScope, tokens, {
              config: guard.config,
              idToken: user.idToken,
            })
          : {
              suggestedGrade: presetGrade,
              suggestedSubject: presetSubject,
              suggestedChapters: [],
              suggestedTitle: first.originalname.replace(/\.[^.]+$/, ''),
            };

      recordUsageEvent({
        uid: user.uid,
        email: user.email,
        requestType: 'ocr',
        outcome: 'success',
        promptTokens: tokens.promptTokens,
        candidateTokens: tokens.candidateTokens,
        totalTokens: tokens.totalTokens,
      });
      void persistUsageSnapshot(user.idToken, user.isSuperAdmin, user.uid);

      res.json({ pages, scopeSuggestion, tokenUsage: tokens });
    } catch (err) {
      const mapped = mapGeminiErrorResponse(err);
      recordUsageEvent({
        uid: user.uid,
        email: user.email,
        requestType: 'ocr',
        outcome: 'failed',
        providerError: mapped.status >= 500,
        quotaBlocked: mapped.status === 429,
      });
      res.status(mapped.status).json(mapped);
    }
  });

  app.post('/api/ai/analyze', requireAuth, async (req, res) => {
    const user = req.authUser!;
    const {
      idempotencyKey,
      pages,
      grade,
      subject,
      textbookReferenceId,
      textbookTitle,
      selectedChapters,
      scope,
      referenceChunks,
      enableWebGrounding,
    } = req.body as {
      idempotencyKey?: string;
      pages: ExtractedPage[];
      grade: GradeLevel;
      subject: SubjectId;
      textbookReferenceId?: string;
      textbookTitle?: string;
      selectedChapters?: string[];
      scope?: string;
      referenceChunks?: ReferenceChunk[];
      enableWebGrounding?: boolean;
    };

    if (idempotencyKey) {
      const cached = getIdempotentResult(`${user.uid}:analyze:${idempotencyKey}`);
      if (cached) {
        res.json(cached);
        return;
      }
    }

    if (!Array.isArray(pages) || pages.length === 0) {
      res.status(400).json({ error: 'Thiếu dữ liệu trang tài liệu đã xác nhận OCR.' });
      return;
    }

    let jobStarted = false;
    let guardPassed = false;
    const tokens: TokenTelemetry = { promptTokens: 0, candidateTokens: 0, totalTokens: 0 };

    try {
      const preCfg = await loadAuthoritativeAiConfig(user.idToken);
      if (pages.length > preCfg.rateLimitConfig.maximumPagesPerAnalysis) {
        res.status(400).json({
          error: `Số trang (${pages.length}) vượt quá giới hạn tối đa (${preCfg.rateLimitConfig.maximumPagesPerAnalysis}).`,
        });
        return;
      }

      const guard = await checkAiRequestGuard({
        uid: user.uid,
        email: user.email,
        idToken: user.idToken,
        requestType: 'analysis',
      });
      if (!guard.allowed) {
        res.status(guard.httpStatus || 503).json({ code: guard.code, error: guard.message });
        return;
      }
      guardPassed = true;

      incrementConcurrentJob(user.uid);
      jobStarted = true;
      const result = await KnowledgeAnalysisService.runFullVerification({
        pages,
        grade: grade || '10',
        subject: subject || 'khac',
        textbookReferenceId: textbookReferenceId || '',
        textbookTitle: textbookTitle || '',
        selectedChapters: selectedChapters || [],
        scope: scope || '',
        referenceChunks: referenceChunks || [],
        enableWebGrounding: enableWebGrounding === true,
        tokensOut: tokens,
        config: guard.config,
        idToken: user.idToken,
      });

      const payload = { ...result, tokenUsage: tokens };
      if (idempotencyKey) {
        setIdempotentResult(`${user.uid}:analyze:${idempotencyKey}`, payload);
      }

      recordUsageEvent({
        uid: user.uid,
        email: user.email,
        requestType: 'analysis',
        outcome: 'success',
        webGrounded: result.usedWebGrounding,
        promptTokens: tokens.promptTokens,
        candidateTokens: tokens.candidateTokens,
        totalTokens: tokens.totalTokens,
      });
      void persistUsageSnapshot(user.idToken, user.isSuperAdmin, user.uid);

      res.json(payload);
    } catch (err) {
      if (guardPassed) {
        rollbackAiRequestGuard(user.uid, 'analysis');
      }
      const mapped = mapGeminiErrorResponse(err);
      recordUsageEvent({
        uid: user.uid,
        email: user.email,
        requestType: 'analysis',
        outcome: 'failed',
        providerError: mapped.status >= 500,
        quotaBlocked: mapped.status === 429,
      });
      void persistUsageSnapshot(user.idToken, user.isSuperAdmin, user.uid);
      res.status(mapped.status).json(mapped);
    } finally {
      if (jobStarted) {
        decrementConcurrentJob(user.uid);
      }
    }
  });

  app.post('/api/ai/quiz', requireAuth, async (req, res) => {
    const user = req.authUser!;
    const {
      idempotencyKey,
      subject,
      grade,
      textbookTitle,
      claims,
      coverageItems,
      referenceChunks,
      count,
      difficulty,
      scope,
      chapterFilter,
      advancedEnabled,
      advancedCount,
    } = req.body as {
      idempotencyKey?: string;
      subject: SubjectId;
      grade: GradeLevel;
      textbookTitle: string;
      claims: Parameters<typeof QuizGenerationService.generateQuiz>[0]['claims'];
      coverageItems: Parameters<typeof QuizGenerationService.generateQuiz>[0]['coverageItems'];
      referenceChunks?: ReferenceChunk[];
      count: number;
      difficulty: QuizDifficulty;
      scope: QuizScope;
      chapterFilter?: string;
      advancedEnabled?: boolean;
      advancedCount?: number;
    };

    if (idempotencyKey) {
      const cached = getIdempotentResult(`${user.uid}:quiz:${idempotencyKey}`);
      if (cached) {
        res.json(cached);
        return;
      }
    }

    const safeCount = Math.min(20, Math.max(5, Number(count) || 5));
    const safeAdvancedCount = advancedEnabled ? Math.min(6, Math.max(1, Number(advancedCount) || 2)) : 0;
    const tokens: TokenTelemetry = { promptTokens: 0, candidateTokens: 0, totalTokens: 0 };

    try {
      const guard = await checkAiRequestGuard({
        uid: user.uid,
        email: user.email,
        idToken: user.idToken,
        requestType: 'quiz',
      });
      if (!guard.allowed) {
        res.status(guard.httpStatus || 503).json({ code: guard.code, error: guard.message });
        return;
      }

      const generated = await QuizGenerationService.generateQuiz({
        subject,
        grade,
        textbookTitle,
        claims: claims || [],
        coverageItems: coverageItems || [],
        referenceChunks: referenceChunks || [],
        count: safeCount,
        difficulty: difficulty || 'mixed',
        scope: scope || 'all',
        chapterFilter,
        advancedEnabled: Boolean(advancedEnabled),
        advancedCount: safeAdvancedCount,
        tokensOut: tokens,
        config: guard.config,
        idToken: user.idToken,
      });

      const payload = { ...generated, tokenUsage: tokens };
      if (idempotencyKey) {
        setIdempotentResult(`${user.uid}:quiz:${idempotencyKey}`, payload);
      }

      recordUsageEvent({
        uid: user.uid,
        email: user.email,
        requestType: 'quiz',
        outcome: 'success',
        promptTokens: tokens.promptTokens,
        candidateTokens: tokens.candidateTokens,
        totalTokens: tokens.totalTokens,
      });
      void persistUsageSnapshot(user.idToken, user.isSuperAdmin, user.uid);

      res.json(payload);
    } catch (err) {
      const mapped = mapGeminiErrorResponse(err);
      recordUsageEvent({
        uid: user.uid,
        email: user.email,
        requestType: 'quiz',
        outcome: 'failed',
        providerError: mapped.status >= 500,
        quotaBlocked: mapped.status === 429,
      });
      void persistUsageSnapshot(user.idToken, user.isSuperAdmin, user.uid);
      res.status(mapped.status).json(mapped);
    }
  });

  app.post('/api/ai/flashcards', requireAuth, async (req, res) => {
    const user = req.authUser!;
    const { subject, grade, textbookTitle, claims, coverageItems, count } = (req.body || {}) as {
      subject: SubjectId;
      grade: GradeLevel;
      textbookTitle: string;
      claims: Parameters<typeof FlashcardGenerationService.generateFromAnalysis>[0]['claims'];
      coverageItems: Parameters<typeof FlashcardGenerationService.generateFromAnalysis>[0]['coverageItems'];
      count?: number;
    };
    const tokens: TokenTelemetry = { promptTokens: 0, candidateTokens: 0, totalTokens: 0 };

    try {
      const guard = await checkAiRequestGuard({
        uid: user.uid,
        email: user.email,
        idToken: user.idToken,
        requestType: 'quiz',
      });
      if (!guard.allowed) {
        res.status(guard.httpStatus || 503).json({ code: guard.code, error: guard.message });
        return;
      }

      const cards = await FlashcardGenerationService.generateFromAnalysis({
        ownerUid: user.uid,
        subject: subject || 'khac',
        grade: grade || '10',
        textbookTitle: textbookTitle || 'SGK chuẩn',
        claims: claims || [],
        coverageItems: coverageItems || [],
        count: count || 6,
        tokensOut: tokens,
        config: guard.config,
        idToken: user.idToken,
      });
      recordUsageEvent({
        uid: user.uid,
        email: user.email,
        requestType: 'quiz',
        outcome: 'success',
        promptTokens: tokens.promptTokens,
        candidateTokens: tokens.candidateTokens,
        totalTokens: tokens.totalTokens,
      });
      void persistUsageSnapshot(user.idToken, user.isSuperAdmin, user.uid);
      res.json({ cards, tokenUsage: tokens });
    } catch (err) {
      const mapped = mapGeminiErrorResponse(err);
      recordUsageEvent({
        uid: user.uid,
        email: user.email,
        requestType: 'quiz',
        outcome: 'failed',
        providerError: mapped.status >= 500,
        quotaBlocked: mapped.status === 429,
      });
      void persistUsageSnapshot(user.idToken, user.isSuperAdmin, user.uid);
      res.status(mapped.status).json(mapped);
    }
  });

  app.post('/api/feedback/classify', requireAuth, async (req, res) => {
    const user = req.authUser!;
    const { targetType, category, note } = req.body as {
      targetType: string;
      category: string;
      note: string;
    };
    const tokens: TokenTelemetry = { promptTokens: 0, candidateTokens: 0, totalTokens: 0 };
    try {
      const cfg = await loadAuthoritativeAiConfig(user.idToken);
      const classification = await FeedbackAnalysisService.classifyFeedback({
        targetType: targetType || 'claim',
        category: category || '',
        note: note || '',
        tokensOut: tokens,
        config: cfg,
        idToken: user.idToken,
      });
      res.json({ classification });
    } catch {
      res.json({ classification: 'Cần Admin đối chiếu thêm với tài liệu nguồn.' });
    }
  });

  // --- Super Admin Endpoints ---
  app.get('/api/admin/overview', requireSuperAdmin, async (req, res) => {
    const user = req.authUser!;
    try {
      const [config, usageStats, auditLogs, singleKeyStatus, providerKeys] = await Promise.all([
        loadAuthoritativeAiConfig(user.idToken),
        getUsageStatistics(user.idToken).catch(() => ({
          today: {
            date: new Date().toISOString().slice(0, 10),
            requestCount: 0,
            successfulCount: 0,
            failedCount: 0,
            blockedCount: 0,
            analysisCount: 0,
            quizGenerationCount: 0,
            ocrCount: 0,
            webGroundedCount: 0,
            actualPromptTokens: 0,
            actualCandidateTokens: 0,
            actualTotalTokens: 0,
            quotaExceededEvents: 0,
            providerErrorEvents: 0,
            updatedAt: new Date().toISOString(),
          },
          dailySeries: [],
          perUserToday: [],
        })),
        getAuditLogs(user.idToken).catch(() => []),
        getSingleKeyStatus(user.idToken).catch(() => ({
          configured: false,
          source: 'none' as const,
          maskedKey: '',
          label: '',
          hasEnvFallbackKey: false,
          lastTestStatus: 'Untested' as const,
        })),
        getProviderKeysStatus(user.idToken).catch(() => ({
          groq: {
            configured: false,
            source: 'none' as const,
            maskedKey: '',
            label: '',
            hasEnvFallbackKey: false,
            lastTestStatus: 'Untested' as const,
          },
          cloudflare: {
            configured: false,
            source: 'none' as const,
            maskedAccountId: '',
            maskedKey: '',
            label: '',
            hasEnvFallbackKey: false,
            lastTestStatus: 'Untested' as const,
          },
        })),
      ]);
      res.json({
        config,
        usageStats,
        auditLogs,
        singleKeyStatus,
        providerKeys,
        groqConfigured: isGroqConfigured(),
        cloudflareConfigured: isCloudflareConfigured(),
        executionLogs: getRecentExecutionLogs(),
        modelCatalog: MODEL_CATALOG,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Không tải được dữ liệu tổng quan quản trị.' });
    }
  });

  app.patch('/api/admin/ai-service', requireSuperAdmin, async (req, res) => {
    const user = req.authUser!;
    try {
      const {
        enabled,
        disabledReason,
        maintenanceMessage,
        rateLimitConfig,
        activeModel,
        allowedOrigins,
        taskModels,
      } = req.body || {};
      const updated = await updateAuthoritativeAiConfig(
        {
          ...(typeof enabled === 'boolean' ? { enabled } : {}),
          ...(typeof disabledReason === 'string' ? { disabledReason: disabledReason.slice(0, 300) } : {}),
          ...(typeof maintenanceMessage === 'string'
            ? { maintenanceMessage: maintenanceMessage.slice(0, 400) }
            : {}),
          ...(rateLimitConfig ? { rateLimitConfig } : {}),
          ...(typeof activeModel === 'string' ? { activeModel } : {}),
          ...(Array.isArray(allowedOrigins) ? { allowedOrigins } : {}),
          ...(taskModels && typeof taskModels === 'object' ? { taskModels } : {}),
        },
        user.uid,
        user.email,
        user.idToken
      );
      res.json({ config: updated });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Không thể cập nhật cấu hình dịch vụ AI.' });
    }
  });

  app.post('/api/admin/models/override', requireSuperAdmin, async (req, res) => {
    const user = req.authUser!;
    try {
      const { taskType, modelId } = (req.body || {}) as { taskType: AiTaskType; modelId: string | null };
      if (!taskType) {
        res.status(400).json({ error: 'Thiếu taskType.' });
        return;
      }
      const updated = await setOneTimeTaskOverride({
        taskType,
        modelId: modelId || null,
        actorUid: user.uid,
        actorEmail: user.email,
        idToken: user.idToken,
      });
      res.json({ config: updated });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Không thể đặt model override.' });
    }
  });

  app.post('/api/admin/models/test', requireSuperAdmin, async (req, res) => {
    try {
      const { modelId } = (req.body || {}) as { modelId?: string };
      const targetModel = (modelId || 'gemini-2.5-flash').trim();
      const result = await testModelConnectivity(targetModel);
      res.json(result);
    } catch (err) {
      res.status(500).json({
        ok: false,
        modelId: String(req.body?.modelId || 'gemini-2.5-flash'),
        latencyMs: 0,
        message: err instanceof Error ? err.message : 'Không thể kiểm tra kết nối model.',
      });
    }
  });

  app.get('/api/admin/debug/snapshot', requireSuperAdmin, async (req, res) => {
    const user = req.authUser!;
    try {
      const [config, singleKeyStatus, providerKeys] = await Promise.all([
        loadAuthoritativeAiConfig(user.idToken),
        getSingleKeyStatus(user.idToken),
        getProviderKeysStatus(user.idToken),
      ]);
      const taskTypes: AiTaskType[] = [
        'subject_classification',
        'curriculum_extraction',
        'claim_validation',
        'knowledge_analysis',
        'completeness_analysis',
        'quiz_blueprint',
        'quiz_generation',
        'feedback_classification',
      ];
      const taskRouting = taskTypes.map((t) => resolveModelForTask(t, config));
      res.json({
        timestamp: new Date().toISOString(),
        adminEmail: user.email,
        activeModel: config.activeModel,
        enabled: config.enabled,
        configuredProviders: {
          groq: isGroqConfigured(),
          gemini: isGeminiConfigured(),
          cloudflare: isCloudflareConfigured(),
        },
        singleKeyStatus,
        providerKeys,
        taskRouting,
        executionLogs: getRecentExecutionLogs().slice(0, 40),
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Không thể tải snapshot debug hệ thống.',
      });
    }
  });

  app.post('/api/admin/debug/diagnostics', requireSuperAdmin, async (req, res) => {
    const user = req.authUser!;
    try {
      const config = await loadAuthoritativeAiConfig(user.idToken);
      const checks: Array<{
        provider: 'groq' | 'gemini' | 'cloudflare';
        mode: 'text' | 'json_schema';
        configured: boolean;
        ok: boolean;
        requestedModel: string;
        resolvedModel: string;
        latencyMs: number;
        detail: string;
        availableModels?: string[];
      }> = [];

      // 1. Probe Groq (Text + JSON mode)
      if (isGroqConfigured()) {
        const groqKey = getGroqApiKey();
        const availableGroq = await fetchAvailableGroqChatModels(groqKey, undefined, true);
        const targetGroq = config.activeModel.startsWith('groq:')
          ? config.activeModel
          : 'groq:openai/gpt-oss-120b';
        const tStart = Date.now();
        try {
          const jsonResp = await callWithTimeout(
            (signal) =>
              callGroqChatCompletion({
                modelId: targetGroq,
                prompt: 'Kiểm tra JSON mode cho hệ thống Kiểm định: trả về {"status":"OK","subject":"vat_ly"}',
                jsonMode: true,
                jsonSchemaHint: '{"status":"OK","subject":"vat_ly"}',
                maxOutputTokens: 256,
                signal,
              }),
            15_000
          );
          const parsed = JSON.parse(jsonResp.text || '{}') as { status?: string };
          checks.push({
            provider: 'groq',
            mode: 'json_schema',
            configured: true,
            ok: Boolean(parsed && typeof parsed === 'object'),
            requestedModel: targetGroq,
            resolvedModel: jsonResp.resolvedModel || targetGroq,
            latencyMs: Date.now() - tStart,
            detail: `JSON Mode thành công (${jsonResp.text.slice(0, 90)})`,
            availableModels: availableGroq.slice(0, 12),
          });
        } catch (err) {
          checks.push({
            provider: 'groq',
            mode: 'json_schema',
            configured: true,
            ok: false,
            requestedModel: targetGroq,
            resolvedModel: targetGroq,
            latencyMs: Date.now() - tStart,
            detail: err instanceof Error ? err.message : String(err),
            availableModels: availableGroq.slice(0, 12),
          });
        }
      } else {
        checks.push({
          provider: 'groq',
          mode: 'json_schema',
          configured: false,
          ok: false,
          requestedModel: 'groq:openai/gpt-oss-120b',
          resolvedModel: '-',
          latencyMs: 0,
          detail: 'Chưa cấu hình Groq API Key.',
        });
      }

      // 2. Probe Gemini (Text + JSON mode)
      if (isGeminiConfigured()) {
        const targetGemini =
          !config.activeModel.startsWith('groq:') && !config.activeModel.startsWith('cf:')
            ? config.activeModel
            : 'gemini-2.5-flash';
        const gStart = Date.now();
        try {
          const ai = await createServerAiClient();
          const gemResp = await callWithTimeout(
            (signal) =>
              generateGeminiContentWithFallback({
                ai,
                model: targetGemini,
                contents: 'Trả về JSON đúng chuẩn: {"status":"OK","provider":"gemini"}',
                thinkingTier: 'minimal',
                config: {
                  maxOutputTokens: 256,
                  abortSignal: signal,
                  responseMimeType: 'application/json',
                },
              }),
            15_000
          );
          const parsed = JSON.parse(gemResp.text || '{}') as { status?: string };
          checks.push({
            provider: 'gemini',
            mode: 'json_schema',
            configured: true,
            ok: Boolean(parsed && typeof parsed === 'object'),
            requestedModel: targetGemini,
            resolvedModel: gemResp.resolvedModel,
            latencyMs: Date.now() - gStart,
            detail: `JSON Mode thành công trên ${gemResp.resolvedModel} (${gemResp.text.slice(0, 90)})`,
          });
        } catch (err) {
          checks.push({
            provider: 'gemini',
            mode: 'json_schema',
            configured: true,
            ok: false,
            requestedModel: targetGemini,
            resolvedModel: targetGemini,
            latencyMs: Date.now() - gStart,
            detail: err instanceof Error ? err.message : String(err),
          });
        }
      } else {
        checks.push({
          provider: 'gemini',
          mode: 'json_schema',
          configured: false,
          ok: false,
          requestedModel: 'gemini-2.5-flash',
          resolvedModel: '-',
          latencyMs: 0,
          detail: 'Chưa cấu hình Gemini API Key.',
        });
      }

      // 3. Probe Cloudflare (JSON mode)
      if (isCloudflareConfigured()) {
        const targetCf = config.activeModel.startsWith('cf:')
          ? config.activeModel
          : 'cf:@cf/meta/llama-3.3-70b-instruct-fp8-fast';
        const cStart = Date.now();
        try {
          const cfResp = await callWithTimeout(
            (signal) =>
              callCloudflareChatCompletion({
                modelId: targetCf,
                prompt: 'Trả về JSON hợp lệ: {"status":"OK","provider":"cloudflare"}',
                jsonMode: true,
                jsonSchemaHint: '{"status":"OK","provider":"cloudflare"}',
                maxOutputTokens: 256,
                signal,
              }),
            15_000
          );
          const parsed = JSON.parse(cfResp.text || '{}') as { status?: string };
          checks.push({
            provider: 'cloudflare',
            mode: 'json_schema',
            configured: true,
            ok: Boolean(parsed && typeof parsed === 'object'),
            requestedModel: targetCf,
            resolvedModel: cfResp.resolvedModel || targetCf,
            latencyMs: Date.now() - cStart,
            detail: `JSON Mode thành công (${cfResp.text.slice(0, 90)})`,
          });
        } catch (err) {
          checks.push({
            provider: 'cloudflare',
            mode: 'json_schema',
            configured: true,
            ok: false,
            requestedModel: targetCf,
            resolvedModel: targetCf,
            latencyMs: Date.now() - cStart,
            detail: err instanceof Error ? err.message : String(err),
          });
        }
      } else {
        checks.push({
          provider: 'cloudflare',
          mode: 'json_schema',
          configured: false,
          ok: false,
          requestedModel: 'cf:@cf/meta/llama-3.3-70b-instruct-fp8-fast',
          resolvedModel: '-',
          latencyMs: 0,
          detail: 'Chưa cấu hình Cloudflare Workers AI.',
        });
      }

      res.json({
        ranAt: new Date().toISOString(),
        activeModel: config.activeModel,
        checks,
        executionLogs: getRecentExecutionLogs().slice(0, 20),
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Lỗi khi chạy chẩn đoán AI.',
      });
    }
  });

  app.get('/api/admin/roles', requireSuperAdmin, async (req, res) => {
    const user = req.authUser!;
    try {
      const admins = await firestoreRestList<{ uid: string; role: string; grantedAt: string; email?: string }>(
        'admins',
        user.idToken,
        100
      );
      res.json({
        admins,
        protectedEmails: Array.from(PROTECTED_SUPER_ADMIN_EMAILS),
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Không tải được danh sách Admin.' });
    }
  });

  app.post('/api/admin/roles', requireSuperAdmin, async (req, res) => {
    const user = req.authUser!;
    const { identifier } = req.body as { identifier?: string };
    const clean = (identifier || '').trim();
    if (!clean) {
      res.status(400).json({ error: 'Vui lòng nhập UID hoặc Email tài khoản cần cấp quyền Super Admin.' });
      return;
    }

    try {
      let targetUid = clean;
      if (clean.includes('@')) {
        let resolvedFromAdmin = '';
        const adminAuth = await getAdminAuth();
        if (adminAuth) {
          try {
            const fbUser = await adminAuth.getUserByEmail(clean);
            resolvedFromAdmin = fbUser.uid;
          } catch {
            // Ignore ADC errors on serverless environments without service account
          }
        }
        if (resolvedFromAdmin) {
          targetUid = resolvedFromAdmin;
        } else {
          const usersList = await firestoreRestList<{ uid?: string; email?: string }>('users', user.idToken, 200);
          const matchedUser = usersList.find((u) => (u.email || '').trim().toLowerCase() === clean.toLowerCase());
          if (!matchedUser?.uid) {
            throw new Error(
              `Không tìm thấy tài khoản có email "${clean}". Người dùng cần đăng nhập ít nhất 1 lần trước khi cấp quyền theo Email, hoặc hãy nhập trực tiếp UID.`
            );
          }
          targetUid = matchedUser.uid;
        }
      }

      const now = new Date().toISOString();
      const record = {
        uid: targetUid,
        role: 'super_admin',
        grantedAt: now,
      };
      await firestoreRestSet(`admins/${targetUid}`, record, user.idToken);
      invalidateVerifiedTokenCacheForUid(targetUid);
      await recordAuditLog(
        {
          actorUid: user.uid,
          actorEmail: user.email,
          action: 'SUPER_ADMIN_GRANTED',
          resourceType: 'admins',
          resourceId: targetUid,
          status: 'success',
          metadata: { identifier: clean },
        },
        user.idToken
      );
      res.json({ ok: true, admin: record });
    } catch (err) {
      res.status(400).json({
        error: `Không tìm thấy hoặc không cấp được quyền: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  });

  app.delete('/api/admin/roles/:uid', requireSuperAdmin, async (req, res) => {
    const user = req.authUser!;
    const targetUid = req.params.uid;
    if (!targetUid) {
      res.status(400).json({ error: 'Thiếu UID cần thu hồi.' });
      return;
    }
    if (targetUid === user.uid) {
      res.status(400).json({ error: 'Không thể tự thu hồi quyền Super Admin của chính mình.' });
      return;
    }

    try {
      const existingAdmins = await firestoreRestList<{ uid: string }>('admins', user.idToken, 50);
      if (existingAdmins.length <= 1 && PROTECTED_SUPER_ADMIN_EMAILS.size === 0) {
        res.status(400).json({ error: 'Phải giữ lại ít nhất 1 tài khoản Super Admin trong hệ thống.' });
        return;
      }

      // Check if user doc belongs to protected owner email
      const userDoc = await firestoreRestGet<{ email?: string }>(`users/${targetUid}`, user.idToken);
      if (userDoc?.email && PROTECTED_SUPER_ADMIN_EMAILS.has(userDoc.email.toLowerCase())) {
        res.status(400).json({ error: 'Không thể thu hồi quyền của tài khoản chủ sở hữu mặc định.' });
        return;
      }

      await firestoreRestDelete(`admins/${targetUid}`, user.idToken);
      invalidateVerifiedTokenCacheForUid(targetUid);
      await recordAuditLog(
        {
          actorUid: user.uid,
          actorEmail: user.email,
          action: 'SUPER_ADMIN_REVOKED',
          resourceType: 'admins',
          resourceId: targetUid,
          status: 'success',
          metadata: {},
        },
        user.idToken
      );
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Không thể thu hồi quyền Admin.',
      });
    }
  });

  app.get('/api/admin/key', requireSuperAdmin, async (req, res) => {
    const user = req.authUser!;
    try {
      const singleKeyStatus = await getSingleKeyStatus(user.idToken);
      res.json({ singleKeyStatus });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Không kiểm tra được trạng thái API key.' });
    }
  });

  app.post('/api/admin/key', requireSuperAdmin, async (req, res) => {
    const user = req.authUser!;
    try {
      const { apiKey, label } = (req.body || {}) as { apiKey?: string; label?: string };
      if (!apiKey || typeof apiKey !== 'string') {
        res.status(400).json({ error: 'Vui lòng nhập Gemini API key.' });
        return;
      }
      const result = await setSingleGeminiApiKey({
        rawKey: apiKey,
        label,
        actorUid: user.uid,
        actorEmail: user.email,
        idToken: user.idToken,
      });
      if (!result.ok) {
        res.status(400).json({ error: result.error });
        return;
      }
      res.json({ singleKeyStatus: result.status });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Không thể lưu Gemini API key.' });
    }
  });

  app.post('/api/admin/key/test', requireSuperAdmin, async (req, res) => {
    const user = req.authUser!;
    try {
      const { apiKey } = (req.body || {}) as { apiKey?: string };
      const cfg = await loadAuthoritativeAiConfig(user.idToken);
      const result = await testSingleGeminiKey({
        rawKeyOverride: apiKey,
        actorUid: user.uid,
        actorEmail: user.email,
        idToken: user.idToken,
        activeModel: cfg.activeModel,
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({
        status: 'Temporary provider error',
        message: err instanceof Error ? err.message : 'Không thể kiểm tra Gemini API key.',
        testedSource: 'none',
        testedAt: new Date().toISOString(),
      });
    }
  });

  app.delete('/api/admin/key', requireSuperAdmin, async (req, res) => {
    const user = req.authUser!;
    try {
      const result = await clearSingleGeminiApiKey({
        actorUid: user.uid,
        actorEmail: user.email,
        idToken: user.idToken,
      });
      res.json({ singleKeyStatus: result.status });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Không thể xóa Gemini API key.' });
    }
  });

  // --- Super Admin Provider Backup Keys (Groq Cloud & Cloudflare Workers AI) ---
  app.get('/api/admin/provider-keys', requireSuperAdmin, async (req, res) => {
    const user = req.authUser!;
    try {
      const providerKeys = await getProviderKeysStatus(user.idToken);
      res.json({
        providerKeys,
        groqConfigured: isGroqConfigured(),
        cloudflareConfigured: isCloudflareConfigured(),
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Không tải được trạng thái API key dự phòng.',
      });
    }
  });

  app.post('/api/admin/provider-keys/groq', requireSuperAdmin, async (req, res) => {
    const user = req.authUser!;
    try {
      const { apiKey, label } = (req.body || {}) as { apiKey?: string; label?: string };
      if (!apiKey || typeof apiKey !== 'string') {
        res.status(400).json({ error: 'Vui lòng nhập Groq API Key (bắt đầu bằng gsk_...).' });
        return;
      }
      const result = await setGroqApiKey({
        rawKey: apiKey,
        label,
        actorUid: user.uid,
        actorEmail: user.email,
        idToken: user.idToken,
      });
      if (!result.ok) {
        res.status(400).json({ error: result.error });
        return;
      }
      res.json({
        groqStatus: result.status,
        providerKeys: await getProviderKeysStatus(user.idToken),
        groqConfigured: isGroqConfigured(),
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Không thể lưu Groq API Key.',
      });
    }
  });

  app.post('/api/admin/provider-keys/groq/test', requireSuperAdmin, async (req, res) => {
    const user = req.authUser!;
    try {
      const { apiKey } = (req.body || {}) as { apiKey?: string };
      const result = await testGroqApiKey({
        rawKeyOverride: typeof apiKey === 'string' ? apiKey : undefined,
        actorUid: user.uid,
        actorEmail: user.email,
        idToken: user.idToken,
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({
        status: 'Temporary provider error',
        message: err instanceof Error ? err.message : 'Không thể kiểm tra Groq API Key.',
        testedSource: 'none',
        testedAt: new Date().toISOString(),
      });
    }
  });

  app.delete('/api/admin/provider-keys/groq', requireSuperAdmin, async (req, res) => {
    const user = req.authUser!;
    try {
      const result = await clearGroqApiKey({
        actorUid: user.uid,
        actorEmail: user.email,
        idToken: user.idToken,
      });
      res.json({
        groqStatus: result.status,
        providerKeys: await getProviderKeysStatus(user.idToken),
        groqConfigured: isGroqConfigured(),
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Không thể gỡ Groq API Key.',
      });
    }
  });

  app.post('/api/admin/provider-keys/cloudflare', requireSuperAdmin, async (req, res) => {
    const user = req.authUser!;
    try {
      const { accountId, apiToken, label } = (req.body || {}) as {
        accountId?: string;
        apiToken?: string;
        label?: string;
      };
      if (!accountId || typeof accountId !== 'string' || !apiToken || typeof apiToken !== 'string') {
        res.status(400).json({ error: 'Vui lòng nhập đầy đủ Cloudflare Account ID và API Token.' });
        return;
      }
      const result = await setCloudflareCredentials({
        accountId,
        apiToken,
        label,
        actorUid: user.uid,
        actorEmail: user.email,
        idToken: user.idToken,
      });
      if (!result.ok) {
        res.status(400).json({ error: result.error });
        return;
      }
      res.json({
        cloudflareStatus: result.status,
        providerKeys: await getProviderKeysStatus(user.idToken),
        cloudflareConfigured: isCloudflareConfigured(),
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Không thể lưu thông tin Cloudflare Workers AI.',
      });
    }
  });

  app.post('/api/admin/provider-keys/cloudflare/test', requireSuperAdmin, async (req, res) => {
    const user = req.authUser!;
    try {
      const { accountId, apiToken } = (req.body || {}) as {
        accountId?: string;
        apiToken?: string;
      };
      const result = await testCloudflareCredentials({
        accountIdOverride: typeof accountId === 'string' ? accountId : undefined,
        apiTokenOverride: typeof apiToken === 'string' ? apiToken : undefined,
        actorUid: user.uid,
        actorEmail: user.email,
        idToken: user.idToken,
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({
        status: 'Temporary provider error',
        message: err instanceof Error ? err.message : 'Không thể kiểm tra Cloudflare Workers AI.',
        testedSource: 'none',
        testedAt: new Date().toISOString(),
      });
    }
  });

  app.delete('/api/admin/provider-keys/cloudflare', requireSuperAdmin, async (req, res) => {
    const user = req.authUser!;
    try {
      const result = await clearCloudflareCredentials({
        actorUid: user.uid,
        actorEmail: user.email,
        idToken: user.idToken,
      });
      res.json({
        cloudflareStatus: result.status,
        providerKeys: await getProviderKeysStatus(user.idToken),
        cloudflareConfigured: isCloudflareConfigured(),
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Không thể gỡ thông tin Cloudflare Workers AI.',
      });
    }
  });

  app.post('/api/admin/references/ingest-url', requireSuperAdmin, async (req, res) => {
    const { url, referenceId, grade, subject, textbookSeries } = req.body as {
      url: string;
      referenceId: string;
      grade: GradeLevel;
      subject: SubjectId;
      textbookSeries: string;
    };
    try {
      const result = await ingestReferenceFromUrl({
        url,
        referenceId,
        grade,
        subject,
        textbookSeries,
      });
      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: msg });
    }
  });

  app.post('/api/admin/references/ingest-pdf', requireSuperAdmin, upload.single('file'), async (req, res) => {
    const file = req.file;
    const { referenceId, grade, subject, textbookSeries } = req.body as {
      referenceId: string;
      grade: GradeLevel;
      subject: SubjectId;
      textbookSeries: string;
    };
    if (!file || file.mimetype !== 'application/pdf' || !hasValidMagicSignature(file.buffer, 'application/pdf')) {
      res.status(400).json({ error: 'Vui lòng tải lên tệp PDF hợp lệ.' });
      return;
    }
    try {
      const result = await ingestReferenceFromPdfBuffer({
        buffer: file.buffer,
        referenceId,
        grade: grade || '10',
        subject: subject || 'khac',
        textbookSeries: textbookSeries || 'Sách giáo khoa',
      });
      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: msg });
    }
  });

  app.post('/api/admin/references/ingest-docx', requireSuperAdmin, upload.single('file'), async (req, res) => {
    const file = req.file;
    const { referenceId, grade, subject, textbookSeries } = req.body as {
      referenceId: string;
      grade: GradeLevel;
      subject: SubjectId;
      textbookSeries: string;
    };
    const docxMime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (!file || file.mimetype !== docxMime || !hasValidMagicSignature(file.buffer, docxMime)) {
      res.status(400).json({ error: 'Vui lòng tải lên tệp DOCX hợp lệ.' });
      return;
    }
    try {
      const result = await ingestReferenceFromDocxBuffer({
        buffer: file.buffer,
        referenceId,
        grade: grade || '10',
        subject: subject || 'khac',
        textbookSeries: textbookSeries || 'Tài liệu giáo viên',
      });
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/admin/references/ingest-text', requireSuperAdmin, async (req, res) => {
    const { mode, content, referenceId, grade, subject, textbookSeries } = req.body as {
      mode: 'text' | 'json';
      content: string;
      referenceId: string;
      grade: GradeLevel;
      subject: SubjectId;
      textbookSeries: string;
    };
    try {
      const result = ingestReferenceFromTextOrJson({
        mode: mode === 'json' ? 'json' : 'text',
        content,
        referenceId,
        grade: grade || '10',
        subject: subject || 'khac',
        textbookSeries: textbookSeries || 'Tài liệu tham chiếu',
      });
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/admin/references/synthesize-outline', requireSuperAdmin, async (req, res) => {
    const user = req.authUser!;
    const { grade, subject, textbookSeries, title, customTocHint } = req.body as {
      grade?: GradeLevel;
      subject?: SubjectId;
      textbookSeries?: string;
      title?: string;
      customTocHint?: string;
    };
    const tokensOut: TokenTelemetry = { promptTokens: 0, candidateTokens: 0, totalTokens: 0 };
    try {
      const cfg = await loadAuthoritativeAiConfig(user.idToken);
      const result = await TextbookSynthesisService.synthesizeOutline({
        grade: grade || '10',
        subject: subject || 'hoa_hoc',
        textbookSeries: textbookSeries || 'Kết nối tri thức với cuộc sống',
        title,
        customTocHint,
        tokensOut,
        config: cfg,
        idToken: user.idToken,
      });
      recordUsageEvent({
        uid: user.uid,
        email: user.email,
        requestType: 'analysis',
        outcome: 'success',
        promptTokens: tokensOut.promptTokens,
        candidateTokens: tokensOut.candidateTokens,
        totalTokens: tokensOut.totalTokens,
      });
      void persistUsageSnapshot(user.idToken, user.isSuperAdmin, user.uid);
      res.json(result);
    } catch (err) {
      const mapped = mapGeminiErrorResponse(err);
      res.status(mapped.status).json({ code: mapped.code, error: mapped.error });
    }
  });

  app.post('/api/admin/references/synthesize-chapter', requireSuperAdmin, async (req, res) => {
    const user = req.authUser!;
    const {
      referenceId,
      grade,
      subject,
      textbookSeries,
      chapterIndex,
      chapterTitle,
      lessons,
      estimatedPageStart,
    } = req.body as {
      referenceId: string;
      grade?: GradeLevel;
      subject?: SubjectId;
      textbookSeries?: string;
      chapterIndex?: number;
      chapterTitle: string;
      lessons?: string[];
      estimatedPageStart?: number;
    };

    if (!referenceId || !chapterTitle) {
      res.status(400).json({ error: 'Thiếu mã sách tham chiếu (referenceId) hoặc tên chương (chapterTitle).' });
      return;
    }

    const tokensOut: TokenTelemetry = { promptTokens: 0, candidateTokens: 0, totalTokens: 0 };
    try {
      const cfg = await loadAuthoritativeAiConfig(user.idToken);
      const chunks = await TextbookSynthesisService.synthesizeChapterChunks({
        referenceId,
        grade: grade || '10',
        subject: subject || 'hoa_hoc',
        textbookSeries: textbookSeries || 'Kết nối tri thức với cuộc sống',
        chapterIndex: Math.max(1, Number(chapterIndex) || 1),
        chapterTitle,
        lessons: Array.isArray(lessons) ? lessons : [],
        estimatedPageStart: Math.max(1, Number(estimatedPageStart) || 1),
        tokensOut,
        config: cfg,
        idToken: user.idToken,
      });
      recordUsageEvent({
        uid: user.uid,
        email: user.email,
        requestType: 'analysis',
        outcome: 'success',
        promptTokens: tokensOut.promptTokens,
        candidateTokens: tokensOut.candidateTokens,
        totalTokens: tokensOut.totalTokens,
      });
      void persistUsageSnapshot(user.idToken, user.isSuperAdmin, user.uid);
      res.json({ chunks });
    } catch (err) {
      const mapped = mapGeminiErrorResponse(err);
      res.status(mapped.status).json({ code: mapped.code, error: mapped.error });
    }
  });

  app.post(
    '/api/admin/references/ocr-pages',
    requireSuperAdmin,
    upload.array('files', 4),
    async (req, res) => {
      const user = req.authUser!;
      const rawFiles = (req.files as Express.Multer.File[]) || [];
      if (rawFiles.length === 0) {
        res.status(400).json({ error: 'Không có trang ảnh nào được gửi lên để đọc OCR.' });
        return;
      }

      const { pageNumbers: rawPageNumbers, grade, subject, textbookSeries } = req.body as {
        pageNumbers?: string;
        grade?: GradeLevel;
        subject?: SubjectId;
        textbookSeries?: string;
      };

      let parsedPageNums: number[] = [];
      try {
        if (rawPageNumbers) {
          const arr = JSON.parse(rawPageNumbers);
          if (Array.isArray(arr)) parsedPageNums = arr.map((n) => Number(n) || 1);
        }
      } catch {
        parsedPageNums = [];
      }

      const tokensOut: TokenTelemetry = { promptTokens: 0, candidateTokens: 0, totalTokens: 0 };
      try {
        const cfg = await loadAuthoritativeAiConfig(user.idToken);
        const pages = await TextbookSynthesisService.ocrScannedTextbookPages({
          files: rawFiles.map((f, idx) => ({
            buffer: f.buffer,
            mimeType: f.mimetype || 'image/jpeg',
            pageNumber: parsedPageNums[idx] || idx + 1,
          })),
          grade: grade || '10',
          subject: subject || 'hoa_hoc',
          textbookSeries: textbookSeries || 'Sách giáo khoa',
          tokensOut,
          config: cfg,
          idToken: user.idToken,
        });
        recordUsageEvent({
          uid: user.uid,
          email: user.email,
          requestType: 'ocr',
          outcome: 'success',
          promptTokens: tokensOut.promptTokens,
          candidateTokens: tokensOut.candidateTokens,
          totalTokens: tokensOut.totalTokens,
        });
        void persistUsageSnapshot(user.idToken, user.isSuperAdmin, user.uid);
        res.json({ pages });
      } catch (err) {
        const mapped = mapGeminiErrorResponse(err);
        res.status(mapped.status).json({ code: mapped.code, error: mapped.error });
      }
    }
  );

  // --- Admin Exam Blueprint & Exam Generator Endpoints ---
  app.post('/api/admin/exams/blueprint', requireSuperAdmin, async (req, res) => {
    const user = req.authUser!;
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
    } = req.body as {
      title?: string;
      grade: GradeLevel;
      subject: SubjectId;
      textbookSeries: string;
      examType: ExamType;
      academicYear?: string;
      semester?: '1' | '2';
      chapters?: string[];
      durationMinutes?: number;
      totalScore?: number;
      referenceChunks?: ReferenceChunk[];
    };

    const tokens: TokenTelemetry = { promptTokens: 0, candidateTokens: 0, totalTokens: 0 };
    try {
      const cfg = await loadAuthoritativeAiConfig(user.idToken);
      const blueprint = await ExamPipelineService.generateBlueprint({
        title,
        grade: grade || '10',
        subject: subject || 'toan',
        textbookSeries: textbookSeries || 'Kết nối tri thức với cuộc sống',
        examType: examType || 'giua_ky_1',
        academicYear: academicYear || '2026-2027',
        semester: semester === '2' ? '2' : '1',
        chapters: Array.isArray(chapters) ? chapters : [],
        durationMinutes: Math.max(15, Math.min(180, Number(durationMinutes) || 45)),
        totalScore: Math.max(1, Math.min(100, Number(totalScore) || 10)),
        referenceChunks: referenceChunks || [],
        actorUid: user.uid,
        tokensOut: tokens,
        config: cfg,
        idToken: user.idToken,
      });
      res.json({ blueprint, tokenUsage: tokens });
    } catch (err) {
      const mapped = mapGeminiErrorResponse(err);
      res.status(mapped.status).json(mapped);
    }
  });

  app.post('/api/admin/exams/generate', requireSuperAdmin, async (req, res) => {
    const user = req.authUser!;
    const { blueprint, referenceChunks } = req.body as {
      blueprint: ExamBlueprint;
      referenceChunks?: ReferenceChunk[];
    };
    if (!blueprint || !Array.isArray(blueprint.rows) || blueprint.rows.length === 0) {
      res.status(400).json({ error: 'Cần có ma trận đề hợp lệ trước khi sinh đề thi.' });
      return;
    }

    const tokens: TokenTelemetry = { promptTokens: 0, candidateTokens: 0, totalTokens: 0 };
    try {
      const cfg = await loadAuthoritativeAiConfig(user.idToken);
      const generated = await ExamPipelineService.generateExamFromBlueprint({
        blueprint,
        referenceChunks: referenceChunks || [],
        tokensOut: tokens,
        config: cfg,
        idToken: user.idToken,
      });
      const now = new Date().toISOString();
      const exam: ExamDocument = {
        examId: `exam_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        blueprintId: blueprint.blueprintId,
        title: blueprint.title,
        description: `Đề kiểm tra được sinh từ ma trận "${blueprint.title}".`,
        grade: blueprint.grade,
        subject: blueprint.subject,
        textbookSeries: blueprint.textbookSeries,
        examType: blueprint.examType,
        academicYear: blueprint.academicYear,
        semester: blueprint.semester,
        chapters: blueprint.chapters || [],
        durationMinutes: blueprint.durationMinutes,
        totalScore: blueprint.totalScore,
        allowRetake: true,
        published: false,
        validationStatus: generated.validationStatus,
        questions: generated.questions.slice(0, 60),
        createdBy: user.uid,
        createdAt: now,
        updatedAt: now,
      };
      res.json({ exam, ...generated, tokenUsage: tokens });
    } catch (err) {
      const mapped = mapGeminiErrorResponse(err);
      res.status(mapped.status).json(mapped);
    }
  });

  app.post('/api/admin/exams/import-sample', requireSuperAdmin, upload.array('files', 25), async (req, res) => {
    const user = req.authUser!;
    const uploadedFiles = (req.files as Express.Multer.File[]) || [];
    if (uploadedFiles.length === 0) {
      res.status(400).json({ error: 'Vui lòng chọn file đề mẫu (PDF, DOCX hoặc ảnh).' });
      return;
    }

    const body = (req.body || {}) as Record<string, string | undefined>;
    const tokens: TokenTelemetry = { promptTokens: 0, candidateTokens: 0, totalTokens: 0 };
    try {
      const cfg = await loadAuthoritativeAiConfig(user.idToken);
      const maxBytes = (cfg.rateLimitConfig?.maximumFileSizeMb || 20) * 1024 * 1024;
      for (const f of uploadedFiles) {
        if (!ALLOWED_UPLOAD_MIMES.has(f.mimetype)) {
          res.status(400).json({
            error: `Định dạng file "${f.originalname}" không được hỗ trợ. Chỉ chấp nhận PDF, DOCX, JPG, PNG, WEBP.`,
          });
          return;
        }
        if (f.size > maxBytes) {
          res.status(400).json({
            error: `File "${f.originalname}" vượt quá giới hạn ${cfg.rateLimitConfig?.maximumFileSizeMb || 20}MB.`,
          });
          return;
        }
        if (!hasValidMagicSignature(f.buffer, f.mimetype)) {
          res.status(400).json({
            error: `File "${f.originalname}" có chữ ký nhị phân không khớp định dạng hoặc bị hỏng.`,
          });
          return;
        }
      }

      const result = await ExamPipelineService.extractQuestionsFromSampleExam({
        files: uploadedFiles.map((f) => ({
          buffer: f.buffer,
          mimeType: f.mimetype,
          originalName: f.originalname,
        })),
        title: body.title,
        grade: body.grade === '11' || body.grade === '12' ? body.grade : '10',
        subject: (body.subject as SubjectId) || 'toan',
        textbookSeries: body.textbookSeries || 'Kết nối tri thức với cuộc sống',
        examType: (body.examType as ExamType) || 'giua_ky_1',
        academicYear: body.academicYear || '2026-2027',
        semester: body.semester === '2' ? '2' : '1',
        durationMinutes: Math.max(15, Math.min(180, Number(body.durationMinutes) || 45)),
        totalScore: Math.max(1, Math.min(100, Number(body.totalScore) || 10)),
        includeTrueFalse: body.includeTrueFalse === 'true',
        actorUid: user.uid,
        tokensOut: tokens,
        config: cfg,
        idToken: user.idToken,
      });
      res.json({ ...result, tokenUsage: tokens });
    } catch (err) {
      const mapped = mapGeminiErrorResponse(err);
      res.status(mapped.status).json(mapped);
    }
  });

  app.post('/api/admin/exams/rewrite-question', requireSuperAdmin, async (req, res) => {
    const user = req.authUser!;
    const { question, instruction, grade, subject, textbookSeries } = req.body as {
      question: ExamQuestion;
      instruction: string;
      grade: GradeLevel;
      subject: SubjectId;
      textbookSeries: string;
    };
    if (!question) {
      res.status(400).json({ error: 'Thiếu dữ liệu câu hỏi cần viết lại.' });
      return;
    }
    const tokens: TokenTelemetry = { promptTokens: 0, candidateTokens: 0, totalTokens: 0 };
    try {
      const cfg = await loadAuthoritativeAiConfig(user.idToken);
      const updatedQuestion = await ExamPipelineService.rewriteSingleQuestion({
        question,
        instruction,
        grade: grade || '10',
        subject: subject || 'toan',
        textbookSeries: textbookSeries || 'Kết nối tri thức với cuộc sống',
        tokensOut: tokens,
        config: cfg,
        idToken: user.idToken,
      });
      res.json({ question: updatedQuestion, tokenUsage: tokens });
    } catch (err) {
      const mapped = mapGeminiErrorResponse(err);
      res.status(mapped.status).json(mapped);
    }
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return;

    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({
          code: 'PAYLOAD_TOO_LARGE',
          error:
            'Tệp tải lên vượt quá dung lượng cho phép. Vui lòng chọn ảnh ≤ 5MB hoặc PDF/DOCX ≤ 4MB.',
        });
        return;
      }
      if (err.code === 'LIMIT_FILE_COUNT') {
        res.status(400).json({
          code: 'TOO_MANY_FILES',
          error: 'Số lượng tệp gửi lên vượt quá giới hạn cho phép mỗi lượt.',
        });
        return;
      }
      res.status(400).json({
        code: 'UPLOAD_ERROR',
        error: `Lỗi tiếp nhận tệp tải lên (${err.code}). Vui lòng thử lại.`,
      });
      return;
    }

    const bodyErr = err as { type?: string; status?: number; statusCode?: number } | null;
    if (
      bodyErr &&
      (bodyErr.type === 'entity.too.large' || bodyErr.status === 413 || bodyErr.statusCode === 413)
    ) {
      res.status(413).json({
        code: 'PAYLOAD_TOO_LARGE',
        error:
          'Gói dữ liệu gửi lên vượt quá giới hạn máy chủ (413). Hãy nén tệp nhỏ hơn hoặc chia ít trang hơn.',
      });
      return;
    }

    console.error('Unhandled Express API error:', err);
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Lỗi máy chủ nội bộ.',
    });
  });

  return app;
}
