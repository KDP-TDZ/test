export type GradeLevel = '10' | '11' | '12';

export type SubjectId =
  | 'toan'
  | 'vat_ly'
  | 'hoa_hoc'
  | 'sinh_hoc'
  | 'ngu_van'
  | 'lich_su'
  | 'dia_ly'
  | 'tieng_anh'
  | 'tin_hoc'
  | 'gdkt_pl'
  | 'khac';

export const SUBJECT_LABELS: Record<SubjectId, string> = {
  toan: 'Toán học',
  vat_ly: 'Vật lý',
  hoa_hoc: 'Hóa học',
  sinh_hoc: 'Sinh học',
  ngu_van: 'Ngữ văn',
  lich_su: 'Lịch sử',
  dia_ly: 'Địa lý',
  tieng_anh: 'Tiếng Anh',
  tin_hoc: 'Tin học',
  gdkt_pl: 'Giáo dục Kinh tế & Pháp luật',
  khac: 'Môn học khác',
};

export const TEXTBOOK_SERIES_OPTIONS = [
  'Kết nối tri thức với cuộc sống',
  'Chân trời sáng tạo',
  'Cánh Diều',
  'Chương trình GDPT 2018 (Chung)',
] as const;

export type ClaimStatus =
  | 'CORRECT'
  | 'PARTIALLY_CORRECT'
  | 'INCORRECT'
  | 'MISSING'
  | 'UNVERIFIED'
  | 'AMBIGUOUS'
  | 'OCR_UNCERTAIN'
  | 'OUT_OF_SCOPE';

export type ImportanceLevel = 'core' | 'supporting' | 'detail';

export type CoverageStatus = 'COVERED' | 'PARTIALLY_COVERED' | 'MISSING' | 'OUT_OF_SCOPE';

export type AnalysisStage =
  | 'queued'
  | 'uploading'
  | 'extracting'
  | 'awaiting_ocr_confirmation'
  | 'retrieving_references'
  | 'verifying'
  | 'calculating'
  | 'generating_report'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type ConfidenceLevel = 'Cao' | 'Trung bình' | 'Thấp' | 'Chưa đủ dữ liệu đánh giá';

export type MasteryStatus =
  | 'Đã tiếp cận'
  | 'Đã học qua'
  | 'Đang củng cố'
  | 'Cần ôn tập'
  | 'Tạm nắm vững';

export type KnowledgeUnitType =
  | 'concept'
  | 'mechanism'
  | 'condition'
  | 'characteristic'
  | 'formula'
  | 'problem_type';

export interface NormalizedBoundingBox {
  x: number; // 0..1
  y: number; // 0..1
  width: number; // 0..1
  height: number; // 0..1
}

export interface ExtractedTextBlock {
  blockId: string;
  pageNumber: number;
  extractedText: string;
  textType: 'paragraph' | 'heading' | 'formula' | 'table' | 'list' | 'handwriting';
  boundingBox?: NormalizedBoundingBox | null;
  confidence: number; // 0..1
  readingOrder: number;
  formulaText?: string;
}

export interface ExtractedPage {
  pageNumber: number;
  width?: number;
  height?: number;
  imageUrl?: string;
  rawText: string;
  blocks: ExtractedTextBlock[];
  ocrAverageConfidence: number;
}

export interface ReferenceEvidence {
  evidenceId: string;
  sourceType: 'textbook' | 'web';
  referenceId?: string;
  chunkId?: string;
  title: string;
  chapter?: string;
  lesson?: string;
  pageNumber?: number;
  excerpt: string;
  url?: string;
  domain?: string;
  publisher?: string;
  publishedDate?: string;
  accessedAt?: string;
  relevance?: number;
}

export interface ExtractedClaim {
  claimId: string;
  sourceText: string;
  normalizedMeaning: string;
  subject: SubjectId;
  chapter: string;
  concept: string;
  importanceLevel: ImportanceLevel;
  importanceWeight: 1 | 2 | 3;
  sourcePage: number;
  blockId?: string;
  blockIds?: string[];
  errorSpan?: string;
  shortFix?: string;
  boundingBox?: NormalizedBoundingBox | null;
  ocrConfidence: number;
  knowledgeType: 'textbook_core' | 'advanced_extension' | 'insufficient_evidence';
  evaluationStatus: ClaimStatus;
  explanation: string;
  correctKnowledge: string;
  reason?: string;
  suggestedFix?: string;
  evidences: ReferenceEvidence[];
}

export type RubricMode = 'fixed_textbook_rubric' | 'scope_guided' | 'unscoped';

export interface RubricCriterion {
  criterionId: string;
  concept: string;
  chapter: string;
  lesson?: string;
  importanceWeight: 1 | 2 | 3;
  referenceChunkId: string;
  referencePage?: number;
  referenceExcerpt: string;
  expectedKeywords: string[];
}

export interface FixedRubric {
  rubricId: string;
  rubricHash: string;
  rubricMode: RubricMode;
  subject: SubjectId;
  grade: GradeLevel;
  textbookReferenceId: string;
  textbookTitle: string;
  selectedChapters: string[];
  criteria: RubricCriterion[];
  totalRequiredWeight: number;
}

export interface GradingAuditMetadata {
  requestedModel: string;
  actualModel: string;
  usedFallback: boolean;
  usedOverride: boolean;
  cached: boolean;
  strictModelLock: boolean;
  systemFingerprint?: string;
  promptVersion: string;
  configVersion: number;
  inputHash: string;
  ocrTextHash: string;
  ocrConfirmed: boolean;
  rubricMode: RubricMode;
  rubricHash?: string;
  rubricItemCount: number;
  extraCoverageCount: number;
  chunkIds: string[];
  truncationApplied: boolean;
  studentCharCount: number;
  textbookCharCount: number;
  webGroundingEnabled: boolean;
  deterministicSeed: number;
}

export interface KnowledgeCoverageItem {
  itemId: string;
  criterionId?: string;
  concept: string;
  chapter: string;
  lesson?: string;
  importanceWeight: 1 | 2 | 3;
  status: CoverageStatus;
  suggestedAddition: string;
  referenceExcerpt: string;
  referencePage?: number;
  matchedChunkId?: string;
}

export interface AnnotationItem {
  annotationId: string;
  pageNumber: number;
  blockId?: string;
  blockIds?: string[];
  textExcerpt: string;
  errorSpan?: string;
  claimId: string;
  referenceId?: string;
  boundingBox?: NormalizedBoundingBox | null;
  annotationColor: 'red' | 'orange' | 'yellow' | 'green';
  reason: string;
  evidenceId?: string;
}

export interface AnalysisStrength {
  title: string;
  detail: string;
  sourceExcerpt: string;
  pageNumber: number;
}

export interface AnalysisWeakness {
  title: string;
  category: 'knowledge_error' | 'missing_content' | 'partial_condition' | 'unverified' | 'presentation';
  detail: string;
  claimId?: string;
  pageNumber?: number;
}

export interface ImprovementSuggestion {
  priority: number;
  actionType: 'fix_error' | 'add_missing' | 'review_partial' | 'practice_weak' | 'explore_extension';
  title: string;
  description: string;
  relatedClaimId?: string;
}

export interface AccuracyBreakdown {
  accuracyScore: number | null;
  verifiedWeight: number;
  earnedWeight: number;
  totalClaimWeight: number;
  evidenceCoverage: number | null;
  confidenceLevel: ConfidenceLevel;
  confidenceReason: string;
  counts: {
    total: number;
    correct: number;
    partiallyCorrect: number;
    incorrect: number;
    missing: number;
    unverified: number;
    ambiguous: number;
    ocrUncertain: number;
    outOfScope: number;
  };
  gradingAudit?: GradingAuditMetadata;
}

export interface CompletenessBreakdown {
  completenessScore: number | null;
  coveredWeight: number;
  totalRequiredWeight: number;
  missingCount: number;
  partialCount: number;
  coveredCount: number;
  rubricMode?: RubricMode;
  rubricItemCount?: number;
  extraObservationsCount?: number;
}

export interface AnalysisRecord {
  analysisId: string;
  ownerUid: string;
  documentTitle: string;
  originalFileName: string;
  mimeType: string;
  storagePath: string;
  storageDownloadUrl?: string;
  grade: GradeLevel;
  subject: SubjectId;
  textbookReferenceId: string;
  textbookTitle: string;
  textbookVersion?: string;
  selectedChapters: string[];
  scope: string;
  analysisStatus: AnalysisStage;
  statusMessage?: string;
  extractedPages: ExtractedPage[];
  claims: ExtractedClaim[];
  coverageItems: KnowledgeCoverageItem[];
  annotations: AnnotationItem[];
  accuracyScore: number | null;
  completenessScore: number | null;
  evidenceCoverage: number | null;
  confidenceLevel: ConfidenceLevel;
  confidenceReason: string;
  accuracyBreakdown?: AccuracyBreakdown;
  completenessBreakdown?: CompletenessBreakdown;
  strengths: AnalysisStrength[];
  weaknesses: AnalysisWeakness[];
  suggestions: ImprovementSuggestion[];
  webSources: ReferenceEvidence[];
  usedWebGrounding: boolean;
  webGroundingNotice?: string;
  jobId?: string;
  modelUsed?: string;
  createdAt: string;
  updatedAt: string;
}

export type KnowledgeSourceType =
  | 'official_curriculum'
  | 'textbook_reference'
  | 'teacher_material'
  | 'supplementary_material'
  | 'public_exam_reference'
  | 'external_extension';

export type SourceLicenseStatus =
  | 'Admin tự biên soạn'
  | 'Có sự cho phép của chủ sở hữu'
  | 'Có giấy phép mở phù hợp'
  | 'Chỉ được tham chiếu nội bộ'
  | 'Chưa xác minh';

export interface ReferenceBook {
  referenceId: string;
  title: string;
  grade: GradeLevel;
  subject: SubjectId;
  textbookSeries: string;
  publisher: string;
  editionYear: string;
  description: string;
  sourceType: 'url' | 'upload' | 'text' | 'json';
  knowledgeSourceType?: KnowledgeSourceType;
  licenseStatus?: SourceLicenseStatus;
  sourceUrl?: string;
  storagePath?: string;
  chapters: string[];
  chunkCount: number;
  status: 'active' | 'paused';
  indexStatus: 'indexed' | 'processing' | 'failed';
  indexError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReferenceChunk {
  chunkId: string;
  referenceId: string;
  grade: GradeLevel;
  subject: SubjectId;
  textbookSeries: string;
  chapter: string;
  lesson: string;
  pageNumber: number;
  sectionTitle: string;
  content: string;
  keywords: string[];
  learningObjectives: string[];
  conceptTags: string[];
}

export type QuizDifficulty = 'basic' | 'medium' | 'advanced' | 'mixed';
export type QuizScope = 'all' | 'incorrect' | 'missing' | 'partial' | 'chapter';
export type CognitiveLevel = 'nhan_biet' | 'thong_hieu' | 'van_dung' | 'van_dung_cao';

export interface DistractorExplanations {
  A?: string;
  B?: string;
  C?: string;
  D?: string;
}

export interface QuizQuestion {
  questionId: string;
  questionText: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  correctAnswer: 'A' | 'B' | 'C' | 'D';
  explanation: string;
  distractorExplanations?: DistractorExplanations;
  difficulty: 'basic' | 'medium' | 'advanced';
  cognitiveLevel?: CognitiveLevel;
  knowledgeUnitType?: KnowledgeUnitType;
  subject: SubjectId;
  grade: GradeLevel;
  chapter: string;
  concept: string;
  sourceReference: string;
  sourcePage?: number;
  sourceType?: KnowledgeSourceType;
  modelId?: string;
  promptVersion?: string;
  validationStatus?: 'passed' | 'repaired' | 'needs_review' | 'rejected';
  validationIssues?: string[];
  isExternalAdvanced?: boolean;
  relatedClaimId?: string;
  createdAt: string;
}

export interface QuizSet {
  quizSetId: string;
  ownerUid: string;
  analysisId: string;
  title: string;
  subject: SubjectId;
  grade: GradeLevel;
  difficulty: QuizDifficulty;
  scope: QuizScope;
  questionCount: number;
  requestedCount?: number;
  advancedEnabled?: boolean;
  advancedCount?: number;
  supplementedFromTextbook?: boolean;
  supplementNotice?: string;
  modelUsed?: string;
  questions: QuizQuestion[];
  createdAt: string;
}

export interface PracticeItem {
  itemId: string;
  questionId: string;
  ownerUid: string;
  questionText: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  correctAnswer: 'A' | 'B' | 'C' | 'D';
  explanation: string;
  distractorExplanations?: DistractorExplanations;
  sourceReference: string;
  subject: SubjectId;
  grade: GradeLevel;
  chapter: string;
  concept: string;
  difficulty: 'basic' | 'medium' | 'advanced';
  cognitiveLevel?: CognitiveLevel;
  knowledgeUnitType?: KnowledgeUnitType;
  flaggedForReview?: boolean;
  reviewStage?: 0 | 1 | 2 | 3;
  reviewIntervalDays?: number;
  nextReviewAt?: string;
  attemptCount: number;
  correctCount: number;
  incorrectCount: number;
  lastAttemptAt: string;
  lastResult: 'correct' | 'incorrect';
  masteryStatus: MasteryStatus;
  createdAt: string;
}

export interface FlashcardItem {
  flashcardId: string;
  ownerUid: string;
  front: string;
  back: string;
  sourceReference: string;
  sourcePage?: number;
  subject: SubjectId;
  grade: GradeLevel;
  chapter: string;
  concept: string;
  cardType: 'concept' | 'formula' | 'condition' | 'mistake_fix' | 'example';
  masteryStatus: 'Mới tạo' | 'Đang ôn' | 'Đã nhớ';
  reviewStage?: 0 | 1 | 2 | 3;
  nextReviewAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeProgress {
  conceptId: string;
  conceptTitle: string;
  subjectId: SubjectId;
  grade: GradeLevel;
  chapterId: string;
  lesson?: string;
  textbookReferenceId?: string;
  textbookTitle?: string;
  encounteredCount: number;
  practiceAttemptCount: number;
  correctAttempts: number;
  incorrectAttempts: number;
  recentResults: boolean[]; // chronological up to last 10
  sessionIds: string[];
  recentAccuracy: number | null;
  masteryStatus: MasteryStatus;
  lastMistakeNote?: string;
  firstSeenAt: string;
  lastAttemptAt?: string;
  updatedAt: string;
}

export interface QuizAttempt {
  attemptId: string;
  uid: string;
  questionId: string;
  quizSetId: string;
  conceptId: string;
  conceptTitle: string;
  subjectId: SubjectId;
  chapterId: string;
  selectedAnswer: 'A' | 'B' | 'C' | 'D';
  correctAnswer: 'A' | 'B' | 'C' | 'D';
  isCorrect: boolean;
  attemptedAt: string;
  sessionId: string;
}

// --- Exam Center & Đua Top Leaderboard ---
export type ExamType =
  | 'giua_ky_1'
  | 'cuoi_ky_1'
  | 'giua_ky_2'
  | 'cuoi_ky_2'
  | 'on_tap_tong_hop';

export const EXAM_TYPE_LABELS: Record<ExamType, string> = {
  giua_ky_1: 'Đề kiểm tra Giữa kỳ I',
  cuoi_ky_1: 'Đề kiểm tra Cuối kỳ I',
  giua_ky_2: 'Đề kiểm tra Giữa kỳ II',
  cuoi_ky_2: 'Đề kiểm tra Cuối kỳ II',
  on_tap_tong_hop: 'Đề ôn tập tổng hợp',
};

export type ExamQuestionType = 'abcd' | 'true_false' | 'short_answer';

export interface ExamBlueprintRow {
  rowId: string;
  chapter: string;
  topic: string;
  cognitiveLevel: CognitiveLevel;
  questionType: ExamQuestionType;
  questionCount: number;
  scorePerQuestion: number;
  learningOutcome: string;
}

export interface ExamBlueprint {
  blueprintId: string;
  title: string;
  grade: GradeLevel;
  subject: SubjectId;
  textbookSeries: string;
  examType: ExamType;
  academicYear: string;
  semester: '1' | '2';
  chapters: string[];
  durationMinutes: number;
  totalScore: number;
  cognitiveDistribution: Record<CognitiveLevel, number>;
  rows: ExamBlueprintRow[];
  status: 'draft' | 'approved';
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface TrueFalseStatement {
  label: 'a' | 'b' | 'c' | 'd';
  text: string;
  isTrue: boolean;
}

export interface ExamQuestion {
  questionId: string;
  orderIndex: number;
  chapterId: string;
  conceptId: string;
  learningOutcome: string;
  cognitiveLevel: CognitiveLevel;
  questionType: ExamQuestionType;
  scoreWeight: number;
  questionText: string;
  optionA?: string;
  optionB?: string;
  optionC?: string;
  optionD?: string;
  correctAnswer?: 'A' | 'B' | 'C' | 'D';
  trueFalseStatements?: TrueFalseStatement[];
  shortAnswerAccepted?: string[];
  explanation: string;
  distractorExplanations?: DistractorExplanations;
  sourceReference: string;
  sourceType: KnowledgeSourceType;
  validationStatus: 'passed' | 'repaired' | 'needs_review' | 'rejected';
  validationIssues?: string[];
}

export interface ExamDocument {
  examId: string;
  blueprintId: string;
  title: string;
  description: string;
  grade: GradeLevel;
  subject: SubjectId;
  textbookSeries: string;
  examType: ExamType;
  academicYear: string;
  semester: '1' | '2';
  chapters: string[];
  durationMinutes: number;
  totalScore: number;
  allowRetake: boolean;
  published: boolean;
  validationStatus: 'passed' | 'repaired' | 'needs_review';
  questions: ExamQuestion[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExamQuestionAnswer {
  questionId: string;
  selectedOption?: 'A' | 'B' | 'C' | 'D';
  trueFalseChoices?: Partial<Record<'a' | 'b' | 'c' | 'd', boolean>>;
  shortAnswerText?: string;
}

export interface ExamAttemptBreakdownItem {
  questionId: string;
  questionType: ExamQuestionType;
  earnedScore: number;
  maxScore: number;
  isFullCorrect: boolean;
  correctDisplay: string;
  studentDisplay: string;
}

export interface ExamAttempt {
  attemptId: string;
  examId: string;
  examTitle: string;
  uid: string;
  displayName: string;
  grade: GradeLevel;
  subject: SubjectId;
  examType: ExamType;
  answers: ExamQuestionAnswer[];
  earnedScore: number;
  maxScore: number;
  percentScore: number;
  leaderboardPointsAwarded: number;
  durationSpentSeconds: number;
  breakdown: ExamAttemptBreakdownItem[];
  submittedAt: string;
}

export interface LeaderboardEntry {
  uid: string;
  displayName: string;
  grade: GradeLevel;
  totalScore: number;
  examCount: number;
  bestExamScore: number;
  averagePercent: number;
  awardedExamScores: Record<string, number>;
  updatedAt: string;
}

export interface FeedbackEntry {
  feedbackId: string;
  ownerUid: string;
  ownerEmail?: string;
  targetType: 'claim' | 'quiz_question' | 'exam_question';
  targetId: string;
  analysisId?: string;
  category:
    | 'Đáp án đúng nhưng bị đánh dấu sai'
    | 'Thiếu dẫn chứng'
    | 'Giải thích chưa đúng'
    | 'Ngoài phạm vi'
    | 'Câu hỏi sai kiến thức'
    | 'Đáp án gây nhiễu lỗi'
    | 'Khó hiểu';
  note: string;
  status: 'pending' | 'reviewed' | 'resolved';
  aiClassification?: string;
  createdAt: string;
  updatedAt: string;
}

// --- AI Model Router, Jobs & System Config ---
export type AiTaskType =
  | 'subject_classification'
  | 'curriculum_extraction'
  | 'knowledge_analysis'
  | 'completeness_analysis'
  | 'claim_validation'
  | 'quiz_blueprint'
  | 'quiz_generation'
  | 'quiz_validation'
  | 'answer_explanation'
  | 'flashcard_generation'
  | 'feedback_analysis';

export const AI_TASK_LABELS: Record<AiTaskType, string> = {
  subject_classification: 'Phân loại môn học & lớp',
  curriculum_extraction: 'OCR & trích xuất nội dung học tập',
  knowledge_analysis: 'Phân tích & kiểm định kiến thức',
  completeness_analysis: 'Đánh giá độ bao phủ kiến thức',
  claim_validation: 'Xác minh & đối chiếu mệnh đề',
  quiz_blueprint: 'Lập ma trận đề & kế hoạch câu hỏi',
  quiz_generation: 'Sinh câu hỏi trắc nghiệm & đề thi',
  quiz_validation: 'Kiểm định chất lượng câu hỏi',
  answer_explanation: 'Giải thích đáp án & phương án nhiễu',
  flashcard_generation: 'Tạo Flashcard ôn tập',
  feedback_analysis: 'Phân loại phản hồi người dùng',
};

export interface TaskModelConfig {
  defaultModel: string;
  fallbackModel: string;
  enableFallback: boolean;
  oneTimeOverrideModel?: string | null;
  promptVersion: string;
}

export interface AiExecutionLog {
  executionId: string;
  taskType: AiTaskType;
  modelId: string;
  requestedModel?: string;
  actualModel?: string;
  systemFingerprint?: string;
  usedFallback: boolean;
  usedOverride: boolean;
  promptVersion: string;
  configVersion: number;
  status: 'success' | 'failed';
  error?: string;
  durationMs: number;
  cached?: boolean;
  timestamp: string;
}

export interface AiJobRecord {
  jobId: string;
  ownerUid: string;
  jobType: 'ocr_extract' | 'analysis_verify' | 'quiz_generate' | 'exam_generate';
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'paused' | 'cancelled';
  currentStage: string;
  stagesCompleted: string[];
  configVersion: number;
  inputHash?: string;
  resultSummary?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RateLimitConfig {
  requestsPerMinute: number;
  requestsPerHour: number;
  analysesPerDay: number;
  cooldownSeconds: number;
  maximumConcurrentJobs: number;
  maximumPagesPerAnalysis: number;
  maximumFileSizeMb: number;
}

export interface SystemAiConfig {
  enabled: boolean;
  disabledReason: string;
  maintenanceMessage: string;
  updatedAt: string;
  updatedBy: string;
  rateLimitConfig: RateLimitConfig;
  activeModel: string;
  configVersion: number;
  allowedOrigins: string[];
  taskModels: Record<AiTaskType, TaskModelConfig>;
}

export type KeyTestStatus =
  | 'Connected'
  | 'Invalid key'
  | 'API not enabled'
  | 'Quota exceeded'
  | 'Permission denied'
  | 'Model unavailable'
  | 'Temporary provider error'
  | 'Untested';

export interface SingleApiKeyStatus {
  configured: boolean;
  source: 'admin' | 'server_env' | 'none';
  maskedKey: string;
  label: string;
  hasEnvFallbackKey: boolean;
  lastTestStatus: KeyTestStatus;
  lastTestAt?: string;
  lastTestMessage?: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface CloudflareKeyStatus extends SingleApiKeyStatus {
  maskedAccountId: string;
}

export interface ProviderKeysStatus {
  groq: SingleApiKeyStatus;
  cloudflare: CloudflareKeyStatus;
}

export interface ColdStartProviderReadiness {
  provider: 'groq' | 'gemini' | 'cloudflare';
  label: string;
  envVarNames: string[];
  envConfigured: boolean;
  adminOverrideActive: boolean;
  configuredNow: boolean;
  survivesColdStartWhenAdminOffline: boolean;
}

export interface ColdStartReadinessReport {
  overallStatus: 'ready_24_7' | 'partial_risk' | 'at_risk';
  runtimePlatform: 'vercel' | 'render' | 'standard';
  activeModel: string;
  activeProvider: 'groq' | 'gemini' | 'cloudflare';
  activeModelCoveredByEnv: boolean;
  anyProviderCoveredByEnv: boolean;
  encryptionSecretConfigured: boolean;
  providers: {
    groq: ColdStartProviderReadiness;
    gemini: ColdStartProviderReadiness;
    cloudflare: ColdStartProviderReadiness;
  };
  warnings: string[];
  envTemplate: string;
}

export interface AuditLogEntry {
  logId: string;
  actorUid: string;
  actorEmail?: string;
  action: string;
  resourceType: string;
  resourceId: string;
  timestamp: string;
  status: 'success' | 'failure' | 'blocked';
  metadata: Record<string, string | number | boolean>;
}

export interface ApiUsageDaily {
  date: string;
  requestCount: number;
  successfulCount: number;
  failedCount: number;
  blockedCount: number;
  analysisCount: number;
  quizGenerationCount: number;
  ocrCount: number;
  webGroundedCount: number;
  actualPromptTokens: number;
  actualCandidateTokens: number;
  actualTotalTokens: number;
  quotaExceededEvents: number;
  providerErrorEvents: number;
  updatedAt: string;
}

export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  avatarUrl?: string;
  grade: GradeLevel;
  preferredSubjects: SubjectId[];
  createdAt: string;
  lastLoginAt: string;
  accountStatus: 'active' | 'suspended';
  isSuperAdmin?: boolean;
}
