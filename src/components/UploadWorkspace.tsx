import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  BookOpen,
  Camera,
  CheckCircle2,
  Clock,
  FileUp,
  Globe,
  Loader2,
  RefreshCw,
  Trash2,
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

interface UploadWorkspaceProps {
  onAnalysisCompleted: (analysis: AnalysisRecord, localFile: File | null) => void;
}

type WizardStep = 'select' | 'extracting' | 'ocr_review' | 'scope_confirm' | 'analyzing';

interface OcrDraftCache {
  documentId: string;
  documentTitle: string;
  grade: GradeLevel;
  subject: SubjectId;
  scopeNote: string;
  pages: ExtractedPage[];
  savedAt: string;
}

const PIPELINE_STAGES: Array<{ id: AnalysisStage; label: string }> = [
  { id: 'uploading', label: 'Đang tải tệp & kiểm tra định dạng' },
  { id: 'extracting', label: 'Trích xuất văn bản / OCR chữ viết tay' },
  { id: 'awaiting_ocr_confirmation', label: 'Xác nhận văn bản OCR' },
  { id: 'retrieving_references', label: 'Truy xuất học liệu & SGK chuẩn' },
  { id: 'verifying', label: 'Kiểm định từng mệnh đề kiến thức' },
  { id: 'calculating', label: 'Chấm điểm độc lập Độ chính xác & Đầy đủ' },
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
  const [lastFailedAction, setLastFailedAction] = useState<'extract' | 'analyze' | null>(null);

  const [documentId, setDocumentId] = useState<string>('');
  const [storagePath] = useState<string>('');
  const [storageDownloadUrl] = useState<string>('');
  const [extractedPages, setExtractedPages] = useState<ExtractedPage[]>([]);

  // Resumable jobs & OCR Draft recovery
  const [recentJobs, setRecentJobs] = useState<AiJobRecord[]>([]);
  const [ocrDraft, setOcrDraft] = useState<OcrDraftCache | null>(null);

  // Scope Confirmation State
  const [documentTitle, setDocumentTitle] = useState('');
  const [grade, setGrade] = useState<GradeLevel>(profile?.grade || '10');
  const [subject, setSubject] = useState<SubjectId>('toan');
  const [referenceBooks, setReferenceBooks] = useState<ReferenceBook[]>([]);
  const [selectedBookId, setSelectedBookId] = useState<string>('');
  const [selectedChapters, setSelectedChapters] = useState<string[]>([]);
  const [scopeNote, setScopeNote] = useState('');
  const [enableWebGrounding, setEnableWebGrounding] = useState(false);

  const aiEnabled = systemStatus ? systemStatus.enabled : true;
  const maxFileMb = systemStatus?.rateLimitConfig?.maximumFileSizeMb || 20;
  const maxPages = systemStatus?.rateLimitConfig?.maximumPagesPerAnalysis || 25;

  useEffect(() => {
    listReferenceBooks(true)
      .then((books) => setReferenceBooks(books))
      .catch(() => setReferenceBooks([]));
  }, []);

  useEffect(() => {
    if (!user) return;
    listUserAiJobs(user.uid)
      .then((jobs) => setRecentJobs(jobs.slice(0, 3)))
      .catch(() => setRecentJobs([]));

    try {
      const raw = localStorage.getItem(`studycheck_ocr_draft_${user.uid}`);
      if (raw) {
        const parsed = JSON.parse(raw) as OcrDraftCache;
        if (Array.isArray(parsed.pages) && parsed.pages.length > 0) {
          setOcrDraft(parsed);
        }
      }
    } catch {
      // Ignore malformed draft
    }
  }, [user]);

  useEffect(() => {
    if (step !== 'extracting' && step !== 'analyzing') {
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
      if (step !== 'extracting' && step !== 'analyzing') return;
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

  const filteredBooks = referenceBooks.filter(
    (b) => b.grade === grade && b.subject === subject && b.status === 'active'
  );
  const selectedBook = filteredBooks.find((b) => b.referenceId === selectedBookId) || null;

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
      if (f.size > maxFileMb * 1024 * 1024) {
        setError(`File "${f.name}" vượt quá giới hạn tối đa ${maxFileMb}MB.`);
        return;
      }
    }

    const firstIsDoc =
      list[0].type === 'application/pdf' ||
      list[0].name.toLowerCase().endsWith('.pdf') ||
      list[0].name.toLowerCase().endsWith('.docx');

    if (firstIsDoc && list.length > 1) {
      setFiles([list[0]]);
      setWarning('Chỉ xử lý 1 file PDF hoặc DOCX cho mỗi lần kiểm định; các ảnh nhiều trang có thể chọn cùng lúc.');
    } else if (!firstIsDoc) {
      const imagesOnly = list.filter((f) => !f.name.toLowerCase().endsWith('.pdf') && !f.name.toLowerCase().endsWith('.docx'));
      if (imagesOnly.length > maxPages) {
        setError(`Số trang ảnh (${imagesOnly.length}) vượt quá giới hạn ${maxPages} trang.`);
        return;
      }
      setFiles((prev) => {
        const merged = prev.some((p) => p.type.startsWith('image/')) ? [...prev, ...imagesOnly] : imagesOnly;
        return merged.slice(0, maxPages);
      });
    } else {
      setFiles([list[0]]);
    }
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

  const handleStartExtraction = async () => {
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
    setStep('extracting');
    setActiveStage('uploading');
    const newDocId = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    setDocumentId(newDocId);
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
              ? `Đang nén ảnh trang ${curr}/${total} để tải lên nhanh hơn...`
              : 'Đang nén ảnh để tải lên nhanh hơn...'
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
          isPdf
            ? 'Đang đọc & trích xuất từng trang tệp PDF...'
            : 'Đang đọc nội dung tệp Word (DOCX)...'
        );
        const formData = new FormData();
        preparedFiles.forEach((f) => formData.append('files', f));
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
        const batchSize = totalPages <= 8 ? 1 : Math.ceil(totalPages / 8);
        let accumulatedText = '';

        for (let offset = 0; offset < totalPages; offset += batchSize) {
          const batch = preparedFiles.slice(offset, offset + batchSize);
          const endIdx = Math.min(offset + batch.length, totalPages);
          const isLastBatch = endIdx >= totalPages;

          setProgressDetail({ current: offset + 1, total: totalPages });
          setStatusLabel(
            batch.length === 1
              ? `Đang đọc trang ${offset + 1}/${totalPages}...`
              : `Đang đọc trang ${offset + 1}–${endIdx}/${totalPages}...`
          );

          const formData = new FormData();
          batch.forEach((f) => formData.append('files', f));
          formData.append('pageOffset', String(offset));
          formData.append('skipScope', isLastBatch ? 'false' : 'true');
          if (isLastBatch && accumulatedText) {
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
          setProgressDetail({ current: endIdx, total: totalPages });
        }
      }

      setExtractedPages(pages);
      const nextTitle =
        suggestion.suggestedTitle || files[0].name.replace(/\.[^.]+$/, '') || 'Tài liệu học tập';
      const nextGrade: GradeLevel = suggestion.suggestedGrade || profile?.grade || '10';
      const nextSubject: SubjectId = suggestion.suggestedSubject || 'toan';
      const nextScope =
        Array.isArray(suggestion.suggestedChapters) && suggestion.suggestedChapters.length > 0
          ? suggestion.suggestedChapters.join(', ')
          : '';

      setDocumentTitle(nextTitle);
      setGrade(nextGrade);
      setSubject(nextSubject);
      if (nextScope) setScopeNote(nextScope);

      persistOcrDraft({
        documentId: newDocId,
        documentTitle: nextTitle,
        grade: nextGrade,
        subject: nextSubject,
        scopeNote: nextScope,
        pages,
        savedAt: new Date().toISOString(),
      });

      saveAiJobRecord({
        ...baseJob,
        status: 'completed',
        currentStage: 'awaiting_ocr_confirmation',
        stagesCompleted: ['uploading', 'extracting'],
        resultSummary: `Đã trích xuất ${pages.length} trang`,
        updatedAt: new Date().toISOString(),
      }).catch(() => {});

      setProgressDetail(null);
      setActiveStage('awaiting_ocr_confirmation');
      setStep('ocr_review');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Lỗi xử lý tải lên và trích xuất.';
      setProgressDetail(null);
      setError(msg);
      setLastFailedAction('extract');
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

  const executeVerification = async () => {
    if (!user || extractedPages.length === 0) return;
    if (!aiEnabled) {
      setError(systemStatus?.maintenanceMessage || 'Dịch vụ AI hiện đang tạm ngừng.');
      return;
    }

    setError(null);
    setLastFailedAction(null);
    setStep('analyzing');
    setActiveStage('retrieving_references');
    setProgressDetail({ current: 1, total: 3 });
    setStatusLabel('Bước 1/3: Đang tìm kiến thức sách giáo khoa phù hợp...');

    const jobId = `job_an_${documentId || Date.now()}`;
    const nowStart = new Date().toISOString();
    const baseJob: AiJobRecord = {
      jobId,
      ownerUid: user.uid,
      jobType: 'analysis_verify',
      status: 'processing',
      currentStage: 'retrieving_references',
      stagesCompleted: ['uploading', 'extracting', 'awaiting_ocr_confirmation'],
      configVersion: systemStatus?.configVersion || 1,
      createdAt: nowStart,
      updatedAt: nowStart,
    };
    saveAiJobRecord(baseJob).catch(() => {});

    try {
      let relevantChunks: ReferenceChunk[] = [];
      if (selectedBook) {
        const allChunks = await listReferenceChunksForBook(selectedBook.referenceId);
        const queryText = extractedPages.map((p) => p.rawText).join(' ').slice(0, 2500);
        const retrieved = retrieveRelevantChunks(queryText, allChunks, {
          referenceId: selectedBook.referenceId,
          selectedChapters: selectedChapters.length > 0 ? selectedChapters : undefined,
          topK: 8,
        });
        relevantChunks =
          retrieved.length > 0
            ? retrieved.map((r) => r.chunk)
            : allChunks
                .filter(
                  (c) =>
                    selectedChapters.length === 0 ||
                    selectedChapters.some((ch) => c.chapter.includes(ch))
                )
                .slice(0, 6);
      }

      setActiveStage('verifying');
      setProgressDetail({ current: 2, total: 3 });
      setStatusLabel(
        enableWebGrounding
          ? `Bước 2/3: Đang đối chiếu ${extractedPages.length} trang với SGK & tìm kiếm bổ sung...`
          : `Bước 2/3: Đang kiểm định & đối chiếu ${extractedPages.length} trang với kiến thức chuẩn...`
      );

      const idempotencyKey = `${documentId}_${grade}_${subject}_${Date.now()}`;
      const res = await authorizedFetch('/api/ai/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idempotencyKey,
          pages: extractedPages,
          grade,
          subject,
          textbookReferenceId: selectedBook?.referenceId || '',
          textbookTitle: selectedBook?.title || '',
          selectedChapters,
          scope: scopeNote,
          referenceChunks: relevantChunks,
          enableWebGrounding,
        }),
      });

      const data = await parseApiResponse<any>(res, 'Quá trình phân tích kiến thức thất bại.');

      setActiveStage('calculating');
      setProgressDetail({ current: 3, total: 3 });
      setStatusLabel('Bước 3/3: Đang chấm điểm & lưu báo cáo kết quả...');

      const now = new Date().toISOString();
      const record: AnalysisRecord = {
        analysisId: documentId || `an_${Date.now()}`,
        ownerUid: user.uid,
        documentTitle: documentTitle.trim() || 'Tài liệu kiểm định',
        originalFileName: files[0]?.name || `${documentTitle || 'tai_lieu'}.txt`,
        mimeType: files[0]?.type || 'text/plain',
        storagePath,
        storageDownloadUrl,
        grade,
        subject,
        textbookReferenceId: selectedBook?.referenceId || '',
        textbookTitle: selectedBook?.title || 'Chương trình GDPT chuẩn',
        textbookVersion: selectedBook?.editionYear || '',
        selectedChapters,
        scope: scopeNote.trim() || selectedChapters.join(', ') || 'Toàn bộ nội dung tài liệu',
        analysisStatus: 'completed',
        extractedPages,
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
        webGroundingNotice: data.webGroundingNotice,
        jobId,
        modelUsed: data.modelUsed,
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

      onAnalysisCompleted(record, files[0] || null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Không thể hoàn tất phân tích.';
      setProgressDetail(null);
      setError(msg);
      setLastFailedAction('analyze');
      setStep('scope_confirm');
      saveAiJobRecord({
        ...baseJob,
        status: 'failed',
        currentStage: 'verifying',
        error: msg.slice(0, 300),
        updatedAt: new Date().toISOString(),
      }).catch(() => {});
    }
  };

  const handleRunVerification = async (e: React.FormEvent) => {
    e.preventDefault();
    await executeVerification();
  };

  const handleRestoreDraft = () => {
    if (!ocrDraft) return;
    setDocumentId(ocrDraft.documentId);
    setDocumentTitle(ocrDraft.documentTitle);
    setGrade(ocrDraft.grade);
    setSubject(ocrDraft.subject);
    setScopeNote(ocrDraft.scopeNote);
    setExtractedPages(ocrDraft.pages);
    setStep('ocr_review');
  };

  const activeStageIdx = PIPELINE_STAGES.findIndex((s) => s.id === activeStage);

  return (
    <div ref={workspaceRef} className="space-y-4 sm:space-y-6">
      {/* Progress Stepper */}
      <div className="glass-segment rounded-2xl px-3.5 sm:px-4 py-2.5 flex flex-wrap items-center gap-1.5 sm:gap-2 text-xs font-medium">
        {[
          { id: 'select', label: '1. Tải tài liệu' },
          { id: 'ocr_review', label: '2. Kiểm tra OCR' },
          { id: 'scope_confirm', label: '3. Xác nhận phạm vi & SGK' },
          { id: 'analyzing', label: '4. Đối chiếu & Chấm điểm' },
        ].map((s, idx) => {
          const active =
            step === s.id || (step === 'extracting' && s.id === 'select');
          return (
            <React.Fragment key={s.id}>
              {idx > 0 && <span className="text-sky-300 dark:text-slate-600">/</span>}
              <span
                className={
                  active
                    ? 'px-3 py-1 rounded-xl bg-gradient-to-r from-sky-500 to-sky-600 text-white font-semibold shadow-sm'
                    : 'px-2 py-1 text-[#475B78] dark:text-[#B4C7E2]'
                }
              >
                {s.label}
              </span>
            </React.Fragment>
          );
        })}
      </div>

      {/* Resumable OCR Draft Banner */}
      {step === 'select' && ocrDraft && (
        <GlassSurface className="rounded-3xl p-4 sm:p-5 border border-sky-200/80 dark:border-sky-800/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="text-xs space-y-0.5">
            <p className="font-semibold text-[#16243E] dark:text-[#E6EFFC]">
              Bản nháp OCR chưa phân tích xong: {ocrDraft.documentTitle}
            </p>
            <p className="text-slate-600 dark:text-slate-300">
              {ocrDraft.pages.length} trang · Lưu lúc{' '}
              {new Date(ocrDraft.savedAt).toLocaleString('vi-VN')} (Khôi phục ngay không tốn lượt AI OCR)
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => persistOcrDraft(null)}
              className="glass-control px-3.5 py-1.5 rounded-xl text-xs font-medium text-slate-600 dark:text-slate-200 cursor-pointer"
            >
              Bỏ nháp
            </button>
            <WaterRippleButton size="sm" onClick={handleRestoreDraft}>
              Tiếp tục từ bước OCR
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
                lastFailedAction === 'extract' ? handleStartExtraction() : executeVerification()
              }
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-semibold shrink-0 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Thử lại bước hiện tại
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

      {/* STEP 1: Select File / Camera */}
      {step === 'select' && (
        <GlassSurface className="upload-step-panel rounded-3xl p-4 sm:p-8 space-y-5 sm:space-y-6">
          <div>
            <h1 className="font-display text-[clamp(1.25rem,3.8vw,1.5rem)] font-bold text-[#16243E] dark:text-[#E6EFFC] leading-[1.25]">
              Tải tài liệu để kiểm định kiến thức
            </h1>
            <p className="text-sm text-[#475B78] dark:text-[#B4C7E2] mt-1.5 leading-[1.6] prose-measure">
              Hỗ trợ PDF, DOCX hoặc nhiều ảnh chụp trang vở viết tay (JPG, PNG, WEBP). Giới hạn{' '}
              <span className="font-mono font-medium">{maxFileMb}MB/file</span> · Tối đa{' '}
              <span className="font-mono font-medium">{maxPages} trang</span>.
            </p>
          </div>

          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              validateAndSetFiles(e.dataTransfer.files);
            }}
            className="glass-panel-subtle rounded-2xl border-2 border-dashed border-sky-300/80 dark:border-sky-700/70 p-5 sm:p-8 text-center transition-colors hover:border-sky-500"
          >
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

              <div className="pt-2 flex justify-end">
                <WaterRippleButton
                  size="lg"
                  disabled={!aiEnabled}
                  onClick={handleStartExtraction}
                >
                  Tiếp tục trích xuất & OCR
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

      {/* STEP 1.5 / 4: Step-by-Step Progress State */}
      {(step === 'extracting' || step === 'analyzing') && (
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
            Vui lòng giữ tab trình duyệt mở để hoàn tất quá trình xác minh và lưu kết quả vào tài
            khoản Firebase của bạn.
          </p>
        </GlassSurface>
      )}

      {/* STEP 2: Mandatory OCR Review */}
      {step === 'ocr_review' && (
        <div className="upload-step-panel">
        <OcrReviewPanel
          pages={extractedPages}
          previewFiles={files}
          mimeType={files[0]?.type || ''}
          onChangePages={(nextPages) => {
            setExtractedPages(nextPages);
            if (ocrDraft) {
              persistOcrDraft({ ...ocrDraft, pages: nextPages, savedAt: new Date().toISOString() });
            }
          }}
          onConfirmOcr={() => setStep('scope_confirm')}
          onBack={() => setStep('select')}
        />
        </div>
      )}

      {/* STEP 3: Mandatory Scope & Reference Book Confirmation */}
      {step === 'scope_confirm' && (
        <GlassSurface className="upload-step-panel rounded-3xl p-4 sm:p-8">
          <h2 className="font-display text-lg sm:text-xl font-bold text-[#16243E] dark:text-[#E6EFFC]">
            Xác nhận phạm vi kiến thức & Sách giáo khoa tham chiếu
          </h2>
          <p className="text-xs sm:text-sm text-[#475B78] dark:text-[#B4C7E2] mt-1 mb-5 sm:mb-6 leading-[1.6] prose-measure">
            AI đã gợi ý môn học và khối lớp từ nội dung bạn tải lên. Hãy kiểm tra và xác nhận lại để
            chấm Độ chính xác và Độ đầy đủ đúng chương trình.
          </p>

          <form onSubmit={handleRunVerification} className="space-y-5">
            <div>
              <label htmlFor="doc-title" className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-1.5">
                Tiêu đề tài liệu
              </label>
              <input
                id="doc-title"
                type="text"
                required
                value={documentTitle}
                onChange={(e) => setDocumentTitle(e.target.value)}
                className="glass-control w-full px-3.5 py-2.5 rounded-xl text-sm text-[#16243E] dark:text-[#E6EFFC]"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="scope-grade" className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-1.5">
                  Khối lớp
                </label>
                <select
                  id="scope-grade"
                  value={grade}
                  onChange={(e) => {
                    setGrade(e.target.value as GradeLevel);
                    setSelectedBookId('');
                    setSelectedChapters([]);
                  }}
                  className="glass-control w-full px-3.5 py-2.5 rounded-xl text-sm text-[#16243E] dark:text-[#E6EFFC]"
                >
                  <option value="10">Lớp 10</option>
                  <option value="11">Lớp 11</option>
                  <option value="12">Lớp 12</option>
                </select>
              </div>

              <div>
                <label htmlFor="scope-subject" className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-1.5">
                  Môn học
                </label>
                <select
                  id="scope-subject"
                  value={subject}
                  onChange={(e) => {
                    setSubject(e.target.value as SubjectId);
                    setSelectedBookId('');
                    setSelectedChapters([]);
                  }}
                  className="glass-control w-full px-3.5 py-2.5 rounded-xl text-sm text-[#16243E] dark:text-[#E6EFFC]"
                >
                  {(Object.keys(SUBJECT_LABELS) as SubjectId[]).map((s) => (
                    <option key={s} value={s}>
                      {SUBJECT_LABELS[s]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label htmlFor="scope-book" className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-1.5">
                Bộ sách giáo khoa tham chiếu (từ Thư viện quản trị)
              </label>
              <select
                id="scope-book"
                value={selectedBookId}
                onChange={(e) => {
                  setSelectedBookId(e.target.value);
                  setSelectedChapters([]);
                }}
                className="glass-control w-full px-3.5 py-2.5 rounded-xl text-sm text-[#16243E] dark:text-[#E6EFFC]"
              >
                <option value="">
                  {filteredBooks.length > 0
                    ? '-- Chọn sách giáo khoa chuẩn để đối chiếu trực tiếp --'
                    : '-- Chưa có sách được lập chỉ mục cho môn/lớp này (dùng chuẩn chương trình & Web Grounding) --'}
                </option>
                {filteredBooks.map((book) => (
                  <option key={book.referenceId} value={book.referenceId}>
                    {book.title} ({book.textbookSeries} · {book.chunkCount} đoạn kiến thức)
                  </option>
                ))}
              </select>
            </div>

            {selectedBook && selectedBook.chapters.length > 0 && (
              <div>
                <p className="text-xs font-medium text-slate-700 dark:text-slate-200 mb-2 flex items-center gap-1.5">
                  <BookOpen className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                  Chọn chương / chủ đề cần đánh giá độ đầy đủ (tùy chọn)
                </p>
                <div className="flex flex-wrap gap-2">
                  {selectedBook.chapters.map((ch) => {
                    const active = selectedChapters.includes(ch);
                    return (
                      <button
                        key={ch}
                        type="button"
                        onClick={() =>
                          setSelectedChapters((prev) =>
                            prev.includes(ch) ? prev.filter((c) => c !== ch) : [...prev, ch]
                          )
                        }
                        className={`px-3 py-1.5 rounded-xl text-xs font-medium cursor-pointer transition-all ${
                          active
                            ? 'bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-sm'
                            : 'glass-control text-slate-700 dark:text-slate-200'
                        }`}
                      >
                        {ch}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div>
              <label htmlFor="scope-note" className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-1.5">
                Phạm vi bài học / Ghi chú cụ thể
              </label>
              <input
                id="scope-note"
                type="text"
                value={scopeNote}
                onChange={(e) => setScopeNote(e.target.value)}
                placeholder="Ví dụ: Chương 3 - Liên kết hóa học, Bài Liên kết hydrogen"
                className="glass-control w-full px-3.5 py-2.5 rounded-xl text-sm text-[#16243E] dark:text-[#E6EFFC]"
              />
            </div>

            <label className="glass-panel-subtle flex items-start gap-3 rounded-2xl p-4 cursor-pointer">
              <input
                type="checkbox"
                checked={enableWebGrounding}
                onChange={(e) => setEnableWebGrounding(e.target.checked)}
                className="mt-1 h-4 w-4 accent-sky-600"
              />
              <div className="text-xs">
                <p className="font-semibold text-[#16243E] dark:text-[#E6EFFC] flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                  Tùy chọn: Bật tìm kiếm bổ sung ngoài sách qua Google Search Grounding
                </p>
                <p className="text-slate-600 dark:text-slate-300 mt-0.5">
                  Tắt mặc định để tối ưu cho Gemini API miễn phí (dùng kho sách giáo khoa & kiến thức
                  chuẩn). Chỉ bật nếu API key của bạn hỗ trợ Google Search Grounding.
                </p>
              </div>
            </label>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <button
                type="button"
                onClick={() => setStep('ocr_review')}
                className="glass-control px-4 py-2 rounded-xl text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer"
              >
                ← Quay lại sửa OCR
              </button>
              <WaterRippleButton type="submit" size="lg" disabled={!aiEnabled}>
                <CheckCircle2 className="w-4 h-4" />
                Bắt đầu đối chiếu & chấm điểm
              </WaterRippleButton>
            </div>
          </form>
        </GlassSurface>
      )}
    </div>
  );
};
