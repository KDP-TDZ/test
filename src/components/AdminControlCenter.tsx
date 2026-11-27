import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertCircle,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  Copy,
  Cpu,
  Edit3,
  FileText,
  FileUp,
  Globe,
  KeyRound,
  Layers,
  ListChecks,
  Loader2,
  MessageSquareWarning,
  PauseCircle,
  PlayCircle,
  Plus,
  Power,
  Printer,
  RefreshCw,
  Save,
  Server,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Sparkles,
  Trash2,
  UserCheck,
  Wand2,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  distributeExamQuestionScores,
  generateShuffledExamVariant,
  validateExamBlueprint,
} from '../core/quizValidation';
import {
  generateExamBatchFromRawQuestions,
  parseRawExamQuestions,
  type BatchGenerationMode,
  type ParsedRawQuestion,
} from '../core/rawExamParser';
import {
  AI_TASK_LABELS,
  EXAM_TYPE_LABELS,
  SUBJECT_LABELS,
  TEXTBOOK_SERIES_OPTIONS,
  type AiExecutionLog,
  type AiTaskType,
  type ApiUsageDaily,
  type AuditLogEntry,
  type CloudflareKeyStatus,
  type CognitiveLevel,
  type ColdStartReadinessReport,
  type ExamBlueprint,
  type ExamBlueprintRow,
  type ExamDocument,
  type ExamQuestion,
  type ExamQuestionType,
  type ExamType,
  type FeedbackEntry,
  type GradeLevel,
  type KnowledgeSourceType,
  type ProviderKeysStatus,
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
import { compressImageFilesForUpload } from '../services/imageCompression';
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
  saveReferenceBookProgress,
  saveReferenceBookRecord,
  saveReferenceBookWithChunks,
  saveReferenceChunksBatch,
  updateFeedbackStatus,
  updateReferenceBookStatus,
  updateReferenceChunkContent,
} from '../services/firestoreService';
import {
  inspectClientPdfPageCount,
  runSmartClientPdfIngest,
  type SmartPdfIngestProgress,
} from '../services/clientPdfIngest';
import { GlassSurface } from './LiquidGlass/GlassSurface';
import { SlidingTabs } from './LiquidGlass/SlidingTabs';
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
  provider?: 'mistral' | 'groq' | 'cloudflare';
  tier: string;
  strengths: string;
  supportsMultimodal?: boolean;
}

const FALLBACK_MODEL_CATALOG: ModelCatalogItem[] = [
  {
    modelId: 'mistral:mistral-small-latest',
    displayName: 'Mistral AI · Mistral Small Latest (Ưu tiên #1 · Chấm chính Free)',
    provider: 'mistral',
    tier: 'free',
    strengths:
      'Ưu tiên số 1 cho chấm điểm, kiểm định kiến thức, sinh đề & hỗ trợ Vision OCR dự phòng trên Mistral Free Tier.',
    supportsMultimodal: true,
  },
  {
    modelId: 'mistral:ministral-8b-latest',
    displayName: 'Mistral AI · Ministral 8B Fast (Đối soát & Tác vụ nhanh Free)',
    provider: 'mistral',
    tier: 'free',
    strengths:
      'Tốc độ cao, chi phí thấp — tối ưu cho kiểm tra chéo (Verify), phân loại môn học & tạo flashcard.',
    supportsMultimodal: false,
  },
  {
    modelId: 'groq:qwen/qwen3.8-27b',
    displayName: 'Groq · Qwen 3.8 27B Vision (Ưu tiên #1 OCR & Đối soát Free)',
    provider: 'groq',
    tier: 'free',
    strengths:
      'Đa phương thức siêu nhanh (~450 tok/s, miễn phí) — quét ảnh chụp vở/bài làm Bước 1 và chạy nhánh đối soát độc lập.',
    supportsMultimodal: true,
  },
  {
    modelId: 'groq:openai/gpt-oss-120b',
    displayName: 'Groq · GPT-OSS 120B (Dự phòng suy luận siêu nhanh Free)',
    provider: 'groq',
    tier: 'free',
    strengths:
      'Tốc độ ~500 tok/s, miễn phí — tầng dự phòng mạnh cho chấm điểm, tổng hợp SGK & tạo đề trắc nghiệm.',
    supportsMultimodal: false,
  },
  {
    modelId: 'groq:openai/gpt-oss-20b',
    displayName: 'Groq · GPT-OSS 20B Fast (Đối soát chéo ~1.000 tok/s Free)',
    provider: 'groq',
    tier: 'free',
    strengths:
      'Siêu nhanh (~1.000 tok/s), miễn phí — ưu tiên cho bước Đối soát (Verify) chéo nhà cung cấp & tác vụ nhẹ.',
    supportsMultimodal: false,
  },
  {
    modelId: 'cf:@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    displayName: 'Cloudflare · Llama 3.3 70B FP8 Fast (Chấm song song Phần 2 Free)',
    provider: 'cloudflare',
    tier: 'free',
    strengths:
      'Miễn phí (10.000 Neurons/ngày trên Cloudflare Edge) — chạy song song Phần 2 khi văn bản dài & làm tầng dự phòng độc lập.',
    supportsMultimodal: false,
  },
  {
    modelId: 'cf:@cf/qwen/qwen3.8-27b',
    displayName: 'Cloudflare · Qwen 3.8 27B Vision (Quét tinh chỉnh Bước 2 Free)',
    provider: 'cloudflare',
    tier: 'free',
    strengths:
      'Đa phương thức trên Cloudflare Edge — chạy Quét tinh chỉnh (Scan Pass 2) cho tài liệu dài & dự phòng Vision OCR.',
    supportsMultimodal: true,
  },
  {
    modelId: 'cf:@cf/meta/llama-3.1-8b-instruct-fast',
    displayName: 'Cloudflare · Llama 3.1 8B Fast (Đối soát dự phòng tiết kiệm Free)',
    provider: 'cloudflare',
    tier: 'free',
    strengths:
      'Miễn phí, tiêu tốn cực ít Neuron trên Cloudflare Edge — đối soát dự phòng, phân loại môn & flashcard.',
    supportsMultimodal: false,
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
  'w-full px-3.5 py-2 rounded-xl glass-control text-xs';

export const AdminControlCenter: React.FC = () => {
  const { user, isSuperAdmin, refreshSystemStatus } = useAuth();
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
  const [providerKeys, setProviderKeys] = useState<ProviderKeysStatus | null>(null);
  const [coldStartReadiness, setColdStartReadiness] = useState<ColdStartReadinessReport | null>(null);
  const [copiedEnvTemplate, setCopiedEnvTemplate] = useState(false);
  const [showDeployGuide, setShowDeployGuide] = useState(false);
  const [executionLogs, setExecutionLogs] = useState<AiExecutionLog[]>([]);
  const [modelCatalog, setModelCatalog] = useState<ModelCatalogItem[]>(FALLBACK_MODEL_CATALOG);
  const [mistralConfigured, setMistralConfigured] = useState<boolean>(false);
  const [groqConfigured, setGroqConfigured] = useState<boolean>(false);
  const [cloudflareConfigured, setCloudflareConfigured] = useState<boolean>(false);

  const [books, setBooks] = useState<ReferenceBook[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [feedbackList, setFeedbackList] = useState<FeedbackEntry[]>([]);
  const [blueprints, setBlueprints] = useState<ExamBlueprint[]>([]);
  const [exams, setExams] = useState<ExamDocument[]>([]);

  // Overview / AI Switch form
  const [maintenanceMessage, setMaintenanceMessage] = useState('');
  const [disabledReason, setDisabledReason] = useState('');
  const [activeModel, setActiveModel] = useState('mistral:mistral-small-latest');
  const [unifiedFallbackModel, setUnifiedFallbackModel] = useState('groq:openai/gpt-oss-120b');
  const [unifiedEnableFallback, setUnifiedEnableFallback] = useState(true);
  const [adaptiveThresholdInput, setAdaptiveThresholdInput] = useState<number>(1500);
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

  // API Key & Allowed Origins state (Mistral AI)
  const [newKeyLabel, setNewKeyLabel] = useState('Mistral AI Free API Key');
  const [newRawKey, setNewRawKey] = useState('');
  const [savingKey, setSavingKey] = useState(false);
  const [testingKey, setTestingKey] = useState(false);
  const [testResult, setTestResult] = useState<{ status: string; message: string; testedSource: string } | null>(null);

  // Groq Cloud Key state (Admin in-web)
  const [groqKeyLabel, setGroqKeyLabel] = useState('Groq Cloud Free API Key');
  const [groqRawKey, setGroqRawKey] = useState('');
  const [savingGroqKey, setSavingGroqKey] = useState(false);
  const [testingGroqKey, setTestingGroqKey] = useState(false);
  const [groqTestResult, setGroqTestResult] = useState<{
    status: string;
    message: string;
    testedSource: string;
    availableModels?: string[];
  } | null>(null);

  // Cloudflare Workers AI credentials state (Admin in-web)
  const [cfKeyLabel, setCfKeyLabel] = useState('Cloudflare Workers AI Free');
  const [cfAccountIdInput, setCfAccountIdInput] = useState('');
  const [cfApiTokenInput, setCfApiTokenInput] = useState('');
  const [savingCfKey, setSavingCfKey] = useState(false);
  const [testingCfKey, setTestingCfKey] = useState(false);
  const [cfTestResult, setCfTestResult] = useState<{
    status: string;
    message: string;
    testedSource: string;
  } | null>(null);

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
  const [refInputMode, setRefInputMode] = useState<
    'ai_synthesize' | 'pdf' | 'docx' | 'url' | 'text' | 'json'
  >('ai_synthesize');
  const [refUrl, setRefUrl] = useState('');
  const [refFile, setRefFile] = useState<File | null>(null);
  const [refRawContent, setRefRawContent] = useState('');
  const [ingestingRef, setIngestingRef] = useState(false);

  // Smart Client-Side PDF Ingest state
  const [pdfDetectedPages, setPdfDetectedPages] = useState<number | null>(null);
  const [pdfPageRangeInput, setPdfPageRangeInput] = useState('');
  const [pdfProgress, setPdfProgress] = useState<SmartPdfIngestProgress | null>(null);
  const pdfAbortRef = useRef<AbortController | null>(null);

  // Sequential AI Textbook Chapter Synthesizer state
  const [customTocHint, setCustomTocHint] = useState('');
  const [synthesizingOutline, setSynthesizingOutline] = useState(false);
  const [outlineChapters, setOutlineChapters] = useState<
    Array<{
      chapterIndex: number;
      chapterTitle: string;
      lessons: string[];
      estimatedPageStart: number;
      selected: boolean;
      status: 'idle' | 'running' | 'saved' | 'error';
      savedChunks: number;
      errorMsg?: string;
    }>
  >([]);
  const [synthesizingChapters, setSynthesizingChapters] = useState(false);
  const [activeSynthReferenceId, setActiveSynthReferenceId] = useState<string | null>(null);
  const synthAbortRef = useRef<AbortController | null>(null);

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
  const [examCreationMode, setExamCreationMode] = useState<'sample_import' | 'raw_text_batch' | 'blueprint'>('sample_import');
  const [sampleExamFiles, setSampleExamFiles] = useState<File[]>([]);
  const [includeTrueFalseInSample, setIncludeTrueFalseInSample] = useState(false);
  const [importingSampleExam, setImportingSampleExam] = useState(false);
  const [editingExamQuestionId, setEditingExamQuestionId] = useState<string | null>(null);

  // Raw Text Batch Exam Generator State (Admin-only)
  const [rawTextInput, setRawTextInput] = useState('');
  const [rawTextFiles, setRawTextFiles] = useState<
    Array<{ fileName: string; rawText: string; questions: ParsedRawQuestion[] }>
  >([]);
  const [rawBatchMode, setRawBatchMode] = useState<BatchGenerationMode>('split_sequential');
  const [rawBatchExamCount, setRawBatchExamCount] = useState(3);
  const [rawQuestionsPerExam, setRawQuestionsPerExam] = useState(10);
  const [rawShuffleOptions, setRawShuffleOptions] = useState(true);
  const [rawPublishImmediately, setRawPublishImmediately] = useState(false);
  const [rawAllowRetake, setRawAllowRetake] = useState(true);
  const [rawBatchDrafts, setRawBatchDrafts] = useState<ExamDocument[]>([]);
  const [savingRawBatch, setSavingRawBatch] = useState(false);

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
      const loadedPrimary = data.config?.activeModel || 'mistral:mistral-small-latest';
      setActiveModel(loadedPrimary);
      if (typeof data.config?.adaptiveLongTextThresholdChars === 'number') {
        setAdaptiveThresholdInput(data.config.adaptiveLongTextThresholdChars);
      } else if (typeof data.config?.rateLimitConfig?.adaptiveLongTextThresholdChars === 'number') {
        setAdaptiveThresholdInput(data.config.rateLimitConfig.adaptiveLongTextThresholdChars);
      } else {
        setAdaptiveThresholdInput(1500);
      }
      if (data.config?.rateLimitConfig) setLimits(data.config.rateLimitConfig);
      if (data.config?.taskModels) {
        setTaskModelsDraft(data.config.taskModels);
        const ka = data.config.taskModels.knowledge_analysis;
        if (ka?.defaultModel) setActiveModel(ka.defaultModel);
        if (ka?.fallbackModel) setUnifiedFallbackModel(ka.fallbackModel);
        if (typeof ka?.enableFallback === 'boolean') setUnifiedEnableFallback(ka.enableFallback);
      }
      setUsageStats(data.usageStats);
      setAuditLogs(data.auditLogs || []);
      setSingleKeyStatus(data.singleKeyStatus || data.providerKeys?.mistral || null);
      setProviderKeys(data.providerKeys || null);
      setColdStartReadiness(data.coldStartReadiness || null);
      setMistralConfigured(Boolean(data.mistralConfigured || data.providerKeys?.mistral?.configured));
      setGroqConfigured(Boolean(data.groqConfigured || data.providerKeys?.groq?.configured));
      setCloudflareConfigured(Boolean(data.cloudflareConfigured || data.providerKeys?.cloudflare?.configured));
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

  const rawParsedPreview = useMemo(() => parseRawExamQuestions(rawTextInput), [rawTextInput]);

  if (!isSuperAdmin) {
    return (
      <GlassSurface className="rounded-3xl p-8 text-center">
        <Shield className="w-10 h-10 text-rose-600 mx-auto mb-3" />
        <h1 className="font-display text-xl font-bold text-[#16243E] dark:text-[#E6EFFC]">
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
      if (data.coldStartReadiness) setColdStartReadiness(data.coldStartReadiness);
      if (data.config?.activeModel) setActiveModel(data.config.activeModel);
      if (typeof data.config?.adaptiveLongTextThresholdChars === 'number') {
        setAdaptiveThresholdInput(data.config.adaptiveLongTextThresholdChars);
      }
      if (data.config?.taskModels) setTaskModelsDraft(data.config.taskModels);
      await refreshSystemStatus();
      setNotice(successMsg || `Đã cập nhật cấu hình hệ thống (Phiên bản v${data.config?.configVersion ?? 1}).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi cập nhật cấu hình.');
    } finally {
      setSavingConfig(false);
    }
  };

  const handleApplyUnifiedAi = async (
    primaryModelId: string,
    fallbackModelId: string,
    enableFb: boolean
  ) => {
    const nextTaskModels = {} as Record<AiTaskType, TaskModelConfig>;
    for (const taskKey of Object.keys(AI_TASK_LABELS) as AiTaskType[]) {
      nextTaskModels[taskKey] = {
        defaultModel: primaryModelId,
        fallbackModel: fallbackModelId,
        enableFallback: enableFb,
        oneTimeOverrideModel: null,
        promptVersion: 'v4.2_3provider',
      };
    }
    setActiveModel(primaryModelId);
    setUnifiedFallbackModel(fallbackModelId);
    setUnifiedEnableFallback(enableFb);
    setTaskModelsDraft(nextTaskModels);
    await handlePatchAiConfig(
      { activeModel: primaryModelId, taskModels: nextTaskModels },
      `Đã gộp toàn bộ 11 tác vụ AI sang 1 model chính: "${primaryModelId}"${
        enableFb ? ` (dự phòng: ${fallbackModelId})` : ''
      }.`
    );
  };

  const handleSaveAdaptiveThreshold = async () => {
    const clamped = Math.max(300, Math.min(20000, Math.round(Number(adaptiveThresholdInput) || 1500)));
    setAdaptiveThresholdInput(clamped);
    await handlePatchAiConfig(
      { adaptiveLongTextThresholdChars: clamped },
      `Đã lưu ngưỡng phân loại văn bản ngắn/dài: ${clamped.toLocaleString('vi-VN')} ký tự.`
    );
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
      const res = await authorizedFetch('/api/admin/provider-keys/mistral', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: newKeyLabel, apiKey: newRawKey }),
      });
      const data = await parseApiResponse<any>(res, 'Không thể lưu Mistral API key.');
      if (data.providerKeys) setProviderKeys(data.providerKeys);
      const mistralStatus = data.mistralStatus || data.singleKeyStatus || data.providerKeys?.mistral;
      if (mistralStatus) setSingleKeyStatus(mistralStatus);
      setMistralConfigured(Boolean(data.mistralConfigured ?? mistralStatus?.configured));
      if (data.coldStartReadiness) setColdStartReadiness(data.coldStartReadiness);
      setNewRawKey('');
      setTestResult(null);
      setNotice(
        `Đã lưu & kích hoạt ngay Mistral AI API Key (${mistralStatus?.maskedKey || 'đã mã hóa'}). Để chạy 24/7 khi máy chủ tự ngủ/reset lúc Admin ngoại tuyến, hãy đặt thêm MISTRAL_API_KEY trong biến môi trường Vercel/Render.`
      );
      await loadAllAdminData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi lưu Mistral API key.');
    } finally {
      setSavingKey(false);
    }
  };

  const handleCopyEnvTemplate = async () => {
    const template = coldStartReadiness?.envTemplate;
    if (!template) return;
    try {
      await navigator.clipboard.writeText(template);
      setCopiedEnvTemplate(true);
      window.setTimeout(() => setCopiedEnvTemplate(false), 2200);
    } catch {
      setShowDeployGuide(true);
      setNotice('Không thể tự động sao chép vào clipboard. Hãy sao chép trực tiếp từ khung mẫu bên dưới.');
    }
  };

  const handleTestKey = async (rawKeyOverride?: string) => {
    setTestingKey(true);
    setError(null);
    try {
      const res = await authorizedFetch('/api/admin/provider-keys/mistral/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rawKeyOverride ? { apiKey: rawKeyOverride } : {}),
      });
      const data = await parseApiResponse<any>(res, 'Không thể kiểm tra Mistral API key.');
      setTestResult(data);
      if (data.providerKeys) setProviderKeys(data.providerKeys);
      const mistralStatus = data.keyStatus || data.mistralStatus || data.providerKeys?.mistral;
      if (mistralStatus) setSingleKeyStatus(mistralStatus);
      if (rawKeyOverride && data.status === 'Connected') {
        setNewRawKey('');
        setNotice(data.message || 'Đã thử nghiệm thành công và tự động kích hoạt Mistral AI Key.');
      }
      await loadAllAdminData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi kiểm tra Mistral API key.');
    } finally {
      setTestingKey(false);
    }
  };

  const handleClearAdminKey = async () => {
    setError(null);
    setNotice(null);
    try {
      const res = await authorizedFetch('/api/admin/provider-keys/mistral', { method: 'DELETE' });
      const data = await parseApiResponse<any>(res, 'Không thể xóa Mistral API key quản trị.');
      if (data.providerKeys) setProviderKeys(data.providerKeys);
      setSingleKeyStatus(data.mistralStatus || data.singleKeyStatus || null);
      setTestResult(null);
      setNotice('Đã gỡ Mistral AI key cấu hình trong Admin UI (hệ thống quay về biến MISTRAL_API_KEY của máy chủ nếu có).');
      await loadAllAdminData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi xóa Mistral API key.');
    }
  };

  const handleSaveGroqKey = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingGroqKey(true);
    setError(null);
    setNotice(null);
    try {
      const res = await authorizedFetch('/api/admin/provider-keys/groq', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: groqKeyLabel, apiKey: groqRawKey }),
      });
      const data = await parseApiResponse<any>(res, 'Không thể lưu Groq API Key.');
      if (data.providerKeys) setProviderKeys(data.providerKeys);
      setGroqConfigured(Boolean(data.groqConfigured ?? data.groqStatus?.configured));
      setGroqRawKey('');
      setGroqTestResult(null);
      setNotice(
        `Đã lưu & kích hoạt ngay Groq API Key (${data.groqStatus?.maskedKey || ''}). Để web chạy 24/7 khi Vercel/Render reset lúc Admin ngoại tuyến, hãy đặt thêm GROQ_API_KEY trong biến môi trường máy chủ.`
      );
      await loadAllAdminData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi lưu Groq API Key.');
    } finally {
      setSavingGroqKey(false);
    }
  };

  const handleTestGroqKey = async (rawKeyOverride?: string) => {
    setTestingGroqKey(true);
    setError(null);
    try {
      const res = await authorizedFetch('/api/admin/provider-keys/groq/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rawKeyOverride ? { apiKey: rawKeyOverride } : {}),
      });
      const data = await parseApiResponse<any>(res, 'Không thể kiểm tra Groq API Key.');
      setGroqTestResult(data);
      if (data.keyStatus) {
        setProviderKeys((prev) =>
          prev
            ? { ...prev, groq: data.keyStatus }
            : {
                mistral: {
                  configured: false,
                  source: 'none',
                  maskedKey: '',
                  label: '',
                  hasEnvFallbackKey: false,
                  lastTestStatus: 'Untested',
                },
                groq: data.keyStatus,
                cloudflare: {
                  configured: false,
                  source: 'none',
                  maskedAccountId: '',
                  maskedKey: '',
                  label: '',
                  hasEnvFallbackKey: false,
                  lastTestStatus: 'Untested',
                } as CloudflareKeyStatus,
              }
        );
      }
      if (rawKeyOverride && data.status === 'Connected') {
        setGroqRawKey('');
        setGroqConfigured(true);
        setNotice(data.message || 'Đã thử nghiệm thành công và tự động kích hoạt Groq API Key cho Kiểm định.');
      }
      await loadAllAdminData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi kiểm tra Groq API Key.');
    } finally {
      setTestingGroqKey(false);
    }
  };

  const handleClearGroqKey = async () => {
    setError(null);
    setNotice(null);
    try {
      const res = await authorizedFetch('/api/admin/provider-keys/groq', { method: 'DELETE' });
      const data = await parseApiResponse<any>(res, 'Không thể gỡ Groq API Key quản trị.');
      if (data.providerKeys) setProviderKeys(data.providerKeys);
      setGroqConfigured(Boolean(data.groqConfigured));
      setGroqTestResult(null);
      setNotice('Đã gỡ Groq API Key trong Admin UI (quay về biến GROQ_API_KEY của máy chủ nếu có).');
      await loadAllAdminData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi gỡ Groq API Key.');
    }
  };

  const handleSaveCloudflareKey = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingCfKey(true);
    setError(null);
    setNotice(null);
    try {
      const res = await authorizedFetch('/api/admin/provider-keys/cloudflare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: cfKeyLabel,
          accountId: cfAccountIdInput,
          apiToken: cfApiTokenInput,
        }),
      });
      const data = await parseApiResponse<any>(res, 'Không thể lưu thông tin Cloudflare Workers AI.');
      if (data.providerKeys) setProviderKeys(data.providerKeys);
      setCloudflareConfigured(Boolean(data.cloudflareConfigured ?? data.cloudflareStatus?.configured));
      setCfAccountIdInput('');
      setCfApiTokenInput('');
      setCfTestResult(null);
      setNotice(
        'Đã lưu & kích hoạt ngay Cloudflare Workers AI. Để chạy 24/7 khi Vercel/Render reset lúc Admin ngoại tuyến, hãy đặt thêm CLOUDFLARE_ACCOUNT_ID và CLOUDFLARE_API_TOKEN trong biến môi trường máy chủ.'
      );
      await loadAllAdminData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi lưu thông tin Cloudflare.');
    } finally {
      setSavingCfKey(false);
    }
  };

  const handleTestCloudflareKey = async (accountIdOverride?: string, apiTokenOverride?: string) => {
    setTestingCfKey(true);
    setError(null);
    try {
      const res = await authorizedFetch('/api/admin/provider-keys/cloudflare/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          accountIdOverride || apiTokenOverride
            ? { accountId: accountIdOverride, apiToken: apiTokenOverride }
            : {}
        ),
      });
      const data = await parseApiResponse<any>(res, 'Không thể kiểm tra Cloudflare Workers AI.');
      setCfTestResult(data);
      if (data.keyStatus) {
        setProviderKeys((prev) =>
          prev
            ? { ...prev, cloudflare: data.keyStatus }
            : {
                mistral: {
                  configured: false,
                  source: 'none',
                  maskedKey: '',
                  label: '',
                  hasEnvFallbackKey: false,
                  lastTestStatus: 'Untested',
                },
                groq: {
                  configured: false,
                  source: 'none',
                  maskedKey: '',
                  label: '',
                  hasEnvFallbackKey: false,
                  lastTestStatus: 'Untested',
                },
                cloudflare: data.keyStatus,
              }
        );
      }
      if ((accountIdOverride || apiTokenOverride) && data.status === 'Connected') {
        setCfAccountIdInput('');
        setCfApiTokenInput('');
        setCloudflareConfigured(true);
        setNotice(data.message || 'Đã thử nghiệm thành công và tự động kích hoạt Cloudflare Workers AI cho Kiểm định.');
      }
      await loadAllAdminData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi kiểm tra Cloudflare Workers AI.');
    } finally {
      setTestingCfKey(false);
    }
  };

  const handleClearCloudflareKey = async () => {
    setError(null);
    setNotice(null);
    try {
      const res = await authorizedFetch('/api/admin/provider-keys/cloudflare', { method: 'DELETE' });
      const data = await parseApiResponse<any>(res, 'Không thể gỡ thông tin Cloudflare quản trị.');
      if (data.providerKeys) setProviderKeys(data.providerKeys);
      setCloudflareConfigured(Boolean(data.cloudflareConfigured));
      setCfTestResult(null);
      setNotice('Đã gỡ thông tin Cloudflare trong Admin UI (quay về biến môi trường máy chủ nếu có).');
      await loadAllAdminData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi gỡ thông tin Cloudflare.');
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

  const handleSelectPdfFile = async (file: File | null) => {
    setRefFile(file);
    setPdfDetectedPages(null);
    setPdfPageRangeInput('');
    if (!file) return;
    if (!refTitle.trim()) {
      setRefTitle(file.name.replace(/\.pdf$/i, ''));
    }
    try {
      const count = await inspectClientPdfPageCount(file);
      setPdfDetectedPages(count);
      setPdfPageRangeInput(`1-${count}`);
    } catch {
      setPdfDetectedPages(null);
    }
  };

  const handleGenerateSgkOutline = async () => {
    setError(null);
    setNotice(null);
    setSynthesizingOutline(true);
    try {
      const res = await authorizedFetch('/api/admin/references/synthesize-outline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grade: refGrade,
          subject: refSubject,
          textbookSeries: refSeries,
          title: refTitle.trim() || undefined,
          customTocHint: customTocHint.trim() || undefined,
        }),
      });
      const data = await parseApiResponse<{
        bookTitle: string;
        chapters: Array<{
          chapterIndex: number;
          chapterTitle: string;
          lessons: string[];
          estimatedPageStart: number;
        }>;
      }>(res, 'Không thể tạo mục lục chương chuẩn.');

      if (data.bookTitle && !refTitle.trim()) {
        setRefTitle(data.bookTitle);
      }
      setActiveSynthReferenceId(null);
      setOutlineChapters(
        (data.chapters || []).map((ch, idx) => ({
          chapterIndex: ch.chapterIndex || idx + 1,
          chapterTitle: ch.chapterTitle,
          lessons: Array.isArray(ch.lessons) ? ch.lessons : [],
          estimatedPageStart: ch.estimatedPageStart || 6 + idx * 20,
          selected: true,
          status: 'idle',
          savedChunks: 0,
        }))
      );
      setNotice(
        `Đã tạo mục lục chuẩn gồm ${(data.chapters || []).length} chương cho ${
          data.bookTitle || SUBJECT_LABELS[refSubject]
        }. Hãy kiểm tra và bấm "2. Tổng hợp & Lưu tuần tự từng Chương".`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi tạo mục lục SGK.');
    } finally {
      setSynthesizingOutline(false);
    }
  };

  const handleRunSequentialChapterSynthesis = async (retrySingleChapterIndex?: number) => {
    const targetChapters =
      typeof retrySingleChapterIndex === 'number'
        ? outlineChapters.filter((ch) => ch.chapterIndex === retrySingleChapterIndex)
        : outlineChapters.filter((ch) => ch.selected && ch.status !== 'saved');

    if (targetChapters.length === 0) {
      setError('Vui lòng chọn ít nhất 1 chương chưa lưu để tổng hợp.');
      return;
    }

    setError(null);
    setNotice(null);
    setSynthesizingChapters(true);
    const abortCtrl = new AbortController();
    synthAbortRef.current = abortCtrl;

    const referenceId =
      activeSynthReferenceId || `ref_${refSubject}_${refGrade}_${Date.now()}`;
    const bookTitle =
      refTitle.trim() ||
      `SGK ${SUBJECT_LABELS[refSubject]} ${refGrade} - ${refSeries}`;

    try {
      if (!activeSynthReferenceId) {
        const now = new Date().toISOString();
        const initialBook: ReferenceBook = {
          referenceId,
          title: bookTitle,
          grade: refGrade,
          subject: refSubject,
          textbookSeries: refSeries.trim(),
          publisher: refPublisher.trim(),
          editionYear: refYear.trim(),
          description:
            refDesc.trim() ||
            `Tổng hợp chuẩn chương trình GDPT 2018 (${outlineChapters.filter((c) => c.selected).length} chương)`,
          sourceType: 'text',
          knowledgeSourceType: refKnowledgeSourceType,
          licenseStatus: refLicenseStatus,
          chapters: [],
          chunkCount: 0,
          status: 'active',
          indexStatus: 'processing',
          createdAt: now,
          updatedAt: now,
        };
        await saveReferenceBookRecord(initialBook);
        setActiveSynthReferenceId(referenceId);
        setBooks((prev) => [initialBook, ...prev.filter((b) => b.referenceId !== referenceId)]);
      }

      let runningTotalChunks = outlineChapters.reduce(
        (sum, ch) => sum + (ch.status === 'saved' ? ch.savedChunks : 0),
        0
      );
      const completedChapterTitles = new Set<string>(
        outlineChapters.filter((ch) => ch.status === 'saved').map((ch) => ch.chapterTitle)
      );

      for (const ch of targetChapters) {
        if (abortCtrl.signal.aborted) break;

        setOutlineChapters((prev) =>
          prev.map((item) =>
            item.chapterIndex === ch.chapterIndex
              ? { ...item, status: 'running', errorMsg: undefined }
              : item
          )
        );

        try {
          const res = await authorizedFetch('/api/admin/references/synthesize-chapter', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              referenceId,
              grade: refGrade,
              subject: refSubject,
              textbookSeries: refSeries,
              chapterIndex: ch.chapterIndex,
              chapterTitle: ch.chapterTitle,
              lessons: ch.lessons,
              estimatedPageStart: ch.estimatedPageStart,
            }),
            signal: abortCtrl.signal,
          });
          const data = await parseApiResponse<{ chunks: ReferenceChunk[] }>(
            res,
            `Không thể tổng hợp ${ch.chapterTitle}.`
          );
          const chunks = data.chunks || [];

          await saveReferenceChunksBatch(chunks);
          runningTotalChunks += chunks.length;
          completedChapterTitles.add(ch.chapterTitle);

          const updatedChaptersArr = Array.from(completedChapterTitles);
          await saveReferenceBookProgress(referenceId, {
            title: bookTitle,
            chapters: updatedChaptersArr,
            chunkCount: runningTotalChunks,
            indexStatus: 'processing',
          });

          setBooks((prev) =>
            prev.map((b) =>
              b.referenceId === referenceId
                ? {
                    ...b,
                    title: bookTitle,
                    chapters: updatedChaptersArr,
                    chunkCount: runningTotalChunks,
                    updatedAt: new Date().toISOString(),
                  }
                : b
            )
          );

          setOutlineChapters((prev) =>
            prev.map((item) =>
              item.chapterIndex === ch.chapterIndex
                ? { ...item, status: 'saved', savedChunks: chunks.length, errorMsg: undefined }
                : item
            )
          );
        } catch (chErr) {
          if (abortCtrl.signal.aborted) {
            setOutlineChapters((prev) =>
              prev.map((item) =>
                item.chapterIndex === ch.chapterIndex && item.status === 'running'
                  ? { ...item, status: 'idle' }
                  : item
              )
            );
            break;
          }
          const errMsg = chErr instanceof Error ? chErr.message : 'Lỗi tổng hợp chương.';
          setOutlineChapters((prev) =>
            prev.map((item) =>
              item.chapterIndex === ch.chapterIndex
                ? { ...item, status: 'error', errorMsg: errMsg }
                : item
            )
          );
        }
      }

      const finalChaptersArr = Array.from(completedChapterTitles);
      const finalIndexStatus: ReferenceBook['indexStatus'] =
        runningTotalChunks > 0 ? 'indexed' : 'failed';

      await saveReferenceBookProgress(referenceId, {
        title: bookTitle,
        chapters: finalChaptersArr,
        chunkCount: runningTotalChunks,
        indexStatus: finalIndexStatus,
      });

      setBooks((prev) =>
        prev.map((b) =>
          b.referenceId === referenceId
            ? {
                ...b,
                title: bookTitle,
                chapters: finalChaptersArr,
                chunkCount: runningTotalChunks,
                indexStatus: finalIndexStatus,
                updatedAt: new Date().toISOString(),
              }
            : b
        )
      );

      if (runningTotalChunks > 0) {
        setNotice(
          abortCtrl.signal.aborted
            ? `Đã tạm dừng và lưu an toàn ${finalChaptersArr.length} chương (${runningTotalChunks} đoạn tri thức) vào kho chuẩn.`
            : `Hoàn tất tổng hợp & lưu "${bookTitle}" — ${finalChaptersArr.length} chương (${runningTotalChunks} đoạn tri thức chuẩn SGK).`
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi tổng hợp SGK theo chương.');
    } finally {
      synthAbortRef.current = null;
      setSynthesizingChapters(false);
    }
  };

  const handleIngestReference = async (e: React.FormEvent) => {
    e.preventDefault();
    if (refInputMode === 'ai_synthesize') {
      await handleGenerateSgkOutline();
      return;
    }

    setError(null);
    setNotice(null);
    setIngestingRef(true);

    const referenceId = `ref_${refSubject}_${refGrade}_${Date.now()}`;
    try {
      if (refInputMode === 'pdf') {
        if (!refFile) throw new Error('Vui lòng chọn tệp PDF sách giáo khoa.');
        const abortCtrl = new AbortController();
        pdfAbortRef.current = abortCtrl;
        setPdfProgress(null);

        const smartRes = await runSmartClientPdfIngest({
          file: refFile,
          referenceId,
          title: refTitle.trim() || refFile.name.replace(/\.pdf$/i, ''),
          grade: refGrade,
          subject: refSubject,
          textbookSeries: refSeries,
          publisher: refPublisher,
          editionYear: refYear,
          description: refDesc,
          knowledgeSourceType: refKnowledgeSourceType,
          licenseStatus: refLicenseStatus,
          pageRangeInput: pdfPageRangeInput,
          signal: abortCtrl.signal,
          onProgress: (prog) => setPdfProgress(prog),
        });

        setBooks((prev) => [
          smartRes.book,
          ...prev.filter((b) => b.referenceId !== smartRes.book.referenceId),
        ]);
        setRefTitle('');
        setRefDesc('');
        setRefFile(null);
        setPdfDetectedPages(null);
        setPdfPageRangeInput('');
        setNotice(
          `${smartRes.stoppedEarly ? 'Đã dừng & lưu phần đã đọc' : 'Đã đọc PDF thông minh & lưu'} “${
            smartRes.book.title
          }” — ${smartRes.totalChunksSaved} đoạn tri thức (${smartRes.directTextPages} trang văn bản trực tiếp, ${
            smartRes.ocrPages
          } trang scan OCR AI).`
        );
        return;
      }

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
      } else {
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
      pdfAbortRef.current = null;
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
    if (activeExamDraft.questions.length === 0) {
      setError('Đề thi phải có ít nhất 1 câu hỏi trước khi lưu.');
      return;
    }
    setSavingExam(true);
    setError(null);
    try {
      const updated: ExamDocument = {
        ...activeExamDraft,
        questions: activeExamDraft.questions.slice(0, 60).map((q, idx) => ({
          ...q,
          orderIndex: idx + 1,
        })),
        updatedAt: new Date().toISOString(),
      };
      await saveExamDocument(updated);
      setActiveExamDraft(updated);
      setEditingExamQuestionId(null);
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

  const handleImportSampleExam = async () => {
    if (sampleExamFiles.length === 0) {
      setError('Vui lòng chọn tệp đề mẫu (PDF, DOCX hoặc ảnh chụp trang đề).');
      return;
    }
    setImportingSampleExam(true);
    setError(null);
    setNotice(null);
    try {
      const prepared = await compressImageFilesForUpload(sampleExamFiles);
      const formData = new FormData();
      prepared.forEach((f) => formData.append('files', f));
      if (examTitle.trim()) formData.append('title', examTitle.trim());
      formData.append('grade', examGrade);
      formData.append('subject', examSubject);
      formData.append('textbookSeries', examSeries);
      formData.append('examType', examType);
      formData.append('academicYear', examYear);
      formData.append('semester', examSemester);
      formData.append('durationMinutes', String(examDuration));
      formData.append('totalScore', String(examTotalScore));
      formData.append('includeTrueFalse', includeTrueFalseInSample ? 'true' : 'false');

      const res = await authorizedFetch('/api/admin/exams/import-sample', {
        method: 'POST',
        body: formData,
      });
      const data = await parseApiResponse<{
        exam: ExamDocument;
        summary: {
          totalExtracted: number;
          abcdCount: number;
          shortAnswerCount: number;
          trueFalseCount: number;
          inferredAnswersCount: number;
        };
      }>(res, 'Không thể trích xuất câu hỏi từ file đề mẫu.');

      setActiveExamDraft(data.exam);
      setEditingExamQuestionId(null);
      const s = data.summary;
      const inferredNote =
        s.inferredAnswersCount > 0
          ? ` Có ${s.inferredAnswersCount} câu file gốc không kèm đáp án nên AI đã tự giải — vui lòng kiểm tra lại.`
          : '';
      setNotice(
        `Đã sao chép nguyên văn ${s.totalExtracted} câu hỏi (${s.abcdCount} trắc nghiệm ABCD, ${s.shortAnswerCount} trả lời ngắn${s.trueFalseCount > 0 ? `, ${s.trueFalseCount} Đúng/Sai` : ''}).${inferredNote} Kiểm tra lại rồi nhấn "Lưu Đề Thi".`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi trích xuất đề mẫu.');
    } finally {
      setImportingSampleExam(false);
    }
  };

  const handleUpdateDraftQuestion = (questionId: string, patch: Partial<ExamQuestion>) => {
    setActiveExamDraft((prev) =>
      prev
        ? {
            ...prev,
            questions: prev.questions.map((item) =>
              item.questionId === questionId ? { ...item, ...patch } : item
            ),
            updatedAt: new Date().toISOString(),
          }
        : prev
    );
  };

  const handleDeleteDraftQuestion = (questionId: string) => {
    setActiveExamDraft((prev) => {
      if (!prev) return prev;
      const next = prev.questions
        .filter((q) => q.questionId !== questionId)
        .map((q, idx) => ({ ...q, orderIndex: idx + 1 }));
      return { ...prev, questions: next, updatedAt: new Date().toISOString() };
    });
    if (editingExamQuestionId === questionId) {
      setEditingExamQuestionId(null);
    }
  };

  const handleAddManualDraftQuestion = (questionType: 'abcd' | 'short_answer') => {
    if (!activeExamDraft) return;
    if (activeExamDraft.questions.length >= 60) {
      setError('Mỗi đề thi hỗ trợ tối đa 60 câu hỏi.');
      return;
    }
    const newId = `eq_manual_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const nextIdx = activeExamDraft.questions.length + 1;
    const newQuestion: ExamQuestion = {
      questionId: newId,
      orderIndex: nextIdx,
      chapterId: 'Bổ sung thủ công',
      conceptId: 'Theo đề mẫu',
      learningOutcome: 'Theo cấu trúc đề',
      cognitiveLevel: 'thong_hieu',
      questionType,
      scoreWeight: 0.25,
      questionText: '',
      ...(questionType === 'abcd'
        ? {
            optionA: '',
            optionB: '',
            optionC: '',
            optionD: '',
            correctAnswer: 'A' as const,
          }
        : {
            shortAnswerAccepted: [''],
          }),
      explanation: 'Admin bổ sung thủ công.',
      sourceReference: 'Admin biên soạn',
      sourceType: 'teacher_material',
      validationStatus: 'passed',
    };
    setActiveExamDraft({
      ...activeExamDraft,
      questions: [...activeExamDraft.questions, newQuestion],
      updatedAt: new Date().toISOString(),
    });
    setEditingExamQuestionId(newId);
  };

  const handleRedistributeDraftScores = () => {
    if (!activeExamDraft) return;
    setActiveExamDraft({
      ...activeExamDraft,
      questions: distributeExamQuestionScores(activeExamDraft.questions, activeExamDraft.totalScore),
      updatedAt: new Date().toISOString(),
    });
    setNotice(`Đã chia đều tổng ${activeExamDraft.totalScore} điểm cho ${activeExamDraft.questions.length} câu hỏi.`);
  };

  const handleRawTextFilesSelected = async (files: File[]) => {
    const validFiles = files.filter((f) => /\.(txt|md|csv|tsv|log)$/i.test(f.name) || f.type.startsWith('text/'));
    if (validFiles.length === 0) {
      setError('Vui lòng chọn tệp văn bản thô (.txt, .md, .csv).');
      return;
    }
    setError(null);
    const loaded = await Promise.all(
      validFiles.map(async (f) => {
        const text = await f.text();
        const parsed = parseRawExamQuestions(text);
        return {
          fileName: f.name,
          rawText: text,
          questions: parsed.questions,
        };
      })
    );
    setRawTextFiles(loaded);
    const combined = loaded.map((item) => item.rawText.trim()).filter(Boolean).join('\n\n');
    setRawTextInput(combined);
    if (loaded.length > 1) {
      setRawBatchMode('per_file');
    }
    const totalCount = loaded.reduce((s, item) => s + item.questions.length, 0);
    setNotice(`Đã đọc ${loaded.length} tệp văn bản thô và nhận diện ${totalCount} câu hỏi.`);
  };

  const handleInsertRawSample = () => {
    const sample = [
      'Câu 1:Liên kết hydrogen chỉ hình thành mạnh nhất giữa nguyên tử H với các nguyên tử có độ âm điện lớn nào sau đây?:F, O, N:C, Si, P:Na, K, Ca:He, Ne, Ar:A:Hợp chất chứa F, O, N phân cực liên kết với H đủ mạnh để tạo liên kết hydrogen.',
      'Câu 2:Thủ đô của nước Việt Nam là thành phố nào?:Thành phố Hồ Chí Minh:*Hà Nội:Đà Nẵng:Hải Phòng:Đáp án là Hà Nội.',
      'Giá trị của biểu thức 2x + 5 tại x = 3 bằng bao nhiêu?:9:10:11:12:C',
      '[ĐS] Xét các nhận định sau về cấu tạo nguyên tử và bảng tuần hoàn:|a) Hạt nhân nguyên tử chứa proton và neutron (trừ H-1).|b) Nguyên tử trung hòa điện có số proton bằng số electron.|c) Các nguyên tố cùng chu kỳ có cùng số electron lớp ngoài cùng.|d) Độ âm điện nhóm A thường tăng từ trái sang phải trong cùng chu kỳ.:Đ-Đ-S-Đ:Ý c sai vì cùng chu kỳ có cùng số lớp electron.',
      '[ĐS] Cho hàm số y = x^2 - 4x + 3.|*a) Đồ thị là parabol có bề lõm hướng lên trên.|*b) Trục đối xứng là đường thẳng x = 2.|c) Giá trị nhỏ nhất của hàm số bằng 1.|*d) Phương trình x^2 - 4x + 3 = 0 có hai nghiệm x = 1 và x = 3.',
      '[TLN] Kết quả của phép tính 25 x 4 + 12 bằng bao nhiêu?:112',
      '[TLN] Hình chữ nhật dài 8,5 cm, rộng 4 cm có diện tích bao nhiêu cm²?:34 | 34,0 | 34 cm2',
    ].join('\n');
    setRawTextFiles([]);
    setRawTextInput(sample);
    setRawQuestionsPerExam(4);
    setError(null);
    setNotice('Đã chèn dữ liệu mẫu đủ 3 dạng (ABCD rút gọn, Đúng/Sai 4 ý, Trả lời ngắn). Bạn có thể chỉnh sửa hoặc tạo đề ngay.');
  };

  const handleGenerateRawBatch = () => {
    setError(null);
    setNotice(null);
    const pool = rawParsedPreview.questions;
    if (pool.length === 0) {
      setError('Chưa nhận diện được câu hỏi hợp lệ nào. Hãy kiểm tra lại định dạng chữ thô hoặc bấm "Chèn mẫu thử".');
      return;
    }

    const drafts = generateExamBatchFromRawQuestions({
      pool,
      fileGroups:
        rawTextFiles.length > 0
          ? rawTextFiles.map((f) => ({ fileName: f.fileName, questions: f.questions }))
          : undefined,
      config: {
        baseTitle: examTitle.trim() || `${SUBJECT_LABELS[examSubject]} Lớp ${examGrade}`,
        grade: examGrade,
        subject: examSubject,
        textbookSeries: examSeries,
        examType,
        academicYear: examYear,
        semester: examSemester,
        durationMinutes: examDuration,
        totalScore: examTotalScore,
        allowRetake: rawAllowRetake,
        published: rawPublishImmediately,
        createdBy: user?.uid || 'admin',
        mode: rawBatchMode,
        examCount: rawBatchExamCount,
        questionsPerExam: rawQuestionsPerExam,
        shuffleOptionsInVariants: rawShuffleOptions,
      },
    });

    if (drafts.length === 0) {
      setError('Không thể tạo bộ đề từ danh sách câu hỏi hiện tại.');
      return;
    }

    setRawBatchDrafts(drafts);
    setNotice(
      `Đã tạo xem trước ${drafts.length} bộ đề từ ${pool.length} câu hỏi thô. Kiểm tra rồi bấm "Lưu tất cả ${drafts.length} bộ đề".`
    );
  };

  const handleSaveAllRawBatch = async () => {
    if (rawBatchDrafts.length === 0) return;
    setSavingRawBatch(true);
    setError(null);
    setNotice(null);
    try {
      const savedList: ExamDocument[] = [];
      for (const draft of rawBatchDrafts) {
        const sanitized: ExamDocument = {
          ...draft,
          title: draft.title.trim().slice(0, 200) || 'Đề kiểm tra',
          questions: draft.questions.slice(0, 60).map((q, idx) => ({
            ...q,
            orderIndex: idx + 1,
          })),
          updatedAt: new Date().toISOString(),
        };
        await saveExamDocument(sanitized);
        savedList.push(sanitized);
      }

      setExams((prev) => {
        const savedIds = new Set(savedList.map((s) => s.examId));
        return [...savedList, ...prev.filter((ex) => !savedIds.has(ex.examId))];
      });
      setRawBatchDrafts([]);
      const publishedCount = savedList.filter((d) => d.published).length;
      setNotice(
        `Đã lưu thành công ${savedList.length} bộ đề vào Firestore (${publishedCount} đề đang mở cho học sinh, ${savedList.length - publishedCount} bản nháp).`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi khi lưu hàng loạt bộ đề.');
    } finally {
      setSavingRawBatch(false);
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
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer transition-all ${
                  printPreview.variantCode === code
                    ? 'bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-sm'
                    : 'glass-control'
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
          <h1 className="font-display text-2xl font-bold text-[#16243E] dark:text-[#E6EFFC]">
            Trung tâm điều khiển StudyCheck AI
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {config && (
            <span className="font-mono text-xs px-3 py-1.5 rounded-xl glass-panel-subtle text-slate-700 dark:text-slate-300">
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
      <SlidingTabs<AdminTab>
        layoutGroupId="admin-control-tabs"
        ariaLabel="Điều hướng quản trị"
        activeId={tab}
        onChange={setTab}
        className="w-full"
        items={[
          { id: 'overview', label: 'Tổng quan & Công tắc AI', icon: Power },
          { id: 'models', label: 'Model Router (11 tác vụ)', icon: Cpu },
          { id: 'api_security', label: 'API Key & Bảo mật', icon: KeyRound },
          { id: 'references', label: 'Thư viện nguồn chuẩn', icon: BookOpen },
          { id: 'exams', label: 'Quản trị Đề kiểm tra', icon: ClipboardCheck },
          { id: 'feedback_roles', label: 'Phản hồi & Phân quyền', icon: UserCheck },
          { id: 'limits_audit', label: 'Giới hạn & Nhật ký', icon: Sliders },
        ]}
      />

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
        <GlassSurface className="rounded-3xl p-10 text-center">
          <Loader2 className="w-8 h-8 text-sky-600 animate-spin mx-auto" />
          <p className="text-xs text-slate-600 dark:text-slate-300 mt-3">Đang đồng bộ dữ liệu quản trị...</p>
        </GlassSurface>
      ) : (
        <>
          {/* TAB 1: OVERVIEW & GLOBAL AI SWITCH */}
          {tab === 'overview' && (
            <div className="space-y-6">
              {coldStartReadiness && coldStartReadiness.overallStatus !== 'ready_24_7' && (
                <div
                  className={`rounded-2xl border px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                    coldStartReadiness.overallStatus === 'at_risk'
                      ? 'border-rose-200 dark:border-rose-800/70 bg-rose-50/85 dark:bg-rose-950/35 text-rose-950 dark:text-rose-100'
                      : 'border-amber-200 dark:border-amber-800/70 bg-amber-50/85 dark:bg-amber-950/35 text-amber-950 dark:text-amber-100'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {coldStartReadiness.overallStatus === 'at_risk' ? (
                      <AlertCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                    ) : (
                      <ShieldAlert className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                    )}
                    <div className="space-y-0.5">
                      <p className="text-sm font-semibold">
                        {coldStartReadiness.overallStatus === 'at_risk'
                          ? 'Cảnh báo 24/7: AI có nguy cơ lỗi 503 khi máy chủ tự ngủ / khởi động lại lúc Admin ngoại tuyến'
                          : 'Lưu ý 24/7: Một phần cấu hình khóa API chưa bền vững qua lần khởi động lại máy chủ'}
                      </p>
                      <p className="text-xs opacity-90">
                        {coldStartReadiness.warnings[0] ||
                          'Hãy đặt khóa API vào biến môi trường máy chủ (Vercel / Render) để học sinh luôn dùng được khi Admin offline.'}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setTab('api_security')}
                    className="px-4 py-2 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-semibold hover:opacity-90 transition-opacity whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Kiểm tra cấu hình 24/7
                  </button>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <GlassSurface className="rounded-3xl p-5">
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

                <GlassSurface className="rounded-3xl p-5">
                  <p className="text-xs text-slate-500 dark:text-slate-400">Yêu cầu AI hôm nay</p>
                  <p className="font-mono text-2xl font-bold text-[#16243E] dark:text-[#E6EFFC] tabular-nums mt-1">
                    {usageStats?.today.requestCount ?? 0}
                  </p>
                  <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
                    Thành công: {usageStats?.today.successfulCount ?? 0} · Bị chặn:{' '}
                    {usageStats?.today.blockedCount ?? 0}
                  </p>
                </GlassSurface>

                <GlassSurface className="rounded-3xl p-5">
                  <p className="text-xs text-slate-500 dark:text-slate-400">Token AI thực tế</p>
                  <p className="font-mono text-2xl font-bold text-sky-700 dark:text-sky-400 tabular-nums mt-1">
                    {(usageStats?.today.actualTotalTokens ?? 0).toLocaleString('vi-VN')}
                  </p>
                  <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
                    Prompt {(usageStats?.today.actualPromptTokens ?? 0).toLocaleString('vi-VN')} · Output{' '}
                    {(usageStats?.today.actualCandidateTokens ?? 0).toLocaleString('vi-VN')}
                  </p>
                </GlassSurface>

                <GlassSurface className="rounded-3xl p-5">
                  <p className="text-xs text-slate-500 dark:text-slate-400">Hệ sinh thái học tập</p>
                  <p className="font-mono text-2xl font-bold text-[#16243E] dark:text-[#E6EFFC] tabular-nums mt-1">
                    {books.length} / {exams.length} / {users.length}
                  </p>
                  <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
                    Sách chuẩn / Đề thi / Tài khoản
                  </p>
                </GlassSurface>
              </div>

              {config && (
                <GlassSurface className="rounded-3xl p-6 space-y-5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-sky-200/60 dark:border-slate-700/70">
                    <div>
                      <h2 className="font-display text-lg font-bold text-[#16243E] dark:text-[#E6EFFC]">
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
                          AI chính dùng chung toàn hệ thống (Mistral · Groq · Cloudflare)
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

                  <div className="flex flex-wrap gap-2.5">
                    <WaterRippleButton
                      disabled={savingConfig}
                      onClick={() =>
                        handleApplyUnifiedAi(activeModel, unifiedFallbackModel, unifiedEnableFallback)
                      }
                    >
                      <Save className="w-4 h-4" />
                      Áp dụng 1 AI này cho toàn bộ 11 tác vụ
                    </WaterRippleButton>
                    <WaterRippleButton
                      variant="secondary"
                      disabled={savingConfig}
                      onClick={() =>
                        handlePatchAiConfig({
                          maintenanceMessage,
                          disabledReason,
                          activeModel,
                        })
                      }
                    >
                      Lưu riêng thông báo bảo trì
                    </WaterRippleButton>
                  </div>
                </GlassSurface>
              )}

              {usageStats && (
                <GlassSurface className="rounded-3xl p-6 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="font-display text-base font-bold text-[#16243E] dark:text-[#E6EFFC]">
                      Thống kê lưu lượng & Lỗi theo ngày
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Hôm nay: OCR {usageStats.today.ocrCount} · Phân tích {usageStats.today.analysisCount} ·
                      Quiz {usageStats.today.quizGenerationCount} · Web Grounding {usageStats.today.webGroundedCount}
                    </p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-sky-200/60 dark:border-slate-700/70 text-slate-500 dark:text-slate-400">
                        <tr>
                          <th className="py-2 pr-4">Ngày</th>
                          <th className="py-2 pr-4">Tổng Req</th>
                          <th className="py-2 pr-4">Thành công</th>
                          <th className="py-2 pr-4">Bị chặn</th>
                          <th className="py-2 pr-4">Token thực tế</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-sky-200/40 dark:divide-slate-800 font-mono">
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

          {/* TAB 2: MODEL ROUTER (3-PROVIDER FREE STACK: MISTRAL · CLOUDFLARE · GROQ) */}
          {tab === 'models' && taskModelsDraft && (
            <div className="space-y-6">
              <GlassSurface className="rounded-3xl p-6 space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h2 className="font-display text-lg font-bold text-[#16243E] dark:text-[#E6EFFC]">
                      Điều phối 3-Provider Miễn phí &amp; Ngưỡng thích ứng 1-vs-2 API
                    </h2>
                    <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
                      Hệ thống chạy 100% trên 3 nhà cung cấp miễn phí (Mistral AI · Cloudflare Workers AI · Groq), tự động chia tải 1 API cho bài ngắn và 2 API song song cho bài dài.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {modelCatalog.map((m) => (
                      <button
                        key={m.modelId}
                        type="button"
                        disabled={testingModelId === m.modelId}
                        onClick={() => handleTestModel(m.modelId)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl glass-control text-xs font-semibold cursor-pointer"
                      >
                        <Activity className="w-3.5 h-3.5 text-[#2563EB] dark:text-[#60A5FA]" />
                        {testingModelId === m.modelId ? 'Đang test...' : `Test ${m.modelId}`}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Ngưỡng thích ứng 1-vs-2 API (Admin Configurable) */}
                <div className="rounded-2xl border border-[#BFDBFE] dark:border-[#1E3A5F] bg-[#EAF2FF]/70 dark:bg-[#0D1A30] px-4 py-4 text-xs text-[#172033] dark:text-[#E6EFFC] space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
                    <div className="flex-1 space-y-1">
                      <label
                        htmlFor="adaptive-threshold-input"
                        className="block text-xs font-semibold text-[#172033] dark:text-[#E6EFFC]"
                      >
                        Ngưỡng phân loại văn bản ngắn/dài (ký tự)
                      </label>
                      <p className="text-[11px] text-[#525E75] dark:text-[#94A3B8] leading-relaxed">
                        Bài ngắn (&lt; ngưỡng): 1 API Quét · 1 API Chấm · 1 API Đối soát chéo. Bài dài (&ge; ngưỡng): 2 API Quét tinh chỉnh · 2 API Chấm song song (Mistral + Cloudflare) · 2 API Đối soát chéo. Phạm vi hợp lệ: 300–20.000 ký tự (mặc định 1.500).
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <input
                        id="adaptive-threshold-input"
                        type="number"
                        min={300}
                        max={20000}
                        step={100}
                        value={adaptiveThresholdInput}
                        onChange={(e) => setAdaptiveThresholdInput(Number(e.target.value))}
                        className={`${INPUT_CLASS} w-32 font-mono tabular-nums`}
                      />
                      <WaterRippleButton
                        size="sm"
                        disabled={savingConfig}
                        onClick={handleSaveAdaptiveThreshold}
                      >
                        <Save className="w-3.5 h-3.5" />
                        Lưu ngưỡng
                      </WaterRippleButton>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-[#E6ECF5] dark:border-[#1E293B] bg-[#F1F5FA]/80 dark:bg-[#0D1628] px-4 py-4 text-xs text-[#172033] dark:text-[#E6EFFC] space-y-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold">
                      Cấu hình 1 AI chính &amp; Dự phòng tự động · 3-Provider Free Stack
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-lg text-[11px] font-semibold ${
                          mistralConfigured
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300'
                            : 'bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300'
                        }`}
                      >
                        {mistralConfigured
                          ? providerKeys?.mistral?.source === 'admin'
                            ? 'Mistral AI: Đã bật (Key Admin)'
                            : 'Mistral AI: Đã bật (MISTRAL_API_KEY)'
                          : 'Mistral AI: Chưa cấu hình Key'}
                      </span>
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-lg text-[11px] font-semibold ${
                          groqConfigured
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300'
                            : 'bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300'
                        }`}
                      >
                        {groqConfigured
                          ? providerKeys?.groq?.source === 'admin'
                            ? 'Groq Cloud: Đã bật (Key Admin)'
                            : 'Groq Cloud: Đã bật (GROQ_API_KEY)'
                          : 'Groq Cloud: Chưa cấu hình Key'}
                      </span>
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-lg text-[11px] font-semibold ${
                          cloudflareConfigured
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300'
                            : 'bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300'
                        }`}
                      >
                        {cloudflareConfigured
                          ? providerKeys?.cloudflare?.source === 'admin'
                            ? 'Cloudflare AI: Đã bật (Key Admin)'
                            : 'Cloudflare AI: Đã bật (Env máy chủ)'
                          : 'Cloudflare AI: Chưa cấu hình Key'}
                      </span>
                      <button
                        type="button"
                        onClick={() => setTab('api_security')}
                        className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg bg-[#2563EB] text-white text-[11px] font-semibold hover:bg-[#1746A2] transition-colors cursor-pointer"
                      >
                        <KeyRound className="w-3 h-3" />
                        Nhập Key trong web
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        1. AI chính chạy toàn bộ tác vụ
                      </label>
                      <select
                        value={activeModel}
                        onChange={(e) => setActiveModel(e.target.value)}
                        className={`${INPUT_CLASS} font-mono`}
                      >
                        {modelCatalog.map((m) => (
                          <option key={m.modelId} value={m.modelId}>
                            {m.displayName}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        2. AI dự phòng tự động (khi lỗi / 429)
                      </label>
                      <select
                        value={unifiedFallbackModel}
                        onChange={(e) => setUnifiedFallbackModel(e.target.value)}
                        className={`${INPUT_CLASS} font-mono`}
                      >
                        {modelCatalog.map((m) => (
                          <option key={m.modelId} value={m.modelId}>
                            {m.modelId}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="inline-flex items-center gap-1.5 cursor-pointer text-xs font-medium">
                        <input
                          type="checkbox"
                          checked={unifiedEnableFallback}
                          onChange={(e) => setUnifiedEnableFallback(e.target.checked)}
                        />
                        <span>Bật dự phòng</span>
                      </label>
                      <WaterRippleButton
                        disabled={savingConfig}
                        onClick={() =>
                          handleApplyUnifiedAi(activeModel, unifiedFallbackModel, unifiedEnableFallback)
                        }
                      >
                        <Save className="w-4 h-4" />
                        Áp dụng cho cả 11 tác vụ
                      </WaterRippleButton>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                      Chọn nhanh 1 chạm:
                    </span>
                    <button
                      type="button"
                      disabled={savingConfig}
                      onClick={() =>
                        handleApplyUnifiedAi(
                          'mistral:mistral-small-latest',
                          'groq:openai/gpt-oss-120b',
                          true
                        )
                      }
                      className="px-3 py-1.5 rounded-xl bg-[#2563EB] text-white text-[11px] font-semibold hover:bg-[#1746A2] transition-colors cursor-pointer"
                    >
                      Khuyên dùng · Mistral Small + Dự phòng Groq GPT-OSS 120B
                    </button>
                    <button
                      type="button"
                      disabled={savingConfig}
                      onClick={() =>
                        handleApplyUnifiedAi(
                          'groq:openai/gpt-oss-120b',
                          'cf:@cf/meta/llama-3.3-70b-instruct-fp8-fast',
                          true
                        )
                      }
                      className="px-3 py-1.5 rounded-xl glass-control text-[11px] font-semibold cursor-pointer"
                    >
                      Groq GPT-OSS 120B + Dự phòng Cloudflare Llama 70B
                    </button>
                    <button
                      type="button"
                      disabled={savingConfig}
                      onClick={() =>
                        handleApplyUnifiedAi(
                          'cf:@cf/meta/llama-3.3-70b-instruct-fp8-fast',
                          'mistral:mistral-small-latest',
                          true
                        )
                      }
                      className="px-3 py-1.5 rounded-xl glass-control text-[11px] font-semibold cursor-pointer"
                    >
                      Cloudflare Llama 3.3 70B + Dự phòng Mistral Small
                    </button>
                  </div>

                  <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                    Pipeline 3-Provider tự động điều phối: <strong>Quét OCR</strong> dùng Groq Vision (<code className="font-mono text-[11px]">qwen/qwen3.8-27b</code>) + tinh chỉnh Cloudflare/Mistral Vision cho bài dài; <strong>Chấm điểm</strong> dùng Mistral Small + Cloudflare Llama 70B song song; <strong>Đối soát chéo</strong> luôn chạy nhà cung cấp khác (Groq GPT-OSS 20B / Ministral 8B / Cloudflare 8B) để tối ưu chất lượng và tránh chạm giới hạn 429.
                  </p>
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

                <details className="rounded-2xl border border-slate-200/80 dark:border-slate-700/70 p-4">
                  <summary className="cursor-pointer text-xs font-semibold text-slate-700 dark:text-slate-200 select-none">
                    Tùy chỉnh nâng cao riêng từng tác vụ ({Object.keys(AI_TASK_LABELS).length} tác vụ — chỉ mở khi cần tách model riêng)
                  </summary>
                  <div className="mt-4 space-y-4">
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
                              defaultModel: 'mistral:mistral-small-latest',
                              fallbackModel: 'groq:openai/gpt-oss-120b',
                              enableFallback: true,
                              oneTimeOverrideModel: null,
                              promptVersion: 'v4.2_3provider',
                            };
                            const overrideDraft =
                              overrideSelection[taskKey] ?? row.oneTimeOverrideModel ?? 'mistral:mistral-small-latest';
                            return (
                              <tr key={taskKey} className="align-middle">
                                <td className="py-3 pr-3">
                                  <p className="font-semibold text-[#16243E] dark:text-[#E6EFFC]">
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
                                      className="px-2 py-1.5 rounded-lg glass-control font-mono text-[11px]"
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
                                      className="px-2.5 py-1.5 rounded-lg bg-gradient-to-r from-sky-500 to-blue-600 text-white text-[11px] font-semibold hover:brightness-105 shadow-sm cursor-pointer"
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
                          'Đã lưu bảng tùy chỉnh nâng cao cho từng tác vụ AI.'
                        )
                      }
                    >
                      <Save className="w-4 h-4" />
                      Lưu tùy chỉnh nâng cao
                    </WaterRippleButton>
                  </div>
                </details>
              </GlassSurface>

              <GlassSurface className="rounded-3xl p-6 space-y-4">
                <h3 className="font-display text-base font-bold text-[#16243E] dark:text-[#E6EFFC]">
                  Nhật ký thực thi Model gần nhất ({executionLogs.length})
                </h3>
                {executionLogs.length === 0 ? (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Chưa có lượt gọi AI nào trong phiên máy chủ hiện tại.
                  </p>
                ) : (
                  <div className="overflow-x-auto max-h-[340px]">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-sky-200/60 dark:border-slate-700/70 text-slate-500 dark:text-slate-400">
                        <tr>
                          <th className="py-2 pr-3">Thời gian</th>
                          <th className="py-2 pr-3">Tác vụ</th>
                          <th className="py-2 pr-3">Model</th>
                          <th className="py-2 pr-3">Chế độ</th>
                          <th className="py-2 pr-3">Thời lượng</th>
                          <th className="py-2 pr-3">Trạng thái</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-sky-200/40 dark:divide-slate-800 font-mono text-[11px]">
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
              {coldStartReadiness && (
                <GlassSurface className="rounded-3xl p-6 space-y-5">
                  <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 pb-4 border-b border-slate-200/70 dark:border-slate-700/70">
                    <div className="flex items-start gap-3">
                      {coldStartReadiness.overallStatus === 'ready_24_7' ? (
                        <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                      ) : coldStartReadiness.overallStatus === 'partial_risk' ? (
                        <ShieldAlert className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                      ) : (
                        <AlertCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                      )}
                      <div>
                        <h2 className="font-display text-base font-bold text-[#16243E] dark:text-[#E6EFFC]">
                          Trạng thái Sẵn sàng 24/7 (Chống mất API khi Server Reset)
                        </h2>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600 dark:text-slate-300 mt-1">
                          <span
                            className={`font-semibold ${
                              coldStartReadiness.overallStatus === 'ready_24_7'
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : coldStartReadiness.overallStatus === 'partial_risk'
                                  ? 'text-amber-700 dark:text-amber-400'
                                  : 'text-rose-700 dark:text-rose-400'
                            }`}
                          >
                            {coldStartReadiness.overallStatus === 'ready_24_7'
                              ? 'Sẵn sàng 24/7'
                              : coldStartReadiness.overallStatus === 'partial_risk'
                                ? 'Cần bổ sung dự phòng'
                                : 'Nguy cơ lỗi 503 khi server reset'}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>
                            Môi trường:{' '}
                            {coldStartReadiness.runtimePlatform === 'vercel'
                              ? 'Vercel Serverless'
                              : coldStartReadiness.runtimePlatform === 'render'
                                ? 'Render Container'
                                : 'Node.js Server'}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono text-[11px]">
                            Model chính: {coldStartReadiness.activeModel}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={handleCopyEnvTemplate}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl glass-control text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        {copiedEnvTemplate ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                            <span>Đã sao chép mẫu</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>Sao chép mẫu biến môi trường</span>
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowDeployGuide((prev) => !prev)}
                        className="inline-flex items-center gap-1 px-3 py-2 rounded-xl glass-control text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <Server className="w-3.5 h-3.5" />
                        <span>Hướng dẫn Vercel / Render</span>
                        {showDeployGuide ? (
                          <ChevronUp className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200/70 dark:border-slate-700/70 text-slate-500 dark:text-slate-400">
                          <th className="py-2 pr-4 font-medium">Nhà cung cấp AI</th>
                          <th className="py-2 pr-4 font-medium">Biến môi trường máy chủ</th>
                          <th className="py-2 pr-4 font-medium">Nguồn đang chạy</th>
                          <th className="py-2 font-medium">Khi server reset &amp; Admin offline</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200/50 dark:divide-slate-800/70">
                        {[
                          coldStartReadiness.providers.mistral,
                          coldStartReadiness.providers.groq,
                          coldStartReadiness.providers.cloudflare,
                        ].filter(Boolean).map((item) => {
                          const isActiveProvider = coldStartReadiness.activeProvider === item.provider;
                          return (
                            <tr key={item.provider} className="align-middle">
                              <td className="py-2.5 pr-4 font-medium text-[#16243E] dark:text-[#E6EFFC]">
                                {item.label}
                                {isActiveProvider && (
                                  <span className="text-[11px] font-normal text-sky-700 dark:text-sky-400 ml-1.5">
                                    · Đang dùng chính
                                  </span>
                                )}
                              </td>
                              <td className="py-2.5 pr-4 font-mono text-[11px] text-slate-600 dark:text-slate-300">
                                {item.envVarNames.join(' / ')}
                              </td>
                              <td className="py-2.5 pr-4 text-slate-600 dark:text-slate-300">
                                {item.adminOverrideActive && item.envConfigured
                                  ? 'Key Admin (có Env dự phòng)'
                                  : item.adminOverrideActive
                                    ? 'Chỉ Key dán trong Admin'
                                    : item.envConfigured
                                      ? 'Biến môi trường máy chủ'
                                      : 'Chưa cấu hình'}
                              </td>
                              <td className="py-2.5 font-medium">
                                {item.survivesColdStartWhenAdminOffline ? (
                                  <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
                                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                                    Tự hoạt động 24/7
                                  </span>
                                ) : item.adminOverrideActive ? (
                                  <span className="inline-flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
                                    <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                                    Mất tạm thời khi reset
                                  </span>
                                ) : (
                                  <span className="text-slate-500 dark:text-slate-400">
                                    Chưa kích hoạt
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-200/70 dark:border-slate-700/70 text-xs">
                    <span className="text-slate-600 dark:text-slate-300">
                      Khóa mã hóa lưu trữ (<code className="font-mono">KEY_ENCRYPTION_SECRET</code>):
                    </span>
                    <span
                      className={`font-semibold ${
                        coldStartReadiness.encryptionSecretConfigured
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-amber-700 dark:text-amber-400'
                      }`}
                    >
                      {coldStartReadiness.encryptionSecretConfigured
                        ? 'Đã cấu hình bền vững qua các lần khởi động lại'
                        : 'Chưa đặt — khóa dán trong Admin chỉ lưu tạm trong RAM'}
                    </span>
                  </div>

                  {coldStartReadiness.warnings.length > 0 && (
                    <div className="pt-3 border-t border-slate-200/70 dark:border-slate-700/70 space-y-1.5">
                      <p className="text-xs font-semibold text-[#16243E] dark:text-[#E6EFFC]">
                        Cần bổ sung để đảm bảo 24/7:
                      </p>
                      <ul className="list-disc pl-5 space-y-1 text-xs text-slate-700 dark:text-slate-300">
                        {coldStartReadiness.warnings.map((w, idx) => (
                          <li key={idx}>{w}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {showDeployGuide && (
                    <div className="pt-3 border-t border-slate-200/70 dark:border-slate-700/70 space-y-3 text-xs text-slate-700 dark:text-slate-300">
                      <p className="font-semibold text-[#16243E] dark:text-[#E6EFFC]">
                        Cách cấu hình chạy 24/7 trên Vercel hoặc Render (3 bước):
                      </p>
                      <ol className="list-decimal pl-5 space-y-1">
                        <li>
                          Mở mục <strong>Settings → Environment Variables</strong> (trên Vercel) hoặc{' '}
                          <strong>Environment → Add Environment Variable</strong> (trên Render).
                        </li>
                        <li>
                          Thêm ít nhất khóa AI chính (<code className="font-mono">MISTRAL_API_KEY</code>,{' '}
                          <code className="font-mono">GROQ_API_KEY</code> hoặc cặp Cloudflare Workers AI) cùng 1 chuỗi bí mật ngẫu nhiên 32+ ký tự cho{' '}
                          <code className="font-mono">KEY_ENCRYPTION_SECRET</code>.
                        </li>
                        <li>
                          Lưu và <strong>Redeploy</strong>. Từ lúc này, dù máy chủ tự ngủ và Admin ngoại tuyến hoàn toàn, mọi yêu cầu của học sinh vẫn chạy bình thường mà không cần mở khóa Firestore.
                        </li>
                      </ol>
                      <pre className="p-3.5 rounded-xl bg-slate-900/95 text-slate-100 font-mono text-[11px] overflow-x-auto leading-relaxed">
                        {coldStartReadiness.envTemplate}
                      </pre>
                    </div>
                  )}
                </GlassSurface>
              )}

              {/* MISTRAL AI FREE KEY (IN-WEB SUPER ADMIN) */}
              <GlassSurface className="rounded-3xl p-6 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="font-display text-base font-bold text-[#16243E] dark:text-[#E6EFFC]">
                      API Key Mistral AI Free (Chấm chính, Kiểm định &amp; Vision dự phòng)
                    </h2>
                    <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
                      Ghi đè nhanh ngay lập tức trong phiên chạy (lưu mã hóa AES-256-GCM trên <code className="font-mono">adminSecrets/mistral</code>). Để bền vững 24/7 khi Vercel/Render reset lúc Admin ngoại tuyến, hãy đặt thêm biến <code className="font-mono">MISTRAL_API_KEY</code> trên máy chủ.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <WaterRippleButton
                      size="sm"
                      variant="secondary"
                      disabled={testingKey || !(providerKeys?.mistral?.configured ?? singleKeyStatus?.configured)}
                      onClick={() => handleTestKey()}
                    >
                      {testingKey ? 'Đang kiểm tra...' : 'Test Mistral Key đang dùng'}
                    </WaterRippleButton>
                    {(providerKeys?.mistral?.source ?? singleKeyStatus?.source) === 'admin' && (
                      <button
                        type="button"
                        onClick={handleClearAdminKey}
                        className="px-3 py-1.5 rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 text-xs font-semibold hover:bg-rose-100 cursor-pointer"
                      >
                        Gỡ Mistral Key Admin
                      </button>
                    )}
                  </div>
                </div>

                <div className="glass-panel-subtle rounded-2xl p-4 text-xs grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <p className="text-slate-500 dark:text-slate-400">Trạng thái hiện tại</p>
                    <p
                      className={`font-semibold mt-0.5 ${
                        (providerKeys?.mistral?.configured ?? singleKeyStatus?.configured)
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-rose-700 dark:text-rose-400'
                      }`}
                    >
                      {(providerKeys?.mistral?.configured ?? singleKeyStatus?.configured)
                        ? (providerKeys?.mistral?.source ?? singleKeyStatus?.source) === 'admin'
                          ? 'Đang dùng Key của Quản trị viên'
                          : 'Đang dùng biến MISTRAL_API_KEY của máy chủ'
                        : 'Chưa có Mistral API Key'}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-500 dark:text-slate-400">Mã nhận diện (đã che)</p>
                    <p className="font-mono font-semibold mt-0.5">
                      {providerKeys?.mistral?.maskedKey || singleKeyStatus?.maskedKey || '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-500 dark:text-slate-400">Kiểm tra gần nhất</p>
                    <p className="font-semibold mt-0.5">
                      {providerKeys?.mistral?.lastTestStatus || singleKeyStatus?.lastTestStatus || 'Untested'}
                    </p>
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

                <form onSubmit={handleSaveSingleKey} className="space-y-4 pt-2 border-t border-sky-200/60 dark:border-slate-700/70">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Tên gợi nhớ (tùy chọn)
                      </label>
                      <input
                        type="text"
                        value={newKeyLabel}
                        onChange={(e) => setNewKeyLabel(e.target.value)}
                        placeholder="Ví dụ: Mistral AI Free Production"
                        className={INPUT_CLASS}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Mistral AI API Key mới
                      </label>
                      <input
                        type="password"
                        required
                        value={newRawKey}
                        onChange={(e) => setNewRawKey(e.target.value)}
                        placeholder="Dán Mistral API Key từ console.mistral.ai..."
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
                      className="px-4 py-2 rounded-xl glass-control text-xs font-semibold disabled:opacity-45 cursor-pointer"
                    >
                      Thử nghiệm key đang nhập
                    </button>
                  </div>
                </form>
              </GlassSurface>

              {/* GROQ CLOUD FREE KEY (IN-WEB SUPER ADMIN) */}
              <GlassSurface className="rounded-3xl p-6 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="font-display text-base font-bold text-[#16243E] dark:text-[#E6EFFC]">
                      API Key Groq Cloud Free (OCR Vision, Đối soát chéo &amp; Dự phòng siêu tốc)
                    </h2>
                    <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
                      Dùng để thử nghiệm hoặc đổi nhanh tức thì trong phiên chạy (lưu mã hóa AES-256-GCM trên <code className="font-mono">adminSecrets/groq</code> cho Super Admin). Để chạy <strong>24/7 khi Vercel/Render reset lúc Admin ngoại tuyến</strong>, hãy đặt thêm biến <code className="font-mono">GROQ_API_KEY</code> trên máy chủ.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <WaterRippleButton
                      size="sm"
                      variant="secondary"
                      disabled={testingGroqKey || !providerKeys?.groq?.configured}
                      onClick={() => handleTestGroqKey()}
                    >
                      {testingGroqKey ? 'Đang kiểm tra...' : 'Test Groq Key đang dùng'}
                    </WaterRippleButton>
                    {providerKeys?.groq?.source === 'admin' && (
                      <button
                        type="button"
                        onClick={handleClearGroqKey}
                        className="px-3 py-1.5 rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 text-xs font-semibold hover:bg-rose-100 cursor-pointer"
                      >
                        Gỡ Groq Key Admin
                      </button>
                    )}
                  </div>
                </div>

                <div className="glass-panel-subtle rounded-2xl p-4 text-xs grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <p className="text-slate-500 dark:text-slate-400">Trạng thái hiện tại</p>
                    <p
                      className={`font-semibold mt-0.5 ${
                        providerKeys?.groq?.configured
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-amber-700 dark:text-amber-400'
                      }`}
                    >
                      {providerKeys?.groq?.configured
                        ? providerKeys.groq.source === 'admin'
                          ? 'Đang dùng Groq Key của Quản trị viên'
                          : 'Đang dùng biến GROQ_API_KEY của máy chủ'
                        : 'Chưa cấu hình Groq Key'}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-500 dark:text-slate-400">Mã nhận diện (đã che)</p>
                    <p className="font-mono font-semibold mt-0.5">
                      {providerKeys?.groq?.maskedKey || '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-500 dark:text-slate-400">Kiểm tra gần nhất</p>
                    <p className="font-semibold mt-0.5">
                      {providerKeys?.groq?.lastTestStatus || 'Untested'}
                    </p>
                  </div>
                </div>

                {groqTestResult && (
                  <div
                    className={`rounded-xl border p-3.5 text-xs space-y-1 ${
                      groqTestResult.status === 'Connected'
                        ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
                        : 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-900 dark:text-rose-200'
                    }`}
                  >
                    <p>
                      <strong>Kết quả kiểm tra Groq ({groqTestResult.status}):</strong> {groqTestResult.message}
                    </p>
                    {groqTestResult.availableModels && groqTestResult.availableModels.length > 0 && (
                      <p className="text-[11px] opacity-85 font-mono">
                        Model văn bản khả dụng trên key này: {groqTestResult.availableModels.slice(0, 6).join(', ')}
                      </p>
                    )}
                  </div>
                )}

                <form onSubmit={handleSaveGroqKey} className="space-y-4 pt-2 border-t border-sky-200/60 dark:border-slate-700/70">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Tên gợi nhớ Groq Key (tùy chọn)
                      </label>
                      <input
                        type="text"
                        value={groqKeyLabel}
                        onChange={(e) => setGroqKeyLabel(e.target.value)}
                        placeholder="Ví dụ: Groq Free Production"
                        className={INPUT_CLASS}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Groq API Key mới
                      </label>
                      <input
                        type="password"
                        required
                        value={groqRawKey}
                        onChange={(e) => setGroqRawKey(e.target.value)}
                        placeholder="Dán Groq API key vào đây (ví dụ gsk_...)"
                        className={`${INPUT_CLASS} font-mono`}
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <WaterRippleButton type="submit" disabled={savingGroqKey}>
                      {savingGroqKey ? 'Đang lưu...' : 'Lưu Groq Key & Áp dụng ngay'}
                    </WaterRippleButton>
                    <button
                      type="button"
                      disabled={testingGroqKey || !groqRawKey.trim()}
                      onClick={() => handleTestGroqKey(groqRawKey)}
                      className="px-4 py-2 rounded-xl glass-control text-xs font-semibold disabled:opacity-45 cursor-pointer"
                    >
                      Thử nghiệm Groq Key đang nhập
                    </button>
                  </div>
                </form>
              </GlassSurface>

              {/* CLOUDFLARE WORKERS AI CREDENTIALS (IN-WEB SUPER ADMIN) */}
              <GlassSurface className="rounded-3xl p-6 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="font-display text-base font-bold text-[#16243E] dark:text-[#E6EFFC]">
                      Cloudflare Workers AI Free (Account ID &amp; API Token — Tầng dự phòng thứ 3)
                    </h2>
                    <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
                      Dùng để thử nghiệm hoặc ghi đè nhanh (lưu mã hóa trên <code className="font-mono">adminSecrets/cloudflare</code> cho Super Admin). Để tầng dự phòng này tự sống lại <strong>24/7 khi Vercel/Render reset</strong>, hãy đặt thêm <code className="font-mono">CLOUDFLARE_ACCOUNT_ID</code> và <code className="font-mono">CLOUDFLARE_API_TOKEN</code> trên máy chủ.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <WaterRippleButton
                      size="sm"
                      variant="secondary"
                      disabled={testingCfKey || !providerKeys?.cloudflare?.configured}
                      onClick={() => handleTestCloudflareKey()}
                    >
                      {testingCfKey ? 'Đang kiểm tra...' : 'Test Cloudflare đang dùng'}
                    </WaterRippleButton>
                    {providerKeys?.cloudflare?.source === 'admin' && (
                      <button
                        type="button"
                        onClick={handleClearCloudflareKey}
                        className="px-3 py-1.5 rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 text-xs font-semibold hover:bg-rose-100 cursor-pointer"
                      >
                        Gỡ Cloudflare Key Admin
                      </button>
                    )}
                  </div>
                </div>

                <div className="glass-panel-subtle rounded-2xl p-4 text-xs grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <p className="text-slate-500 dark:text-slate-400">Trạng thái hiện tại</p>
                    <p
                      className={`font-semibold mt-0.5 ${
                        providerKeys?.cloudflare?.configured
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-amber-700 dark:text-amber-400'
                      }`}
                    >
                      {providerKeys?.cloudflare?.configured
                        ? providerKeys.cloudflare.source === 'admin'
                          ? 'Đang dùng Cloudflare Key của Quản trị viên'
                          : 'Đang dùng biến CLOUDFLARE_* của máy chủ'
                        : 'Chưa cấu hình Cloudflare AI'}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-500 dark:text-slate-400">Account ID / API Token (đã che)</p>
                    <p className="font-mono font-semibold mt-0.5">
                      {providerKeys?.cloudflare?.configured
                        ? `${providerKeys.cloudflare.maskedAccountId || '—'} · ${providerKeys.cloudflare.maskedKey || '—'}`
                        : '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-500 dark:text-slate-400">Kiểm tra gần nhất</p>
                    <p className="font-semibold mt-0.5">
                      {providerKeys?.cloudflare?.lastTestStatus || 'Untested'}
                    </p>
                  </div>
                </div>

                {cfTestResult && (
                  <div
                    className={`rounded-xl border p-3.5 text-xs ${
                      cfTestResult.status === 'Connected'
                        ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
                        : 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-900 dark:text-rose-200'
                    }`}
                  >
                    <strong>Kết quả kiểm tra Cloudflare ({cfTestResult.status}):</strong> {cfTestResult.message}
                  </div>
                )}

                <form onSubmit={handleSaveCloudflareKey} className="space-y-4 pt-2 border-t border-sky-200/60 dark:border-slate-700/70">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Tên gợi nhớ (tùy chọn)
                      </label>
                      <input
                        type="text"
                        value={cfKeyLabel}
                        onChange={(e) => setCfKeyLabel(e.target.value)}
                        placeholder="Ví dụ: Cloudflare Workers AI"
                        className={INPUT_CLASS}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Cloudflare Account ID
                      </label>
                      <input
                        type="text"
                        required
                        value={cfAccountIdInput}
                        onChange={(e) => setCfAccountIdInput(e.target.value)}
                        placeholder="32 ký tự hex trong Cloudflare Dashboard"
                        className={`${INPUT_CLASS} font-mono`}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Cloudflare API Token (Workers AI)
                      </label>
                      <input
                        type="password"
                        required
                        value={cfApiTokenInput}
                        onChange={(e) => setCfApiTokenInput(e.target.value)}
                        placeholder="Dán Workers AI API Token vào đây"
                        className={`${INPUT_CLASS} font-mono`}
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <WaterRippleButton type="submit" disabled={savingCfKey}>
                      {savingCfKey ? 'Đang lưu...' : 'Lưu Cloudflare & Áp dụng ngay'}
                    </WaterRippleButton>
                    <button
                      type="button"
                      disabled={testingCfKey || !cfAccountIdInput.trim() || !cfApiTokenInput.trim()}
                      onClick={() => handleTestCloudflareKey(cfAccountIdInput, cfApiTokenInput)}
                      className="px-4 py-2 rounded-xl glass-control text-xs font-semibold disabled:opacity-45 cursor-pointer"
                    >
                      Thử nghiệm Cloudflare đang nhập
                    </button>
                  </div>
                </form>
              </GlassSurface>

              {/* LIVE ALLOWED_ORIGIN MANAGER */}
              <GlassSurface className="rounded-3xl p-6 space-y-4">
                <div>
                  <h2 className="font-display text-base font-bold text-[#16243E] dark:text-[#E6EFFC]">
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
                        className="flex items-center justify-between gap-3 rounded-xl glass-panel-subtle px-3.5 py-2 text-xs"
                      >
                        <span className="font-mono text-[#16243E] dark:text-[#E6EFFC] break-all">{origin}</span>
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
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="font-display text-lg font-bold text-[#16243E] dark:text-[#E6EFFC]">
                      Thêm nguồn kiến thức chuẩn SGK (AI Tổng Hợp Theo Chương / Đọc PDF Thông Minh)
                    </h2>
                    <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
                      Nạp nhanh khung SGK chuẩn GDPT 2018 tuần tự từng chương không lo timeout, hoặc đọc PDF bất kỳ dung lượng (hỗ trợ cả PDF scan) trực tiếp trên trình duyệt.
                    </p>
                  </div>
                </div>

                <div className="glass-segment rounded-2xl p-1.5 inline-flex flex-wrap gap-1.5 text-xs">
                  {(
                    [
                      ['ai_synthesize', 'AI Tổng hợp chuẩn SGK', Sparkles],
                      ['pdf', 'Đọc PDF thông minh', FileUp],
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
                        setPdfDetectedPages(null);
                        setPdfProgress(null);
                      }}
                      className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl font-semibold cursor-pointer transition-all ${
                        refInputMode === modeId
                          ? 'bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-sm'
                          : 'text-slate-600 dark:text-slate-300 hover:bg-white/60 dark:hover:bg-slate-800/60 hover:text-[#16243E] dark:hover:text-[#E6EFFC]'
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
                        Tên tài liệu / Sách {refInputMode === 'ai_synthesize' ? '(có thể để AI tự điền)' : ''}
                      </label>
                      <input
                        type="text"
                        required={refInputMode !== 'ai_synthesize'}
                        value={refTitle}
                        onChange={(e) => setRefTitle(e.target.value)}
                        placeholder={`Ví dụ: SGK ${SUBJECT_LABELS[refSubject]} ${refGrade} - ${refSeries}`}
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

                  {/* MODE 1: AI SEQUENTIAL TEXTBOOK CHAPTER SYNTHESIZER */}
                  {refInputMode === 'ai_synthesize' && (
                    <div className="rounded-2xl border border-sky-200/80 dark:border-sky-800/60 bg-sky-50/40 dark:bg-slate-900/50 p-4 sm:p-5 space-y-4">
                      <div className="space-y-1.5">
                        <label className="block text-xs font-semibold text-[#16243E] dark:text-[#E6EFFC]">
                          Gợi ý mục lục Chương / Bài (Không bắt buộc — để trống nếu muốn AI tự tra cứu chuẩn GDPT 2018)
                        </label>
                        <textarea
                          rows={3}
                          value={customTocHint}
                          onChange={(e) => setCustomTocHint(e.target.value)}
                          placeholder="Có thể dán nhanh mục lục các chương ở đây nếu bạn muốn chỉ định chính xác tên chương/bài..."
                          className={`${INPUT_CLASS} font-mono`}
                        />
                      </div>

                      <div className="flex flex-wrap items-center gap-3">
                        <WaterRippleButton
                          type="button"
                          disabled={synthesizingOutline || synthesizingChapters}
                          onClick={() => void handleGenerateSgkOutline()}
                        >
                          {synthesizingOutline ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Wand2 className="w-4 h-4" />
                          )}
                          <span>
                            {synthesizingOutline
                              ? 'Đang tra cứu & lập mục lục Chương...'
                              : '1. Tạo Mục lục Chương chuẩn'}
                          </span>
                        </WaterRippleButton>

                        {outlineChapters.length > 0 && (
                          <button
                            type="button"
                            disabled={synthesizingChapters}
                            onClick={() => {
                              const nextIndex = outlineChapters.length + 1;
                              setOutlineChapters((prev) => [
                                ...prev,
                                {
                                  chapterIndex: nextIndex,
                                  chapterTitle: `Chương ${nextIndex}: Chủ đề bổ sung`,
                                  lessons: ['Bài 1: Nội dung trọng tâm'],
                                  estimatedPageStart: 6 + (nextIndex - 1) * 20,
                                  selected: true,
                                  status: 'idle',
                                  savedChunks: 0,
                                },
                              ]);
                            }}
                            className="glass-control inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-[#16243E] dark:text-[#E6EFFC] cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>Thêm chương thủ công</span>
                          </button>
                        )}
                      </div>

                      {outlineChapters.length > 0 && (
                        <div className="space-y-3 pt-2 border-t border-sky-200/60 dark:border-slate-800">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2 text-xs font-semibold text-[#16243E] dark:text-[#E6EFFC]">
                              <ListChecks className="w-4 h-4 text-sky-600 dark:text-sky-400" />
                              <span>
                                Danh sách Chương ({outlineChapters.filter((c) => c.selected).length}/
                                {outlineChapters.length} chương được chọn · Đã lưu{' '}
                                {outlineChapters.filter((c) => c.status === 'saved').length} chương)
                              </span>
                            </div>

                            <div className="flex items-center gap-2 text-xs">
                              <button
                                type="button"
                                disabled={synthesizingChapters}
                                onClick={() =>
                                  setOutlineChapters((prev) =>
                                    prev.map((c) => ({ ...c, selected: true }))
                                  )
                                }
                                className="text-sky-700 dark:text-sky-400 hover:underline font-medium cursor-pointer"
                              >
                                Chọn tất cả
                              </button>
                              <span>·</span>
                              <button
                                type="button"
                                disabled={synthesizingChapters}
                                onClick={() =>
                                  setOutlineChapters((prev) =>
                                    prev.map((c) => ({ ...c, selected: false }))
                                  )
                                }
                                className="text-slate-600 dark:text-slate-400 hover:underline font-medium cursor-pointer"
                              >
                                Bỏ chọn
                              </button>
                            </div>
                          </div>

                          {/* Overall Chapter Synthesis Progress Bar */}
                          {(synthesizingChapters ||
                            outlineChapters.some((c) => c.status === 'saved')) && (
                            <div className="space-y-1.5">
                              <div className="flex items-center justify-between text-xs font-mono">
                                <span className="text-slate-600 dark:text-slate-300">
                                  Tiến độ tổng hợp & lưu tuần tự vào Firestore
                                </span>
                                <span className="font-semibold text-sky-700 dark:text-sky-300 tabular-nums">
                                  {outlineChapters.filter((c) => c.status === 'saved').length}/
                                  {Math.max(1, outlineChapters.filter((c) => c.selected).length)}{' '}
                                  chương (
                                  {outlineChapters.reduce((s, c) => s + c.savedChunks, 0)} chunks)
                                </span>
                              </div>
                              <div className="h-2 w-full rounded-full bg-slate-200/80 dark:bg-slate-800 overflow-hidden">
                                <div
                                  className="h-full rounded-full bg-[#2563EB] dark:bg-[#3B82F6] transition-all duration-300"
                                  style={{
                                    width: `${Math.min(
                                      100,
                                      Math.round(
                                        (outlineChapters.filter((c) => c.status === 'saved')
                                          .length /
                                          Math.max(
                                            1,
                                            outlineChapters.filter((c) => c.selected).length
                                          )) *
                                          100
                                      )
                                    )}%`,
                                  }}
                                />
                              </div>
                            </div>
                          )}

                          <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                            {outlineChapters.map((ch) => (
                              <div
                                key={ch.chapterIndex}
                                className={`rounded-2xl border p-3 text-xs transition-colors ${
                                  ch.status === 'running'
                                    ? 'border-sky-400 bg-sky-50/90 dark:bg-sky-950/40 dark:border-sky-600'
                                    : ch.status === 'saved'
                                    ? 'border-emerald-300/80 bg-emerald-50/60 dark:bg-emerald-950/30 dark:border-emerald-800/70'
                                    : ch.status === 'error'
                                    ? 'border-rose-300 bg-rose-50/70 dark:bg-rose-950/30 dark:border-rose-800/70'
                                    : 'border-slate-200/80 bg-white/80 dark:bg-slate-900/60 dark:border-slate-800'
                                }`}
                              >
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                  <div className="flex items-start gap-2.5 flex-1 min-w-[220px]">
                                    <input
                                      type="checkbox"
                                      checked={ch.selected}
                                      disabled={synthesizingChapters}
                                      onChange={(e) =>
                                        setOutlineChapters((prev) =>
                                          prev.map((item) =>
                                            item.chapterIndex === ch.chapterIndex
                                              ? { ...item, selected: e.target.checked }
                                              : item
                                          )
                                        )
                                      }
                                      className="mt-1 h-4 w-4 accent-sky-600 rounded cursor-pointer"
                                    />
                                    <div className="flex-1 space-y-1.5">
                                      <input
                                        type="text"
                                        disabled={synthesizingChapters}
                                        value={ch.chapterTitle}
                                        onChange={(e) =>
                                          setOutlineChapters((prev) =>
                                            prev.map((item) =>
                                              item.chapterIndex === ch.chapterIndex
                                                ? { ...item, chapterTitle: e.target.value }
                                                : item
                                            )
                                          )
                                        }
                                        className="w-full font-semibold text-[#16243E] dark:text-[#E6EFFC] bg-transparent border-b border-transparent focus:border-sky-400 focus:outline-none pb-0.5"
                                      />
                                      <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                                        Các bài: {ch.lessons.join(' · ')}
                                      </p>
                                      {ch.errorMsg && (
                                        <p className="text-[11px] font-medium text-rose-600 dark:text-rose-400">
                                          {ch.errorMsg}
                                        </p>
                                      )}
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-2 shrink-0">
                                    {ch.status === 'running' && (
                                      <span className="inline-flex items-center gap-1 font-semibold text-sky-700 dark:text-sky-300">
                                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                        <span>Đang tổng hợp...</span>
                                      </span>
                                    )}
                                    {ch.status === 'saved' && (
                                      <span className="inline-flex items-center gap-1 font-semibold text-emerald-700 dark:text-emerald-300">
                                        <CheckCircle2 className="w-3.5 h-3.5" />
                                        <span>Đã lưu ({ch.savedChunks} chunks)</span>
                                      </span>
                                    )}
                                    {ch.status === 'error' && (
                                      <button
                                        type="button"
                                        disabled={synthesizingChapters}
                                        onClick={() =>
                                          void handleRunSequentialChapterSynthesis(ch.chapterIndex)
                                        }
                                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-semibold cursor-pointer"
                                      >
                                        <RefreshCw className="w-3 h-3" />
                                        <span>Thử lại chương này</span>
                                      </button>
                                    )}
                                    {ch.status === 'idle' && (
                                      <span className="text-[11px] text-slate-500 dark:text-slate-400">
                                        Chờ xử lý
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>

                          <div className="flex flex-wrap items-center gap-3 pt-2">
                            <WaterRippleButton
                              type="button"
                              disabled={
                                synthesizingChapters ||
                                outlineChapters.filter((c) => c.selected && c.status !== 'saved')
                                  .length === 0
                              }
                              onClick={() => void handleRunSequentialChapterSynthesis()}
                            >
                              {synthesizingChapters ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Sparkles className="w-4 h-4" />
                              )}
                              <span>
                                {synthesizingChapters
                                  ? 'Đang tổng hợp & lưu tuần tự từng chương...'
                                  : '2. Tổng hợp & Lưu tuần tự từng Chương'}
                              </span>
                            </WaterRippleButton>

                            {synthesizingChapters && (
                              <button
                                type="button"
                                onClick={() => synthAbortRef.current?.abort()}
                                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/50 text-xs font-semibold text-amber-800 dark:text-amber-200 cursor-pointer"
                              >
                                <PauseCircle className="w-4 h-4" />
                                <span>Tạm dừng & Giữ các chương đã lưu</span>
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* MODE 2: SMART CLIENT-SIDE PDF READER (Supports large PDFs & scanned PDFs) */}
                  {refInputMode === 'pdf' && (
                    <div className="rounded-2xl border border-sky-200/80 dark:border-sky-800/60 bg-sky-50/40 dark:bg-slate-900/50 p-4 sm:p-5 space-y-4">
                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                        <div className="sm:col-span-8">
                          <label className="block text-xs font-semibold text-[#16243E] dark:text-[#E6EFFC] mb-1">
                            Chọn tệp PDF SGK từ máy (Hỗ trợ cả PDF nặng 50–100MB & PDF scan ảnh)
                          </label>
                          <input
                            type="file"
                            accept="application/pdf"
                            required
                            disabled={ingestingRef}
                            onChange={(e) => void handleSelectPdfFile(e.target.files?.[0] || null)}
                            className={INPUT_CLASS}
                          />
                        </div>
                        <div className="sm:col-span-4">
                          <label className="block text-xs font-semibold text-[#16243E] dark:text-[#E6EFFC] mb-1">
                            Khoảng trang cần nạp{' '}
                            {pdfDetectedPages ? `(Tổng ${pdfDetectedPages} trang)` : ''}
                          </label>
                          <input
                            type="text"
                            disabled={ingestingRef}
                            value={pdfPageRangeInput}
                            onChange={(e) => setPdfPageRangeInput(e.target.value)}
                            placeholder={pdfDetectedPages ? `1-${pdfDetectedPages}` : 'Ví dụ: 1-120'}
                            className={`${INPUT_CLASS} font-mono`}
                          />
                        </div>
                      </div>

                      <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                        Trình duyệt sẽ tự động tách từng trang ngay trên máy bạn: trang có lớp chữ chuẩn được đọc tức thì (0 giây chờ mạng), trang scan ảnh sẽ tự nén nhẹ và gửi đọc OCR công thức bằng AI theo từng lô 3 trang.
                      </p>

                      {pdfProgress && (
                        <div className="rounded-2xl border border-sky-300/80 dark:border-sky-700/80 bg-white/90 dark:bg-slate-900/90 p-4 space-y-2.5 text-xs">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-semibold text-[#16243E] dark:text-[#E6EFFC]">
                              {pdfProgress.stageLabel}
                            </span>
                            <span className="font-mono font-semibold text-sky-700 dark:text-sky-300 tabular-nums">
                              {pdfProgress.processedPages}/{pdfProgress.totalTargetPages} trang (
                              {Math.min(
                                100,
                                Math.round(
                                  (pdfProgress.processedPages /
                                    Math.max(1, pdfProgress.totalTargetPages)) *
                                    100
                                )
                              )}
                              %)
                            </span>
                          </div>

                          <div className="h-2 w-full rounded-full bg-slate-200/80 dark:bg-slate-800 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-[#2563EB] dark:bg-[#3B82F6] transition-all duration-200"
                              style={{
                                width: `${Math.min(
                                  100,
                                  Math.round(
                                    (pdfProgress.processedPages /
                                      Math.max(1, pdfProgress.totalTargetPages)) *
                                      100
                                  )
                                )}%`,
                              }}
                            />
                          </div>

                          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600 dark:text-slate-300 font-mono">
                            <span>
                              Đọc text trực tiếp: <strong>{pdfProgress.directTextPages}</strong> trang ·
                              OCR AI trang scan: <strong>{pdfProgress.ocrPages}</strong> trang
                            </span>
                            <span>
                              Đã lưu Firestore: <strong>{pdfProgress.savedChunksCount}</strong> chunks (
                              {pdfProgress.detectedChapters.length} chương)
                            </span>
                          </div>
                        </div>
                      )}

                      <div className="flex flex-wrap items-center gap-3">
                        <WaterRippleButton type="submit" disabled={ingestingRef || !refFile}>
                          {ingestingRef ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <FileUp className="w-4 h-4" />
                          )}
                          <span>
                            {ingestingRef
                              ? 'Đang đọc PDF & lưu tuần tự vào kho chuẩn...'
                              : 'Bắt đầu đọc PDF thông minh & Lưu vào kho chuẩn'}
                          </span>
                        </WaterRippleButton>

                        {ingestingRef && (
                          <button
                            type="button"
                            onClick={() => pdfAbortRef.current?.abort()}
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/50 text-xs font-semibold text-amber-800 dark:text-amber-200 cursor-pointer"
                          >
                            <PauseCircle className="w-4 h-4" />
                            <span>Dừng lại & Giữ kết quả đã đọc</span>
                          </button>
                        )}
                      </div>
                    </div>
                  )}

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

                  {refInputMode === 'docx' && (
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Chọn tệp DOCX có lớp văn bản
                      </label>
                      <input
                        type="file"
                        accept="application/vnd.openxmlformats-officedocument.wordprocessingml.document"
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

                  {refInputMode !== 'ai_synthesize' && refInputMode !== 'pdf' && (
                    <WaterRippleButton type="submit" disabled={ingestingRef}>
                      {ingestingRef
                        ? 'Đang trích xuất & lập chỉ mục...'
                        : 'Lập chỉ mục & Lưu vào kho chuẩn'}
                    </WaterRippleButton>
                  )}
                </form>
              </GlassSurface>

              {/* INLINE CHUNK EDITOR */}
              {editingBook && (
                <GlassSurface className="rounded-3xl p-6 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-sky-200/60 dark:border-slate-700/70 pb-3">
                    <div>
                      <p className="text-xs font-semibold text-sky-700 dark:text-sky-400">
                        Chỉnh sửa trực tiếp các đoạn kiến thức (Chunks)
                      </p>
                      <h3 className="font-display text-base font-bold text-[#16243E] dark:text-[#E6EFFC]">
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
                          className="px-3 py-1.5 rounded-xl glass-control text-xs font-semibold cursor-pointer"
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
                          className="glass-panel-subtle rounded-2xl p-3.5 text-xs flex flex-col sm:flex-row sm:items-start justify-between gap-3"
                        >
                          <div className="space-y-1">
                            <p className="font-semibold text-[#16243E] dark:text-[#E6EFFC]">
                              {ch.chapter} · {ch.lesson} · Trang {ch.pageNumber} ({ch.sectionTitle})
                            </p>
                            <p className="text-slate-600 dark:text-slate-300 line-clamp-3">{ch.content}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setEditingChunk(ch)}
                            className="px-3 py-1.5 rounded-xl glass-control font-semibold shrink-0 cursor-pointer"
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
                    className="rounded-3xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                  >
                    <div>
                      <p className="text-sm font-bold text-[#16243E] dark:text-[#E6EFFC]">{book.title}</p>
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
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl glass-control font-semibold cursor-pointer"
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
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl glass-control cursor-pointer"
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

          {/* TAB 5: EXAM CENTER MANAGEMENT (SAMPLE EXAM IMPORT OR BLUEPRINT GENERATOR -> INLINE EDIT -> PUBLISH -> PRINT) */}
          {tab === 'exams' && (
            <div className="space-y-6">
              <div className="glass-segment rounded-2xl p-1.5 inline-flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setExamCreationMode('sample_import')}
                  className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer transition-all ${
                    examCreationMode === 'sample_import'
                      ? 'bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-white/60 dark:hover:bg-slate-800/60 hover:text-[#16243E] dark:hover:text-[#E6EFFC]'
                  }`}
                >
                  <FileUp className="w-3.5 h-3.5" />
                  Tải file đề mẫu (AI sao chép ABCD & Trả lời ngắn)
                </button>
                <button
                  type="button"
                  onClick={() => setExamCreationMode('raw_text_batch')}
                  className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer transition-all ${
                    examCreationMode === 'raw_text_batch'
                      ? 'bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-white/60 dark:hover:bg-slate-800/60 hover:text-[#16243E] dark:hover:text-[#E6EFFC]'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5" />
                  Tạo nhiều đề từ file chữ thô (0 tốn AI)
                </button>
                <button
                  type="button"
                  onClick={() => setExamCreationMode('blueprint')}
                  className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer transition-all ${
                    examCreationMode === 'blueprint'
                      ? 'bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-white/60 dark:hover:bg-slate-800/60 hover:text-[#16243E] dark:hover:text-[#E6EFFC]'
                  }`}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Hoặc lập Ma trận & AI tự sinh đề
                </button>
              </div>

              {examCreationMode === 'raw_text_batch' && (
                <GlassSurface className="rounded-3xl p-6 space-y-5">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold text-sky-700 dark:text-sky-400">
                        Chỉ dành cho Admin · Xử lý trực tiếp, không tốn lượt AI
                      </p>
                      <h2 className="font-display text-lg font-bold text-[#16243E] dark:text-[#E6EFFC] mt-0.5">
                        Tạo nhiều bộ đề từ tệp / văn bản câu hỏi &amp; đáp án thô
                      </h2>
                      <p className="text-xs text-[#475B78] dark:text-[#B4C7E2] mt-1 leading-[1.6]">
                        Hỗ trợ đủ 3 dạng GDPT 2018: ABCD rút gọn (<code className="font-mono">Câu hỏi:A:B:C:D:Đáp án</code> hoặc <code className="font-mono">*Đáp án</code>),
                        Đúng/Sai 4 ý (<code className="font-mono">[ĐS] ... | a)... | b)... | c)... | d)... : Đ-Đ-S-Đ</code>), Trả lời ngắn (<code className="font-mono">[TLN] ...:đáp số</code>) và bảng <code className="font-mono">.csv / .tsv</code>.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleInsertRawSample}
                      className="px-3 py-2 rounded-xl glass-control text-xs font-semibold shrink-0 cursor-pointer"
                    >
                      Chèn mẫu thử
                    </button>
                  </div>

                  {/* Metadata + Batch Controls */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Tên bộ đề gốc
                      </label>
                      <input
                        type="text"
                        value={examTitle}
                        onChange={(e) => setExamTitle(e.target.value)}
                        placeholder="VD: Đề ôn tập Chương 1 Hóa 10"
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
                        Cách tạo nhiều bộ đề
                      </label>
                      <select
                        value={rawBatchMode}
                        onChange={(e) => setRawBatchMode(e.target.value as BatchGenerationMode)}
                        className={INPUT_CLASS}
                      >
                        <option value="split_sequential">Chia lần lượt thành nhiều đề (không trùng câu)</option>
                        <option value="split_random">Xáo trộn rồi chia thành nhiều đề (không trùng)</option>
                        <option value="shuffle_variants">Tạo N bộ đề trộn câu &amp; đảo đáp án từ kho</option>
                        <option value="per_file">Mỗi tệp tải lên thành 1 bộ đề riêng</option>
                      </select>
                    </div>
                    {rawBatchMode !== 'per_file' && (
                      <div>
                        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                          Số câu mỗi đề (tối đa 60)
                        </label>
                        <input
                          type="number"
                          min={1}
                          max={60}
                          value={rawQuestionsPerExam}
                          onChange={(e) =>
                            setRawQuestionsPerExam(Math.max(1, Math.min(60, Number(e.target.value) || 10)))
                          }
                          className={INPUT_CLASS}
                        />
                      </div>
                    )}
                    {rawBatchMode === 'shuffle_variants' && (
                      <div>
                        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                          Số bộ đề muốn tạo (1–20)
                        </label>
                        <input
                          type="number"
                          min={1}
                          max={20}
                          value={rawBatchExamCount}
                          onChange={(e) =>
                            setRawBatchExamCount(Math.max(1, Math.min(20, Number(e.target.value) || 1)))
                          }
                          className={INPUT_CLASS}
                        />
                      </div>
                    )}
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Thời gian (phút) / Thang điểm
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="number"
                          min={5}
                          max={180}
                          value={examDuration}
                          onChange={(e) => setExamDuration(Math.max(5, Number(e.target.value) || 45))}
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
                  </div>

                  {/* Upload Multiple .txt / .md / .csv Files OR Paste Raw Text */}
                  <div
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const dropped = Array.from(e.dataTransfer.files || []);
                      if (dropped.length > 0) void handleRawTextFilesSelected(dropped);
                    }}
                    className="glass-panel-subtle rounded-2xl border-2 border-dashed border-sky-300/80 dark:border-sky-700/70 p-4 sm:p-5 space-y-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold text-[#16243E] dark:text-[#E6EFFC]">
                          Chọn 1 hoặc nhiều tệp chữ thô (.txt, .md, .csv) hoặc kéo thả vào đây
                        </p>
                        <p className="text-[11px] text-[#475B78] dark:text-[#B4C7E2] mt-0.5">
                          Có thể tải lên nhiều tệp đề cùng lúc, hoặc dán thẳng danh sách câu hỏi vào khung bên dưới.
                        </p>
                      </div>
                      <label className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 text-white text-xs font-semibold cursor-pointer shadow-sm hover:brightness-105">
                        <FileUp className="w-3.5 h-3.5" />
                        Chọn tệp chữ thô
                        <input
                          type="file"
                          multiple
                          accept=".txt,.md,.csv,.tsv,.log,text/plain"
                          className="hidden"
                          onChange={(e) => {
                            const list = Array.from(e.target.files || []);
                            if (list.length > 0) void handleRawTextFilesSelected(list);
                          }}
                        />
                      </label>
                    </div>

                    {rawTextFiles.length > 0 && (
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        {rawTextFiles.map((f, idx) => (
                          <span
                            key={`${f.fileName}_${idx}`}
                            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl glass-control"
                          >
                            <FileText className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                            <span>
                              {f.fileName} ({f.questions.length} câu)
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                const remaining = rawTextFiles.filter((_, fIdx) => fIdx !== idx);
                                setRawTextFiles(remaining);
                                setRawTextInput(
                                  remaining.map((item) => item.rawText.trim()).filter(Boolean).join('\n\n')
                                );
                              }}
                              className="text-rose-600 hover:text-rose-700 ml-1 cursor-pointer"
                              aria-label="Gỡ tệp"
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    )}

                    <textarea
                      rows={8}
                      value={rawTextInput}
                      onChange={(e) => {
                        setRawTextInput(e.target.value);
                        if (rawTextFiles.length > 0) setRawTextFiles([]);
                      }}
                      placeholder={'Ví dụ:\nCâu 1:Thủ đô Việt Nam là gì?:TP.HCM:*Hà Nội:Đà Nẵng:Huế\n[ĐS] Xét các mệnh đề:|a) Ý 1|b) Ý 2|c) Ý 3|d) Ý 4:Đ-Đ-S-Đ\n[TLN] Tính 15 x 4?:60 | 60,0'}
                      className={`${INPUT_CLASS} font-mono leading-relaxed`}
                    />

                    {/* Live Parse Stats */}
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono tabular-nums">
                        <span className="font-semibold text-sky-700 dark:text-sky-300">
                          Nhận diện: {rawParsedPreview.questions.length} câu
                        </span>
                        <span className="text-[#475B78] dark:text-[#B4C7E2]">
                          Trắc nghiệm ABCD: {rawParsedPreview.abcdCount} · Đúng/Sai 4 ý: {rawParsedPreview.trueFalseCount} · Trả lời ngắn: {rawParsedPreview.shortAnswerCount} · Có đáp án:{' '}
                          {rawParsedPreview.answeredCount}/{rawParsedPreview.questions.length}
                        </span>
                        {rawParsedPreview.questions.length - rawParsedPreview.answeredCount > 0 && (
                          <span className="font-semibold text-amber-700 dark:text-amber-300">
                            · Cần kiểm tra đáp án: {rawParsedPreview.questions.length - rawParsedPreview.answeredCount}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-4 text-xs text-slate-700 dark:text-slate-300">
                        <label className="inline-flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={rawShuffleOptions}
                            onChange={(e) => setRawShuffleOptions(e.target.checked)}
                          />
                          <span>Đảo thứ tự A/B/C/D</span>
                        </label>
                        <label className="inline-flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={rawAllowRetake}
                            onChange={(e) => setRawAllowRetake(e.target.checked)}
                          />
                          <span>Cho phép thi lại</span>
                        </label>
                        <label className="inline-flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={rawPublishImmediately}
                            onChange={(e) => setRawPublishImmediately(e.target.checked)}
                          />
                          <span>Xuất bản ngay cho HS</span>
                        </label>
                      </div>
                    </div>

                    {rawParsedPreview.warnings.length > 0 && rawTextInput.trim() && (
                      <div className="rounded-xl border border-amber-200 dark:border-amber-800/70 bg-amber-50/80 dark:bg-amber-950/35 px-3.5 py-2.5 text-[11px] text-amber-900 dark:text-amber-200 space-y-0.5">
                        <p className="font-semibold">Lưu ý định dạng ({rawParsedPreview.warnings.length}):</p>
                        {rawParsedPreview.warnings.slice(0, 4).map((w, wIdx) => (
                          <p key={wIdx}>• {w}</p>
                        ))}
                        {rawParsedPreview.warnings.length > 4 && (
                          <p>...và {rawParsedPreview.warnings.length - 4} lưu ý khác.</p>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-[11px] text-[#475B78] dark:text-[#B4C7E2]">
                      {rawBatchMode === 'split_sequential' || rawBatchMode === 'split_random'
                        ? `Dự kiến chia thành ${Math.max(1, Math.min(20, Math.ceil(rawParsedPreview.questions.length / Math.max(1, rawQuestionsPerExam))))} bộ đề.`
                        : rawBatchMode === 'per_file'
                        ? `Sẽ tạo ${rawTextFiles.filter((f) => f.questions.length > 0).length || 0} bộ đề theo từng tệp.`
                        : `Sẽ tạo ${rawBatchExamCount} bộ đề (tối đa ${Math.min(rawQuestionsPerExam, rawParsedPreview.questions.length)} câu/đề).`}
                    </p>
                    <WaterRippleButton
                      type="button"
                      disabled={rawParsedPreview.questions.length === 0}
                      onClick={handleGenerateRawBatch}
                    >
                      <ListChecks className="w-4 h-4" />
                      Tạo xem trước bộ đề
                    </WaterRippleButton>
                  </div>

                  {/* Batch Drafts Preview & One-Click Save All */}
                  {rawBatchDrafts.length > 0 && (
                    <div className="document-paper rounded-2xl p-5 space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-700 pb-3">
                        <div>
                          <p className="text-xs font-semibold text-sky-700 dark:text-sky-400">
                            Danh sách bộ đề chuẩn bị lưu ({rawBatchDrafts.length} bộ đề)
                          </p>
                          <p className="text-[11px] text-[#475B78] dark:text-[#B4C7E2] mt-0.5">
                            Bạn có thể sửa tên, bật/tắt xuất bản từng đề hoặc mở vào trình biên tập chi tiết trước khi lưu hàng loạt.
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setRawBatchDrafts([])}
                            className="px-3 py-1.5 rounded-xl glass-control text-xs font-semibold cursor-pointer"
                          >
                            Xóa danh sách
                          </button>
                          <WaterRippleButton
                            type="button"
                            size="sm"
                            disabled={savingRawBatch}
                            onClick={handleSaveAllRawBatch}
                          >
                            <Save className="w-3.5 h-3.5" />
                            {savingRawBatch
                              ? 'Đang lưu tất cả...'
                              : `Lưu tất cả ${rawBatchDrafts.length} bộ đề`}
                          </WaterRippleButton>
                        </div>
                      </div>

                      <div className="space-y-2.5 max-h-[420px] overflow-y-auto pr-1">
                        {rawBatchDrafts.map((draft, dIdx) => (
                          <div
                            key={draft.examId}
                            className="glass-panel-subtle rounded-2xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                          >
                            <div className="flex-1 min-w-0 space-y-1.5">
                              <input
                                type="text"
                                value={draft.title}
                                onChange={(e) =>
                                  setRawBatchDrafts((prev) =>
                                    prev.map((item) =>
                                      item.examId === draft.examId
                                        ? { ...item, title: e.target.value }
                                        : item
                                    )
                                  )
                                }
                                className="w-full font-display text-sm font-bold text-[#16243E] dark:text-[#E6EFFC] bg-transparent border-b border-sky-200/70 dark:border-slate-700 focus:outline-none focus:border-sky-500 pb-0.5"
                              />
                              <div className="flex flex-wrap items-center gap-3 text-[11px] text-[#475B78] dark:text-[#B4C7E2] font-mono tabular-nums">
                                <span>Đề #{dIdx + 1}</span>
                                <span>{draft.questions.length} câu</span>
                                <span>{draft.durationMinutes} phút</span>
                                <span>{draft.totalScore} điểm</span>
                                <span
                                  className={
                                    draft.validationStatus === 'passed'
                                      ? 'text-emerald-700 dark:text-emerald-400 font-semibold'
                                      : 'text-amber-700 dark:text-amber-400 font-semibold'
                                  }
                                >
                                  {draft.validationStatus === 'passed' ? 'Đủ đáp án' : 'Có câu thiếu đáp án'}
                                </span>
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 shrink-0">
                              <label className="inline-flex items-center gap-1.5 cursor-pointer px-2 py-1 rounded-lg glass-control">
                                <input
                                  type="checkbox"
                                  checked={draft.published}
                                  onChange={(e) =>
                                    setRawBatchDrafts((prev) =>
                                      prev.map((item) =>
                                        item.examId === draft.examId
                                          ? { ...item, published: e.target.checked }
                                          : item
                                      )
                                    )
                                  }
                                />
                                <span>Xuất bản</span>
                              </label>
                              <button
                                type="button"
                                onClick={() => {
                                  setActiveExamDraft(draft);
                                  setEditingExamQuestionId(null);
                                }}
                                className="px-2.5 py-1.5 rounded-xl glass-control font-semibold cursor-pointer"
                              >
                                Xem / Sửa từng câu
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setRawBatchDrafts((prev) =>
                                    prev.filter((item) => item.examId !== draft.examId)
                                  )
                                }
                                className="p-1.5 rounded-lg border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
                                aria-label="Bỏ bộ đề này"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </GlassSurface>
              )}

              {examCreationMode === 'sample_import' && (
                <GlassSurface className="rounded-3xl p-6 space-y-5">
                  <div>
                    <h2 className="font-display text-lg font-bold text-[#16243E] dark:text-[#E6EFFC]">
                      Tải file đề mẫu — AI sao chép Trắc nghiệm ABCD & Trả lời ngắn
                    </h2>
                    <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
                      Đưa file PDF, DOCX hoặc ảnh chụp các trang đề mẫu lên; AI sẽ giữ nguyên văn câu hỏi Trắc nghiệm 4 lựa chọn (ABCD) và Trả lời ngắn để bạn rà soát và xuất bản nhanh chóng.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Tiêu đề đề (tùy chọn — để trống sẽ lấy theo đề mẫu)
                      </label>
                      <input
                        type="text"
                        value={examTitle}
                        onChange={(e) => setExamTitle(e.target.value)}
                        placeholder="VD: Đề Giữa kỳ I Toán 10 - Đề số 1"
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
                          className="px-2.5 py-2 rounded-xl glass-control text-xs"
                        >
                          <option value="1">HK I</option>
                          <option value="2">HK II</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Thời gian (phút) / Thang điểm
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
                    <div className="flex items-end pb-1">
                      <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={includeTrueFalseInSample}
                          onChange={(e) => setIncludeTrueFalseInSample(e.target.checked)}
                        />
                        <span>Kèm cả phần Đúng/Sai (4 ý) nếu có</span>
                      </label>
                    </div>
                  </div>

                  <div
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const dropped = Array.from(e.dataTransfer.files || []);
                      if (dropped.length > 0) setSampleExamFiles(dropped);
                    }}
                    className="glass-panel-subtle rounded-2xl border-2 border-dashed border-sky-300/80 dark:border-sky-700/70 p-6 text-center space-y-3"
                  >
                    <FileUp className="w-8 h-8 text-sky-600 dark:text-sky-400 mx-auto" />
                    <div className="space-y-1">
                      <p className="text-xs font-semibold text-[#16243E] dark:text-[#E6EFFC]">
                        Kéo thả file đề mẫu vào đây (PDF, DOCX hoặc nhiều ảnh chụp trang đề)
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        Hỗ trợ trích xuất tối đa 60 câu hỏi mỗi đề. Không cần lập ma trận đề trước.
                      </p>
                    </div>
                    <label className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 text-white text-xs font-semibold cursor-pointer shadow-sm hover:brightness-105 transition-all">
                      <FileUp className="w-3.5 h-3.5" />
                      Chọn tệp đề mẫu
                      <input
                        type="file"
                        multiple
                        accept=".pdf,.docx,image/jpeg,image/png,image/webp"
                        className="hidden"
                        onChange={(e) => {
                          const list = Array.from(e.target.files || []);
                          if (list.length > 0) setSampleExamFiles(list);
                        }}
                      />
                    </label>

                    {sampleExamFiles.length > 0 && (
                      <div className="pt-2 flex flex-wrap items-center justify-center gap-2 text-xs">
                        {sampleExamFiles.map((f, idx) => (
                          <span
                            key={`${f.name}_${idx}`}
                            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl glass-panel-subtle text-[#16243E] dark:text-[#E6EFFC]"
                          >
                            <FileText className="w-3.5 h-3.5 text-sky-600" />
                            {f.name}
                            <button
                              type="button"
                              onClick={() =>
                                setSampleExamFiles((prev) => prev.filter((_, fIdx) => fIdx !== idx))
                              }
                              className="text-rose-500 hover:text-rose-700 ml-1 cursor-pointer"
                              aria-label="Bỏ tệp"
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      {includeTrueFalseInSample
                        ? 'Chế độ: Sao chép ABCD + Trả lời ngắn + Đúng/Sai 4 ý.'
                        : 'Chế độ mặc định: Chỉ sao chép Trắc nghiệm ABCD và Trả lời ngắn.'}
                    </p>
                    <WaterRippleButton
                      type="button"
                      disabled={importingSampleExam || sampleExamFiles.length === 0}
                      onClick={handleImportSampleExam}
                    >
                      {importingSampleExam ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Đang đọc & sao chép câu hỏi...
                        </>
                      ) : (
                        <>
                          <FileUp className="w-4 h-4" />
                          Tải lên & AI sao chép câu hỏi
                        </>
                      )}
                    </WaterRippleButton>
                  </div>
                </GlassSurface>
              )}

              {/* STEP 1: EXAM BLUEPRINT (SECONDARY MODE) */}
              {examCreationMode === 'blueprint' && (
              <GlassSurface className="rounded-3xl p-6 space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="font-display text-lg font-bold text-[#16243E] dark:text-[#E6EFFC]">
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
                        className="px-2.5 py-2 rounded-xl glass-control text-xs"
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
                      className="px-3 py-2 rounded-xl glass-control text-xs"
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
              )}

              {/* STEP 2: EXAM DRAFT REVIEW, INLINE EDITING, SINGLE QUESTION REWRITE & PUBLISH */}
              {activeExamDraft && (
                <GlassSurface className="rounded-3xl p-6 space-y-5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-700 pb-4">
                    <div>
                      <p className="text-xs font-semibold text-sky-700 dark:text-sky-400">
                        Biên tập & Kiểm duyệt Đề thi ({activeExamDraft.questions.length} câu · Tổng{' '}
                        {Math.round(activeExamDraft.questions.reduce((s, q) => s + (q.scoreWeight || 0), 0) * 100) / 100}
                        /{activeExamDraft.totalScore} điểm)
                      </p>
                      <input
                        type="text"
                        value={activeExamDraft.title}
                        onChange={(e) =>
                          setActiveExamDraft({ ...activeExamDraft, title: e.target.value })
                        }
                        className="font-display text-lg font-bold bg-transparent border-b border-slate-300 dark:border-slate-700 focus:outline-none mt-1 w-full sm:w-96"
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-2.5 text-xs">
                      <button
                        type="button"
                        onClick={handleRedistributeDraftScores}
                        className="px-2.5 py-1.5 rounded-xl glass-control font-semibold cursor-pointer"
                      >
                        Chia đều điểm
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAddManualDraftQuestion('abcd')}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl glass-control font-semibold cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Câu ABCD
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAddManualDraftQuestion('short_answer')}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl glass-control font-semibold cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Câu Trả lời ngắn
                      </button>
                      <label className="inline-flex items-center gap-1.5 cursor-pointer ml-1">
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

                  <div className="space-y-3 max-h-[620px] overflow-y-auto pr-1">
                    {activeExamDraft.questions.map((q) => {
                      const isEditing = editingExamQuestionId === q.questionId;
                      return (
                        <div key={q.questionId} className="document-paper rounded-2xl p-4 space-y-2.5 text-xs">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-semibold text-sky-700 dark:text-sky-400">
                              Câu {q.orderIndex} · {QUESTION_TYPE_LABELS[q.questionType]} ·{' '}
                              {COGNITIVE_LABELS[q.cognitiveLevel]} · {q.scoreWeight}đ
                            </span>
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={`font-semibold ${
                                  q.validationStatus === 'passed'
                                    ? 'text-emerald-700 dark:text-emerald-400'
                                    : 'text-amber-700 dark:text-amber-400'
                                }`}
                              >
                                {q.validationStatus === 'passed'
                                  ? 'Đạt chuẩn'
                                  : q.validationStatus === 'needs_review'
                                    ? 'Cần kiểm tra đáp án'
                                    : q.validationStatus}
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  setEditingExamQuestionId(isEditing ? null : q.questionId)
                                }
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl glass-control font-semibold cursor-pointer"
                              >
                                <Edit3 className="w-3 h-3 text-sky-600 dark:text-sky-400" />
                                {isEditing ? 'Xong' : 'Sửa tay'}
                              </button>
                              <button
                                type="button"
                                disabled={rewriteQuestionId === q.questionId}
                                onClick={() => handleRewriteExamQuestion(q)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl glass-control font-semibold cursor-pointer"
                              >
                                <Wand2 className="w-3 h-3 text-sky-600 dark:text-sky-400" />
                                {rewriteQuestionId === q.questionId ? 'Đang viết lại...' : 'AI viết lại câu này'}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteDraftQuestion(q.questionId)}
                                className="p-1.5 rounded-lg border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
                                aria-label="Xóa câu hỏi"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          </div>

                          {isEditing ? (
                            <div className="space-y-2.5 pt-1">
                              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                                <div className="sm:col-span-3">
                                  <label className="block text-[11px] text-slate-500 mb-1">Nội dung câu hỏi</label>
                                  <textarea
                                    rows={2}
                                    value={q.questionText}
                                    onChange={(e) =>
                                      handleUpdateDraftQuestion(q.questionId, { questionText: e.target.value })
                                    }
                                    className={INPUT_CLASS}
                                  />
                                </div>
                                <div>
                                  <label className="block text-[11px] text-slate-500 mb-1">Điểm câu này</label>
                                  <input
                                    type="number"
                                    step="0.05"
                                    min={0.05}
                                    value={q.scoreWeight}
                                    onChange={(e) =>
                                      handleUpdateDraftQuestion(q.questionId, {
                                        scoreWeight: Math.max(0.05, Number(e.target.value) || 0.25),
                                      })
                                    }
                                    className={INPUT_CLASS}
                                  />
                                </div>
                              </div>

                              {q.questionType === 'abcd' && (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                  {(['A', 'B', 'C', 'D'] as const).map((letter) => {
                                    const field = `option${letter}` as 'optionA' | 'optionB' | 'optionC' | 'optionD';
                                    return (
                                      <div key={letter} className="flex items-center gap-1.5">
                                        <span className="font-bold w-5 shrink-0">{letter}.</span>
                                        <input
                                          type="text"
                                          value={q[field] || ''}
                                          onChange={(e) =>
                                            handleUpdateDraftQuestion(q.questionId, { [field]: e.target.value })
                                          }
                                          className={INPUT_CLASS}
                                        />
                                      </div>
                                    );
                                  })}
                                  <div className="sm:col-span-2 flex items-center gap-2">
                                    <span className="text-[11px] font-semibold">Đáp án đúng:</span>
                                    <select
                                      value={q.correctAnswer || 'A'}
                                      onChange={(e) =>
                                        handleUpdateDraftQuestion(q.questionId, {
                                          correctAnswer: e.target.value as 'A' | 'B' | 'C' | 'D',
                                          validationStatus: 'passed',
                                        })
                                      }
                                      className="px-2.5 py-1 rounded-lg glass-control font-semibold"
                                    >
                                      <option value="A">A</option>
                                      <option value="B">B</option>
                                      <option value="C">C</option>
                                      <option value="D">D</option>
                                    </select>
                                  </div>
                                </div>
                              )}

                              {q.questionType === 'short_answer' && (
                                <div>
                                  <label className="block text-[11px] text-slate-500 mb-1">
                                    Các đáp án chấp nhận (cách nhau bằng dấu | , ví dụ: 0.5 | 0,5)
                                  </label>
                                  <input
                                    type="text"
                                    value={(q.shortAnswerAccepted || []).join(' | ')}
                                    onChange={(e) =>
                                      handleUpdateDraftQuestion(q.questionId, {
                                        shortAnswerAccepted: e.target.value
                                          .split('|')
                                          .map((s) => s.trim())
                                          .filter(Boolean),
                                        validationStatus: 'passed',
                                      })
                                    }
                                    className={INPUT_CLASS}
                                  />
                                </div>
                              )}

                              <div>
                                <label className="block text-[11px] text-slate-500 mb-1">Giải thích</label>
                                <input
                                  type="text"
                                  value={q.explanation}
                                  onChange={(e) =>
                                    handleUpdateDraftQuestion(q.questionId, { explanation: e.target.value })
                                  }
                                  className={INPUT_CLASS}
                                />
                              </div>
                            </div>
                          ) : (
                            <>
                              <p className="text-sm font-medium">{q.questionText}</p>
                              {q.questionType === 'abcd' && (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-slate-600 dark:text-slate-300">
                                  <p className={q.correctAnswer === 'A' ? 'font-bold text-emerald-700 dark:text-emerald-400' : ''}>
                                    A. {q.optionA}
                                  </p>
                                  <p className={q.correctAnswer === 'B' ? 'font-bold text-emerald-700 dark:text-emerald-400' : ''}>
                                    B. {q.optionB}
                                  </p>
                                  <p className={q.correctAnswer === 'C' ? 'font-bold text-emerald-700 dark:text-emerald-400' : ''}>
                                    C. {q.optionC}
                                  </p>
                                  <p className={q.correctAnswer === 'D' ? 'font-bold text-emerald-700 dark:text-emerald-400' : ''}>
                                    D. {q.optionD}
                                  </p>
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
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </GlassSurface>
              )}

              {/* SAVED EXAMS LIST */}
              <GlassSurface className="rounded-3xl p-6 space-y-4">
                <h3 className="font-display text-base font-bold text-[#16243E] dark:text-[#E6EFFC]">
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
                        className="glass-panel-subtle rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                      >
                        <div>
                          <p className="text-sm font-bold text-[#16243E] dark:text-[#E6EFFC]">{ex.title}</p>
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
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl glass-control font-semibold cursor-pointer"
                          >
                            <Printer className="w-3.5 h-3.5" />
                            Xuất Mã đề 101/102/103
                          </button>
                          <button
                            type="button"
                            onClick={() => setActiveExamDraft(ex)}
                            className="px-2.5 py-1.5 rounded-xl glass-control font-semibold cursor-pointer"
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
                            className="px-2.5 py-1.5 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 text-white font-semibold shadow-sm hover:brightness-105 cursor-pointer"
                          >
                            {ex.published ? 'Ẩn đề' : 'Xuất bản'}
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              await deleteExamDocument(ex.examId);
                              setExams((prev) => prev.filter((item) => item.examId !== ex.examId));
                            }}
                            className="p-1.5 rounded-xl border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
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
                    <h2 className="font-display text-base font-bold text-[#16243E] dark:text-[#E6EFFC]">
                      Hộp thư phản hồi sai sót từ học sinh ({feedbackList.length})
                    </h2>
                  </div>
                  <select
                    value={feedbackFilter}
                    onChange={(e) => setFeedbackFilter(e.target.value as any)}
                    className="px-3 py-1.5 rounded-xl glass-control text-xs"
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
                          className="glass-panel-subtle rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                        >
                          <div className="space-y-1">
                            <p className="font-semibold text-[#16243E] dark:text-[#E6EFFC]">
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
                            className="px-3 py-1.5 rounded-xl glass-control font-semibold shrink-0"
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
                  <h2 className="font-display text-base font-bold text-[#16243E] dark:text-[#E6EFFC]">
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
                      className="glass-panel-subtle rounded-2xl px-4 py-2.5 flex items-center justify-between gap-3 text-xs"
                    >
                      <div>
                        <p className="font-mono font-semibold text-[#16243E] dark:text-[#E6EFFC]">{adm.uid}</p>
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
              <GlassSurface className="rounded-3xl p-6 space-y-4">
                <h2 className="font-display text-base font-bold text-[#16243E] dark:text-[#E6EFFC]">
                  Danh sách tài khoản học sinh ({users.length})
                </h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-sky-200/60 dark:border-slate-700/70 text-slate-500 dark:text-slate-400">
                      <tr>
                        <th className="py-2 pr-4">Tên hiển thị</th>
                        <th className="py-2 pr-4">Email</th>
                        <th className="py-2 pr-4">Lớp</th>
                        <th className="py-2 pr-4">Đăng nhập gần nhất</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-sky-200/40 dark:divide-slate-800">
                      {users.map((u) => (
                        <tr key={u.uid}>
                          <td className="py-2.5 pr-4 font-semibold text-[#16243E] dark:text-[#E6EFFC]">{u.displayName}</td>
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
                <h2 className="font-display text-lg font-bold text-[#16243E] dark:text-[#E6EFFC]">
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

              <GlassSurface className="rounded-3xl p-6 space-y-4">
                <h2 className="font-display text-base font-bold text-[#16243E] dark:text-[#E6EFFC]">
                  Nhật ký kiểm toán quản trị ({auditLogs.length})
                </h2>
                <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
                  {auditLogs.map((log) => (
                    <div
                      key={log.logId}
                      className="glass-panel-subtle rounded-2xl p-3.5 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                    >
                      <div>
                        <p className="font-mono font-semibold text-[#16243E] dark:text-[#E6EFFC]">
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
