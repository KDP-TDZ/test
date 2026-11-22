import React, { useState } from 'react';
import {
  CheckCircle2,
  FileCheck2,
  FileSpreadsheet,
  FileText,
  Loader2,
  Printer,
  RefreshCw,
  ScrollText,
  X,
} from 'lucide-react';
import {
  SUBJECT_LABELS,
  type AnalysisRecord,
} from '../core/types';
import type { VerificationSummaryReport } from '../core/summaryReportBuilder';
import {
  exportSummaryAsDocx,
  exportSummaryAsTxt,
  exportSummaryAsXlsx,
  type SummaryExportFormat,
} from '../services/summaryExportService';
import { AnimatedModal } from './LiquidGlass/AnimatedModal';
import { WaterRippleButton } from './LiquidGlass/WaterRippleButton';

interface SummaryExportModalProps {
  open: boolean;
  onClose: () => void;
  analysis: AnalysisRecord;
  actionableCount: number;
  resolvedCount: number;
  confirmedSummary: VerificationSummaryReport | null;
  includeStudentCorrections: boolean;
  onChangeIncludeStudentCorrections: (val: boolean) => void;
  includeCoverageAndSources: boolean;
  onChangeIncludeCoverageAndSources: (val: boolean) => void;
  customNote: string;
  onChangeCustomNote: (val: string) => void;
  onConfirmCreate: () => void;
  onResetConfirmation: () => void;
  onPrintSummaryPdf: () => void;
}

export const SummaryExportModal: React.FC<SummaryExportModalProps> = ({
  open,
  onClose,
  analysis,
  actionableCount,
  resolvedCount,
  confirmedSummary,
  includeStudentCorrections,
  onChangeIncludeStudentCorrections,
  includeCoverageAndSources,
  onChangeIncludeCoverageAndSources,
  customNote,
  onChangeCustomNote,
  onConfirmCreate,
  onResetConfirmation,
  onPrintSummaryPdf,
}) => {
  const [downloadingFormat, setDownloadingFormat] = useState<SummaryExportFormat | null>(null);
  const [downloadNotice, setDownloadNotice] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const handleDownload = async (format: SummaryExportFormat) => {
    if (!confirmedSummary || downloadingFormat) return;
    setDownloadingFormat(format);
    setDownloadNotice(null);
    setDownloadError(null);
    try {
      if (format === 'txt') {
        const fileName = exportSummaryAsTxt(confirmedSummary);
        setDownloadNotice(`Đã tạo và tải xuống tệp văn bản: ${fileName}`);
      } else if (format === 'docx') {
        const fileName = await exportSummaryAsDocx(confirmedSummary);
        setDownloadNotice(`Đã tạo và tải xuống tệp Word: ${fileName}`);
      } else if (format === 'xlsx') {
        const fileName = await exportSummaryAsXlsx(confirmedSummary);
        setDownloadNotice(`Đã tạo và tải xuống tệp Excel: ${fileName}`);
      } else if (format === 'pdf') {
        onPrintSummaryPdf();
        setDownloadNotice('Đã mở hộp thoại In / Lưu thành PDF cho bản tổng kết.');
      }
    } catch (err) {
      setDownloadError(
        err instanceof Error
          ? err.message
          : 'Không thể tạo tệp tải xuống lúc này. Vui lòng thử lại.'
      );
    } finally {
      setDownloadingFormat(null);
    }
  };

  return (
    <AnimatedModal
      open={open}
      onClose={onClose}
      maxWidthClassName="max-w-xl"
      panelClassName="p-5 sm:p-7"
      ariaLabelledBy="summary-export-modal-title"
    >
      <div className="space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="size-10 rounded-2xl bg-sky-500/15 dark:bg-sky-400/15 border border-sky-300/60 dark:border-sky-500/30 flex items-center justify-center shrink-0">
              <FileCheck2 className="w-5 h-5 text-sky-600 dark:text-sky-400" />
            </div>
            <div>
              <h2
                id="summary-export-modal-title"
                className="font-display text-lg font-bold text-[#16243E] dark:text-[#E6EFFC]"
              >
                {confirmedSummary
                  ? 'Bản tổng kết kiểm định đã sẵn sàng'
                  : 'Xác nhận tạo bản tổng kết kiểm định?'}
              </h2>
              <p className="text-xs text-[#475B78] dark:text-[#B4C7E2] mt-0.5 leading-relaxed">
                {confirmedSummary
                  ? `Đã xác nhận tạo lúc ${confirmedSummary.confirmedAtDisplay}. Chọn định dạng bạn muốn tải về.`
                  : 'Hệ thống chỉ tổng hợp và tạo tệp bản tổng kết sau khi bạn bấm xác nhận bên dưới.'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng hộp thoại"
            className="size-8 rounded-xl glass-control inline-flex items-center justify-center text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {!confirmedSummary ? (
          <>
            {/* Pre-confirmation summary preview */}
            <div className="document-paper rounded-2xl p-4 text-xs space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-200/80 dark:border-slate-700/80">
                <span className="font-bold text-sm text-[#16243E] dark:text-[#E6EFFC]">
                  {analysis.documentTitle}
                </span>
                <span className="font-mono text-[11px] text-sky-700 dark:text-sky-400 font-semibold">
                  {SUBJECT_LABELS[analysis.subject]} · Lớp {analysis.grade}
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-0.5">
                <div className="rounded-xl bg-slate-50 dark:bg-slate-900/70 px-3 py-2 border border-slate-200/70 dark:border-slate-800">
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">Độ chính xác</p>
                  <p className="font-mono font-bold text-sm text-[#16243E] dark:text-[#E6EFFC]">
                    {analysis.accuracyScore !== null ? `${analysis.accuracyScore}%` : '—'}
                  </p>
                </div>
                <div className="rounded-xl bg-slate-50 dark:bg-slate-900/70 px-3 py-2 border border-slate-200/70 dark:border-slate-800">
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">Độ đầy đủ</p>
                  <p className="font-mono font-bold text-sm text-[#16243E] dark:text-[#E6EFFC]">
                    {analysis.completenessScore !== null ? `${analysis.completenessScore}%` : '—'}
                  </p>
                </div>
                <div className="rounded-xl bg-slate-50 dark:bg-slate-900/70 px-3 py-2 border border-slate-200/70 dark:border-slate-800">
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">Mệnh đề</p>
                  <p className="font-mono font-bold text-sm text-[#16243E] dark:text-[#E6EFFC]">
                    {analysis.claims.length}
                  </p>
                </div>
                <div className="rounded-xl bg-slate-50 dark:bg-slate-900/70 px-3 py-2 border border-slate-200/70 dark:border-slate-800">
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">Đã tự sửa</p>
                  <p className="font-mono font-bold text-sm text-emerald-700 dark:text-emerald-400">
                    {resolvedCount}/{actionableCount}
                  </p>
                </div>
              </div>
            </div>

            {/* Confirmation Options */}
            <div className="space-y-3 text-xs">
              <label className="flex items-start gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={includeStudentCorrections}
                  onChange={(e) => onChangeIncludeStudentCorrections(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                />
                <span className="text-[#16243E] dark:text-[#E6EFFC] leading-relaxed">
                  Kèm nội dung <strong>tự sửa lỗi & trạng thái đã sửa</strong> bạn đã ghi ở Bước 4
                </span>
              </label>

              <label className="flex items-start gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={includeCoverageAndSources}
                  onChange={(e) => onChangeIncludeCoverageAndSources(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                />
                <span className="text-[#16243E] dark:text-[#E6EFFC] leading-relaxed">
                  Kèm <strong>bảng kiểm độ bao phủ chương SGK</strong> và nguồn tham khảo ngoài sách
                </span>
              </label>

              <div className="space-y-1.5">
                <label
                  htmlFor="summary-custom-note"
                  className="block font-semibold text-[#16243E] dark:text-[#E6EFFC]"
                >
                  Ghi chú cá nhân kèm bản tổng kết (tùy chọn)
                </label>
                <input
                  id="summary-custom-note"
                  type="text"
                  maxLength={200}
                  value={customNote}
                  onChange={(e) => onChangeCustomNote(e.target.value)}
                  placeholder="Ví dụ: Ôn tập chuẩn bị kiểm tra giữa kỳ..."
                  className="glass-control w-full px-3.5 py-2.5 rounded-xl text-xs"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2.5 pt-2 border-t border-sky-200/60 dark:border-slate-700/80">
              <button
                type="button"
                onClick={onClose}
                className="glass-control min-h-[42px] px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer"
              >
                Chưa tạo, đóng lại
              </button>
              <WaterRippleButton onClick={onConfirmCreate}>
                <CheckCircle2 className="w-4 h-4" />
                <span>Xác nhận tạo bản tổng kết</span>
              </WaterRippleButton>
            </div>
          </>
        ) : (
          <>
            {/* Confirmed State & Multi-format Downloads */}
            <div className="rounded-2xl border border-emerald-200/90 dark:border-emerald-800/70 bg-emerald-50/75 dark:bg-emerald-950/35 p-3.5 text-xs text-emerald-900 dark:text-emerald-200 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-semibold">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span>Đã xác nhận tạo bản tổng kết · Mã tệp: {confirmedSummary.fileBaseName}</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setDownloadNotice(null);
                  setDownloadError(null);
                  onResetConfirmation();
                }}
                className="inline-flex items-center gap-1 text-[11px] font-semibold underline cursor-pointer"
              >
                <RefreshCw className="w-3 h-3" />
                Tạo lại với tùy chọn khác
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                disabled={downloadingFormat !== null}
                onClick={() => handleDownload('docx')}
                className="document-paper rounded-2xl p-4 text-left hover:border-sky-400 dark:hover:border-sky-500 transition-colors cursor-pointer disabled:opacity-60 flex items-start gap-3"
              >
                <div className="size-9 rounded-xl bg-blue-500/12 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                  {downloadingFormat === 'docx' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <FileText className="w-4 h-4" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-[#16243E] dark:text-[#E6EFFC]">
                    Tải Word (.docx)
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    Báo cáo đầy đủ có bảng biểu, dễ chỉnh sửa & nộp bài
                  </p>
                </div>
              </button>

              <button
                type="button"
                disabled={downloadingFormat !== null}
                onClick={() => handleDownload('xlsx')}
                className="document-paper rounded-2xl p-4 text-left hover:border-emerald-400 dark:hover:border-emerald-500 transition-colors cursor-pointer disabled:opacity-60 flex items-start gap-3"
              >
                <div className="size-9 rounded-xl bg-emerald-500/12 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                  {downloadingFormat === 'xlsx' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <FileSpreadsheet className="w-4 h-4" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-[#16243E] dark:text-[#E6EFFC]">
                    Tải Excel (.xlsx)
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    3 sheet: Tổng quan, Mệnh đề & Đánh giá bao phủ
                  </p>
                </div>
              </button>

              <button
                type="button"
                disabled={downloadingFormat !== null}
                onClick={() => handleDownload('txt')}
                className="document-paper rounded-2xl p-4 text-left hover:border-indigo-400 dark:hover:border-indigo-500 transition-colors cursor-pointer disabled:opacity-60 flex items-start gap-3"
              >
                <div className="size-9 rounded-xl bg-indigo-500/12 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
                  {downloadingFormat === 'txt' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <ScrollText className="w-4 h-4" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-[#16243E] dark:text-[#E6EFFC]">
                    Tải Văn bản (.txt)
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    Chuẩn UTF-8 gọn nhẹ, mở nhanh trên mọi thiết bị
                  </p>
                </div>
              </button>

              <button
                type="button"
                disabled={downloadingFormat !== null}
                onClick={() => handleDownload('pdf')}
                className="document-paper rounded-2xl p-4 text-left hover:border-rose-400 dark:hover:border-rose-500 transition-colors cursor-pointer disabled:opacity-60 flex items-start gap-3"
              >
                <div className="size-9 rounded-xl bg-rose-500/12 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
                  {downloadingFormat === 'pdf' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Printer className="w-4 h-4" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-[#16243E] dark:text-[#E6EFFC]">
                    Xuất PDF (In / Lưu PDF)
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    Bản trình bày in ấn có chữ ký xác thực StudyCheck AI
                  </p>
                </div>
              </button>
            </div>

            {downloadNotice && (
              <div className="rounded-xl border border-sky-200 dark:border-sky-800/70 bg-sky-50/80 dark:bg-sky-950/40 px-3.5 py-2.5 text-xs text-sky-900 dark:text-sky-200">
                {downloadNotice}
              </div>
            )}
            {downloadError && (
              <div className="rounded-xl border border-rose-200 dark:border-rose-800/70 bg-rose-50/80 dark:bg-rose-950/40 px-3.5 py-2.5 text-xs text-rose-800 dark:text-rose-200">
                {downloadError}
              </div>
            )}

            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={onClose}
                className="glass-control min-h-[40px] px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer"
              >
                Đóng
              </button>
            </div>
          </>
        )}
      </div>
    </AnimatedModal>
  );
};
