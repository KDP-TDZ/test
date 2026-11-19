import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  BookOpen,
  CheckCircle2,
  ClipboardCheck,
  Cpu,
  Edit3,
  FileText,
  FileUp,
  Globe,
  KeyRound,
  Loader2,
  MessageSquareWarning,
  PauseCircle,
  PlayCircle,
  Plus,
  Power,
  Printer,
  RefreshCw,
  Save,
  Shield,
  Sliders,
  Sparkles,
  Trash2,
  UserCheck,
  Wand2,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { generateShuffledExamVariant, validateExamBlueprint } from '../core/quizValidation';
import {
  AI_TASK_LABELS,
  EXAM_TYPE_LABELS,
  SUBJECT_LABELS,
  TEXTBOOK_SERIES_OPTIONS,
  type AiExecutionLog,
  type AiTaskType,
  type ApiUsageDaily,
  type AuditLogEntry,
  type CognitiveLevel,
  type ExamBlueprint,
  type ExamBlueprintRow,
  type ExamDocument,
  type ExamQuestion,
  type ExamQuestionType,
  type ExamType,
  type FeedbackEntry,
  type GradeLevel,
  type KnowledgeSourceType,
  type RateLimitConfig,
  type ReferenceBook,
  type ReferenceChunk,
  type SingleApiKeyStatus,
  type SourceLicenseStatus,
  type SubjectId,
  type SystemAiConfig,
  type TaskModelConfig,
  type UserProfile,
} from '../core/types';
import { authorizedFetch, parseApiResponse } from '../services/apiClient';
import {
  deleteExamBlueprint,
  deleteExamDocument,
  deleteReferenceBookAndChunks,
  listAllFeedbackForAdmin,
  listAllUsersForAdmin,
  listExamBlueprints,
  listExams,
  listReferenceBooks,
  listReferenceChunksForBook,
  saveExamBlueprint,
  saveExamDocument,
  saveReferenceBookWithChunks,
  updateFeedbackStatus,
  updateReferenceBookStatus,
  updateReferenceChunkContent,
} from '../services/firestoreService';
import { GlassSurface } from './LiquidGlass/GlassSurface';
import { WaterRippleButton } from './LiquidGlass/WaterRippleButton';

type AdminTab =
  | 'overview'
  | 'models'
  | 'api_security'
  | 'references'
  | 'exams'
  | 'feedback_roles'
  | 'limits_audit';

interface ModelCatalogItem {
  modelId: string;
  displayName: string;
  tier: string;
  strengths: string;
}

const FALLBACK_MODEL_CATALOG: ModelCatalogItem[] = [
  {
    modelId: 'gemini-4-hydrogen',
    displayName: 'Gemini 4 Hydrogen',
    tier: 'free',
    strengths: 'Suy luận sâu, kiểm định tri thức đa nguồn, OCR công thức & chữ viết tay phức tạp.',
  },
  {
    modelId: 'gemini-3.1-flash-lite',
    displayName: 'Gemini 3.1 Flash Lite',
    tier: 'free',
    strengths: 'Tốc độ nhanh, tiết kiệm token cho phân loại môn, kiểm tra cấu trúc, flashcard & phản hồi.',
  },
];

const KNOWLEDGE_SOURCE_LABELS: Record<KnowledgeSourceType, string> = {
  official_curriculum: 'Chương trình chuẩn GDPT 2018',
  textbook_reference: 'Sách giáo khoa tham chiếu',
  teacher_material: 'Tài liệu giáo viên biên soạn',
  supplementary_material: 'Tài liệu bổ trợ học tập',
  public_exam_reference: 'Đề thi / Đề minh họa công khai',
  external_extension: 'Mở rộng nâng cao ngoài sách',
};

const LICENSE_STATUS_OPTIONS: SourceLicenseStatus[] = [
  'Admin tự biên soạn',
  'Có sự cho phép của chủ sở hữu',
  'Có giấy phép mở phù hợp',
  'Chỉ được tham chiếu nội bộ',
  'Chưa xác minh',
];

const COGNITIVE_LABELS: Record<CognitiveLevel, string> = {
  nhan_biet: 'Nhận biết',
  thong_hieu: 'Thông hiểu',
  van_dung: 'Vận dụng',
  van_dung_cao: 'Vận dụng cao',
};

const QUESTION_TYPE_LABELS: Record<ExamQuestionType, string> = {
  abcd: 'Trắc nghiệm ABCD',
  true_false: 'Đúng / Sai (4 ý)',
  short_answer: 'Trả lời ngắn',
};

const INPUT_CLASS =
  'w-full px-3.5 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-[#17243A] dark:text-[#E5EDF9] focus:outline-none focus:ring-2 focus:ring-sky-500/40';

export const AdminControlCenter: React.FC = () => {
  const { isSuperAdmin, refreshSystemStatus } = useAuth();
  const [tab, setTab] = useState<AdminTab>('overview');
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [config, setConfig] = useState<SystemAiConfig | null>(null);
  const [usageStats, setUsageStats] = useState<{
    today: ApiUsageDaily;
    dailySeries: ApiUsageDaily[];
    perUserToday: Array<{ uid: string; email: string; requests: number; analyses: number; blocked: number; tokens: number }>;
  } | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [singleKeyStatus, setSingleKeyStatus] = useState<SingleApiKeyStatus | null>(null);
  const [executionLogs, setExecutionLogs] = useState<AiExecutionLog[]>([]);
  const [modelCatalog, setModelCatalog] = useState<ModelCatalogItem[]>(FALLBACK_MODEL_CATALOG);

  const [books, setBooks] = useState<ReferenceBook[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [feedbackList, setFeedbackList] = useState<FeedbackEntry[]>([]);
  const [blueprints, setBlueprints] = useState<ExamBlueprint[]>([]);
  const [exams, setExams] = useState<ExamDocument[]>([]);

  // Overview / AI Switch form
  const [maintenanceMessage, setMaintenanceMessage] = useState('');
  const [disabledReason, setDisabledReason] = useState('');
  const [activeModel, setActiveModel] = useState('gemini-4-hydrogen');
  const [savingConfig, setSavingConfig] = useState(false);

  // Model Router state
  const [taskModelsDraft, setTaskModelsDraft] = useState<Record<AiTaskType, TaskModelConfig> | null>(null);
  const [overrideSelection, setOverrideSelection] = useState<Partial<Record<AiTaskType, string>>>({});
  const [testingModelId, setTestingModelId] = useState<string | null>(null);
  const [modelTestResult, setModelTestResult] = useState<{
    modelId: string;
    ok: boolean;
    message: string;
    latencyMs?: number;
  } | null>(null);

  // API Key & Allowed Origins state
  const [newKeyLabel, setNewKeyLabel] = useState('Gemini API Key dùng chung');
  const [newRawKey, setNewRawKey] = useState('');
  const [savingKey, setSavingKey] = useState(false);
  const [testingKey, setTestingKey] = useState(false);
  const [testResult, setTestResult] = useState<{ status: string; message: string; testedSource: string } | null>(null);
  const [newOriginInput, setNewOriginInput] = useState('');

  // Rate Limits form
  const [limits, setLimits] = useState<RateLimitConfig>({
    requestsPerMinute: 12,
    requestsPerHour: 100,
    analysesPerDay: 25,
    cooldownSeconds: 4,
    maximumConcurrentJobs: 2,
    maximumPagesPerAnalysis: 25,
    maximumFileSizeMb: 20,
  });

  // Reference Library Ingest + Chunk Editor state
  const [refTitle, setRefTitle] = useState('');
  const [refGrade, setRefGrade] = useState<GradeLevel>('10');
  const [refSubject, setRefSubject] = useState<SubjectId>('hoa_hoc');
  const [refSeries, setRefSeries] = useState<string>('Kết nối tri thức với cuộc sống');
  const [refPublisher, setRefPublisher] = useState('NXB Giáo dục Việt Nam');
  const [refYear, setRefYear] = useState('2024');
  const [refDesc, setRefDesc] = useState('');
  const [refKnowledgeSourceType, setRefKnowledgeSourceType] =
    useState<KnowledgeSourceType>('textbook_reference');
  const [refLicenseStatus, setRefLicenseStatus] =
    useState<SourceLicenseStatus>('Chỉ được tham chiếu nội bộ');
  const [refInputMode, setRefInputMode] = useState<'pdf' | 'docx' | 'url' | 'text' | 'json'>('pdf');
  const [refUrl, setRefUrl] = useState('');
  const [refFile, setRefFile] = useState<File | null>(null);
  const [refRawContent, setRefRawContent] = useState('');
  const [ingestingRef, setIngestingRef] = useState(false);

  const [editingBook, setEditingBook] = useState<ReferenceBook | null>(null);
  const [bookChunks, setBookChunks] = useState<ReferenceChunk[]>([]);
  const [loadingChunks, setLoadingChunks] = useState(false);
  const [editingChunk, setEditingChunk] = useState<ReferenceChunk | null>(null);
  const [savingChunk, setSavingChunk] = useState(false);

  // Roles & Feedback state
  const [adminRoles, setAdminRoles] = useState<Array<{ uid: string; role: string; grantedAt: string; email?: string }>>([]);
  const [protectedEmails, setProtectedEmails] = useState<string[]>([]);
  const [roleIdentifier, setRoleIdentifier] = useState('');
  const [updatingRole, setUpdatingRole] = useState(false);
  const [feedbackFilter, setFeedbackFilter] = useState<'all' | 'pending' | 'reviewed' | 'resolved'>('all');

  // Exam Center Builder State
  const [examTitle, setExamTitle] = useState('');
  const [examGrade, setExamGrade] = useState<GradeLevel>('10');
  const [examSubject, setExamSubject] = useState<SubjectId>('toan');
  const [examSeries, setExamSeries] = useState<string>('Kết nối tri thức với cuộc sống');
  const [examType, setExamType] = useState<ExamType>('giua_ky_1');
  const [examYear, setExamYear] = useState('2026-2027');
  const [examSemester, setExamSemester] = useState<'1' | '2'>('1');
  const [examDuration, setExamDuration] = useState(45);
  const [examTotalScore, setExamTotalScore] = useState(10);
  const [examChaptersInput, setExamChaptersInput] = useState('Chương 1, Chương 2');
  const [generatingBlueprint, setGeneratingBlueprint] = useState(false);
  const [activeBlueprint, setActiveBlueprint] = useState<ExamBlueprint | null>(null);
  const [savingBlueprint, setSavingBlueprint] = useState(false);

  const [generatingExam, setGeneratingExam] = useState(false);
  const [activeExamDraft, setActiveExamDraft] = useState<ExamDocument | null>(null);
  const [savingExam, setSavingExam] = useState(false);
  const [rewriteQuestionId, setRewriteQuestionId] = useState<string | null>(null);
  const [rewriteInstruction, setRewriteInstruction] = useState('Làm rõ giả thiết và đáp án nhiễu hợp lý hơn');

  // Exam Print Variant Preview
  const [printPreview, setPrintPreview] = useState<{
    exam: ExamDocument;
    variantCode: string;
    questions: ExamQuestion[];
    includeAnswers: boolean;
  } | null>(null);

  const loadAllAdminData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [overviewRes, rolesRes, refList, userList, fbList, bpList, examList] = await Promise.all([
        authorizedFetch('/api/admin/overview'),
        authorizedFetch('/api/admin/roles'),
        listReferenceBooks(false),
        listAllUsersForAdmin(),
        listAllFeedbackForAdmin().catch(() => [] as FeedbackEntry[]),
        listExamBlueprints().catch(() => [] as ExamBlueprint[]),
        listExams(false).catch(() => [] as ExamDocument[]),
      ]);

      const data = await parseApiResponse<any>(overviewRes, 'Không thể tải dữ liệu Super Admin từ máy chủ.');
      setConfig(data.config);
      setMaintenanceMessage(data.config?.maintenanceMessage || '');
      setDisabledReason(data.config?.disabledReason || '');
      setActiveModel(data.config?.activeModel || 'gemini-4-hydrogen');
      if (data.config?.rateLimitConfig) setLimits(data.config.rateLimitConfig);
      if (data.config?.taskModels) setTaskModelsDraft(data.config.taskModels);
      setUsageStats(data.usageStats);
      setAuditLogs(data.auditLogs || []);
      setSingleKeyStatus(data.singleKeyStatus || null);
      setExecutionLogs(data.executionLogs || []);
      if (Array.isArray(data.modelCatalog) && data.modelCatalog.length > 0) {
        setModelCatalog(data.modelCatalog);
      }

      if (rolesRes.ok) {
        const roleData = await rolesRes.json();
        setAdminRoles(roleData.admins || []);
        setProtectedEmails(roleData.protectedEmails || []);
      }

      setBooks(refList);
      setUsers(userList);
      setFeedbackList(fbList);
      setBlueprints(bpList);
      setExams(examList);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi tải khu vực quản trị.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isSuperAdmin) {
      loadAllAdminData();
    }
  }, [isSuperAdmin]);

  const blueprintValidation = useMemo(() => {
    if (!activeBlueprint) return null;
    return validateExamBlueprint(activeBlueprint);
  }, [activeBlueprint]);

  if (!isSuperAdmin) {
    return (
      <GlassSurface className="rounded-3xl p-8 text-center">
        <Shield className="w-10 h-10 text-rose-600 mx-auto mb-3" />
        <h1 className="font-display text-xl font-bold text-[#17243A] dark:text-[#E5EDF9]">
          Không có quyền truy cập khu vực quản trị
        </h1>
        <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
          Chỉ tài khoản Super Admin được xác thực mới có thể truy cập bảng điều khiển hệ thống.
        </p>
      </GlassSurface>
    );
  }

  const handlePatchAiConfig = async (patch: Partial<SystemAiConfig>, successMsg?: string) => {
    setSavingConfig(true);
    setError(null);
    setNotice(null);
    try {
      const res = await authorizedFetch('/api/admin/ai-service', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await parseApiResponse<any>(res, 'Không thể cập nhật cấu hình.');
      setConfig(data.config);
      if (data.config?.taskModels) setTaskModelsDraft(data.config.taskModels);
      await refreshSystemStatus();
      setNotice(successMsg || `Đã cập nhật cấu hình hệ thống (Phiên bản v${data.config?.configVersion ?? 1}).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi cập nhật cấu hình.');
    } finally {
      setSavingConfig(false);
    }
  };

  const handleSetOneTimeOverride = async (taskType: AiTaskType, modelId: string | null) => {
    setError(null);
    setNotice(null);
    try {
      const res = await authorizedFetch('/api/admin/models/override', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskType, modelId }),
      });
      const data = await parseApiResponse<any>(res, 'Không thể đặt override 1 lần.');
      setConfig(data.config);
      if (data.config?.taskModels) setTaskModelsDraft(data.config.taskModels);
      setNotice(
        modelId
          ? `Đã đặt override "${modelId}" cho 1 lần chạy kế tiếp của tác vụ "${AI_TASK_LABELS[taskType]}".`
          : `Đã gỡ override của tác vụ "${AI_TASK_LABELS[taskType]}".`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi đặt override model.');
    }
  };

  const handleTestModel = async (modelId: string) => {
    setTestingModelId(modelId);
    setModelTestResult(null);
    setError(null);
    try {
      const res = await authorizedFetch('/api/admin/models/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId }),
      });
      const data = await parseApiResponse<any>(res, 'Không thể kiểm tra model.');
      setModelTestResult({
        modelId,
        ok: Boolean(data.ok),
        message: data.message || (data.ok ? 'Kết nối thành công' : 'Không kết nối được'),
        latencyMs: data.latencyMs,
      });
    } catch (err) {
      setModelTestResult({
        modelId,
        ok: false,
        message: err instanceof Error ? err.message : 'Lỗi kiểm tra model.',
      });
    } finally {
      setTestingModelId(null);
    }
  };

  const handleSaveSingleKey = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingKey(true);
    setError(null);
    setNotice(null);
    try {
      const res = await authorizedFetch('/api/admin/key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: newKeyLabel, apiKey: newRawKey }),
      });
      const data = await parseApiResponse<any>(res, 'Không thể lưu API key.');
      setSingleKeyStatus(data.singleKeyStatus);
      setNewRawKey('');
      setTestResult(null);
      setNotice(
        `Đã lưu & kích hoạt ngay API key (${data.singleKeyStatus.maskedKey}) mà không cần deploy lại.`
      );
      await loadAllAdminData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi lưu API key.');
    } finally {
      setSavingKey(false);
    }
  };

  const handleTestKey = async (rawKeyOverride?: string) => {
    setTestingKey(true);
    setError(null);
    try {
      const res = await authorizedFetch('/api/admin/key/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rawKeyOverride ? { apiKey: rawKeyOverride } : {}),
      });
      const data = await parseApiResponse<any>(res, 'Không thể kiểm tra API key.');
      setTestResult(data);
      if (data.keyStatus) setSingleKeyStatus(data.keyStatus);
      await loadAllAdminData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi kiểm tra API key.');
    } finally {
      setTestingKey(false);
    }
  };

  const handleClearAdminKey = async () => {
    setError(null);
    setNotice(null);
    try {
      const res = await authorizedFetch('/api/admin/key', { method: 'DELETE' });
      const data = await parseApiResponse<any>(res, 'Không thể xóa API key quản trị.');
      setSingleKeyStatus(data.singleKeyStatus);
      setTestResult(null);
      setNotice('Đã gỡ API key cấu hình trong Admin UI (hệ thống quay về fallback env nếu có).');
      await loadAllAdminData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi xóa API key.');
    }
  };

  const handleAddAllowedOrigin = async () => {
    const clean = newOriginInput.trim().replace(/\/$/, '');
    if (!clean) return;
    if (clean !== '*' && !clean.startsWith('http://') && !clean.startsWith('https://')) {
      setError('Origin phải bắt đầu bằng https:// hoặc http:// (hoặc * để cho phép mọi nguồn).');
      return;
    }
    const nextOrigins = Array.from(new Set([...(config?.allowedOrigins || []), clean]));
    await handlePatchAiConfig(
      { allowedOrigins: nextOrigins },
      `Đã thêm Allowed Origin "${clean}" và áp dụng ngay lập tức.`
    );
    setNewOriginInput('');
  };

  const handleRemoveAllowedOrigin = async (originToRemove: string) => {
    const nextOrigins = (config?.allowedOrigins || []).filter((o) => o !== originToRemove);
    await handlePatchAiConfig(
      { allowedOrigins: nextOrigins },
      `Đã xóa Allowed Origin "${originToRemove}".`
    );
  };

  const handleIngestReference = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setIngestingRef(true);

    const referenceId = `ref_${refSubject}_${refGrade}_${Date.now()}`;
    try {
      let ingestResult: { chunks: ReferenceChunk[]; chapters: string[]; extractedSummary: string };
      let mappedSourceType: ReferenceBook['sourceType'] = 'upload';

      if (refInputMode === 'url') {
        mappedSourceType = 'url';
        const res = await authorizedFetch('/api/admin/references/ingest-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: refUrl,
            referenceId,
            grade: refGrade,
            subject: refSubject,
            textbookSeries: refSeries,
          }),
        });
        ingestResult = await parseApiResponse<any>(res, 'Không thể lập chỉ mục từ URL.');
      } else if (refInputMode === 'text' || refInputMode === 'json') {
        mappedSourceType = refInputMode;
        if (!refRawContent.trim()) {
          throw new Error('Vui lòng dán nội dung văn bản hoặc JSON chuẩn trước khi lưu.');
        }
        const res = await authorizedFetch('/api/admin/references/ingest-text', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: refInputMode,
            content: refRawContent,
            referenceId,
            grade: refGrade,
            subject: refSubject,
            textbookSeries: refSeries,
          }),
        });
        ingestResult = await parseApiResponse<any>(res, 'Không thể lập chỉ mục từ văn bản / JSON.');
      } else if (refInputMode === 'docx') {
        if (!refFile) throw new Error('Vui lòng chọn tệp DOCX tài liệu.');
        const formData = new FormData();
        formData.append('file', refFile);
        formData.append('referenceId', referenceId);
        formData.append('grade', refGrade);
        formData.append('subject', refSubject);
        formData.append('textbookSeries', refSeries);

        const res = await authorizedFetch('/api/admin/references/ingest-docx', {
          method: 'POST',
          body: formData,
        });
        ingestResult = await parseApiResponse<any>(res, 'Không thể trích xuất và lập chỉ mục DOCX.');
      } else {
        if (!refFile) throw new Error('Vui lòng chọn tệp PDF sách giáo khoa.');
        const formData = new FormData();
        formData.append('file', refFile);
        formData.append('referenceId', referenceId);
        formData.append('grade', refGrade);
        formData.append('subject', refSubject);
        formData.append('textbookSeries', refSeries);

        const res = await authorizedFetch('/api/admin/references/ingest-pdf', {
          method: 'POST',
          body: formData,
        });
        ingestResult = await parseApiResponse<any>(res, 'Không thể trích xuất và lập chỉ mục PDF.');
      }

      const now = new Date().toISOString();
      const newBook: ReferenceBook = {
        referenceId,
        title: refTitle.trim(),
        grade: refGrade,
        subject: refSubject,
        textbookSeries: refSeries.trim(),
        publisher: refPublisher.trim(),
        editionYear: refYear.trim(),
        description: refDesc.trim(),
        sourceType: mappedSourceType,
        knowledgeSourceType: refKnowledgeSourceType,
        licenseStatus: refLicenseStatus,
        ...(refInputMode === 'url' ? { sourceUrl: refUrl.trim() } : {}),
        chapters: ingestResult.chapters || [],
        chunkCount: (ingestResult.chunks || []).length,
        status: 'active',
        indexStatus: 'indexed',
        createdAt: now,
        updatedAt: now,
      };

      await saveReferenceBookWithChunks(newBook, ingestResult.chunks || []);
      setBooks((prev) => [newBook, ...prev]);
      setRefTitle('');
      setRefDesc('');
      setRefUrl('');
      setRefFile(null);
      setRefRawContent('');
      setNotice(`Đã lập chỉ mục & lưu nguồn “${newBook.title}” — ${ingestResult.extractedSummary}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi thêm tài liệu tham chiếu.');
    } finally {
      setIngestingRef(false);
    }
  };

  const handleOpenChunkEditor = async (book: ReferenceBook) => {
    setEditingBook(book);
    setEditingChunk(null);
    setLoadingChunks(true);
    try {
      const list = await listReferenceChunksForBook(book.referenceId);
      setBookChunks(list.sort((a, b) => a.pageNumber - b.pageNumber));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không tải được các đoạn nội dung.');
    } finally {
      setLoadingChunks(false);
    }
  };

  const handleSaveChunkEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingChunk) return;
    setSavingChunk(true);
    setError(null);
    try {
      await updateReferenceChunkContent(editingChunk.chunkId, {
        chapter: editingChunk.chapter,
        lesson: editingChunk.lesson,
        pageNumber: editingChunk.pageNumber,
        sectionTitle: editingChunk.sectionTitle,
        content: editingChunk.content,
      });
      setBookChunks((prev) => prev.map((c) => (c.chunkId === editingChunk.chunkId ? editingChunk : c)));
      setEditingChunk(null);
      setNotice('Đã cập nhật nội dung đoạn chuẩn trong Firestore.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi lưu đoạn tham chiếu.');
    } finally {
      setSavingChunk(false);
    }
  };

  // Exam Builder Handlers
  const loadMatchingReferenceChunks = async (grade: GradeLevel, subject: SubjectId) => {
    const matched = books.filter(
      (b) => b.status === 'active' && b.grade === grade && b.subject === subject
    );
    const chunks: ReferenceChunk[] = [];
    for (const b of matched.slice(0, 2)) {
      const list = await listReferenceChunksForBook(b.referenceId).catch(() => []);
      chunks.push(...list);
    }
    return chunks.slice(0, 20);
  };

  const handleGenerateBlueprint = async () => {
    setGeneratingBlueprint(true);
    setError(null);
    setNotice(null);
    try {
      const chapters = examChaptersInput
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean);
      const chunks = await loadMatchingReferenceChunks(examGrade, examSubject);
      const res = await authorizedFetch('/api/admin/exams/blueprint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: examTitle.trim() || undefined,
          grade: examGrade,
          subject: examSubject,
          textbookSeries: examSeries,
          examType: examType,
          academicYear: examYear,
          semester: examSemester,
          chapters,
          durationMinutes: examDuration,
          totalScore: examTotalScore,
          referenceChunks: chunks,
        }),
      });
      const data = await parseApiResponse<{ blueprint: ExamBlueprint }>(
        res,
        'Không thể lập ma trận đề bằng AI.'
      );
      setActiveBlueprint(data.blueprint);
      setNotice('AI đã lập xong bản nháp Ma trận đề. Bạn có thể chỉnh sửa trực tiếp các dòng trước khi duyệt.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi lập ma trận đề.');
    } finally {
      setGeneratingBlueprint(false);
    }
  };

  const handleSaveApprovedBlueprint = async () => {
    if (!activeBlueprint) return;
    setSavingBlueprint(true);
    setError(null);
    try {
      const approved: ExamBlueprint = {
        ...activeBlueprint,
        status: 'approved',
        updatedAt: new Date().toISOString(),
      };
      await saveExamBlueprint(approved);
      setActiveBlueprint(approved);
      setBlueprints((prev) => [
        approved,
        ...prev.filter((b) => b.blueprintId !== approved.blueprintId),
      ]);
      setNotice(`Đã duyệt và lưu Ma trận đề "${approved.title}".`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi lưu ma trận đề.');
    } finally {
      setSavingBlueprint(false);
    }
  };

  const handleGenerateExamFromBlueprint = async () => {
    if (!activeBlueprint) return;
    setGeneratingExam(true);
    setError(null);
    setNotice(null);
    try {
      const chunks = await loadMatchingReferenceChunks(activeBlueprint.grade, activeBlueprint.subject);
      const res = await authorizedFetch('/api/admin/exams/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          blueprint: activeBlueprint,
          referenceChunks: chunks,
        }),
      });
      const data = await parseApiResponse<{ exam: ExamDocument }>(
        res,
        'Không thể sinh đề thi từ ma trận.'
      );
      setActiveExamDraft(data.exam);
      setNotice(`Đã sinh ${data.exam.questions.length} câu hỏi cho đề "${data.exam.title}". Bạn có thể kiểm tra, viết lại từng câu rồi nhấn Lưu Đề Thi.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi sinh đề thi.');
    } finally {
      setGeneratingExam(false);
    }
  };

  const handleRewriteExamQuestion = async (q: ExamQuestion) => {
    if (!activeExamDraft) return;
    setRewriteQuestionId(q.questionId);
    setError(null);
    try {
      const res = await authorizedFetch('/api/admin/exams/rewrite-question', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: q,
          instruction: rewriteInstruction,
          grade: activeExamDraft.grade,
          subject: activeExamDraft.subject,
          textbookSeries: activeExamDraft.textbookSeries,
        }),
      });
      const data = await parseApiResponse<{ question: ExamQuestion }>(res, 'Không thể viết lại câu hỏi.');
      setActiveExamDraft((prev) =>
        prev
          ? {
              ...prev,
              questions: prev.questions.map((item) =>
                item.questionId === q.questionId ? data.question : item
              ),
              updatedAt: new Date().toISOString(),
            }
          : prev
      );
      setNotice(`Đã viết lại câu #${q.orderIndex}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi viết lại câu hỏi.');
    } finally {
      setRewriteQuestionId(null);
    }
  };

  const handleSaveExamDocument = async () => {
    if (!activeExamDraft) return;
    setSavingExam(true);
    setError(null);
    try {
      const updated: ExamDocument = {
        ...activeExamDraft,
        updatedAt: new Date().toISOString(),
      };
      await saveExamDocument(updated);
      setActiveExamDraft(updated);
      setExams((prev) => [updated, ...prev.filter((e) => e.examId !== updated.examId)]);
      setNotice(
        updated.published
          ? `Đã lưu và XUẤT BẢN đề "${updated.title}" lên Trung tâm Đề kiểm tra học sinh.`
          : `Đã lưu bản nháp đề "${updated.title}".`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi lưu đề thi.');
    } finally {
      setSavingExam(false);
    }
  };

  const handleGrantRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roleIdentifier.trim()) return;
    setUpdatingRole(true);
    setError(null);
    setNotice(null);
    try {
      const res = await authorizedFetch('/api/admin/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: roleIdentifier.trim() }),
      });
      const data = await parseApiResponse<any>(res, 'Không thể cấp quyền Super Admin.');
      setRoleIdentifier('');
      setNotice(`Đã cấp quyền Super Admin cho UID: ${data.admin?.uid}`);
      await loadAllAdminData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi cấp quyền Admin.');
    } finally {
      setUpdatingRole(false);
    }
  };

  const handleRevokeRole = async (uid: string) => {
    setError(null);
    setNotice(null);
    try {
      const res = await authorizedFetch(`/api/admin/roles/${encodeURIComponent(uid)}`, {
        method: 'DELETE',
      });
      await parseApiResponse<any>(res, 'Không thể thu hồi quyền Super Admin.');
      setNotice(`Đã thu hồi quyền Super Admin của UID: ${uid}`);
      await loadAllAdminData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi thu hồi quyền.');
    }
  };

  // Print Variant Overlay
  if (printPreview) {
    return (
      <div className="space-y-6">
        <div className="no-print flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {(['101', '102', '103'] as const).map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => {
                  const v = generateShuffledExamVariant(printPreview.exam, code);
                  setPrintPreview({
                    ...printPreview,
                    variantCode: code,
                    questions: v.questions,
                  });
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold border cursor-pointer ${
                  printPreview.variantCode === code
                    ? 'bg-sky-600 text-white border-sky-600'
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-[#17243A] dark:text-[#E5EDF9]'
                }`}
              >
                Mã đề {code}
              </button>
            ))}
            <label className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 ml-2 cursor-pointer">
              <input
                type="checkbox"
                checked={printPreview.includeAnswers}
                onChange={(e) =>
                  setPrintPreview({ ...printPreview, includeAnswers: e.target.checked })
                }
              />
              Kèm đáp án & giải thích riêng cuối trang
            </label>
          </div>
          <div className="flex items-center gap-2">
            <WaterRippleButton size="sm" onClick={() => window.print()}>
              <Printer className="w-4 h-4" />
              In / Lưu PDF
            </WaterRippleButton>
            <WaterRippleButton size="sm" variant="secondary" onClick={() => setPrintPreview(null)}>
              Đóng bản in
            </WaterRippleButton>
          </div>
        </div>

        <div className="document-paper rounded-3xl p-8 space-y-6">
          <div className="text-center border-b border-slate-200 dark:border-slate-700 pb-4">
            <p className="text-xs uppercase tracking-wider text-slate-500">
              {EXAM_TYPE_LABELS[printPreview.exam.examType]} · Năm học {printPreview.exam.academicYear}
            </p>
            <h2 className="font-display text-xl font-bold mt-1">{printPreview.exam.title}</h2>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
              Môn: {SUBJECT_LABELS[printPreview.exam.subject]} · Lớp {printPreview.exam.grade} · Thời gian:{' '}
              {printPreview.exam.durationMinutes} phút · <strong>Mã đề: {printPreview.variantCode}</strong>
            </p>
          </div>

          <div className="space-y-4">
            {printPreview.questions.map((q) => (
              <div key={q.questionId} className="text-sm space-y-1.5 pb-3 border-b border-slate-100 dark:border-slate-800">
                <p className="font-semibold">
                  Câu {q.orderIndex} ({q.scoreWeight} điểm): {q.questionText}
                </p>
                {q.questionType === 'abcd' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pl-4 text-xs">
                    <p>A. {q.optionA}</p>
                    <p>B. {q.optionB}</p>
                    <p>C. {q.optionC}</p>
                    <p>D. {q.optionD}</p>
                  </div>
                )}
                {q.questionType === 'true_false' && (
                  <div className="pl-4 space-y-1 text-xs">
                    {(q.trueFalseStatements || []).map((st) => (
                      <p key={st.label}>
                        {st.label}) {st.text} (Đúng / Sai)
                      </p>
                    ))}
                  </div>
                )}
                {q.questionType === 'short_answer' && (
                  <p className="pl-4 text-xs text-slate-500">Đáp án ngắn: ........................................</p>
                )}
              </div>
            ))}
          </div>

          {printPreview.includeAnswers && (
            <div className="pt-6 border-t-2 border-slate-300 dark:border-slate-700 space-y-3">
              <h3 className="font-display text-base font-bold">
                ĐÁP ÁN CHÍNH THỨC — MÃ ĐỀ {printPreview.variantCode}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                {printPreview.questions.map((q) => (
                  <div key={q.questionId} className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/60">
                    <p className="font-semibold">
                      Câu {q.orderIndex}:{' '}
                      {q.questionType === 'abcd'
                        ? q.correctAnswer
                        : q.questionType === 'true_false'
                          ? (q.trueFalseStatements || [])
                              .map((s) => `${s.label}:${s.isTrue ? 'Đ' : 'S'}`)
                              .join(', ')
                          : (q.shortAnswerAccepted || []).join(' / ')}
                    </p>
                    <p className="text-slate-600 dark:text-slate-300 mt-0.5">{q.explanation}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-sky-700 dark:text-sky-400">
            Khu vực quản trị tối cao · Không cần redeploy khi thay đổi cấu hình
          </p>
          <h1 className="font-display text-2xl font-bold text-[#17243A] dark:text-[#E5EDF9]">
            Trung tâm điều khiển StudyCheck AI
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {config && (
            <span className="font-mono text-xs px-2.5 py-1.5 rounded-lg bg-white/80 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300">
              Config v{config.configVersion || 1}
            </span>
          )}
          <WaterRippleButton variant="secondary" size="sm" onClick={loadAllAdminData}>
            <RefreshCw className="w-3.5 h-3.5" />
            Làm mới
          </WaterRippleButton>
        </div>
      </div>

      {/* Consolidated 7 Live Admin Tabs */}
      <div className="flex flex-wrap gap-2">
        {(
          [
            ['overview', 'Tổng quan & Công tắc AI', Power],
            ['models', 'Model Router (11 tác vụ)', Cpu],
            ['api_security', 'API Key & Bảo mật', KeyRound],
            ['references', 'Thư viện nguồn chuẩn', BookOpen],
            ['exams', 'Quản trị Đề kiểm tra', ClipboardCheck],
            ['feedback_roles', 'Phản hồi & Phân quyền', UserCheck],
            ['limits_audit', 'Giới hạn & Nhật ký', Sliders],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold border cursor-pointer transition-colors ${
              tab === id
                ? 'bg-sky-600 text-white border-sky-600'
                : 'bg-white dark:bg-slate-900 text-[#17243A] dark:text-[#E5EDF9] border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 dark:border-rose-800/70 bg-rose-50 dark:bg-rose-950/50 px-4 py-3 text-xs text-rose-800 dark:text-rose-200 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {notice && (
        <div className="rounded-xl border border-emerald-200 dark:border-emerald-800/70 bg-emerald-50 dark:bg-emerald-950/50 px-4 py-3 text-xs text-emerald-800 dark:text-emerald-200 flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
          <span>{notice}</span>
        </div>
      )}

      {loading ? (
        <GlassSurface className="rounded-2xl p-10 text-center">
          <Loader2 className="w-8 h-8 text-sky-600 animate-spin mx-auto" />
          <p className="text-xs text-slate-600 dark:text-slate-300 mt-3">Đang đồng bộ dữ liệu quản trị...</p>
        </GlassSurface>
      ) : (
        <>
          {/* TAB 1: OVERVIEW & GLOBAL AI SWITCH */}
          {tab === 'overview' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <GlassSurface className="rounded-2xl p-5">
                  <p className="text-xs text-slate-500 dark:text-slate-400">Trạng thái dịch vụ AI</p>
                  <p
                    className={`font-display text-xl font-bold mt-1 ${
                      config?.enabled ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'
                    }`}
                  >
                    {config?.enabled ? 'ĐANG HOẠT ĐỘNG' : 'ĐÃ TẠM NGỪNG'}
                  </p>
                  <p className="font-mono text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                    Mặc định: {config?.activeModel} · Config v{config?.configVersion ?? 1}
                  </p>
                </GlassSurface>

                <GlassSurface className="rounded-2xl p-5">
                  <p className="text-xs text-slate-500 dark:text-slate-400">Yêu cầu AI hôm nay</p>
                  <p className="font-mono text-2xl font-bold text-[#17243A] dark:text-[#E5EDF9] tabular-nums mt-1">
                    {usageStats?.today.requestCount ?? 0}
                  </p>
                  <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
                    Thành công: {usageStats?.today.successfulCount ?? 0} · Bị chặn:{' '}
                    {usageStats?.today.blockedCount ?? 0}
                  </p>
                </GlassSurface>

                <GlassSurface className="rounded-2xl p-5">
                  <p className="text-xs text-slate-500 dark:text-slate-400">Token Gemini thực tế</p>
                  <p className="font-mono text-2xl font-bold text-sky-700 dark:text-sky-400 tabular-nums mt-1">
                    {(usageStats?.today.actualTotalTokens ?? 0).toLocaleString('vi-VN')}
                  </p>
                  <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
                    Prompt {(usageStats?.today.actualPromptTokens ?? 0).toLocaleString('vi-VN')} · Output{' '}
                    {(usageStats?.today.actualCandidateTokens ?? 0).toLocaleString('vi-VN')}
                  </p>
                </GlassSurface>

                <GlassSurface className="rounded-2xl p-5">
                  <p className="text-xs text-slate-500 dark:text-slate-400">Hệ sinh thái học tập</p>
                  <p className="font-mono text-2xl font-bold text-[#17243A] dark:text-[#E5EDF9] tabular-nums mt-1">
                    {books.length} / {exams.length} / {users.length}
                  </p>
                  <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
                    Sách chuẩn / Đề thi / Tài khoản
                  </p>
                </GlassSurface>
              </div>

              {config && (
                <GlassSurface className="rounded-3xl p-6 space-y-5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200/80 dark:border-slate-700/80">
                    <div>
                      <h2 className="font-display text-lg font-bold text-[#17243A] dark:text-[#E5EDF9]">
                        Công tắc dịch vụ AI & Thông báo bảo trì
                      </h2>
                      <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
                        Khi tắt AI, mọi endpoint OCR, phân tích, tạo đề thi và quiz trả về HTTP 503. Học sinh vẫn làm đề đã xuất bản, ôn Flashcard và xem BXH bình thường.
                      </p>
                    </div>
                    <WaterRippleButton
                      variant={config.enabled ? 'danger' : 'primary'}
                      disabled={savingConfig}
                      onClick={() =>
                        handlePatchAiConfig({
                          enabled: !config.enabled,
                          maintenanceMessage,
                          disabledReason,
                          activeModel,
                        })
                      }
                    >
                      <Power className="w-4 h-4" />
                      {config.enabled ? 'Tắt xử lý AI khẩn cấp' : 'Kích hoạt lại dịch vụ AI'}
                    </WaterRippleButton>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                        Thông báo bảo trì hiển thị cho học sinh
                      </label>
                      <textarea
                        rows={3}
                        value={maintenanceMessage}
                        onChange={(e) => setMaintenanceMessage(e.target.value)}
                        className={INPUT_CLASS}
                      />
                    </div>
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                          Lý do nội bộ (Audit Log)
                        </label>
                        <input
                          type="text"
                          value={disabledReason}
                          onChange={(e) => setDisabledReason(e.target.value)}
                          placeholder="Ví dụ: Đổi API key / Bảo trì định kỳ"
                          className={INPUT_CLASS}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                          Model Gemini dự phòng chung
                        </label>
                        <select
                          value={activeModel}
                          onChange={(e) => setActiveModel(e.target.value)}
                          className={`${INPUT_CLASS} font-mono`}
                        >
                          {modelCatalog.map((m) => (
                            <option key={m.modelId} value={m.modelId}>
                              {m.displayName} ({m.modelId})
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>

                  <WaterRippleButton
                    disabled={savingConfig}
                    onClick={() =>
                      handlePatchAiConfig({
                        maintenanceMessage,
                        disabledReason,
                        activeModel,
                      })
                    }
                  >
                    <Save className="w-4 h-4" />
                    Lưu cấu hình bảo trì & Model chung
                  </WaterRippleButton>
                </GlassSurface>
              )}

              {usageStats && (
                <GlassSurface className="rounded-2xl p-6 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="font-display text-base font-bold text-[#17243A] dark:text-[#E5EDF9]">
                      Thống kê lưu lượng & Lỗi theo ngày
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Hôm nay: OCR {usageStats.today.ocrCount} · Phân tích {usageStats.today.analysisCount} ·
                      Quiz {usageStats.today.quizGenerationCount} · Web Grounding {usageStats.today.webGroundedCount}
                    </p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400">
                        <tr>
                          <th className="py-2 pr-4">Ngày</th>
                          <th className="py-2 pr-4">Tổng Req</th>
                          <th className="py-2 pr-4">Thành công</th>
                          <th className="py-2 pr-4">Bị chặn</th>
                          <th className="py-2 pr-4">Token thực tế</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono">
                        {usageStats.dailySeries.map((d) => (
                          <tr key={d.date}>
                            <td className="py-2 pr-4">{d.date}</td>
                            <td className="py-2 pr-4">{d.requestCount}</td>
                            <td className="py-2 pr-4 text-emerald-700 dark:text-emerald-400">{d.successfulCount}</td>
                            <td className="py-2 pr-4 text-rose-700 dark:text-rose-400">{d.blockedCount}</td>
                            <td className="py-2 pr-4">{d.actualTotalTokens.toLocaleString('vi-VN')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </GlassSurface>
              )}
            </div>
          )}

          {/* TAB 2: MODEL ROUTER (11 TASKS) */}
          {tab === 'models' && taskModelsDraft && (
            <div className="space-y-6">
              <GlassSurface className="rounded-3xl p-6 space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h2 className="font-display text-lg font-bold text-[#17243A] dark:text-[#E5EDF9]">
                      Model Router cho 11 tác vụ AI chuyên biệt
                    </h2>
                    <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
                      Chọn model mặc định, model fallback (chỉ chạy khi bật Fallback) hoặc gán model dùng 1 lần cho lần chạy kế tiếp. Không cần deploy lại.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {modelCatalog.map((m) => (
                      <button
                        key={m.modelId}
                        type="button"
                        disabled={testingModelId === m.modelId}
                        onClick={() => handleTestModel(m.modelId)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-[#17243A] dark:text-[#E5EDF9] hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                      >
                        <Activity className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                        {testingModelId === m.modelId ? 'Đang test...' : `Test ${m.modelId}`}
                      </button>
                    ))}
                  </div>
                </div>

                {modelTestResult && (
                  <div
                    className={`rounded-xl border p-3.5 text-xs ${
                      modelTestResult.ok
                        ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
                        : 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-900 dark:text-rose-200'
                    }`}
                  >
                    <strong>Test {modelTestResult.modelId}:</strong> {modelTestResult.message}
                    {modelTestResult.latencyMs ? ` (${modelTestResult.latencyMs} ms)` : ''}
                  </div>
                )}

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400">
                      <tr>
                        <th className="py-2.5 pr-3">Tác vụ AI</th>
                        <th className="py-2.5 pr-3">Model mặc định</th>
                        <th className="py-2.5 pr-3">Fallback</th>
                        <th className="py-2.5 pr-3">Bật Fallback</th>
                        <th className="py-2.5 pr-3">Dùng 1 lần cho lần chạy tới</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {(Object.keys(AI_TASK_LABELS) as AiTaskType[]).map((taskKey) => {
                        const row = taskModelsDraft[taskKey] || {
                          defaultModel: 'gemini-4-hydrogen',
                          fallbackModel: 'gemini-3.1-flash-lite',
                          enableFallback: false,
                          oneTimeOverrideModel: null,
                          promptVersion: 'v2.1',
                        };
                        const overrideDraft =
                          overrideSelection[taskKey] ?? row.oneTimeOverrideModel ?? 'gemini-3.1-flash-lite';
                        return (
                          <tr key={taskKey} className="align-middle">
                            <td className="py-3 pr-3">
                              <p className="font-semibold text-[#17243A] dark:text-[#E5EDF9]">
                                {AI_TASK_LABELS[taskKey]}
                              </p>
                              <p className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                                {taskKey} · {row.promptVersion}
                              </p>
                            </td>
                            <td className="py-3 pr-3 min-w-[175px]">
                              <select
                                value={row.defaultModel}
                                onChange={(e) =>
                                  setTaskModelsDraft((prev) =>
                                    prev
                                      ? {
                                          ...prev,
                                          [taskKey]: { ...row, defaultModel: e.target.value },
                                        }
                                      : prev
                                  )
                                }
                                className={`${INPUT_CLASS} font-mono`}
                              >
                                {modelCatalog.map((m) => (
                                  <option key={m.modelId} value={m.modelId}>
                                    {m.modelId}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="py-3 pr-3 min-w-[175px]">
                              <select
                                value={row.fallbackModel}
                                onChange={(e) =>
                                  setTaskModelsDraft((prev) =>
                                    prev
                                      ? {
                                          ...prev,
                                          [taskKey]: { ...row, fallbackModel: e.target.value },
                                        }
                                      : prev
                                  )
                                }
                                className={`${INPUT_CLASS} font-mono`}
                              >
                                {modelCatalog.map((m) => (
                                  <option key={m.modelId} value={m.modelId}>
                                    {m.modelId}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="py-3 pr-3">
                              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={Boolean(row.enableFallback)}
                                  onChange={(e) =>
                                    setTaskModelsDraft((prev) =>
                                      prev
                                        ? {
                                            ...prev,
                                            [taskKey]: { ...row, enableFallback: e.target.checked },
                                          }
                                        : prev
                                    )
                                  }
                                />
                                <span>{row.enableFallback ? 'Có' : 'Không'}</span>
                              </label>
                            </td>
                            <td className="py-3 pr-3">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <select
                                  value={overrideDraft}
                                  onChange={(e) =>
                                    setOverrideSelection((prev) => ({
                                      ...prev,
                                      [taskKey]: e.target.value,
                                    }))
                                  }
                                  className="px-2 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-[11px] text-[#17243A] dark:text-[#E5EDF9]"
                                >
                                  {modelCatalog.map((m) => (
                                    <option key={m.modelId} value={m.modelId}>
                                      {m.modelId}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  type="button"
                                  onClick={() => handleSetOneTimeOverride(taskKey, overrideDraft)}
                                  className="px-2.5 py-1.5 rounded-lg bg-sky-600 text-white text-[11px] font-semibold hover:bg-sky-700 cursor-pointer"
                                >
                                  Dùng 1 lần
                                </button>
                                {row.oneTimeOverrideModel && (
                                  <button
                                    type="button"
                                    onClick={() => handleSetOneTimeOverride(taskKey, null)}
                                    className="px-2 py-1.5 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 text-[11px] font-semibold cursor-pointer"
                                  >
                                    Đang chờ: {row.oneTimeOverrideModel} (Gỡ)
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <WaterRippleButton
                  disabled={savingConfig}
                  onClick={() =>
                    handlePatchAiConfig(
                      { taskModels: taskModelsDraft },
                      'Đã lưu bảng điều phối Model cho 11 tác vụ AI.'
                    )
                  }
                >
                  <Save className="w-4 h-4" />
                  Lưu toàn bộ Model Router
                </WaterRippleButton>
              </GlassSurface>

              <GlassSurface className="rounded-2xl p-6 space-y-4">
                <h3 className="font-display text-base font-bold text-[#17243A] dark:text-[#E5EDF9]">
                  Nhật ký thực thi Model gần nhất ({executionLogs.length})
                </h3>
                {executionLogs.length === 0 ? (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Chưa có lượt gọi AI nào trong phiên máy chủ hiện tại.
                  </p>
                ) : (
                  <div className="overflow-x-auto max-h-[340px]">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400">
                        <tr>
                          <th className="py-2 pr-3">Thời gian</th>
                          <th className="py-2 pr-3">Tác vụ</th>
                          <th className="py-2 pr-3">Model</th>
                          <th className="py-2 pr-3">Chế độ</th>
                          <th className="py-2 pr-3">Thời lượng</th>
                          <th className="py-2 pr-3">Trạng thái</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono text-[11px]">
                        {executionLogs.map((log) => (
                          <tr key={log.executionId}>
                            <td className="py-2 pr-3">{new Date(log.timestamp).toLocaleTimeString('vi-VN')}</td>
                            <td className="py-2 pr-3">{log.taskType}</td>
                            <td className="py-2 pr-3">{log.modelId}</td>
                            <td className="py-2 pr-3">
                              {log.cached
                                ? 'Cache'
                                : log.usedOverride
                                  ? '1-Time Override'
                                  : log.usedFallback
                                    ? 'Fallback'
                                    : 'Default'}
                            </td>
                            <td className="py-2 pr-3">{log.durationMs} ms</td>
                            <td
                              className={`py-2 pr-3 font-semibold ${
                                log.status === 'success'
                                  ? 'text-emerald-700 dark:text-emerald-400'
                                  : 'text-rose-700 dark:text-rose-400'
                              }`}
                            >
                              {log.status}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </GlassSurface>
            </div>
          )}

          {/* TAB 3: SINGLE API KEY & ALLOWED ORIGINS */}
          {tab === 'api_security' && (
            <div className="space-y-6">
              <GlassSurface className="rounded-2xl p-6 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="font-display text-base font-bold text-[#17243A] dark:text-[#E5EDF9]">
                      API Key Gemini dùng chung cho toàn bộ tác vụ
                    </h2>
                    <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
                      Sử dụng <strong>1 API key duy nhất</strong> cho toàn bộ pipeline. Có thể đổi bất cứ lúc nào mà không cần sửa code hoặc deploy lại.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <WaterRippleButton
                      size="sm"
                      variant="secondary"
                      disabled={testingKey || !singleKeyStatus?.configured}
                      onClick={() => handleTestKey()}
                    >
                      {testingKey ? 'Đang kiểm tra...' : 'Test API Key đang dùng'}
                    </WaterRippleButton>
                    {singleKeyStatus?.source === 'admin' && (
                      <button
                        type="button"
                        onClick={handleClearAdminKey}
                        className="px-3 py-1.5 rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 text-xs font-semibold hover:bg-rose-100 cursor-pointer"
                      >
                        Gỡ key Admin
                      </button>
                    )}
                  </div>
                </div>

                <div className="document-paper rounded-xl p-4 text-xs grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <p className="text-slate-500 dark:text-slate-400">Trạng thái hiện tại</p>
                    <p
                      className={`font-semibold mt-0.5 ${
                        singleKeyStatus?.configured
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-rose-700 dark:text-rose-400'
                      }`}
                    >
                      {singleKeyStatus?.configured
                        ? singleKeyStatus.source === 'admin'
                          ? 'Đang dùng Key của Quản trị viên'
                          : 'Đang dùng biến GEMINI_API_KEY của máy chủ'
                        : 'Chưa có API Key nào'}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-500 dark:text-slate-400">Mã nhận diện (đã che)</p>
                    <p className="font-mono font-semibold mt-0.5">
                      {singleKeyStatus?.maskedKey || '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-500 dark:text-slate-400">Kiểm tra gần nhất</p>
                    <p className="font-semibold mt-0.5">{singleKeyStatus?.lastTestStatus || 'Untested'}</p>
                  </div>
                </div>

                {testResult && (
                  <div
                    className={`rounded-xl border p-3.5 text-xs ${
                      testResult.status === 'Connected'
                        ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
                        : 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-900 dark:text-rose-200'
                    }`}
                  >
                    <strong>Kết quả kiểm tra ({testResult.status}):</strong> {testResult.message}
                  </div>
                )}

                <form onSubmit={handleSaveSingleKey} className="space-y-4 pt-2 border-t border-slate-200/80 dark:border-slate-700/80">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Tên gợi nhớ (tùy chọn)
                      </label>
                      <input
                        type="text"
                        value={newKeyLabel}
                        onChange={(e) => setNewKeyLabel(e.target.value)}
                        placeholder="Ví dụ: Gemini Key Production"
                        className={INPUT_CLASS}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Gemini API Key mới
                      </label>
                      <input
                        type="password"
                        required
                        value={newRawKey}
                        onChange={(e) => setNewRawKey(e.target.value)}
                        placeholder="Dán API key vào đây (ví dụ AIza...)"
                        className={`${INPUT_CLASS} font-mono`}
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <WaterRippleButton type="submit" disabled={savingKey}>
                      {savingKey ? 'Đang lưu...' : 'Lưu & Áp dụng ngay lập tức'}
                    </WaterRippleButton>
                    <button
                      type="button"
                      disabled={testingKey || !newRawKey.trim()}
                      onClick={() => handleTestKey(newRawKey)}
                      className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold text-[#17243A] dark:text-[#E5EDF9] hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-45 cursor-pointer"
                    >
                      Thử nghiệm key đang nhập
                    </button>
                  </div>
                </form>
              </GlassSurface>

              {/* LIVE ALLOWED_ORIGIN MANAGER */}
              <GlassSurface className="rounded-2xl p-6 space-y-4">
                <div>
                  <h2 className="font-display text-base font-bold text-[#17243A] dark:text-[#E5EDF9]">
                    Quản lý tên miền được phép truy cập (Live ALLOWED_ORIGIN)
                  </h2>
                  <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
                    Thêm hoặc xóa tên miền CORS trực tiếp mà không cần sửa biến môi trường hay deploy lại. Nếu danh sách trống, máy chủ cho phép cùng origin mặc định.
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={newOriginInput}
                    onChange={(e) => setNewOriginInput(e.target.value)}
                    placeholder="https://ten-mien-cua-ban.vercel.app hoặc http://localhost:3000"
                    className={`${INPUT_CLASS} font-mono`}
                  />
                  <WaterRippleButton
                    type="button"
                    size="sm"
                    disabled={savingConfig || !newOriginInput.trim()}
                    onClick={handleAddAllowedOrigin}
                  >
                    <Plus className="w-4 h-4" />
                    Thêm Origin
                  </WaterRippleButton>
                </div>

                <div className="space-y-2">
                  {(config?.allowedOrigins || []).length === 0 ? (
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Chưa cấu hình danh sách riêng (đang dùng mặc định từ server / môi trường).
                    </p>
                  ) : (
                    (config?.allowedOrigins || []).map((origin) => (
                      <div
                        key={origin}
                        className="flex items-center justify-between gap-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-3.5 py-2 text-xs"
                      >
                        <span className="font-mono text-[#17243A] dark:text-[#E5EDF9] break-all">{origin}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveAllowedOrigin(origin)}
                          className="text-rose-600 dark:text-rose-400 hover:underline font-semibold shrink-0 cursor-pointer"
                        >
                          Xóa
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </GlassSurface>
            </div>
          )}

          {/* TAB 4: REFERENCE LIBRARY + CHUNK EDITOR */}
          {tab === 'references' && (
            <div className="space-y-6">
              <GlassSurface className="rounded-3xl p-6 space-y-5">
                <h2 className="font-display text-lg font-bold text-[#17243A] dark:text-[#E5EDF9]">
                  Thêm nguồn kiến thức chuẩn (PDF / DOCX / URL / Text / JSON)
                </h2>

                <div className="flex flex-wrap gap-2 text-xs">
                  {(
                    [
                      ['pdf', 'Tải PDF', FileUp],
                      ['docx', 'Tải DOCX', FileText],
                      ['url', 'Nhập URL HTTPS', Globe],
                      ['text', 'Dán văn bản chuẩn', Edit3],
                      ['json', 'Import JSON', Cpu],
                    ] as const
                  ).map(([modeId, label, Icon]) => (
                    <button
                      key={modeId}
                      type="button"
                      onClick={() => {
                        setRefInputMode(modeId);
                        setRefFile(null);
                      }}
                      className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl font-semibold border cursor-pointer ${
                        refInputMode === modeId
                          ? 'bg-sky-600 text-white border-sky-600'
                          : 'bg-white dark:bg-slate-900 text-[#17243A] dark:text-[#E5EDF9] border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {label}
                    </button>
                  ))}
                </div>

                <form onSubmit={handleIngestReference} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Tên tài liệu / Sách
                      </label>
                      <input
                        type="text"
                        required
                        value={refTitle}
                        onChange={(e) => setRefTitle(e.target.value)}
                        placeholder="Ví dụ: Hóa học 10 - Kết nối tri thức"
                        className={INPUT_CLASS}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Khối lớp
                      </label>
                      <select
                        value={refGrade}
                        onChange={(e) => setRefGrade(e.target.value as GradeLevel)}
                        className={INPUT_CLASS}
                      >
                        <option value="10">Lớp 10</option>
                        <option value="11">Lớp 11</option>
                        <option value="12">Lớp 12</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Môn học
                      </label>
                      <select
                        value={refSubject}
                        onChange={(e) => setRefSubject(e.target.value as SubjectId)}
                        className={INPUT_CLASS}
                      >
                        {(Object.keys(SUBJECT_LABELS) as SubjectId[]).map((s) => (
                          <option key={s} value={s}>
                            {SUBJECT_LABELS[s]}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Bộ sách
                      </label>
                      <select
                        value={refSeries}
                        onChange={(e) => setRefSeries(e.target.value)}
                        className={INPUT_CLASS}
                      >
                        {TEXTBOOK_SERIES_OPTIONS.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Phân loại nguồn tri thức
                      </label>
                      <select
                        value={refKnowledgeSourceType}
                        onChange={(e) =>
                          setRefKnowledgeSourceType(e.target.value as KnowledgeSourceType)
                        }
                        className={INPUT_CLASS}
                      >
                        {(Object.keys(KNOWLEDGE_SOURCE_LABELS) as KnowledgeSourceType[]).map((k) => (
                          <option key={k} value={k}>
                            {KNOWLEDGE_SOURCE_LABELS[k]}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Trạng thái bản quyền nguồn
                      </label>
                      <select
                        value={refLicenseStatus}
                        onChange={(e) => setRefLicenseStatus(e.target.value as SourceLicenseStatus)}
                        className={INPUT_CLASS}
                      >
                        {LICENSE_STATUS_OPTIONS.map((lic) => (
                          <option key={lic} value={lic}>
                            {lic}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Nhà xuất bản / Nguồn phát hành
                      </label>
                      <input
                        type="text"
                        value={refPublisher}
                        onChange={(e) => setRefPublisher(e.target.value)}
                        className={INPUT_CLASS}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Năm xuất bản
                      </label>
                      <input
                        type="text"
                        value={refYear}
                        onChange={(e) => setRefYear(e.target.value)}
                        className={INPUT_CLASS}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Mô tả ngắn
                      </label>
                      <input
                        type="text"
                        value={refDesc}
                        onChange={(e) => setRefDesc(e.target.value)}
                        placeholder="Ghi chú phạm vi chương..."
                        className={INPUT_CLASS}
                      />
                    </div>
                  </div>

                  {refInputMode === 'url' && (
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                        URL HTTPS tài liệu (hệ thống tự chặn IP nội bộ / SSRF)
                      </label>
                      <input
                        type="url"
                        required
                        value={refUrl}
                        onChange={(e) => setRefUrl(e.target.value)}
                        placeholder="https://example.edu.vn/sgk-hoa-10.pdf"
                        className={INPUT_CLASS}
                      />
                    </div>
                  )}

                  {(refInputMode === 'pdf' || refInputMode === 'docx') && (
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Chọn tệp {refInputMode.toUpperCase()} có lớp văn bản
                      </label>
                      <input
                        type="file"
                        accept={
                          refInputMode === 'pdf'
                            ? 'application/pdf'
                            : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                        }
                        required
                        onChange={(e) => setRefFile(e.target.files?.[0] || null)}
                        className={INPUT_CLASS}
                      />
                    </div>
                  )}

                  {(refInputMode === 'text' || refInputMode === 'json') && (
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                        {refInputMode === 'json'
                          ? 'Dán mảng JSON [{ "chapter": "...", "lesson": "...", "pageNumber": 12, "sectionTitle": "...", "content": "..." }]'
                          : 'Dán văn bản kiến thức chuẩn (có thể chia theo Chương / Bài)'}
                      </label>
                      <textarea
                        rows={6}
                        required
                        value={refRawContent}
                        onChange={(e) => setRefRawContent(e.target.value)}
                        placeholder={
                          refInputMode === 'json'
                            ? '[{"chapter":"Chương 1","lesson":"Bài 1","pageNumber":10,"sectionTitle":"Khái niệm","content":"..."}]'
                            : 'Chương 1: Cấu tạo nguyên tử...'
                        }
                        className={`${INPUT_CLASS} font-mono`}
                      />
                    </div>
                  )}

                  <WaterRippleButton type="submit" disabled={ingestingRef}>
                    {ingestingRef ? 'Đang trích xuất & lập chỉ mục...' : 'Lập chỉ mục & Lưu vào kho chuẩn'}
                  </WaterRippleButton>
                </form>
              </GlassSurface>

              {/* INLINE CHUNK EDITOR */}
              {editingBook && (
                <GlassSurface className="rounded-3xl p-6 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-700 pb-3">
                    <div>
                      <p className="text-xs font-semibold text-sky-700 dark:text-sky-400">
                        Chỉnh sửa trực tiếp các đoạn kiến thức (Chunks)
                      </p>
                      <h3 className="font-display text-base font-bold text-[#17243A] dark:text-[#E5EDF9]">
                        {editingBook.title}
                      </h3>
                    </div>
                    <WaterRippleButton
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setEditingBook(null);
                        setEditingChunk(null);
                      }}
                    >
                      Đóng trình sửa Chunk
                    </WaterRippleButton>
                  </div>

                  {editingChunk && (
                    <form
                      onSubmit={handleSaveChunkEdit}
                      className="document-paper rounded-2xl p-4 space-y-3"
                    >
                      <p className="text-xs font-bold text-sky-700 dark:text-sky-400">
                        Đang sửa Chunk: {editingChunk.chunkId}
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                        <input
                          type="text"
                          value={editingChunk.chapter}
                          onChange={(e) => setEditingChunk({ ...editingChunk, chapter: e.target.value })}
                          placeholder="Chương"
                          className={INPUT_CLASS}
                        />
                        <input
                          type="text"
                          value={editingChunk.lesson}
                          onChange={(e) => setEditingChunk({ ...editingChunk, lesson: e.target.value })}
                          placeholder="Bài học"
                          className={INPUT_CLASS}
                        />
                        <input
                          type="text"
                          value={editingChunk.sectionTitle}
                          onChange={(e) =>
                            setEditingChunk({ ...editingChunk, sectionTitle: e.target.value })
                          }
                          placeholder="Mục"
                          className={INPUT_CLASS}
                        />
                        <input
                          type="number"
                          min={1}
                          value={editingChunk.pageNumber}
                          onChange={(e) =>
                            setEditingChunk({
                              ...editingChunk,
                              pageNumber: Math.max(1, Number(e.target.value) || 1),
                            })
                          }
                          placeholder="Trang"
                          className={INPUT_CLASS}
                        />
                      </div>
                      <textarea
                        rows={4}
                        value={editingChunk.content}
                        onChange={(e) => setEditingChunk({ ...editingChunk, content: e.target.value })}
                        className={INPUT_CLASS}
                      />
                      <div className="flex items-center gap-2">
                        <WaterRippleButton type="submit" size="sm" disabled={savingChunk}>
                          {savingChunk ? 'Đang lưu...' : 'Lưu đoạn đã sửa'}
                        </WaterRippleButton>
                        <button
                          type="button"
                          onClick={() => setEditingChunk(null)}
                          className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold cursor-pointer"
                        >
                          Hủy
                        </button>
                      </div>
                    </form>
                  )}

                  {loadingChunks ? (
                    <p className="text-xs text-slate-500">Đang tải danh sách đoạn nội dung...</p>
                  ) : (
                    <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
                      {bookChunks.map((ch) => (
                        <div
                          key={ch.chunkId}
                          className="document-paper rounded-xl p-3.5 text-xs flex flex-col sm:flex-row sm:items-start justify-between gap-3"
                        >
                          <div className="space-y-1">
                            <p className="font-semibold">
                              {ch.chapter} · {ch.lesson} · Trang {ch.pageNumber} ({ch.sectionTitle})
                            </p>
                            <p className="text-slate-600 dark:text-slate-300 line-clamp-3">{ch.content}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setEditingChunk(ch)}
                            className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-semibold shrink-0 cursor-pointer"
                          >
                            Sửa đoạn
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </GlassSurface>
              )}

              <div className="space-y-3">
                {books.map((book) => (
                  <GlassSurface
                    key={book.referenceId}
                    className="rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                  >
                    <div>
                      <p className="text-sm font-bold text-[#17243A] dark:text-[#E5EDF9]">{book.title}</p>
                      <p className="text-slate-600 dark:text-slate-300 mt-0.5">
                        {SUBJECT_LABELS[book.subject]} · Lớp {book.grade} · {book.textbookSeries} ·{' '}
                        <span className="font-mono">{book.chunkCount} đoạn</span> · {book.chapters.length} chương
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                        {book.knowledgeSourceType
                          ? KNOWLEDGE_SOURCE_LABELS[book.knowledgeSourceType]
                          : 'Tài liệu tham chiếu'}{' '}
                        · Bản quyền: {book.licenseStatus || 'Chưa phân loại'}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleOpenChunkEditor(book)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-[#17243A] dark:text-[#E5EDF9] font-semibold cursor-pointer"
                      >
                        <Edit3 className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                        Sửa đoạn ({book.chunkCount})
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const next = book.status === 'active' ? 'paused' : 'active';
                          await updateReferenceBookStatus(book.referenceId, { status: next });
                          setBooks((prev) =>
                            prev.map((b) =>
                              b.referenceId === book.referenceId ? { ...b, status: next } : b
                            )
                          );
                        }}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-[#17243A] dark:text-[#E5EDF9] cursor-pointer"
                      >
                        {book.status === 'active' ? (
                          <>
                            <PauseCircle className="w-3.5 h-3.5 text-amber-600" />
                            Đang dùng (Tạm dừng)
                          </>
                        ) : (
                          <>
                            <PlayCircle className="w-3.5 h-3.5 text-emerald-600" />
                            Đang tạm dừng (Kích hoạt)
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          await deleteReferenceBookAndChunks(book.referenceId);
                          setBooks((prev) => prev.filter((b) => b.referenceId !== book.referenceId));
                        }}
                        className="p-2 rounded-lg border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
                        aria-label="Xóa sách tham chiếu"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </GlassSurface>
                ))}
              </div>
            </div>
          )}

          {/* TAB 5: EXAM CENTER MANAGEMENT (2-STEP BLUEPRINT -> EXAM -> REWRITE -> PUBLISH -> PRINT) */}
          {tab === 'exams' && (
            <div className="space-y-6">
              {/* STEP 1: EXAM BLUEPRINT */}
              <GlassSurface className="rounded-3xl p-6 space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="font-display text-lg font-bold text-[#17243A] dark:text-[#E5EDF9]">
                      Bước 1: Lập & Duyệt Ma Trận Đề Kiểm Tra
                    </h2>
                    <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
                      Hỗ trợ Giữa kỳ I/II, Cuối kỳ I/II và Ôn tập tổng hợp với 3 dạng câu hỏi chuẩn (ABCD, Đúng/Sai 4 ý, Trả lời ngắn).
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Tiêu đề đề kiểm tra (tùy chọn)
                    </label>
                    <input
                      type="text"
                      value={examTitle}
                      onChange={(e) => setExamTitle(e.target.value)}
                      placeholder="VD: Kiểm tra Giữa kỳ I Toán 10"
                      className={INPUT_CLASS}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Khối lớp
                    </label>
                    <select
                      value={examGrade}
                      onChange={(e) => setExamGrade(e.target.value as GradeLevel)}
                      className={INPUT_CLASS}
                    >
                      <option value="10">Lớp 10</option>
                      <option value="11">Lớp 11</option>
                      <option value="12">Lớp 12</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Môn học
                    </label>
                    <select
                      value={examSubject}
                      onChange={(e) => setExamSubject(e.target.value as SubjectId)}
                      className={INPUT_CLASS}
                    >
                      {(Object.keys(SUBJECT_LABELS) as SubjectId[]).map((s) => (
                        <option key={s} value={s}>
                          {SUBJECT_LABELS[s]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Kỳ kiểm tra
                    </label>
                    <select
                      value={examType}
                      onChange={(e) => setExamType(e.target.value as ExamType)}
                      className={INPUT_CLASS}
                    >
                      {(Object.keys(EXAM_TYPE_LABELS) as ExamType[]).map((et) => (
                        <option key={et} value={et}>
                          {EXAM_TYPE_LABELS[et]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Bộ sách giáo khoa
                    </label>
                    <select
                      value={examSeries}
                      onChange={(e) => setExamSeries(e.target.value)}
                      className={INPUT_CLASS}
                    >
                      {TEXTBOOK_SERIES_OPTIONS.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Năm học & Học kỳ
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={examYear}
                        onChange={(e) => setExamYear(e.target.value)}
                        className={INPUT_CLASS}
                      />
                      <select
                        value={examSemester}
                        onChange={(e) => setExamSemester(e.target.value as '1' | '2')}
                        className="px-2.5 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs"
                      >
                        <option value="1">HK I</option>
                        <option value="2">HK II</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Thời gian (phút) / Tổng điểm
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        min={15}
                        max={180}
                        value={examDuration}
                        onChange={(e) => setExamDuration(Math.max(15, Number(e.target.value) || 45))}
                        className={INPUT_CLASS}
                      />
                      <input
                        type="number"
                        min={1}
                        max={100}
                        value={examTotalScore}
                        onChange={(e) => setExamTotalScore(Math.max(1, Number(e.target.value) || 10))}
                        className={INPUT_CLASS}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Phạm vi chương (cách nhau dấu phẩy)
                    </label>
                    <input
                      type="text"
                      value={examChaptersInput}
                      onChange={(e) => setExamChaptersInput(e.target.value)}
                      className={INPUT_CLASS}
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <WaterRippleButton
                    type="button"
                    disabled={generatingBlueprint}
                    onClick={handleGenerateBlueprint}
                  >
                    <Sparkles className="w-4 h-4" />
                    {generatingBlueprint ? 'AI đang lập ma trận...' : 'AI Lập Ma Trận Đề'}
                  </WaterRippleButton>
                  {blueprints.length > 0 && (
                    <select
                      value=""
                      onChange={(e) => {
                        const found = blueprints.find((b) => b.blueprintId === e.target.value);
                        if (found) setActiveBlueprint(found);
                      }}
                      className="px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs"
                    >
                      <option value="">-- Mở Ma Trận đã lưu ({blueprints.length}) --</option>
                      {blueprints.map((bp) => (
                        <option key={bp.blueprintId} value={bp.blueprintId}>
                          {bp.title} ({bp.status === 'approved' ? 'Đã duyệt' : 'Nháp'})
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {activeBlueprint && (
                  <div className="document-paper rounded-2xl p-5 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold text-sky-700 dark:text-sky-400">
                          {activeBlueprint.status === 'approved' ? 'Ma trận đã duyệt' : 'Bản nháp Ma trận đề'}
                        </p>
                        <input
                          type="text"
                          value={activeBlueprint.title}
                          onChange={(e) =>
                            setActiveBlueprint({ ...activeBlueprint, title: e.target.value })
                          }
                          className="font-display text-base font-bold bg-transparent border-b border-slate-200 dark:border-slate-700 focus:outline-none mt-0.5"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const newRow: ExamBlueprintRow = {
                            rowId: `row_${Date.now()}`,
                            chapter: activeBlueprint.chapters[0] || 'Chương 1',
                            topic: 'Chủ đề bổ sung',
                            cognitiveLevel: 'thong_hieu',
                            questionType: 'abcd',
                            questionCount: 2,
                            scorePerQuestion: 0.25,
                            learningOutcome: 'Vận dụng kiến thức trọng tâm.',
                          };
                          setActiveBlueprint({
                            ...activeBlueprint,
                            rows: [...activeBlueprint.rows, newRow],
                          });
                        }}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Thêm dòng ma trận
                      </button>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="border-b border-slate-200 dark:border-slate-700 text-slate-500">
                          <tr>
                            <th className="py-2 pr-2">Chương</th>
                            <th className="py-2 pr-2">Chủ đề / Yêu cầu cần đạt</th>
                            <th className="py-2 pr-2">Mức độ</th>
                            <th className="py-2 pr-2">Dạng câu</th>
                            <th className="py-2 pr-2">Số câu</th>
                            <th className="py-2 pr-2">Điểm/câu</th>
                            <th className="py-2">Xóa</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                          {activeBlueprint.rows.map((row, idx) => (
                            <tr key={row.rowId}>
                              <td className="py-2 pr-2 min-w-[120px]">
                                <input
                                  type="text"
                                  value={row.chapter}
                                  onChange={(e) => {
                                    const nextRows = [...activeBlueprint.rows];
                                    nextRows[idx] = { ...row, chapter: e.target.value };
                                    setActiveBlueprint({ ...activeBlueprint, rows: nextRows });
                                  }}
                                  className={INPUT_CLASS}
                                />
                              </td>
                              <td className="py-2 pr-2 min-w-[180px]">
                                <input
                                  type="text"
                                  value={row.topic}
                                  onChange={(e) => {
                                    const nextRows = [...activeBlueprint.rows];
                                    nextRows[idx] = { ...row, topic: e.target.value };
                                    setActiveBlueprint({ ...activeBlueprint, rows: nextRows });
                                  }}
                                  className={INPUT_CLASS}
                                />
                              </td>
                              <td className="py-2 pr-2 min-w-[130px]">
                                <select
                                  value={row.cognitiveLevel}
                                  onChange={(e) => {
                                    const nextRows = [...activeBlueprint.rows];
                                    nextRows[idx] = {
                                      ...row,
                                      cognitiveLevel: e.target.value as CognitiveLevel,
                                    };
                                    setActiveBlueprint({ ...activeBlueprint, rows: nextRows });
                                  }}
                                  className={INPUT_CLASS}
                                >
                                  {(Object.keys(COGNITIVE_LABELS) as CognitiveLevel[]).map((lvl) => (
                                    <option key={lvl} value={lvl}>
                                      {COGNITIVE_LABELS[lvl]}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td className="py-2 pr-2 min-w-[140px]">
                                <select
                                  value={row.questionType}
                                  onChange={(e) => {
                                    const nextRows = [...activeBlueprint.rows];
                                    nextRows[idx] = {
                                      ...row,
                                      questionType: e.target.value as ExamQuestionType,
                                    };
                                    setActiveBlueprint({ ...activeBlueprint, rows: nextRows });
                                  }}
                                  className={INPUT_CLASS}
                                >
                                  {(Object.keys(QUESTION_TYPE_LABELS) as ExamQuestionType[]).map((qt) => (
                                    <option key={qt} value={qt}>
                                      {QUESTION_TYPE_LABELS[qt]}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td className="py-2 pr-2 w-20">
                                <input
                                  type="number"
                                  min={1}
                                  value={row.questionCount}
                                  onChange={(e) => {
                                    const nextRows = [...activeBlueprint.rows];
                                    nextRows[idx] = {
                                      ...row,
                                      questionCount: Math.max(1, Number(e.target.value) || 1),
                                    };
                                    setActiveBlueprint({ ...activeBlueprint, rows: nextRows });
                                  }}
                                  className={INPUT_CLASS}
                                />
                              </td>
                              <td className="py-2 pr-2 w-24">
                                <input
                                  type="number"
                                  step="0.05"
                                  min={0.1}
                                  value={row.scorePerQuestion}
                                  onChange={(e) => {
                                    const nextRows = [...activeBlueprint.rows];
                                    nextRows[idx] = {
                                      ...row,
                                      scorePerQuestion: Math.max(0.05, Number(e.target.value) || 0.25),
                                    };
                                    setActiveBlueprint({ ...activeBlueprint, rows: nextRows });
                                  }}
                                  className={INPUT_CLASS}
                                />
                              </td>
                              <td className="py-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setActiveBlueprint({
                                      ...activeBlueprint,
                                      rows: activeBlueprint.rows.filter((_, rIdx) => rIdx !== idx),
                                    })
                                  }
                                  className="p-1.5 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {blueprintValidation && (
                      <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200 dark:border-slate-700 text-xs">
                        <div>
                          <span className="font-mono font-semibold">
                            Tổng số câu: {blueprintValidation.totalQuestions} · Tổng điểm tính toán:{' '}
                            {blueprintValidation.computedScore}/{activeBlueprint.totalScore}
                          </span>
                          {!blueprintValidation.valid && (
                            <p className="text-rose-600 dark:text-rose-400 mt-0.5">
                              {blueprintValidation.errors.join(' ')}
                            </p>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <WaterRippleButton
                            size="sm"
                            variant="secondary"
                            disabled={savingBlueprint}
                            onClick={handleSaveApprovedBlueprint}
                          >
                            {savingBlueprint ? 'Đang lưu...' : 'Duyệt & Lưu Ma Trận'}
                          </WaterRippleButton>
                          <WaterRippleButton
                            size="sm"
                            disabled={generatingExam || activeBlueprint.rows.length === 0}
                            onClick={handleGenerateExamFromBlueprint}
                          >
                            <Wand2 className="w-3.5 h-3.5" />
                            {generatingExam ? 'Đang sinh đề...' : 'Bước 2: Sinh Đề Thi từ Ma Trận'}
                          </WaterRippleButton>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </GlassSurface>

              {/* STEP 2: EXAM DRAFT REVIEW, SINGLE QUESTION REWRITE & PUBLISH */}
              {activeExamDraft && (
                <GlassSurface className="rounded-3xl p-6 space-y-5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-700 pb-4">
                    <div>
                      <p className="text-xs font-semibold text-sky-700 dark:text-sky-400">
                        Biên tập & Kiểm duyệt Đề thi ({activeExamDraft.questions.length} câu ·{' '}
                        {activeExamDraft.totalScore} điểm)
                      </p>
                      <input
                        type="text"
                        value={activeExamDraft.title}
                        onChange={(e) =>
                          setActiveExamDraft({ ...activeExamDraft, title: e.target.value })
                        }
                        className="font-display text-lg font-bold bg-transparent border-b border-slate-300 dark:border-slate-700 focus:outline-none mt-1"
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs">
                      <label className="inline-flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={activeExamDraft.published}
                          onChange={(e) =>
                            setActiveExamDraft({ ...activeExamDraft, published: e.target.checked })
                          }
                        />
                        <span>Xuất bản cho học sinh</span>
                      </label>
                      <label className="inline-flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={activeExamDraft.allowRetake}
                          onChange={(e) =>
                            setActiveExamDraft({ ...activeExamDraft, allowRetake: e.target.checked })
                          }
                        />
                        <span>Cho phép làm lại</span>
                      </label>
                      <WaterRippleButton size="sm" disabled={savingExam} onClick={handleSaveExamDocument}>
                        <Save className="w-3.5 h-3.5" />
                        {savingExam ? 'Đang lưu...' : 'Lưu Đề Thi'}
                      </WaterRippleButton>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Hướng dẫn chung khi bấm &ldquo;AI viết lại câu này&rdquo;:
                    </label>
                    <input
                      type="text"
                      value={rewriteInstruction}
                      onChange={(e) => setRewriteInstruction(e.target.value)}
                      className={INPUT_CLASS}
                    />
                  </div>

                  <div className="space-y-3 max-h-[560px] overflow-y-auto pr-1">
                    {activeExamDraft.questions.map((q) => (
                      <div key={q.questionId} className="document-paper rounded-2xl p-4 space-y-2 text-xs">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-semibold text-sky-700 dark:text-sky-400">
                            Câu {q.orderIndex} · {QUESTION_TYPE_LABELS[q.questionType]} ·{' '}
                            {COGNITIVE_LABELS[q.cognitiveLevel]} · {q.scoreWeight}đ
                          </span>
                          <div className="flex items-center gap-2">
                            <span
                              className={`font-semibold ${
                                q.validationStatus === 'passed'
                                  ? 'text-emerald-700 dark:text-emerald-400'
                                  : 'text-amber-700 dark:text-amber-400'
                              }`}
                            >
                              {q.validationStatus === 'passed' ? 'Đạt chuẩn' : q.validationStatus}
                            </span>
                            <button
                              type="button"
                              disabled={rewriteQuestionId === q.questionId}
                              onClick={() => handleRewriteExamQuestion(q)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-semibold cursor-pointer"
                            >
                              <Wand2 className="w-3 h-3 text-sky-600 dark:text-sky-400" />
                              {rewriteQuestionId === q.questionId ? 'Đang viết lại...' : 'AI viết lại câu này'}
                            </button>
                          </div>
                        </div>

                        <p className="text-sm font-medium">{q.questionText}</p>
                        {q.questionType === 'abcd' && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-slate-600 dark:text-slate-300">
                            <p>A. {q.optionA}</p>
                            <p>B. {q.optionB}</p>
                            <p>C. {q.optionC}</p>
                            <p>D. {q.optionD}</p>
                          </div>
                        )}
                        {q.questionType === 'true_false' && (
                          <div className="space-y-1 text-slate-600 dark:text-slate-300">
                            {(q.trueFalseStatements || []).map((st) => (
                              <p key={st.label}>
                                {st.label}) {st.text} → <strong>{st.isTrue ? 'Đúng' : 'Sai'}</strong>
                              </p>
                            ))}
                          </div>
                        )}
                        {q.questionType === 'short_answer' && (
                          <p className="font-mono text-emerald-700 dark:text-emerald-400">
                            Đáp án chấp nhận: {(q.shortAnswerAccepted || []).join(' | ')}
                          </p>
                        )}
                        <p className="text-slate-500 dark:text-slate-400">
                          <strong>Giải thích:</strong> {q.explanation} ({q.sourceReference})
                        </p>
                      </div>
                    ))}
                  </div>
                </GlassSurface>
              )}

              {/* SAVED EXAMS LIST */}
              <GlassSurface className="rounded-2xl p-6 space-y-4">
                <h3 className="font-display text-base font-bold text-[#17243A] dark:text-[#E5EDF9]">
                  Danh sách Đề kiểm tra đã tạo ({exams.length})
                </h3>
                {exams.length === 0 ? (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Chưa có đề kiểm tra nào. Hãy lập Ma trận và Sinh đề thi ở trên.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {exams.map((ex) => (
                      <div
                        key={ex.examId}
                        className="document-paper rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                      >
                        <div>
                          <p className="text-sm font-bold">{ex.title}</p>
                          <p className="text-slate-600 dark:text-slate-300 mt-0.5">
                            {SUBJECT_LABELS[ex.subject]} · Lớp {ex.grade} · {EXAM_TYPE_LABELS[ex.examType]} ·{' '}
                            {ex.questions.length} câu · {ex.durationMinutes} phút ·{' '}
                            <strong className={ex.published ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>
                              {ex.published ? 'Đang mở cho HS' : 'Bản nháp'}
                            </strong>
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              const v = generateShuffledExamVariant(ex, '101');
                              setPrintPreview({
                                exam: ex,
                                variantCode: '101',
                                questions: v.questions,
                                includeAnswers: true,
                              });
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 font-semibold cursor-pointer"
                          >
                            <Printer className="w-3.5 h-3.5" />
                            Xuất Mã đề 101/102/103
                          </button>
                          <button
                            type="button"
                            onClick={() => setActiveExamDraft(ex)}
                            className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 font-semibold cursor-pointer"
                          >
                            Chỉnh sửa
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              const next = {
                                ...ex,
                                published: !ex.published,
                                updatedAt: new Date().toISOString(),
                              };
                              await saveExamDocument(next);
                              setExams((prev) =>
                                prev.map((item) => (item.examId === ex.examId ? next : item))
                              );
                            }}
                            className="px-2.5 py-1.5 rounded-lg bg-sky-600 text-white font-semibold cursor-pointer"
                          >
                            {ex.published ? 'Ẩn đề' : 'Xuất bản'}
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              await deleteExamDocument(ex.examId);
                              setExams((prev) => prev.filter((item) => item.examId !== ex.examId));
                            }}
                            className="p-1.5 rounded-lg border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400 cursor-pointer"
                            aria-label="Xóa đề thi"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </GlassSurface>
            </div>
          )}

          {/* TAB 6: FEEDBACK MODERATION, SUPER ADMIN ROLES & USERS */}
          {tab === 'feedback_roles' && (
            <div className="space-y-6">
              {/* FEEDBACK INBOX */}
              <GlassSurface className="rounded-3xl p-6 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <MessageSquareWarning className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                    <h2 className="font-display text-base font-bold text-[#17243A] dark:text-[#E5EDF9]">
                      Hộp thư phản hồi sai sót từ học sinh ({feedbackList.length})
                    </h2>
                  </div>
                  <select
                    value={feedbackFilter}
                    onChange={(e) => setFeedbackFilter(e.target.value as any)}
                    className="px-3 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs"
                  >
                    <option value="all">Tất cả trạng thái</option>
                    <option value="pending">Chờ duyệt</option>
                    <option value="reviewed">Đang xem xét</option>
                    <option value="resolved">Đã xử lý</option>
                  </select>
                </div>

                {feedbackList.length === 0 ? (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Chưa có báo cáo sai sót nào từ học sinh.
                  </p>
                ) : (
                  <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
                    {feedbackList
                      .filter((f) => feedbackFilter === 'all' || f.status === feedbackFilter)
                      .map((fb) => (
                        <div
                          key={fb.feedbackId}
                          className="document-paper rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                        >
                          <div className="space-y-1">
                            <p className="font-semibold">
                              [{fb.targetType}] {fb.category} ·{' '}
                              <span className="font-mono text-slate-500">{fb.ownerEmail || fb.ownerUid}</span>
                            </p>
                            <p className="text-slate-600 dark:text-slate-300">{fb.note}</p>
                            {fb.aiClassification && (
                              <p className="text-sky-700 dark:text-sky-400">
                                AI phân loại: {fb.aiClassification}
                              </p>
                            )}
                          </div>
                          <select
                            value={fb.status}
                            onChange={async (e) => {
                              const nextStatus = e.target.value as FeedbackEntry['status'];
                              await updateFeedbackStatus(fb.feedbackId, nextStatus);
                              setFeedbackList((prev) =>
                                prev.map((item) =>
                                  item.feedbackId === fb.feedbackId ? { ...item, status: nextStatus } : item
                                )
                              );
                            }}
                            className="px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-semibold shrink-0"
                          >
                            <option value="pending">Chờ duyệt</option>
                            <option value="reviewed">Đang xem xét</option>
                            <option value="resolved">Đã xử lý</option>
                          </select>
                        </div>
                      ))}
                  </div>
                )}
              </GlassSurface>

              {/* SUPER ADMIN ROLE MANAGER */}
              <GlassSurface className="rounded-3xl p-6 space-y-4">
                <div>
                  <h2 className="font-display text-base font-bold text-[#17243A] dark:text-[#E5EDF9]">
                    Phân quyền Super Admin (Cấp / Thu hồi trực tiếp)
                  </h2>
                  <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
                    Nhập Email hoặc UID Firebase của giáo viên / quản trị viên để cấp quyền vào Trung tâm điều khiển này.
                  </p>
                </div>

                <form onSubmit={handleGrantRole} className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    required
                    value={roleIdentifier}
                    onChange={(e) => setRoleIdentifier(e.target.value)}
                    placeholder="Email (vd: giaovien@gmail.com) hoặc Firebase UID"
                    className={INPUT_CLASS}
                  />
                  <WaterRippleButton type="submit" size="sm" disabled={updatingRole}>
                    {updatingRole ? 'Đang cấp quyền...' : 'Cấp quyền Super Admin'}
                  </WaterRippleButton>
                </form>

                {protectedEmails.length > 0 && (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Tài khoản chủ sở hữu mặc định (được bảo vệ):{' '}
                    <span className="font-mono">{protectedEmails.join(', ')}</span>
                  </p>
                )}

                <div className="space-y-2">
                  {adminRoles.map((adm) => (
                    <div
                      key={adm.uid}
                      className="document-paper rounded-xl px-4 py-2.5 flex items-center justify-between gap-3 text-xs"
                    >
                      <div>
                        <p className="font-mono font-semibold">{adm.uid}</p>
                        <p className="text-slate-500 dark:text-slate-400">
                          {adm.email ? `${adm.email} · ` : ''}Cấp lúc:{' '}
                          {new Date(adm.grantedAt).toLocaleString('vi-VN')}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRevokeRole(adm.uid)}
                        className="px-3 py-1 rounded-lg border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400 font-semibold hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
                      >
                        Thu hồi
                      </button>
                    </div>
                  ))}
                </div>
              </GlassSurface>

              {/* STUDENT DIRECTORY */}
              <GlassSurface className="rounded-2xl p-6 space-y-4">
                <h2 className="font-display text-base font-bold text-[#17243A] dark:text-[#E5EDF9]">
                  Danh sách tài khoản học sinh ({users.length})
                </h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400">
                      <tr>
                        <th className="py-2 pr-4">Tên hiển thị</th>
                        <th className="py-2 pr-4">Email</th>
                        <th className="py-2 pr-4">Lớp</th>
                        <th className="py-2 pr-4">Đăng nhập gần nhất</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {users.map((u) => (
                        <tr key={u.uid}>
                          <td className="py-2.5 pr-4 font-semibold">{u.displayName}</td>
                          <td className="py-2.5 pr-4 font-mono text-slate-600 dark:text-slate-300">{u.email}</td>
                          <td className="py-2.5 pr-4">Lớp {u.grade}</td>
                          <td className="py-2.5 pr-4 font-mono text-slate-500 dark:text-slate-400">
                            {new Date(u.lastLoginAt).toLocaleString('vi-VN')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </GlassSurface>
            </div>
          )}

          {/* TAB 7: RATE LIMITS & AUDIT LOGS */}
          {tab === 'limits_audit' && (
            <div className="space-y-6">
              <GlassSurface className="rounded-3xl p-6 sm:p-8 space-y-5">
                <h2 className="font-display text-lg font-bold text-[#17243A] dark:text-[#E5EDF9]">
                  Cấu hình giới hạn lưu lượng & Chống lạm dụng
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {(
                    [
                      ['requestsPerMinute', 'Yêu cầu / phút (mỗi học sinh)'],
                      ['requestsPerHour', 'Yêu cầu / giờ (mỗi học sinh)'],
                      ['analysesPerDay', 'Số lần phân tích / ngày'],
                      ['cooldownSeconds', 'Thời gian chờ giữa 2 lần (giây)'],
                      ['maximumConcurrentJobs', 'Số tác vụ chạy song song tối đa'],
                      ['maximumPagesPerAnalysis', 'Số trang tối đa mỗi lần phân tích'],
                      ['maximumFileSizeMb', 'Dung lượng tệp tối đa (MB)'],
                    ] as const
                  ).map(([field, label]) => (
                    <div key={field}>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                        {label}
                      </label>
                      <input
                        type="number"
                        min={1}
                        value={limits[field]}
                        onChange={(e) =>
                          setLimits((prev) => ({
                            ...prev,
                            [field]: Math.max(1, Number(e.target.value) || 1),
                          }))
                        }
                        className={`${INPUT_CLASS} font-mono text-sm`}
                      />
                    </div>
                  ))}
                </div>
                <WaterRippleButton
                  disabled={savingConfig}
                  onClick={() => handlePatchAiConfig({ rateLimitConfig: limits })}
                >
                  Áp dụng giới hạn hệ thống
                </WaterRippleButton>
              </GlassSurface>

              <GlassSurface className="rounded-2xl p-6 space-y-4">
                <h2 className="font-display text-base font-bold text-[#17243A] dark:text-[#E5EDF9]">
                  Nhật ký kiểm toán quản trị ({auditLogs.length})
                </h2>
                <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
                  {auditLogs.map((log) => (
                    <div
                      key={log.logId}
                      className="document-paper rounded-xl p-3.5 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                    >
                      <div>
                        <p className="font-mono font-semibold">
                          {log.action} · {log.resourceType}/{log.resourceId}
                        </p>
                        <p className="text-slate-500 dark:text-slate-400 mt-0.5">
                          Bởi {log.actorEmail || log.actorUid} · Trạng thái: {log.status}
                        </p>
                      </div>
                      <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400 shrink-0">
                        {new Date(log.timestamp).toLocaleString('vi-VN')}
                      </span>
                    </div>
                  ))}
                </div>
              </GlassSurface>
            </div>
          )}
        </>
      )}
    </div>
  );
};
