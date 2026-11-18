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
  boundingBox?: NormalizedBoundingBox | null;
  ocrConfidence: number;
  knowledgeType: 'textbook_core' | 'advanced_extension' | 'insufficient_evidence';
  evaluationStatus: ClaimStatus;
  explanation: string;
  correctKnowledge: string;
  reason?: string;
  evidences: ReferenceEvidence[];
}

export interface KnowledgeCoverageItem {
  itemId: string;
  concept: string;
  chapter: string;
  lesson?: string;
  importanceWeight: 1 | 2 | 3;
  status: CoverageStatus;
  suggestedAddition: string;
  referenceExcerpt: string;
  referencePage?: number;
}

export interface AnnotationItem {
  annotationId: string;
  pageNumber: number;
  blockId?: string;
  textExcerpt: string;
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
}

export interface CompletenessBreakdown {
  completenessScore: number | null;
  coveredWeight: number;
  totalRequiredWeight: number;
  missingCount: number;
  partialCount: number;
  coveredCount: number;
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
  createdAt: string;
  updatedAt: string;
}

export interface ReferenceBook {
  referenceId: string;
  title: string;
  grade: GradeLevel;
  subject: SubjectId;
  textbookSeries: string;
  publisher: string;
  editionYear: string;
  description: string;
  sourceType: 'url' | 'upload';
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

export interface QuizQuestion {
  questionId: string;
  questionText: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  correctAnswer: 'A' | 'B' | 'C' | 'D';
  explanation: string;
  difficulty: 'basic' | 'medium' | 'advanced';
  subject: SubjectId;
  grade: GradeLevel;
  chapter: string;
  concept: string;
  sourceReference: string;
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
  sourceReference: string;
  subject: SubjectId;
  grade: GradeLevel;
  chapter: string;
  concept: string;
  difficulty: 'basic' | 'medium' | 'advanced';
  attemptCount: number;
  correctCount: number;
  incorrectCount: number;
  lastAttemptAt: string;
  lastResult: 'correct' | 'incorrect';
  masteryStatus: MasteryStatus;
  createdAt: string;
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
