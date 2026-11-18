import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'node:path';
import multer from 'multer';
import { createServer as createViteServer } from 'vite';
import {
  verifyFirebaseRequest,
  type AuthenticatedUser,
} from './src/server/firebaseServer';
import {
  checkAiRequestGuard,
  decrementConcurrentJob,
  getAuditLogs,
  getIdempotentResult,
  getUsageStatistics,
  incrementConcurrentJob,
  loadAuthoritativeAiConfig,
  persistUsageSnapshot,
  recordUsageEvent,
  setIdempotentResult,
  updateAuthoritativeAiConfig,
} from './src/server/aiGuardService';
import {
  clearSingleGeminiApiKey,
  getSingleKeyStatus,
  hydrateSingleKeyForSuperAdmin,
  setSingleGeminiApiKey,
  testSingleGeminiKey,
} from './src/server/singleKeyService';
import {
  DocumentExtractionService,
  KnowledgeAnalysisService,
  QuizGenerationService,
  SubjectDetectionService,
  type TokenTelemetry,
} from './src/server/geminiPipeline';
import {
  ingestReferenceFromPdfBuffer,
  ingestReferenceFromUrl,
} from './src/server/referenceIngestService';
import type {
  ExtractedPage,
  GradeLevel,
  QuizDifficulty,
  QuizScope,
  ReferenceChunk,
  SubjectId,
} from './src/core/types';

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
    fileSize: 25 * 1024 * 1024, // 25MB ceiling; dynamically enforced below via systemConfig
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
    // ZIP/OOXML magic header PK\x03\x04
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
  await requireAuth(req, res, () => {
    if (!req.authUser?.isSuperAdmin) {
      res.status(403).json({
        code: 'FORBIDDEN_SUPER_ADMIN',
        error: 'Chỉ tài khoản Super Admin được ủy quyền mới có quyền truy cập khu vực quản trị này.',
      });
      return;
    }
    next();
  });
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

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '15mb' }));

  const allowedOrigins = (process.env.ALLOWED_ORIGIN || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  if (allowedOrigins.length > 0) {
    app.use((req, res, next) => {
      const origin = req.headers.origin;
      if (origin && (allowedOrigins.includes('*') || allowedOrigins.includes(origin))) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      }
      if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
      }
      next();
    });
  }

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'StudyCheck AI Backend', timestamp: new Date().toISOString() });
  });

  // Publicly readable safe maintenance status & upload limits (never exposes keys or internal config)
  app.get('/api/system/status', async (req, res) => {
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
      updatedAt: cfg.updatedAt,
    });
  });

  // Verify Firebase session & hydrate encrypted single key if Super Admin
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

  // STAGE 3 & 5: Document Upload Extraction + OCR + Subject/Scope Auto-Detection
  app.post('/api/ai/extract', requireAuth, upload.array('files', 25), async (req, res) => {
    const user = req.authUser!;
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

    const tokens: TokenTelemetry = { promptTokens: 0, candidateTokens: 0, totalTokens: 0 };
    try {
      let pages: ExtractedPage[] = [];
      const first = uploadedFiles[0];

      if (first.mimetype === 'application/pdf') {
        pages = await DocumentExtractionService.extractFromPdfBuffer(first.buffer, tokens);
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
          tokens
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
        ? await SubjectDetectionService.detectScope(fullSample, tokens)
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

  // STAGE 6-13: Multi-pass Knowledge Analysis, Reference Retrieval, Web Grounding & Scoring
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
    const tokens: TokenTelemetry = { promptTokens: 0, candidateTokens: 0, totalTokens: 0 };

    try {
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
      decrementConcurrentJob(user.uid);
    }
  });

  // STAGE 16: Quiz Generation
  app.post('/api/ai/quiz', requireAuth, async (req, res) => {
    const user = req.authUser!;
    const {
      idempotencyKey,
      subject,
      grade,
      textbookTitle,
      claims,
      coverageItems,
      count,
      difficulty,
      scope,
      chapterFilter,
    } = req.body as {
      idempotencyKey?: string;
      subject: SubjectId;
      grade: GradeLevel;
      textbookTitle: string;
      claims: Parameters<typeof QuizGenerationService.generateQuiz>[0]['claims'];
      coverageItems: Parameters<typeof QuizGenerationService.generateQuiz>[0]['coverageItems'];
      count: number;
      difficulty: QuizDifficulty;
      scope: QuizScope;
      chapterFilter?: string;
    };

    if (idempotencyKey) {
      const cached = getIdempotentResult(`${user.uid}:quiz:${idempotencyKey}`);
      if (cached) {
        res.json(cached);
        return;
      }
    }

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

    const safeCount = Math.min(20, Math.max(5, Number(count) || 5));
    const tokens: TokenTelemetry = { promptTokens: 0, candidateTokens: 0, totalTokens: 0 };

    try {
      const questions = await QuizGenerationService.generateQuiz({
        subject,
        grade,
        textbookTitle,
        claims: claims || [],
        coverageItems: coverageItems || [],
        count: safeCount,
        difficulty: difficulty || 'mixed',
        scope: scope || 'all',
        chapterFilter,
        tokensOut: tokens,
      });

      const payload = { questions, tokenUsage: tokens };
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

  // === SUPER ADMIN ENDPOINTS ===
  app.get('/api/admin/overview', requireSuperAdmin, async (req, res) => {
    const user = req.authUser!;
    const [config, usageStats, auditLogs, singleKeyStatus] = await Promise.all([
      loadAuthoritativeAiConfig(user.idToken),
      getUsageStatistics(user.idToken),
      getAuditLogs(user.idToken),
      getSingleKeyStatus(user.idToken),
    ]);
    res.json({
      config,
      usageStats,
      auditLogs,
      singleKeyStatus,
    });
  });

  app.patch('/api/admin/ai-service', requireSuperAdmin, async (req, res) => {
    const user = req.authUser!;
    const { enabled, disabledReason, maintenanceMessage, rateLimitConfig, activeModel } = req.body;
    const updated = await updateAuthoritativeAiConfig(
      {
        ...(typeof enabled === 'boolean' ? { enabled } : {}),
        ...(typeof disabledReason === 'string' ? { disabledReason: disabledReason.slice(0, 300) } : {}),
        ...(typeof maintenanceMessage === 'string'
          ? { maintenanceMessage: maintenanceMessage.slice(0, 400) }
          : {}),
        ...(rateLimitConfig ? { rateLimitConfig } : {}),
        ...(typeof activeModel === 'string' ? { activeModel } : {}),
      },
      user.uid,
      user.email,
      user.idToken
    );
    res.json({ config: updated });
  });

  app.get('/api/admin/key', requireSuperAdmin, async (req, res) => {
    const user = req.authUser!;
    const singleKeyStatus = await getSingleKeyStatus(user.idToken);
    res.json({ singleKeyStatus });
  });

  app.post('/api/admin/key', requireSuperAdmin, async (req, res) => {
    const user = req.authUser!;
    const { apiKey, label } = req.body as { apiKey?: string; label?: string };
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
  });

  app.post('/api/admin/key/test', requireSuperAdmin, async (req, res) => {
    const user = req.authUser!;
    const { apiKey } = req.body as { apiKey?: string };
    const cfg = await loadAuthoritativeAiConfig(user.idToken);
    const result = await testSingleGeminiKey({
      rawKeyOverride: apiKey,
      actorUid: user.uid,
      actorEmail: user.email,
      idToken: user.idToken,
      activeModel: cfg.activeModel,
    });
    res.json(result);
  });

  app.delete('/api/admin/key', requireSuperAdmin, async (req, res) => {
    const user = req.authUser!;
    const result = await clearSingleGeminiApiKey({
      actorUid: user.uid,
      actorEmail: user.email,
      idToken: user.idToken,
    });
    res.json({ singleKeyStatus: result.status });
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

  // Vite middleware in development, static dist in production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`StudyCheck AI server running on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start StudyCheck AI server:', err);
  process.exit(1);
});
