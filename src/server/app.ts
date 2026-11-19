import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import {
  adminAuth,
  firestoreRestDelete,
  firestoreRestGet,
  firestoreRestList,
  firestoreRestSet,
  PROTECTED_SUPER_ADMIN_EMAILS,
  verifyFirebaseRequest,
  type AuthenticatedUser,
} from './firebaseServer';
import {
  checkAiRequestGuard,
  decrementConcurrentJob,
  getAuditLogs,
  getIdempotentResult,
  getUsageStatistics,
  incrementConcurrentJob,
  loadAuthoritativeAiConfig,
  persistUsageSnapshot,
  recordAuditLog,
  recordUsageEvent,
  setIdempotentResult,
  setOneTimeTaskOverride,
  updateAuthoritativeAiConfig,
} from './aiGuardService';
import {
  clearSingleGeminiApiKey,
  getSingleKeyStatus,
  hydrateSingleKeyForSuperAdmin,
  setSingleGeminiApiKey,
  testSingleGeminiKey,
} from './singleKeyService';
import {
  DocumentExtractionService,
  ExamPipelineService,
  FeedbackAnalysisService,
  FlashcardGenerationService,
  KnowledgeAnalysisService,
  QuizGenerationService,
  SubjectDetectionService,
  type TokenTelemetry,
} from './geminiPipeline';
import {
  ingestReferenceFromDocxBuffer,
  ingestReferenceFromPdfBuffer,
  ingestReferenceFromTextOrJson,
  ingestReferenceFromUrl,
} from './referenceIngestService';
import {
  getRecentExecutionLogs,
  MODEL_CATALOG,
  testModelConnectivity,
} from './modelRouter';
import type {
  AiTaskType,
  ExamBlueprint,
  ExamQuestion,
  ExamType,
  ExtractedPage,
  GradeLevel,
  QuizDifficulty,
  QuizScope,
  ReferenceChunk,
  SubjectId,
} from '../core/types';

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
    if (authUser.isSuperAdmin) {
      await hydrateSingleKeyForSuperAdmin(authUser.idToken);
    }
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
}

function mapGeminiErrorResponse(err: unknown): { status: number; code: string; error: string } {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('GEMINI_API_KEY_UNCONFIGURED')) {
    return {
      status: 503,
      code: 'GEMINI_KEY_MISSING',
      error: 'Hệ thống chưa có Gemini API key. Quản trị viên vui lòng vào Quản trị hệ thống → API Key duy nhất để thêm key.',
    };
  }
  if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('429')) {
    return {
      status: 429,
      code: 'PROVIDER_QUOTA_EXCEEDED',
      error: 'Dịch vụ AI tạm thời đạt giới hạn lưu lượng (429). Vui lòng thử lại sau ít phút.',
    };
  }
  if (msg.includes('API_KEY_INVALID') || msg.includes('PERMISSION_DENIED') || msg.includes('403')) {
    return {
      status: 502,
      code: 'PROVIDER_AUTH_ERROR',
      error: 'Khóa API AI hiện tại không hợp lệ hoặc không có quyền truy cập model.',
    };
  }
  if (msg.includes('NOT_FOUND') || msg.includes('404')) {
    return {
      status: 502,
      code: 'MODEL_UNAVAILABLE',
      error: 'Model AI được cấu hình hiện không khả dụng.',
    };
  }
  return {
    status: 500,
    code: 'AI_PROCESSING_ERROR',
    error: `Không thể hoàn tất xử lý tài liệu: ${msg.slice(0, 180)}`,
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

  app.get('/api/health', (_req, res) => {
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
      if (authUser.isSuperAdmin) {
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

      const maxBytes = guard.config.rateLimitConfig.maximumFileSizeMb * 1024 * 1024;
      for (const f of uploadedFiles) {
        if (!ALLOWED_UPLOAD_MIMES.has(f.mimetype)) {
          res.status(400).json({
            error: `Định dạng file "${f.originalname}" (${f.mimetype}) không được hỗ trợ. Chỉ chấp nhận PDF, DOCX, JPG, PNG, WEBP.`,
          });
          return;
        }
        if (f.size > maxBytes) {
          res.status(400).json({
            error: `File "${f.originalname}" vượt quá giới hạn ${guard.config.rateLimitConfig.maximumFileSizeMb}MB.`,
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

      let pages: ExtractedPage[] = [];
      const first = uploadedFiles[0];

      if (first.mimetype === 'application/pdf') {
        pages = await DocumentExtractionService.extractFromPdfBuffer(first.buffer, tokens, {
          config: guard.config,
          idToken: user.idToken,
        });
      } else if (
        first.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ) {
        pages = await DocumentExtractionService.extractFromDocxBuffer(first.buffer);
      } else {
        pages = await DocumentExtractionService.extractFromImageBuffers(
          uploadedFiles.map((f) => ({
            buffer: f.buffer,
            mimeType: f.mimetype,
            originalName: f.originalname,
          })),
          tokens,
          { config: guard.config, idToken: user.idToken }
        );
      }

      if (pages.length > guard.config.rateLimitConfig.maximumPagesPerAnalysis) {
        res.status(400).json({
          error: `Tài liệu có ${pages.length} trang, vượt quá giới hạn ${guard.config.rateLimitConfig.maximumPagesPerAnalysis} trang cho mỗi lần phân tích.`,
        });
        return;
      }

      const fullSample = pages.map((p) => p.rawText).join('\n');
      const scopeSuggestion = fullSample.trim().length > 15
        ? await SubjectDetectionService.detectScope(fullSample, tokens, {
            config: guard.config,
            idToken: user.idToken,
          })
        : {
            suggestedGrade: '10' as GradeLevel,
            suggestedSubject: 'khac' as SubjectId,
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
      await persistUsageSnapshot(user.idToken, user.isSuperAdmin);

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
    const tokens: TokenTelemetry = { promptTokens: 0, candidateTokens: 0, totalTokens: 0 };

    try {
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

      if (pages.length > guard.config.rateLimitConfig.maximumPagesPerAnalysis) {
        res.status(400).json({
          error: `Số trang (${pages.length}) vượt quá giới hạn tối đa (${guard.config.rateLimitConfig.maximumPagesPerAnalysis}).`,
        });
        return;
      }

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
        enableWebGrounding: Boolean(enableWebGrounding),
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
      await persistUsageSnapshot(user.idToken, user.isSuperAdmin);

      res.json(payload);
    } catch (err) {
      const mapped = mapGeminiErrorResponse(err);
      recordUsageEvent({
        uid: user.uid,
        email: user.email,
        requestType: 'analysis',
        outcome: 'failed',
        providerError: mapped.status >= 500,
        quotaBlocked: mapped.status === 429,
      });
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
      await persistUsageSnapshot(user.idToken, user.isSuperAdmin);

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
      res.json({ cards, tokenUsage: tokens });
    } catch (err) {
      const mapped = mapGeminiErrorResponse(err);
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
      const [config, usageStats, auditLogs, singleKeyStatus] = await Promise.all([
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
      ]);
      res.json({
        config,
        usageStats,
        auditLogs,
        singleKeyStatus,
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
      const targetModel = (modelId || 'gemini-4-hydrogen').trim();
      const result = await testModelConnectivity(targetModel);
      res.json(result);
    } catch (err) {
      res.status(500).json({
        ok: false,
        modelId: String(req.body?.modelId || 'gemini-4-hydrogen'),
        latencyMs: 0,
        message: err instanceof Error ? err.message : 'Không thể kiểm tra kết nối model.',
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
      res.json({ ...generated, tokenUsage: tokens });
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
    console.error('Unhandled Express API error:', err);
    if (res.headersSent) return;
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Lỗi máy chủ nội bộ.',
    });
  });

  return app;
}
