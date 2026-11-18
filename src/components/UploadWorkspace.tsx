import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  BookOpen,
  Camera,
  CheckCircle2,
  FileUp,
  Globe,
  Loader2,
  Trash2,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  SUBJECT_LABELS,
  type AnalysisRecord,
  type ExtractedPage,
  type GradeLevel,
  type ReferenceBook,
  type ReferenceChunk,
  type SubjectId,
} from '../core/types';
import { retrieveRelevantChunks } from '../core/retrieval';
import { authorizedFetch } from '../services/apiClient';
import {
  listReferenceBooks,
  listReferenceChunksForBook,
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

const ALLOWED_EXTENSIONS = ['.pdf', '.docx', '.jpg', '.jpeg', '.png', '.webp'];

export const UploadWorkspace: React.FC<UploadWorkspaceProps> = ({ onAnalysisCompleted }) => {
  const { user, profile, systemStatus } = useAuth();
  const [step, setStep] = useState<WizardStep>('select');
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [statusLabel, setStatusLabel] = useState<string>('');

  const [documentId, setDocumentId] = useState<string>('');
  const [storagePath] = useState<string>('');
  const [storageDownloadUrl] = useState<string>('');
  const [extractedPages, setExtractedPages] = useState<ExtractedPage[]>([]);

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

  const filteredBooks = referenceBooks.filter(
    (b) => b.grade === grade && b.subject === subject && b.status === 'active'
  );
  const selectedBook = filteredBooks.find((b) => b.referenceId === selectedBookId) || null;

  const validateAndSetFiles = (incoming: FileList | File[]) => {
    setError(null);
    setWarning(null);
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
    setStep('extracting');
    setUploadProgress(0);
    const newDocId = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    setDocumentId(newDocId);

    try {
      setStatusLabel('Đang trích xuất văn bản, công thức và nhận diện chữ viết tay (OCR)...');
      setUploadProgress(15);
      const formData = new FormData();
      files.forEach((f) => formData.append('files', f));

      const res = await authorizedFetch('/api/ai/extract', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Không thể trích xuất nội dung tài liệu.');
      }

      setExtractedPages(data.pages || []);
      const suggestion = data.scopeSuggestion || {};
      setDocumentTitle(
        suggestion.suggestedTitle || files[0].name.replace(/\.[^.]+$/, '') || 'Tài liệu học tập'
      );
      if (suggestion.suggestedGrade) setGrade(suggestion.suggestedGrade);
      if (suggestion.suggestedSubject) setSubject(suggestion.suggestedSubject);
      if (Array.isArray(suggestion.suggestedChapters) && suggestion.suggestedChapters.length > 0) {
        setScopeNote(suggestion.suggestedChapters.join(', '));
      }

      setStep('ocr_review');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi xử lý tải lên và trích xuất.');
      setStep('select');
    }
  };

  const handleRunVerification = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || extractedPages.length === 0) return;
    if (!aiEnabled) {
      setError(systemStatus?.maintenanceMessage || 'Dịch vụ AI hiện đang tạm ngừng.');
      return;
    }

    setError(null);
    setStep('analyzing');
    setStatusLabel('Đang truy xuất đoạn kiến thức sách giáo khoa phù hợp...');

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

      setStatusLabel(
        enableWebGrounding
          ? 'Đang phân tích mệnh đề, đối chiếu sách giáo khoa & tra cứu Google Search Grounding...'
          : 'Đang phân tích mệnh đề & đối chiếu sách giáo khoa chuẩn...'
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

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Quá trình phân tích kiến thức thất bại.');
      }

      setStatusLabel('Đang lưu báo cáo phân tích và cập nhật thống kê học tập...');
      const now = new Date().toISOString();
      const record: AnalysisRecord = {
        analysisId: documentId || `an_${Date.now()}`,
        ownerUid: user.uid,
        documentTitle: documentTitle.trim() || 'Tài liệu kiểm định',
        originalFileName: files[0]?.name || 'document',
        mimeType: files[0]?.type || 'application/octet-stream',
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
        createdAt: now,
        updatedAt: now,
      };

      await saveAnalysisRecord(record);
      await syncEncounteredConceptsFromAnalysis(user.uid, record);
      onAnalysisCompleted(record, files[0] || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể hoàn tất phân tích.');
      setStep('scope_confirm');
    }
  };

  return (
    <div className="space-y-6">
      {/* Progress Stepper */}
      <div className="glass-surface rounded-2xl px-5 py-3.5 flex flex-wrap items-center gap-3 text-xs font-medium">
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
              {idx > 0 && <span className="text-slate-300">/</span>}
              <span className={active ? 'text-sky-700 font-bold' : 'text-slate-500'}>
                {s.label}
              </span>
            </React.Fragment>
          );
        })}
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-800 flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {warning && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900 flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <span>{warning}</span>
        </div>
      )}

      {/* STEP 1: Select File / Camera */}
      {step === 'select' && (
        <GlassSurface className="rounded-3xl p-6 sm:p-8 space-y-6">
          <div>
            <h1 className="font-display text-2xl font-bold text-slate-950">
              Tải tài liệu để kiểm định kiến thức
            </h1>
            <p className="text-sm text-slate-600 mt-1">
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
            className="rounded-2xl border-2 border-dashed border-sky-300/80 bg-white/70 p-8 text-center transition-colors hover:border-sky-500"
          >
            <FileUp className="w-10 h-10 text-sky-600 mx-auto mb-3" />
            <p className="text-sm font-semibold text-slate-900">
              Kéo thả tệp vào đây hoặc chọn từ thiết bị
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Có thể chọn nhiều ảnh cùng lúc để ghép thành tài liệu nhiều trang theo đúng thứ tự.
            </p>

            <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
              <label className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-sky-600 text-white text-xs font-semibold cursor-pointer hover:bg-sky-700">
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

              <label className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-800 text-xs font-semibold cursor-pointer hover:bg-slate-50">
                <Camera className="w-4 h-4 text-sky-700" />
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
              <p className="text-xs font-semibold text-slate-700">
                Tài liệu đã chọn ({files.length} tệp)
              </p>
              <div className="space-y-2">
                {files.map((file, idx) => (
                  <div
                    key={`${file.name}_${idx}`}
                    className="rounded-xl bg-white/90 border border-slate-200 px-4 py-2.5 flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900 truncate">
                        Trang {idx + 1}: {file.name}
                      </p>
                      <p className="font-mono text-[11px] text-slate-500">
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
                            className="p-1.5 rounded-lg border border-slate-200 disabled:opacity-35 cursor-pointer"
                            aria-label="Đưa lên trước"
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={idx === files.length - 1}
                            onClick={() => moveFile(idx, 1)}
                            className="p-1.5 rounded-lg border border-slate-200 disabled:opacity-35 cursor-pointer"
                            aria-label="Đưa xuống sau"
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => removeFile(idx)}
                        className="p-1.5 rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50 cursor-pointer"
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
        </GlassSurface>
      )}

      {/* STEP 1.5 / 4: Processing State */}
      {(step === 'extracting' || step === 'analyzing') && (
        <GlassSurface className="rounded-3xl p-10 text-center space-y-4">
          <Loader2 className="w-10 h-10 text-sky-600 animate-spin mx-auto" />
          <h2 className="font-display text-xl font-bold text-slate-950">{statusLabel}</h2>
          {step === 'extracting' && uploadProgress > 0 && uploadProgress < 100 && (
            <div className="max-w-sm mx-auto">
              <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
                <div
                  className="h-full bg-sky-600 transition-all duration-200"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
              <p className="font-mono text-xs text-slate-500 mt-1.5">{uploadProgress}%</p>
            </div>
          )}
          <p className="text-xs text-slate-600 max-w-md mx-auto">
            Vui lòng giữ tab trình duyệt mở để hoàn tất quá trình xác minh và lưu kết quả vào tài khoản
            Firebase của bạn.
          </p>
        </GlassSurface>
      )}

      {/* STEP 2: Mandatory OCR Review */}
      {step === 'ocr_review' && (
        <OcrReviewPanel
          pages={extractedPages}
          previewFiles={files}
          mimeType={files[0]?.type || ''}
          onChangePages={setExtractedPages}
          onConfirmOcr={() => setStep('scope_confirm')}
          onBack={() => setStep('select')}
        />
      )}

      {/* STEP 3: Mandatory Scope & Reference Book Confirmation */}
      {step === 'scope_confirm' && (
        <GlassSurface className="rounded-3xl p-6 sm:p-8">
          <h2 className="font-display text-xl font-bold text-slate-950">
            Xác nhận phạm vi kiến thức & Sách giáo khoa tham chiếu
          </h2>
          <p className="text-xs sm:text-sm text-slate-600 mt-1 mb-6">
            AI đã gợi ý môn học và khối lớp từ nội dung bạn tải lên. Hãy kiểm tra và xác nhận lại để
            chấm Độ chính xác và Độ đầy đủ đúng chương trình.
          </p>

          <form onSubmit={handleRunVerification} className="space-y-5">
            <div>
              <label htmlFor="doc-title" className="block text-xs font-medium text-slate-700 mb-1.5">
                Tiêu đề tài liệu
              </label>
              <input
                id="doc-title"
                type="text"
                required
                value={documentTitle}
                onChange={(e) => setDocumentTitle(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-slate-200 text-sm"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="scope-grade" className="block text-xs font-medium text-slate-700 mb-1.5">
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
                  className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-slate-200 text-sm"
                >
                  <option value="10">Lớp 10</option>
                  <option value="11">Lớp 11</option>
                  <option value="12">Lớp 12</option>
                </select>
              </div>

              <div>
                <label htmlFor="scope-subject" className="block text-xs font-medium text-slate-700 mb-1.5">
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
                  className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-slate-200 text-sm"
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
              <label htmlFor="scope-book" className="block text-xs font-medium text-slate-700 mb-1.5">
                Bộ sách giáo khoa tham chiếu (từ Thư viện quản trị)
              </label>
              <select
                id="scope-book"
                value={selectedBookId}
                onChange={(e) => {
                  setSelectedBookId(e.target.value);
                  setSelectedChapters([]);
                }}
                className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-slate-200 text-sm"
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
                <p className="text-xs font-medium text-slate-700 mb-2 flex items-center gap-1.5">
                  <BookOpen className="w-3.5 h-3.5 text-sky-700" />
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
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer ${
                          active
                            ? 'bg-sky-600 text-white'
                            : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
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
              <label htmlFor="scope-note" className="block text-xs font-medium text-slate-700 mb-1.5">
                Phạm vi bài học / Ghi chú cụ thể
              </label>
              <input
                id="scope-note"
                type="text"
                value={scopeNote}
                onChange={(e) => setScopeNote(e.target.value)}
                placeholder="Ví dụ: Chương 3 - Liên kết hóa học, Bài Liên kết hydrogen"
                className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-slate-200 text-sm"
              />
            </div>

            <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white/80 p-3.5 cursor-pointer">
              <input
                type="checkbox"
                checked={enableWebGrounding}
                onChange={(e) => setEnableWebGrounding(e.target.checked)}
                className="mt-1 h-4 w-4 accent-sky-600"
              />
              <div className="text-xs">
                <p className="font-semibold text-slate-900 flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5 text-sky-600" />
                  Tùy chọn: Bật tìm kiếm bổ sung ngoài sách qua Google Search Grounding
                </p>
                <p className="text-slate-600 mt-0.5">
                  Tắt mặc định để tối ưu cho Gemini API miễn phí (dùng kho sách giáo khoa & kiến thức
                  chuẩn). Chỉ bật nếu API key của bạn hỗ trợ Google Search Grounding.
                </p>
              </div>
            </label>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <button
                type="button"
                onClick={() => setStep('ocr_review')}
                className="px-4 py-2 rounded-xl border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
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
