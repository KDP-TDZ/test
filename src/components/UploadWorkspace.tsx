import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Camera,
  CheckCircle2,
  Clock,
  FileUp,
  Loader2,
  RefreshCw,
  Sparkles,
  Trash2,
  Zap,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { gsap, MOTION_ALLOWED_MEDIA, useGSAP } from '../lib/gsapSetup';
import {
  SUBJECT_LABELS,
  type AiJobRecord,
  type AnalysisRecord,
  type AnalysisStage,
  type ExtractedPage,
  type GradeLevel,
  type ReferenceBook,
  type ReferenceChunk,
  type SubjectId,
} from '../core/types';
import { retrieveRelevantChunks } from '../core/retrieval';
import {
  buildFileNameSuggestionCacheKey,
  getEffectiveUploadLimits,
  inferGradeAndSubjectFromFileNames,
  isGenericCameraFileNames,
  splitFilesIntoByteBudgetBatches,
  validateUploadFileSize,
} from '../core/uploadBatching';
import { authorizedFetch, parseApiResponse } from '../services/apiClient';
import { compressImageFilesForUpload } from '../services/imageCompression';
import {
  listReferenceBooks,
  listReferenceChunksForBook,
  listUserAiJobs,
  saveAiJobRecord,
  saveAnalysisRecord,
  syncEncounteredConceptsFromAnalysis,
} from '../services/firestoreService';
import { GlassSurface } from './LiquidGlass/GlassSurface';
import { WaterRippleButton } from './LiquidGlass/WaterRippleButton';
import { OcrReviewPanel } from './OcrReviewPanel';
import { VerificationFiveStepBar } from './VerificationFiveStepBar';
import {
  resolveStepFromAnalysisStage,
  type VerificationStepId,
} from '../core/verificationStepper';

interface UploadWorkspaceProps {
  onAnalysisCompleted: (analysis: AnalysisRecord, localFile: File | null) => void;
}

type WizardStep = 'select' | 'review_ocr' | 'processing';

interface OcrDraftCache {
  documentId: string;
  documentTitle: string;
  originalFileName: string;
  mimeType: string;
  grade: GradeLevel;
  subject: SubjectId;
  selectedChapters: string[];
  scopeNote: string;
  pages: ExtractedPage[];
  savedAt: string;
}

const PIPELINE_STAGES: Array<{ id: AnalysisStage; label: string }> = [
  { id: 'uploading', label: 'Đang chuẩn bị & kiểm tra tệp tải lên' },
  { id: 'extracting', label: 'Trích xuất văn bản, công thức & tự nhận diện chủ đề' },
  { id: 'retrieving_references', label: 'Tự động tìm sách giáo khoa & chuẩn chương trình' },
  { id: 'verifying', label: 'Kiểm định từng câu, công thức & độ đầy đủ ký hiệu' },
  { id: 'calculating', label: 'Chấm điểm độc lập Độ chính xác & Độ đầy đủ' },
  { id: 'generating_report', label: 'Hoàn tất & lưu báo cáo phân tích' },
];

const ALLOWED_EXTENSIONS = ['.pdf', '.docx', '.jpg', '.jpeg', '.png', '.webp'];

export const UploadWorkspace: React.FC<UploadWorkspaceProps> = ({ onAnalysisCompleted }) => {
  const workspaceRef = useRef<HTMLDivElement>(null);
  const progressFillRef = useRef<HTMLDivElement>(null);
  const { user, profile, systemStatus } = useAuth();
  const [step, setStep] = useState<WizardStep>('select');
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [activeStage, setActiveStage] = useState<AnalysisStage>('uploading');
  const [statusLabel, setStatusLabel] = useState<string>('');
  const [progressDetail, setProgressDetail] = useState<{ current: number; total: number } | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [lastFailedAction, setLastFailedAction] = useState<'full' | 'verify_draft' | null>(null);

  const [referenceBooks, setReferenceBooks] = useState<ReferenceBook[]>([]);
  const [recentJobs, setRecentJobs] = useState<AiJobRecord[]>([]);
  const [ocrDraft, setOcrDraft] = useState<OcrDraftCache | null>(null);
  const [selectedGrade, setSelectedGrade] = useState<GradeLevel>(profile?.grade || '10');
  const [gradeTouched, setGradeTouched] = useState(false);
  const [selectedSubject, setSelectedSubject] = useState<'auto' | SubjectId>('auto');
  const [suggestingFromFileName, setSuggestingFromFileName] = useState(false);
  const [suggestProgressPct, setSuggestProgressPct] = useState(0);
  const [autoSuggestNote, setAutoSuggestNote] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [sgkPrefetchStatus, setSgkPrefetchStatus] = useState<'idle' | 'loading' | 'ready'>('idle');
  const [reviewOcrBeforeGrading, setReviewOcrBeforeGrading] = useState(false);

  const suggestAbortRef = useRef<AbortController | null>(null);
  const filenameSuggestionCacheRef = useRef<
    Map<string, { grade: GradeLevel; subject: 'auto' | SubjectId; note: string }>
  >(new Map());
  const sgkPrefetchCacheRef = useRef<
    Map<string, Promise<{ book: ReferenceBook | null; chunks: ReferenceChunk[] }>>
  >(new Map());

  const aiEnabled = systemStatus ? systemStatus.enabled : true;
  const maxFileMb = systemStatus?.rateLimitConfig?.maximumFileSizeMb || 20;
  const uploadLimits = getEffectiveUploadLimits(maxFileMb);
  const maxPages = systemStatus?.rateLimitConfig?.maximumPagesPerAnalysis || 25;
  const hasManualScope = selectedSubject !== 'auto';

  useEffect(() => {
    if (!gradeTouched && profile?.grade) {
      setSelectedGrade(profile.grade);
    }
  }, [profile?.grade, gradeTouched]);

  useEffect(() => {
    listReferenceBooks(true)
      .then((books) => setReferenceBooks(books))
      .catch(() => setReferenceBooks([]));
    return () => {
      suggestAbortRef.current?.abort();
    };
  }, []);

  const getOrPrefetchSgkReference = (
    grade: GradeLevel,
    subject: SubjectId
  ): Promise<{ book: ReferenceBook | null; chunks: ReferenceChunk[] }> => {
    const key = `${grade}_${subject}`;
    const existing = sgkPrefetchCacheRef.current.get(key);
    if (existing) return existing;

    const promise = (async () => {
      let activeBooks = referenceBooks;
      if (activeBooks.length === 0) {
        activeBooks = await listReferenceBooks(true).catch(() => []);
        if (activeBooks.length > 0) setReferenceBooks(activeBooks);
      }
      const book =
        activeBooks.find(
          (b) => b.status === 'active' && b.grade === grade && b.subject === subject
        ) || null;
      if (!book) return { book: null, chunks: [] };
      const chunks = await listReferenceChunksForBook(book.referenceId).catch(() => []);
      return { book, chunks };
    })();

    sgkPrefetchCacheRef.current.set(key, promise);
    return promise;
  };

  // Proactively warm SGK ReferenceChunks in background whenever Grade + specific Subject are selected
  useEffect(() => {
    if (selectedSubject === 'auto') {
      setSgkPrefetchStatus('idle');
      return;
    }
    let cancelled = false;
    setSgkPrefetchStatus('loading');
    getOrPrefetchSgkReference(selectedGrade, selectedSubject)
      .then(() => {
        if (!cancelled) setSgkPrefetchStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setSgkPrefetchStatus('idle');
      });
    return () => {
      cancelled = true;
    };
  }, [selectedGrade, selectedSubject, referenceBooks.length]);

  useEffect(() => {
    if (!user) return;
    listUserAiJobs(user.uid)
      .then((jobs) => setRecentJobs(jobs.slice(0, 3)))
      .catch(() => setRecentJobs([]));

    try {
      const raw = localStorage.getItem(`studycheck_ocr_draft_${user.uid}`);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<OcrDraftCache>;
        if (Array.isArray(parsed.pages) && parsed.pages.length > 0) {
          setOcrDraft({
            documentId: parsed.documentId || `doc_${Date.now()}`,
            documentTitle: parsed.documentTitle || 'Tài liệu kiểm định',
            originalFileName: parsed.originalFileName || 'tai_lieu.txt',
            mimeType: parsed.mimeType || 'text/plain',
            grade: parsed.grade || profile?.grade || '10',
            subject: parsed.subject || 'khac',
            selectedChapters: Array.isArray(parsed.selectedChapters) ? parsed.selectedChapters : [],
            scopeNote: parsed.scopeNote || '',
            pages: parsed.pages,
            savedAt: parsed.savedAt || new Date().toISOString(),
          });
        }
      }
    } catch {
      // Ignore malformed draft
    }
  }, [user, profile?.grade]);

  useEffect(() => {
    if (step !== 'processing') {
      setElapsedSeconds(0);
      return;
    }
    const timer = window.setInterval(() => {
      setElapsedSeconds((s) => s + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [step]);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_ALLOWED_MEDIA, () => {
        gsap.from('.upload-step-panel', {
          y: 12,
          autoAlpha: 0,
          duration: 0.32,
          ease: 'power2.out',
          clearProps: 'transform,opacity,visibility',
        });
      });
    },
    { scope: workspaceRef, dependencies: [step] }
  );

  useGSAP(
    () => {
      if (step !== 'processing') return;
      const mm = gsap.matchMedia();
      mm.add(MOTION_ALLOWED_MEDIA, () => {
        gsap.fromTo(
          '.upload-status-label',
          { y: 5, autoAlpha: 0.35 },
          {
            y: 0,
            autoAlpha: 1,
            duration: 0.24,
            ease: 'power2.out',
            clearProps: 'transform,opacity,visibility',
          }
        );
      });
    },
    { scope: workspaceRef, dependencies: [statusLabel, activeStage, step] }
  );

  useGSAP(
    () => {
      if (!progressFillRef.current || !progressDetail || progressDetail.total <= 0) return;
      const ratio = Math.min(1, Math.max(0.08, progressDetail.current / progressDetail.total));
      const mm = gsap.matchMedia();
      mm.add(MOTION_ALLOWED_MEDIA, () => {
        gsap.to(progressFillRef.current, {
          scaleX: ratio,
          duration: 0.35,
          ease: 'power2.out',
        });
      });
      mm.add('(prefers-reduced-motion: reduce)', () => {
        gsap.set(progressFillRef.current, { scaleX: ratio });
      });
    },
    { scope: workspaceRef, dependencies: [progressDetail?.current, progressDetail?.total, step] }
  );

  const persistOcrDraft = (draft: OcrDraftCache | null) => {
    if (!user) return;
    try {
      if (draft) {
        localStorage.setItem(`studycheck_ocr_draft_${user.uid}`, JSON.stringify(draft));
        setOcrDraft(draft);
      } else {
        localStorage.removeItem(`studycheck_ocr_draft_${user.uid}`);
        setOcrDraft(null);
      }
    } catch {
      // Ignore quota errors
    }
  };

  const validateAndSetFiles = (incoming: FileList | File[]) => {
    setError(null);
    setWarning(null);
    setLastFailedAction(null);
    const list = Array.from(incoming);
    if (list.length === 0) return;

    for (const f of list) {
      const lower = f.name.toLowerCase();
      if (lower.endsWith('.heic') || lower.endsWith('.heif')) {
        setError(
          `File "${f.name}" có định dạng HEIC chưa được trình duyệt xử lý trực tiếp. Vui lòng chuyển sang JPG hoặc PNG trước khi tải lên.`
        );
        return;
      }
      const hasValidExt = ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext));
      if (!hasValidExt) {
        setError(
          `Định dạng file "${f.name}" không được hỗ trợ. Chỉ chấp nhận PDF, DOCX, JPG, PNG, WEBP.`
        );
        return;
      }
      const sizeCheck = validateUploadFileSize(f, maxFileMb);
      if (!sizeCheck.ok) {
        setError(sizeCheck.error);
        return;
      }
    }

    const firstIsDoc =
      list[0].type === 'application/pdf' ||
      list[0].name.toLowerCase().endsWith('.pdf') ||
      list[0].name.toLowerCase().endsWith('.docx');

    let acceptedFiles: File[] = [];
    if (firstIsDoc && list.length > 1) {
      acceptedFiles = [list[0]];
      setFiles(acceptedFiles);
      setWarning('Chỉ xử lý 1 file PDF hoặc DOCX cho mỗi lần kiểm định; các ảnh nhiều trang có thể chọn cùng lúc.');
    } else if (!firstIsDoc) {
      const imagesOnly = list.filter(
        (f) => !f.name.toLowerCase().endsWith('.pdf') && !f.name.toLowerCase().endsWith('.docx')
      );
      if (imagesOnly.length > maxPages) {
        setError(`Số trang ảnh (${imagesOnly.length}) vượt quá giới hạn ${maxPages} trang.`);
        return;
      }
      setFiles((prev) => {
        const merged = prev.some((p) => p.type.startsWith('image/')) ? [...prev, ...imagesOnly] : imagesOnly;
        acceptedFiles = merged.slice(0, maxPages);
        return acceptedFiles;
      });
    } else {
      acceptedFiles = [list[0]];
      setFiles(acceptedFiles);
    }

    // Automatically suggest Grade & Subject from filename when in Auto mode
    const namesForInference = (acceptedFiles.length > 0 ? acceptedFiles : list).map((f) => f.name);
    if (selectedSubject === 'auto' && namesForInference.length > 0) {
      void runSmartFilenameSuggestion(namesForInference, { triggeredByButton: false });
    }
  };

  const runSmartFilenameSuggestion = async (
    fileNames: string[],
    opts: { triggeredByButton: boolean }
  ) => {
    if (fileNames.length === 0) return;

    suggestAbortRef.current?.abort();
    const fallbackGrade: GradeLevel = profile?.grade || selectedGrade || '10';
    const cacheKey = buildFileNameSuggestionCacheKey(fileNames, fallbackGrade);

    // 1. Check in-memory cache first (0ms, 0 API calls)
    const cached = filenameSuggestionCacheRef.current.get(cacheKey);
    if (cached) {
      setSelectedGrade(cached.grade);
      setGradeTouched(true);
      setSelectedSubject(cached.subject);
      setAutoSuggestNote(cached.note);
      return;
    }

    // 2. Run instant client-side Vietnamese keyword & grade heuristic
    const localInference = inferGradeAndSubjectFromFileNames(fileNames);
    if (localInference.confidence === 'high' && localInference.grade && localInference.subject) {
      const note = `AI gợi ý từ tên tệp "${fileNames[0]}": Lớp ${localInference.grade} · ${SUBJECT_LABELS[localInference.subject]}`;
      filenameSuggestionCacheRef.current.set(cacheKey, {
        grade: localInference.grade,
        subject: localInference.subject,
        note,
      });
      setSelectedGrade(localInference.grade);
      setGradeTouched(true);
      setSelectedSubject(localInference.subject);
      setAutoSuggestNote(note);
      return;
    }

    if (localInference.subject) {
      const effectiveGrade = localInference.grade || selectedGrade;
      const note = `AI gợi ý từ tên tệp "${fileNames[0]}": Lớp ${effectiveGrade} · ${SUBJECT_LABELS[localInference.subject]}`;
      filenameSuggestionCacheRef.current.set(cacheKey, {
        grade: effectiveGrade,
        subject: localInference.subject,
        note,
      });
      if (localInference.grade) {
        setSelectedGrade(localInference.grade);
        setGradeTouched(true);
      }
      setSelectedSubject(localInference.subject);
      setAutoSuggestNote(note);
      return;
    }

    // 3. Skip network request completely if filenames are generic camera/scanner numbers (IMG_001.jpg, etc.)
    if (isGenericCameraFileNames(fileNames)) {
      const effectiveGrade = localInference.grade || fallbackGrade;
      if (localInference.grade) {
        setSelectedGrade(localInference.grade);
        setGradeTouched(true);
      }
      setSelectedSubject('auto');
      if (opts.triggeredByButton) {
        setAutoSuggestNote(
          `Tên tệp "${fileNames[0]}" là ảnh chụp không chứa tên môn — đã đặt Lớp ${effectiveGrade} & để AI tự nhận diện từ nội dung trang vở.`
        );
      }
      return;
    }

    // 4. Meaningful filename without obvious subject keyword -> call lightweight AI route with smooth progress bar
    const controller = new AbortController();
    suggestAbortRef.current = controller;
    setSuggestingFromFileName(true);
    setSuggestProgressPct(22);
    setAutoSuggestNote(`Đang phân tích tên tệp "${fileNames[0]}" để gợi ý Khối lớp & Môn học...`);

    const stepTimer1 = window.setTimeout(() => setSuggestProgressPct(58), 220);
    const stepTimer2 = window.setTimeout(() => setSuggestProgressPct(84), 650);
    const timeoutId = window.setTimeout(() => controller.abort(), 7000);

    try {
      const res = await authorizedFetch('/api/ai/suggest-from-filename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileNames,
          defaultGrade: fallbackGrade,
        }),
        signal: controller.signal,
        retryTransient: false,
      });
      const data = await parseApiResponse<{
        suggestedGrade?: GradeLevel;
        suggestedSubject?: 'auto' | SubjectId;
      }>(res, 'Không thể gợi ý môn học từ tên tệp.');

      if (controller.signal.aborted) return;

      const nextGrade: GradeLevel =
        data.suggestedGrade === '10' || data.suggestedGrade === '11' || data.suggestedGrade === '12'
          ? data.suggestedGrade
          : localInference.grade || fallbackGrade;
      const nextSubj: 'auto' | SubjectId =
        data.suggestedSubject &&
        data.suggestedSubject !== 'auto' &&
        data.suggestedSubject in SUBJECT_LABELS
          ? (data.suggestedSubject as SubjectId)
          : 'auto';

      setSuggestProgressPct(100);
      setSelectedGrade(nextGrade);
      setGradeTouched(true);
      setSelectedSubject(nextSubj);

      const note =
        nextSubj !== 'auto'
          ? `AI gợi ý từ tên tệp "${fileNames[0]}": Lớp ${nextGrade} · ${SUBJECT_LABELS[nextSubj]}`
          : `Tên tệp "${fileNames[0]}" chưa nêu rõ môn học — đã đặt Lớp ${nextGrade} & để AI tự nhận diện môn từ nội dung trang vở.`;

      filenameSuggestionCacheRef.current.set(cacheKey, {
        grade: nextGrade,
        subject: nextSubj,
        note,
      });
      setAutoSuggestNote(note);
    } catch {
      if (controller.signal.aborted) return;
      if (localInference.grade) {
        setSelectedGrade(localInference.grade);
        setGradeTouched(true);
      }
      setSelectedSubject('auto');
      setAutoSuggestNote(
        'Đã đặt chế độ AI tự động nhận diện Khối lớp & Môn học từ nội dung tài liệu.'
      );
    } finally {
      window.clearTimeout(stepTimer1);
      window.clearTimeout(stepTimer2);
      window.clearTimeout(timeoutId);
      if (suggestAbortRef.current === controller) {
        setSuggestingFromFileName(false);
        setSuggestProgressPct(0);
      }
    }
  };

  const handleAutoSuggestFromFileName = async () => {
    setError(null);
    if (files.length === 0) {
      suggestAbortRef.current?.abort();
      setSuggestingFromFileName(false);
      setSuggestProgressPct(0);
      const defaultG: GradeLevel = profile?.grade || '10';
      setSelectedGrade(defaultG);
      setGradeTouched(false);
      setSelectedSubject('auto');
      setAutoSuggestNote(
        'Chế độ Tự động: Hệ thống sẽ tự gợi ý Khối lớp & Môn học ngay khi bạn kéo thả hoặc chọn tệp.'
      );
      return;
    }

    await runSmartFilenameSuggestion(
      files.map((f) => f.name),
      { triggeredByButton: true }
    );
  };

  const moveFile = (idx: number, dir: -1 | 1) => {
    setFiles((prev) => {
      const target = idx + dir;
      if (target < 0 || target >= prev.length) return prev;
      const copy = [...prev];
      const [item] = copy.splice(idx, 1);
      copy.splice(target, 0, item);
      return copy;
    });
  };

  const removeFile = (idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const runVerificationOnDraft = async (
    draft: OcrDraftCache,
    primaryLocalFile: File | null,
    prefetchedRefPromise?: Promise<{ book: ReferenceBook | null; chunks: ReferenceChunk[] }> | null
  ) => {
    if (!user || draft.pages.length === 0) return;

    setActiveStage('retrieving_references');
    setProgressDetail({ current: 1, total: 3 });
    setStatusLabel(
      prefetchedRefPromise
        ? `Đang đối chiếu kho SGK Lớp ${draft.grade} · ${SUBJECT_LABELS[draft.subject]}...`
        : 'Đang tự động tìm sách giáo khoa & chuẩn chương trình phù hợp...'
    );

    const jobId = `job_an_${draft.documentId || Date.now()}`;
    const nowStart = new Date().toISOString();
    const baseJob: AiJobRecord = {
      jobId,
      ownerUid: user.uid,
      jobType: 'analysis_verify',
      status: 'processing',
      currentStage: 'retrieving_references',
      stagesCompleted: ['uploading', 'extracting'],
      configVersion: systemStatus?.configVersion || 1,
      createdAt: nowStart,
      updatedAt: nowStart,
    };
    saveAiJobRecord(baseJob).catch(() => {});

    try {
      let matchedBook: ReferenceBook | null = null;
      let allChunks: ReferenceChunk[] = [];

      if (prefetchedRefPromise) {
        const prefetched = await prefetchedRefPromise.catch(() => ({
          book: null as ReferenceBook | null,
          chunks: [] as ReferenceChunk[],
        }));
        matchedBook = prefetched.book;
        allChunks = prefetched.chunks;
      }

      if (!matchedBook) {
        let activeBooks = referenceBooks;
        if (activeBooks.length === 0) {
          activeBooks = await listReferenceBooks(true).catch(() => []);
          if (activeBooks.length > 0) setReferenceBooks(activeBooks);
        }

        matchedBook =
          activeBooks.find(
            (b) => b.status === 'active' && b.grade === draft.grade && b.subject === draft.subject
          ) || null;

        if (matchedBook && allChunks.length === 0) {
          allChunks = await listReferenceChunksForBook(matchedBook.referenceId).catch(() => []);
        }
      }

      let relevantChunks: ReferenceChunk[] = [];
      if (matchedBook && allChunks.length > 0) {
        const queryText = draft.pages.map((p) => p.rawText).join(' ').slice(0, 2500);
        const retrieved = retrieveRelevantChunks(queryText, allChunks, {
          referenceId: matchedBook.referenceId,
          selectedChapters: draft.selectedChapters.length > 0 ? draft.selectedChapters : undefined,
          topK: 8,
        });
        relevantChunks =
          retrieved.length > 0
            ? retrieved.map((r) => r.chunk)
            : allChunks
                .filter(
                  (c) =>
                    draft.selectedChapters.length === 0 ||
                    draft.selectedChapters.some((ch) => c.chapter.includes(ch))
                )
                .slice(0, 6);
      }

      setActiveStage('verifying');
      setProgressDetail({ current: 2, total: 3 });
      setStatusLabel(
        `Đang kiểm định từng câu, công thức & chú thích trên ${draft.pages.length} trang tài liệu...`
      );

      const idempotencyKey = `${draft.documentId}_${draft.grade}_${draft.subject}_${Date.now()}`;
      const res = await authorizedFetch('/api/ai/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idempotencyKey,
          pages: draft.pages,
          grade: draft.grade,
          subject: draft.subject,
          textbookReferenceId: matchedBook?.referenceId || '',
          textbookTitle: matchedBook?.title || '',
          selectedChapters: draft.selectedChapters,
          scope: draft.scopeNote,
          referenceChunks: relevantChunks,
          enableWebGrounding: false,
        }),
      });

      const data = await parseApiResponse<any>(res, 'Quá trình phân tích kiến thức thất bại.');

      setActiveStage('calculating');
      setProgressDetail({ current: 3, total: 3 });
      setStatusLabel('Đang chấm điểm độc lập & lưu báo cáo kết quả...');

      const now = new Date().toISOString();
      const record: AnalysisRecord = {
        analysisId: draft.documentId || `an_${Date.now()}`,
        ownerUid: user.uid,
        documentTitle: draft.documentTitle.trim() || 'Tài liệu kiểm định',
        originalFileName: draft.originalFileName || `${draft.documentTitle || 'tai_lieu'}.txt`,
        mimeType: draft.mimeType || 'text/plain',
        storagePath: '',
        storageDownloadUrl: '',
        grade: draft.grade,
        subject: draft.subject,
        textbookReferenceId: matchedBook?.referenceId || '',
        textbookTitle: matchedBook?.title || 'Chuẩn chương trình GDPT 2018',
        textbookVersion: matchedBook?.editionYear || '',
        selectedChapters: draft.selectedChapters,
        scope:
          draft.scopeNote.trim() ||
          draft.selectedChapters.join(', ') ||
          'Toàn bộ nội dung tài liệu',
        analysisStatus: 'completed',
        extractedPages: draft.pages,
        claims: data.claims || [],
        coverageItems: data.coverageItems || [],
        annotations: data.annotations || [],
        accuracyScore: data.accuracyBreakdown?.accuracyScore ?? null,
        completenessScore: data.completenessBreakdown?.completenessScore ?? null,
        evidenceCoverage: data.accuracyBreakdown?.evidenceCoverage ?? null,
        confidenceLevel: data.accuracyBreakdown?.confidenceLevel || 'Chưa đủ dữ liệu đánh giá',
        confidenceReason: data.accuracyBreakdown?.confidenceReason || '',
        accuracyBreakdown: data.accuracyBreakdown,
        completenessBreakdown: data.completenessBreakdown,
        strengths: data.strengths || [],
        weaknesses: data.weaknesses || [],
        suggestions: data.suggestions || [],
        webSources: data.webSources || [],
        usedWebGrounding: Boolean(data.usedWebGrounding),
        ...(data.webGroundingNotice ? { webGroundingNotice: data.webGroundingNotice } : {}),
        jobId,
        ...(data.modelUsed ? { modelUsed: data.modelUsed } : {}),
        createdAt: now,
        updatedAt: now,
      };

      setActiveStage('generating_report');
      await saveAnalysisRecord(record);
      await syncEncounteredConceptsFromAnalysis(user.uid, record);
      persistOcrDraft(null);
      setProgressDetail(null);

      saveAiJobRecord({
        ...baseJob,
        status: 'completed',
        currentStage: 'completed',
        stagesCompleted: PIPELINE_STAGES.map((s) => s.id),
        resultSummary: `Accuracy ${record.accuracyScore ?? 'N/A'}% · Completeness ${record.completenessScore ?? 'N/A'}%`,
        updatedAt: new Date().toISOString(),
      }).catch(() => {});

      onAnalysisCompleted(record, primaryLocalFile);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Không thể hoàn tất phân tích.';
      setProgressDetail(null);
      setError(msg);
      setLastFailedAction('verify_draft');
      setStep('select');
      saveAiJobRecord({
        ...baseJob,
        status: 'failed',
        currentStage: 'verifying',
        error: msg.slice(0, 300),
        updatedAt: new Date().toISOString(),
      }).catch(() => {});
    }
  };

  const handleStartOneClickGrading = async () => {
    if (!user || files.length === 0) return;
    if (!aiEnabled) {
      setError(
        systemStatus?.maintenanceMessage ||
          'Dịch vụ AI đang tạm ngừng. Vui lòng quay lại sau khi quản trị viên kích hoạt lại.'
      );
      return;
    }

    setError(null);
    setWarning(null);
    setLastFailedAction(null);
    setStep('processing');
    setActiveStage('uploading');
    const newDocId = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const jobId = `job_ocr_${newDocId}`;
    const now = new Date().toISOString();

    const baseJob: AiJobRecord = {
      jobId,
      ownerUid: user.uid,
      jobType: 'ocr_extract',
      status: 'processing',
      currentStage: 'uploading',
      stagesCompleted: [],
      configVersion: systemStatus?.configVersion || 1,
      createdAt: now,
      updatedAt: now,
    };
    saveAiJobRecord(baseJob).catch(() => {});

    try {
      // Cancel any in-flight filename suggestion so it never conflicts with active grading
      suggestAbortRef.current?.abort();
      setSuggestingFromFileName(false);

      const manualSubject: SubjectId | null = selectedSubject !== 'auto' ? selectedSubject : null;
      const manualGrade: GradeLevel = selectedGrade;

      // Fast Path: reuse proactively prefetched SGK chunks (or start prefetching in parallel with compression & OCR)
      const prefetchedRefPromise: Promise<{
        book: ReferenceBook | null;
        chunks: ReferenceChunk[];
      }> | null = manualSubject ? getOrPrefetchSgkReference(manualGrade, manualSubject) : null;

      const isImageUpload = files.every((f) => f.type.startsWith('image/'));
      setProgressDetail(
        isImageUpload ? { current: 0, total: files.length } : { current: 1, total: 2 }
      );

      let preparedFiles = files;
      if (isImageUpload) {
        preparedFiles = await compressImageFilesForUpload(files, (curr, total) => {
          setProgressDetail({ current: curr, total });
          setStatusLabel(
            total > 1
              ? `Đang nén thích ứng ảnh trang ${curr}/${total} để tải lên nhanh & ổn định...`
              : 'Đang nén thích ứng ảnh để tải lên nhanh & ổn định...'
          );
        });
      } else {
        setStatusLabel(`Đang chuẩn bị tệp ${files[0].name}...`);
      }

      setActiveStage('extracting');

      let pages: ExtractedPage[] = [];
      let suggestion: Record<string, any> = {};

      if (!isImageUpload) {
        const isPdf = files[0].type === 'application/pdf' || files[0].name.toLowerCase().endsWith('.pdf');
        setProgressDetail({ current: 1, total: 2 });
        setStatusLabel(
          manualSubject
            ? isPdf
              ? `Đang trích xuất PDF (${SUBJECT_LABELS[manualSubject]} · Lớp ${manualGrade})...`
              : `Đang đọc tệp Word (${SUBJECT_LABELS[manualSubject]} · Lớp ${manualGrade})...`
            : isPdf
            ? 'Đang trích xuất từng trang tệp PDF & nhận diện môn học...'
            : 'Đang đọc nội dung tệp Word (DOCX) & nhận diện môn học...'
        );
        const formData = new FormData();
        preparedFiles.forEach((f) => formData.append('files', f));
        if (manualSubject) {
          formData.append('skipScope', 'true');
          formData.append('presetGrade', manualGrade);
          formData.append('presetSubject', manualSubject);
        }
        const res = await authorizedFetch('/api/ai/extract', {
          method: 'POST',
          body: formData,
        });
        const data = await parseApiResponse<any>(res, 'Không thể trích xuất nội dung tài liệu.');
        pages = data.pages || [];
        suggestion = data.scopeSuggestion || {};
        setProgressDetail({ current: 2, total: 2 });
      } else {
        const totalPages = preparedFiles.length;
        const batches = splitFilesIntoByteBudgetBatches(preparedFiles);
        let accumulatedText = '';
        let pageCursor = 0;

        for (let bIdx = 0; bIdx < batches.length; bIdx += 1) {
          const batch = batches[bIdx];
          const offset = pageCursor;
          const endIdx = offset + batch.length;
          const isLastBatch = bIdx === batches.length - 1;

          setProgressDetail({ current: offset + 1, total: totalPages });
          setStatusLabel(
            batch.length === 1
              ? manualSubject
                ? `Đang đọc OCR trang ${offset + 1}/${totalPages} (${SUBJECT_LABELS[manualSubject]} ${manualGrade})...`
                : `Đang đọc OCR trang ${offset + 1}/${totalPages}...`
              : manualSubject
              ? `Đang đọc OCR trang ${offset + 1}–${endIdx}/${totalPages} (${SUBJECT_LABELS[manualSubject]} ${manualGrade})...`
              : `Đang đọc OCR trang ${offset + 1}–${endIdx}/${totalPages}...`
          );

          const formData = new FormData();
          batch.forEach((f) => formData.append('files', f));
          formData.append('pageOffset', String(offset));
          const shouldSkipScope = Boolean(manualSubject) || !isLastBatch;
          formData.append('skipScope', shouldSkipScope ? 'true' : 'false');
          if (manualSubject) {
            formData.append('presetGrade', manualGrade);
            formData.append('presetSubject', manualSubject);
          } else if (isLastBatch && accumulatedText) {
            formData.append('previousText', accumulatedText.slice(0, 1500));
          }

          const res = await authorizedFetch('/api/ai/extract', {
            method: 'POST',
            body: formData,
          });
          const data = await parseApiResponse<any>(res, 'Không thể trích xuất nội dung tài liệu.');
          const batchPages: ExtractedPage[] = data.pages || [];
          pages = [...pages, ...batchPages];
          accumulatedText = pages.map((p) => p.rawText).join('\n');
          if (isLastBatch) {
            suggestion = data.scopeSuggestion || {};
          }
          pageCursor = endIdx;
          setProgressDetail({ current: endIdx, total: totalPages });
        }
      }

      if (pages.length === 0) {
        throw new Error('Không trích xuất được nội dung văn bản nào từ tệp tải lên. Hãy thử ảnh rõ nét hơn.');
      }

      const nextTitle =
        suggestion.suggestedTitle || files[0].name.replace(/\.[^.]+$/, '') || 'Tài liệu học tập';
      const nextGrade: GradeLevel = manualSubject
        ? manualGrade
        : suggestion.suggestedGrade || profile?.grade || '10';
      const nextSubject: SubjectId = manualSubject
        ? manualSubject
        : suggestion.suggestedSubject || 'khac';
      const nextChapters: string[] = Array.isArray(suggestion.suggestedChapters)
        ? suggestion.suggestedChapters.slice(0, 5)
        : [];
      const nextScope = nextChapters.join(', ');

      const readyDraft: OcrDraftCache = {
        documentId: newDocId,
        documentTitle: nextTitle,
        originalFileName: files[0]?.name || `${nextTitle}.txt`,
        mimeType: files[0]?.type || 'text/plain',
        grade: nextGrade,
        subject: nextSubject,
        selectedChapters: nextChapters,
        scopeNote: nextScope,
        pages,
        savedAt: new Date().toISOString(),
      };

      persistOcrDraft(readyDraft);

      saveAiJobRecord({
        ...baseJob,
        status: 'completed',
        currentStage: 'retrieving_references',
        stagesCompleted: ['uploading', 'extracting'],
        resultSummary: `Đã trích xuất ${pages.length} trang`,
        updatedAt: new Date().toISOString(),
      }).catch(() => {});

      const hasLowConfidenceOcr = pages.some(
        (p) => p.ocrAverageConfidence < 0.72 || p.blocks.some((b) => b.confidence < 0.65)
      );
      if (reviewOcrBeforeGrading || hasLowConfidenceOcr) {
        setProgressDetail(null);
        setStep('review_ocr');
        return;
      }

      // Immediately continue into automatic verification & grading without any manual scope/option screen
      await runVerificationOnDraft(readyDraft, files[0] || null, prefetchedRefPromise);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Lỗi xử lý tải lên và trích xuất.';
      setProgressDetail(null);
      setError(msg);
      setLastFailedAction('full');
      setStep('select');
      saveAiJobRecord({
        ...baseJob,
        status: 'failed',
        currentStage: 'extracting',
        error: msg.slice(0, 300),
        updatedAt: new Date().toISOString(),
      }).catch(() => {});
    }
  };

  const handleGradeSavedDraftNow = async () => {
    if (!ocrDraft || !aiEnabled) return;
    setError(null);
    setLastFailedAction(null);
    setStep('processing');
    await runVerificationOnDraft(ocrDraft, files[0] || null);
  };

  const activeStageIdx = PIPELINE_STAGES.findIndex((s) => s.id === activeStage);
  const currentFiveStepId: VerificationStepId =
    step === 'select'
      ? 1
      : step === 'review_ocr'
      ? 2
      : Math.max(2, resolveStepFromAnalysisStage(activeStage)) as VerificationStepId;

  const uploadInteractiveSteps: VerificationStepId[] =
    step === 'select' && ocrDraft
      ? [1, 2]
      : step === 'review_ocr'
      ? [1, 2]
      : [];

  return (
    <div ref={workspaceRef} className="space-y-4 sm:space-y-6">
      {/* 5-Step Progress Stepper Card (Matched to Reference Design) */}
      <VerificationFiveStepBar
        activeStep={currentFiveStepId}
        interactiveSteps={uploadInteractiveSteps}
        statusSummaryText={
          step === 'processing'
            ? statusLabel || PIPELINE_STAGES[Math.max(0, activeStageIdx)]?.label
            : step === 'review_ocr' && ocrDraft
            ? `Đang rà soát ${ocrDraft.pages.length} trang OCR trước khi chấm điểm`
            : undefined
        }
        onSelectStep={(targetStep) => {
          if (step === 'processing') return;
          if (targetStep === 1) {
            setStep('select');
          } else if (targetStep === 2 && ocrDraft) {
            setStep('review_ocr');
          }
        }}
      />

      {/* Resumable OCR Draft Banner (1-click direct grading) */}
      {step === 'select' && ocrDraft && (
        <GlassSurface className="rounded-3xl p-4 sm:p-5 border border-sky-200/80 dark:border-sky-800/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="text-xs space-y-0.5">
            <p className="font-semibold text-[#16243E] dark:text-[#E6EFFC]">
              Tài liệu đã đọc OCR chưa chấm xong: {ocrDraft.documentTitle}
            </p>
            <p className="text-slate-600 dark:text-slate-300">
              {ocrDraft.pages.length} trang · Lưu lúc{' '}
              {new Date(ocrDraft.savedAt).toLocaleString('vi-VN')} (Bấm để chấm thẳng không cần đọc lại OCR)
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => persistOcrDraft(null)}
              className="glass-control px-3.5 py-1.5 rounded-xl text-xs font-medium text-slate-600 dark:text-slate-200 cursor-pointer"
            >
              Bỏ nháp
            </button>
            <button
              type="button"
              onClick={() => setStep('review_ocr')}
              className="glass-control px-3.5 py-1.5 rounded-xl text-xs font-semibold text-sky-700 dark:text-sky-300 cursor-pointer"
            >
              Xem / sửa OCR
            </button>
            <WaterRippleButton size="sm" disabled={!aiEnabled} onClick={handleGradeSavedDraftNow}>
              <CheckCircle2 className="w-3.5 h-3.5" />
              Chấm điểm ngay
            </WaterRippleButton>
          </div>
        </GlassSurface>
      )}

      {error && (
        <div className="rounded-xl border border-rose-200 dark:border-rose-800/70 bg-rose-50 dark:bg-rose-950/50 px-4 py-3 text-xs text-rose-800 dark:text-rose-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
          {lastFailedAction && (
            <button
              type="button"
              onClick={() =>
                lastFailedAction === 'verify_draft' && ocrDraft
                  ? handleGradeSavedDraftNow()
                  : handleStartOneClickGrading()
              }
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-semibold shrink-0 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Thử lại ngay
            </button>
          )}
        </div>
      )}

      {warning && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-800/70 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <span>{warning}</span>
        </div>
      )}

      {/* STEP 1: Select File / Camera & 1-Click Grade */}
      {step === 'select' && (
        <GlassSurface className="upload-step-panel rounded-3xl p-4 sm:p-8 space-y-5 sm:space-y-6">
          <div>
            <h1 className="font-display text-[clamp(1.25rem,3.8vw,1.5rem)] font-bold text-[#16243E] dark:text-[#E6EFFC] leading-[1.25]">
              Tải tài liệu để kiểm định & chấm điểm ngay
            </h1>
            <p className="text-sm text-[#475B78] dark:text-[#B4C7E2] mt-1.5 leading-[1.6] prose-measure">
              Hỗ trợ nhiều ảnh chụp trang vở (JPG, PNG, WEBP) và PDF, DOCX. Ảnh tối đa{' '}
              <span className="font-mono font-medium">{uploadLimits.maxImageMb}MB/ảnh</span> (tự nén
              thông minh) · PDF/DOCX tối đa{' '}
              <span className="font-mono font-medium">{uploadLimits.maxDocumentMb}MB/file</span> · Tối đa{' '}
              <span className="font-mono font-medium">{maxPages} trang</span>.
            </p>
          </div>

          {/* Pre-Upload Grade & Subject Dropdowns + AI Filename 'Tự động' Button (Right Above Dropzone) */}
          <div className="glass-panel-subtle relative overflow-hidden rounded-2xl p-3.5 sm:p-4 border border-sky-200/70 dark:border-slate-700/70 space-y-3">
            {/* Smooth Top Progress Bar when AI is suggesting Grade & Subject */}
            {suggestingFromFileName && (
              <div
                aria-hidden="true"
                className="absolute inset-x-0 top-0 h-1 bg-sky-100/80 dark:bg-slate-800 overflow-hidden"
              >
                <div
                  className="h-full bg-gradient-to-r from-sky-400 via-indigo-500 to-sky-500 transition-all duration-300 ease-out"
                  style={{ width: `${Math.max(15, suggestProgressPct)}%` }}
                />
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#16243E] dark:text-[#E6EFFC]">
                <Zap className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400 shrink-0" />
                <span>Chọn nhanh Khối lớp & Môn học trước khi gửi (tăng tốc tìm SGK)</span>
              </div>
              {suggestingFromFileName ? (
                <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-sky-700 dark:text-sky-300 animate-pulse">
                  <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                  <span>AI đang gợi ý từ tên tệp ({suggestProgressPct}%)...</span>
                </span>
              ) : hasManualScope ? (
                <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    Chế độ nhanh: Lớp {selectedGrade} · {SUBJECT_LABELS[selectedSubject]}
                    {sgkPrefetchStatus === 'ready' ? ' (Đã nạp sẵn SGK)' : ''}
                  </span>
                </span>
              ) : (
                <span className="text-[11px] text-[#475B78] dark:text-[#B4C7E2]">
                  Lớp {selectedGrade} · AI tự nhận diện môn học
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end">
              {/* Grade Dropdown with Skeleton state */}
              <div className="sm:col-span-4 space-y-1">
                <label
                  htmlFor="upload-grade-select"
                  className="block text-[11px] font-semibold text-[#475B78] dark:text-[#B4C7E2]"
                >
                  Khối lớp
                </label>
                <div className="relative">
                  <select
                    id="upload-grade-select"
                    aria-label="Chọn khối lớp"
                    disabled={suggestingFromFileName}
                    value={selectedGrade}
                    onChange={(e) => {
                      suggestAbortRef.current?.abort();
                      setSuggestingFromFileName(false);
                      setSelectedGrade(e.target.value as GradeLevel);
                      setGradeTouched(true);
                      setAutoSuggestNote(null);
                    }}
                    className={`w-full min-h-[40px] rounded-xl border border-sky-200/80 dark:border-slate-700 bg-white/90 dark:bg-slate-900/80 px-3 py-2 text-xs font-semibold text-[#16243E] dark:text-[#E6EFFC] focus:outline-none focus:ring-2 focus:ring-sky-500/40 cursor-pointer transition-opacity ${
                      suggestingFromFileName ? 'opacity-45 animate-pulse' : ''
                    }`}
                  >
                    <option value="10">Khối Lớp 10 (GDPT 2018)</option>
                    <option value="11">Khối Lớp 11 (GDPT 2018)</option>
                    <option value="12">Khối Lớp 12 (GDPT 2018)</option>
                  </select>
                </div>
              </div>

              {/* Subject Dropdown with Skeleton state */}
              <div className="sm:col-span-5 space-y-1">
                <label
                  htmlFor="upload-subject-select"
                  className="block text-[11px] font-semibold text-[#475B78] dark:text-[#B4C7E2]"
                >
                  Môn học
                </label>
                <div className="relative">
                  <select
                    id="upload-subject-select"
                    aria-label="Chọn môn học"
                    disabled={suggestingFromFileName}
                    value={selectedSubject}
                    onChange={(e) => {
                      suggestAbortRef.current?.abort();
                      setSuggestingFromFileName(false);
                      setSelectedSubject(e.target.value as 'auto' | SubjectId);
                      setAutoSuggestNote(null);
                    }}
                    className={`w-full min-h-[40px] rounded-xl border border-sky-200/80 dark:border-slate-700 bg-white/90 dark:bg-slate-900/80 px-3 py-2 text-xs font-semibold text-[#16243E] dark:text-[#E6EFFC] focus:outline-none focus:ring-2 focus:ring-sky-500/40 cursor-pointer transition-opacity ${
                      suggestingFromFileName ? 'opacity-45 animate-pulse' : ''
                    }`}
                  >
                    <option value="auto">Tự động nhận diện môn học (AI)</option>
                    {(Object.keys(SUBJECT_LABELS) as SubjectId[]).map((subj) => (
                      <option key={subj} value={subj}>
                        {SUBJECT_LABELS[subj]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* 'Tự động' AI Filename Suggestion Button */}
              <div className="sm:col-span-3">
                <button
                  type="button"
                  disabled={suggestingFromFileName}
                  onClick={handleAutoSuggestFromFileName}
                  title="Để AI tự động gợi ý Khối lớp & Môn học dựa trên tên tệp"
                  className="w-full min-h-[40px] glass-control inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-[#16243E] dark:text-[#E6EFFC] hover:border-sky-400 dark:hover:border-sky-500 transition-colors cursor-pointer disabled:opacity-60"
                >
                  {suggestingFromFileName ? (
                    <Loader2 className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400 animate-spin shrink-0" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400 shrink-0" />
                  )}
                  <span>{suggestingFromFileName ? 'Đang gợi ý...' : 'Tự động'}</span>
                </button>
              </div>
            </div>

            {autoSuggestNote && (
              <p className="text-[11px] font-medium text-sky-700 dark:text-sky-300 flex items-center gap-1.5 pt-0.5">
                <Sparkles className="w-3 h-3 shrink-0" />
                <span>{autoSuggestNote}</span>
              </p>
            )}
          </div>

          {/* Drag-and-Drop Zone with Smooth AI Suggestion Skeleton Loading & Progress Bar */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              if (!isDragOver) setIsDragOver(true);
            }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragOver(false);
              validateAndSetFiles(e.dataTransfer.files);
            }}
            aria-busy={suggestingFromFileName}
            className={`glass-panel-subtle relative overflow-hidden rounded-2xl border-2 border-dashed p-5 sm:p-8 text-center transition-all duration-200 ${
              suggestingFromFileName
                ? 'border-sky-400 dark:border-sky-500 ring-2 ring-sky-400/20'
                : isDragOver
                ? 'border-sky-500 bg-sky-50/60 dark:bg-sky-950/30 scale-[0.998]'
                : 'border-sky-300/80 dark:border-sky-700/70 hover:border-sky-500'
            }`}
          >
            {/* Smooth Animated Progress Bar & Skeleton Overlay inside Dropzone while AI suggests Grade/Subject */}
            {suggestingFromFileName && (
              <div
                role="status"
                aria-live="polite"
                className="mb-5 mx-auto max-w-md rounded-2xl border border-sky-200/90 dark:border-sky-800/70 bg-white/90 dark:bg-slate-900/90 p-3.5 shadow-sm space-y-2.5 text-left"
              >
                <div className="flex items-center justify-between gap-2 text-xs font-semibold text-[#16243E] dark:text-[#E6EFFC]">
                  <span className="inline-flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400 animate-pulse shrink-0" />
                    <span>AI đang phân tích tên tệp & gợi ý phạm vi SGK...</span>
                  </span>
                  <span className="font-mono text-[11px] text-sky-600 dark:text-sky-400 tabular-nums">
                    {suggestProgressPct}%
                  </span>
                </div>

                {/* Smooth Progress Bar */}
                <div className="h-1.5 w-full rounded-full bg-sky-100 dark:bg-slate-800 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-sky-500 via-indigo-500 to-sky-400 transition-all duration-300 ease-out"
                    style={{ width: `${Math.max(18, suggestProgressPct)}%` }}
                  />
                </div>

                {/* Skeleton Shimmer Pills for Grade & Subject */}
                <div className="grid grid-cols-2 gap-2 pt-0.5">
                  <div className="h-7 rounded-xl bg-slate-200/75 dark:bg-slate-800/90 animate-pulse flex items-center px-2.5">
                    <span className="h-2.5 w-20 rounded bg-slate-300/90 dark:bg-slate-700" />
                  </div>
                  <div className="h-7 rounded-xl bg-slate-200/75 dark:bg-slate-800/90 animate-pulse flex items-center px-2.5">
                    <span className="h-2.5 w-28 rounded bg-slate-300/90 dark:bg-slate-700" />
                  </div>
                </div>
              </div>
            )}

            <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-sky-100/80 dark:bg-sky-900/50 border border-sky-200/80 dark:border-sky-700/60 flex items-center justify-center mx-auto mb-3">
              <FileUp className="w-6 h-6 sm:w-7 sm:h-7 text-sky-600 dark:text-sky-400" />
            </div>
            <p className="text-sm font-semibold text-[#16243E] dark:text-[#E6EFFC]">
              Kéo thả tệp vào đây hoặc chọn từ thiết bị
            </p>
            <p className="text-xs text-[#475B78] dark:text-[#B4C7E2] mt-1 leading-[1.6]">
              Có thể chọn nhiều ảnh cùng lúc để ghép thành tài liệu nhiều trang theo đúng thứ tự.
            </p>

            <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
              <label className="min-h-[44px] inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-sky-500 to-sky-600 text-white text-xs font-semibold cursor-pointer hover:from-sky-400 hover:to-sky-500 shadow-[0_6px_18px_-4px_rgba(2,132,199,0.45)] transition-all">
                <FileUp className="w-4 h-4" />
                Chọn tệp (PDF / DOCX / Ảnh)
                <input
                  type="file"
                  multiple
                  accept=".pdf,.docx,image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files) validateAndSetFiles(e.target.files);
                  }}
                />
              </label>

              <label className="glass-control inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-[#16243E] dark:text-[#E6EFFC] text-xs font-semibold cursor-pointer">
                <Camera className="w-4 h-4 text-sky-600 dark:text-sky-400" />
                Chụp trang vở bằng Camera
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files) validateAndSetFiles(e.target.files);
                  }}
                />
              </label>
            </div>
          </div>

          {files.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                Tài liệu đã chọn ({files.length} tệp)
              </p>
              <div className="space-y-2">
                {files.map((file, idx) => (
                  <div
                    key={`${file.name}_${idx}`}
                    className="glass-panel-subtle rounded-2xl px-4 py-3 flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-[#16243E] dark:text-[#E6EFFC] truncate">
                        Trang {idx + 1}: {file.name}
                      </p>
                      <p className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                        {(file.size / 1024 / 1024).toFixed(2)} MB · {file.type || 'document'}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {files.length > 1 && (
                        <>
                          <button
                            type="button"
                            disabled={idx === 0}
                            onClick={() => moveFile(idx, -1)}
                            className="glass-control p-1.5 rounded-lg text-slate-700 dark:text-slate-200 disabled:opacity-35 cursor-pointer"
                            aria-label="Đưa lên trước"
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={idx === files.length - 1}
                            onClick={() => moveFile(idx, 1)}
                            className="glass-control p-1.5 rounded-lg text-slate-700 dark:text-slate-200 disabled:opacity-35 cursor-pointer"
                            aria-label="Đưa xuống sau"
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => removeFile(idx)}
                        className="p-1.5 rounded-lg border border-rose-200/80 dark:border-rose-800/70 bg-rose-50/70 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 hover:bg-rose-100/80 dark:hover:bg-rose-950/70 cursor-pointer"
                        aria-label="Xóa tệp"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={reviewOcrBeforeGrading}
                    onChange={(e) => setReviewOcrBeforeGrading(e.target.checked)}
                    className="h-4 w-4 accent-sky-600 rounded"
                  />
                  <span>Rà soát & chỉnh sửa văn bản OCR trước khi AI chấm điểm</span>
                </label>

                <WaterRippleButton
                  size="lg"
                  disabled={!aiEnabled}
                  onClick={handleStartOneClickGrading}
                >
                  <CheckCircle2 className="w-4 h-4" />
                  {reviewOcrBeforeGrading ? 'Trích xuất OCR & Rà soát' : 'Kiểm định & Chấm điểm ngay'}
                </WaterRippleButton>
              </div>
            </div>
          )}

          {recentJobs.length > 0 && (
            <div className="pt-4 border-t border-sky-200/60 dark:border-slate-700/70">
              <p className="text-xs font-semibold text-slate-600 dark:text-slate-300 mb-2">
                Tiến trình xử lý gần đây
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                {recentJobs.map((job) => (
                  <div
                    key={job.jobId}
                    className="glass-panel-subtle rounded-2xl p-3 text-[11px]"
                  >
                    <p className="font-semibold text-[#16243E] dark:text-[#E6EFFC] truncate">
                      {job.jobType === 'ocr_extract' ? 'Trích xuất OCR' : 'Kiểm định kiến thức'} ·{' '}
                      {job.status === 'completed'
                        ? 'Hoàn tất'
                        : job.status === 'failed'
                        ? 'Lỗi'
                        : 'Đang xử lý'}
                    </p>
                    <p className="text-slate-500 dark:text-slate-400 truncate mt-0.5">
                      {job.resultSummary || job.error || job.currentStage}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </GlassSurface>
      )}

      {/* STEP 1.5: Optional / Low-Confidence OCR Review & Edit */}
      {step === 'review_ocr' && ocrDraft && (
        <div className="upload-step-panel">
          <OcrReviewPanel
            pages={ocrDraft.pages}
            previewFiles={files}
            mimeType={ocrDraft.mimeType}
            onChangePages={(updatedPages) => {
              persistOcrDraft({
                ...ocrDraft,
                pages: updatedPages,
                savedAt: new Date().toISOString(),
              });
            }}
            onConfirmOcr={() => {
              void handleGradeSavedDraftNow();
            }}
            onBack={() => setStep('select')}
          />
        </div>
      )}

      {/* STEP 2: Automatic End-to-End OCR & Grading Progress */}
      {step === 'processing' && (
        <GlassSurface className="upload-step-panel rounded-3xl p-5 sm:p-10 space-y-5 sm:space-y-6">
          <div className="text-center space-y-3">
            <div className="glass-segment inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-semibold text-sky-700 dark:text-sky-300">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>
                Giai đoạn {Math.max(1, activeStageIdx + 1)}/{PIPELINE_STAGES.length}
                {progressDetail && progressDetail.total > 0
                  ? ` · Tiến độ ${progressDetail.current}/${progressDetail.total}`
                  : ''}
              </span>
            </div>
            <h2 className="upload-status-label font-display text-[clamp(1.1rem,3.4vw,1.35rem)] font-bold text-[#16243E] dark:text-[#E6EFFC]">
              {statusLabel || PIPELINE_STAGES[Math.max(0, activeStageIdx)]?.label}
            </h2>
            {progressDetail && progressDetail.total > 0 && (
              <div className="max-w-md mx-auto space-y-1.5">
                <div className="h-2.5 w-full rounded-full bg-sky-100/90 dark:bg-slate-800 overflow-hidden">
                  <div
                    ref={progressFillRef}
                    className="h-full w-full origin-left rounded-full bg-gradient-to-r from-sky-500 to-sky-600"
                    style={{ transform: 'scaleX(0.08)' }}
                  />
                </div>
              </div>
            )}
            <p className="inline-flex items-center gap-1.5 font-mono text-xs text-[#475B78] dark:text-[#B4C7E2] tabular-nums">
              <Clock className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
              Thời gian đã trôi qua: {elapsedSeconds}s
            </p>
          </div>

          <div className="max-w-lg mx-auto space-y-2">
            {PIPELINE_STAGES.map((st, idx) => {
              const isDone = idx < activeStageIdx;
              const isCurrent = idx === activeStageIdx;
              return (
                <div
                  key={st.id}
                  className={`flex items-center justify-between gap-3 rounded-2xl px-3.5 sm:px-4 py-2.5 text-xs border transition-colors ${
                    isCurrent
                      ? 'bg-sky-50/90 dark:bg-sky-950/50 border-sky-300/90 dark:border-sky-700 text-sky-900 dark:text-sky-100 font-semibold shadow-sm'
                      : isDone
                      ? 'bg-emerald-50/75 dark:bg-emerald-950/35 border-emerald-200/80 dark:border-emerald-800/60 text-emerald-800 dark:text-emerald-300'
                      : 'bg-white/50 dark:bg-slate-900/45 border-sky-200/50 dark:border-slate-800 text-[#475B78] dark:text-[#B4C7E2]'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="font-mono w-5 text-center shrink-0">
                      {isDone ? '✓' : isCurrent ? '→' : `${idx + 1}`}
                    </span>
                    <span className="truncate">{st.label}</span>
                  </div>
                  {isCurrent && progressDetail && progressDetail.total > 1 && (
                    <span className="font-mono text-[11px] shrink-0 text-sky-700 dark:text-sky-300 tabular-nums">
                      {progressDetail.current}/{progressDetail.total}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          <p className="text-xs text-center text-[#475B78] dark:text-[#B4C7E2] max-w-md mx-auto leading-[1.6]">
            Vui lòng giữ tab trình duyệt mở để hoàn tất quá trình kiểm định và lưu kết quả vào tài
            khoản của bạn.
          </p>
        </GlassSurface>
      )}
    </div>
  );
};
