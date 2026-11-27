import React, { useMemo, useState } from 'react';
import {
  FileText,
  Search,
  Trash2,
} from 'lucide-react';
import { SUBJECT_LABELS, type AnalysisRecord, type SubjectId } from '../core/types';
import { repairUtf8Mojibake } from '../core/textEncoding';
import { deleteAnalysisRecord } from '../services/firestoreService';
import { deletePrivateStorageFile } from '../services/storageService';
import { GlassSurface } from './LiquidGlass/GlassSurface';
import { WaterRippleButton } from './LiquidGlass/WaterRippleButton';
import { AnalysisReportView } from './AnalysisReportView';

interface HistoryViewProps {
  analyses: AnalysisRecord[];
  selectedAnalysisId: string | null;
  hasMore: boolean;
  loadingMore: boolean;
  onSelectAnalysis: (id: string | null) => void;
  onLoadMore: () => void;
  onDeleted: (analysisId: string) => void;
  onStartQuiz: (analysis: AnalysisRecord) => void;
  onOpenFlashcards?: () => void;
}

export const HistoryView: React.FC<HistoryViewProps> = ({
  analyses,
  selectedAnalysisId,
  hasMore,
  loadingMore,
  onSelectAnalysis,
  onLoadMore,
  onDeleted,
  onStartQuiz,
  onOpenFlashcards,
}) => {
  const [search, setSearch] = useState('');
  const [subjectFilter, setSubjectFilter] = useState<string>('all');
  const [gradeFilter, setGradeFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'newest' | 'accuracy_asc' | 'accuracy_desc'>('newest');
  const [confirmDelete, setConfirmDelete] = useState<AnalysisRecord | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const selectedRecord = useMemo(
    () => analyses.find((a) => a.analysisId === selectedAnalysisId) || null,
    [analyses, selectedAnalysisId]
  );

  const filtered = useMemo(() => {
    return analyses
      .filter((a) => {
        if (subjectFilter !== 'all' && a.subject !== subjectFilter) return false;
        if (gradeFilter !== 'all' && a.grade !== gradeFilter) return false;
        if (search.trim()) {
          const q = search.trim().toLowerCase();
          return (
            repairUtf8Mojibake(a.documentTitle).toLowerCase().includes(q) ||
            (a.scope || '').toLowerCase().includes(q) ||
            (a.textbookTitle || '').toLowerCase().includes(q)
          );
        }
        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'accuracy_asc') return (a.accuracyScore ?? 0) - (b.accuracyScore ?? 0);
        if (sortBy === 'accuracy_desc') return (b.accuracyScore ?? 0) - (a.accuracyScore ?? 0);
        return b.createdAt.localeCompare(a.createdAt);
      });
  }, [analyses, subjectFilter, gradeFilter, search, sortBy]);

  if (selectedRecord) {
    return (
      <AnalysisReportView
        analysis={selectedRecord}
        allAnalyses={analyses}
        onStartQuiz={onStartQuiz}
        onOpenFlashcards={onOpenFlashcards}
        onBack={() => onSelectAnalysis(null)}
      />
    );
  }

  const handleConfirmDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await deleteAnalysisRecord(confirmDelete.analysisId);
      if (confirmDelete.storagePath) {
        await deletePrivateStorageFile(confirmDelete.storagePath);
      }
      onDeleted(confirmDelete.analysisId);
      setConfirmDelete(null);
    } catch (err) {
      setDeleteError(
        err instanceof Error
          ? err.message
          : 'Không thể xóa bản phân tích lúc này. Vui lòng kiểm tra kết nối mạng và thử lại.'
      );
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-[#16243E] dark:text-[#E6EFFC]">
          Lịch sử kiểm định & ưu nhược điểm
        </h1>
        <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 mt-1">
          Toàn bộ báo cáo phân tích, vùng khoanh lỗi và dẫn chứng sách giáo khoa đều có thể mở lại
          bất cứ lúc nào (kể cả khi dịch vụ AI đang tạm nghỉ).
        </p>
      </div>

      {/* Filters */}
      <GlassSurface className="rounded-3xl p-4 sm:p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 z-10 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm tên tài liệu, phạm vi..."
            className="glass-control w-full pl-9 pr-3 py-2 rounded-xl text-xs text-[#16243E] dark:text-[#E6EFFC]"
          />
        </div>

        <select
          value={subjectFilter}
          onChange={(e) => setSubjectFilter(e.target.value)}
          className="glass-control px-3 py-2 rounded-xl text-xs text-[#16243E] dark:text-[#E6EFFC]"
        >
          <option value="all">Tất cả môn học</option>
          {(Object.keys(SUBJECT_LABELS) as SubjectId[]).map((s) => (
            <option key={s} value={s}>
              {SUBJECT_LABELS[s]}
            </option>
          ))}
        </select>

        <select
          value={gradeFilter}
          onChange={(e) => setGradeFilter(e.target.value)}
          className="glass-control px-3 py-2 rounded-xl text-xs text-[#16243E] dark:text-[#E6EFFC]"
        >
          <option value="all">Tất cả khối lớp</option>
          <option value="10">Lớp 10</option>
          <option value="11">Lớp 11</option>
          <option value="12">Lớp 12</option>
        </select>

        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as 'newest' | 'accuracy_asc' | 'accuracy_desc')}
          className="glass-control px-3 py-2 rounded-xl text-xs text-[#16243E] dark:text-[#E6EFFC]"
        >
          <option value="newest">Mới nhất trước</option>
          <option value="accuracy_desc">Chính xác cao nhất</option>
          <option value="accuracy_asc">Chính xác thấp nhất</option>
        </select>
      </GlassSurface>

      {filtered.length === 0 ? (
        <GlassSurface className="rounded-3xl p-8 sm:p-10 text-center space-y-3">
          <svg viewBox="0 0 96 72" className="w-24 h-18 mx-auto" aria-hidden="true">
            <rect x="14" y="14" width="68" height="48" rx="12" className="fill-[#EAF2FF] dark:fill-[#1E293B]" />
            <path d="M14 26h68" className="stroke-[#BFDBFE] dark:stroke-[#334155]" strokeWidth="2" />
            <rect x="26" y="34" width="44" height="5" rx="2.5" className="fill-[#2563EB]/75 dark:fill-[#60A5FA]/80" />
            <rect x="34" y="45" width="28" height="4.5" rx="2.25" className="fill-[#94A3B8]/65" />
            <circle cx="72" cy="20" r="3" className="fill-[#F5A623]" />
          </svg>
          <p className="font-semibold text-[#172033] dark:text-[#E6EFFC]">
            Chưa có tài liệu nào phù hợp bộ lọc
          </p>
          <p className="text-xs sm:text-sm text-[#525E75] dark:text-[#94A3B8] max-w-md mx-auto">
            Thử đổi từ khóa tìm kiếm, khối lớp hoặc tải lên tài liệu mới để lưu báo cáo đối chiếu SGK tại đây.
          </p>
        </GlassSurface>
      ) : (
        <div className="space-y-3">
          {filtered.map((item) => (
            <GlassSurface
              key={item.analysisId}
              className="rounded-3xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0" />
                  <h2 className="text-base font-bold text-[#16243E] dark:text-[#E6EFFC] truncate">
                    {repairUtf8Mojibake(item.documentTitle)}
                  </h2>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  {SUBJECT_LABELS[item.subject]} · Lớp {item.grade} ·{' '}
                  {item.textbookTitle || 'Chương trình chuẩn'} ·{' '}
                  {new Date(item.createdAt).toLocaleString('vi-VN')}
                </p>
                <div className="flex flex-wrap items-center gap-4 text-xs pt-1">
                  <span className="font-mono text-sky-700 dark:text-sky-400">
                    Chính xác: {item.accuracyScore !== null ? `${item.accuracyScore}%` : '—'}
                  </span>
                  <span className="font-mono text-sky-800 dark:text-sky-300">
                    Đầy đủ: {item.completenessScore !== null ? `${item.completenessScore}%` : '—'}
                  </span>
                  <span className="text-emerald-700 dark:text-emerald-400">
                    Điểm mạnh: {item.strengths.length}
                  </span>
                  <span className="text-rose-700 dark:text-rose-400">
                    Điểm yếu: {item.weaknesses.length}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <WaterRippleButton size="sm" onClick={() => onSelectAnalysis(item.analysisId)}>
                  Mở báo cáo & đối chiếu
                </WaterRippleButton>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(item)}
                  aria-label="Xóa bản phân tích"
                  className="p-2 rounded-xl border border-rose-200/80 dark:border-rose-800/70 bg-rose-50/70 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 hover:bg-rose-100/80 dark:hover:bg-rose-950/70 cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </GlassSurface>
          ))}

          {hasMore && (
            <div className="text-center pt-2">
              <WaterRippleButton variant="secondary" disabled={loadingMore} onClick={onLoadMore}>
                {loadingMore ? 'Đang tải thêm...' : 'Tải thêm lịch sử'}
              </WaterRippleButton>
            </div>
          )}
        </div>
      )}

      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/45 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <GlassSurface className="w-full max-w-sm rounded-3xl p-6 space-y-4">
            <h3 className="font-display text-base font-bold text-[#16243E] dark:text-[#E6EFFC]">
              Xác nhận xóa kết quả phân tích?
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              Thao tác này sẽ xóa báo cáo “{repairUtf8Mojibake(confirmDelete.documentTitle)}” khỏi lịch sử học tập trên
              Firestore.
            </p>
            {deleteError && (
              <p className="text-xs text-rose-600 dark:text-rose-400 bg-rose-50/80 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 rounded-xl px-3 py-2">
                {deleteError}
              </p>
            )}
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setConfirmDelete(null);
                  setDeleteError('');
                }}
                className="glass-control px-3.5 py-2 rounded-xl text-xs font-medium cursor-pointer"
              >
                Hủy
              </button>
              <WaterRippleButton
                variant="danger"
                size="sm"
                disabled={deleting}
                onClick={handleConfirmDelete}
              >
                {deleting ? 'Đang xóa...' : 'Xóa vĩnh viễn'}
              </WaterRippleButton>
            </div>
          </GlassSurface>
        </div>
      )}
    </div>
  );
};
