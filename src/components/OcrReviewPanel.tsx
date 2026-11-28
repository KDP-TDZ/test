import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  FileText,
} from 'lucide-react';
import type { ExtractedPage } from '../core/types';
import { PdfPageCanvas } from './PdfPageCanvas';
import { WaterRippleButton } from './LiquidGlass/WaterRippleButton';

interface OcrReviewPanelProps {
  pages: ExtractedPage[];
  previewFiles: File[];
  mimeType: string;
  onChangePages: (updated: ExtractedPage[]) => void;
  onConfirmOcr: () => void;
  onBack: () => void;
}

const TEXT_TYPE_LABELS: Record<string, string> = {
  heading: 'Tiêu đề',
  paragraph: 'Đoạn văn',
  formula: 'Công thức',
  table: 'Bảng biểu',
  list: 'Danh sách',
  handwriting: 'Chữ viết tay',
};

export const OcrReviewPanel: React.FC<OcrReviewPanelProps> = ({
  pages,
  previewFiles,
  mimeType,
  onChangePages,
  onConfirmOcr,
  onBack,
}) => {
  const [activePageIndex, setActivePageIndex] = useState(0);
  const [zoom, setZoom] = useState(1.0);
  const [editMode, setEditMode] = useState<'blocks' | 'raw'>('blocks');
  const [objectUrls, setObjectUrls] = useState<Record<number, string>>({});

  React.useEffect(() => {
    const urls: Record<number, string> = {};
    if (mimeType.startsWith('image/')) {
      previewFiles.forEach((f, idx) => {
        urls[idx] = URL.createObjectURL(f);
      });
    }
    setObjectUrls(urls);
    return () => {
      Object.values(urls).forEach((u) => URL.revokeObjectURL(u));
    };
  }, [previewFiles, mimeType]);

  const currentPage = pages[activePageIndex] || pages[0];
  if (!currentPage) return null;

  const lowConfidenceCount = pages.reduce(
    (sum, p) => sum + p.blocks.filter((b) => b.confidence < 0.72).length,
    0
  );

  const handleUpdateBlock = (blockId: string, newText: string) => {
    const nextPages = pages.map((page, idx) => {
      if (idx !== activePageIndex) return page;
      const nextBlocks = page.blocks.map((b) =>
        b.blockId === blockId
          ? {
              ...b,
              extractedText: newText,
              ...(b.textType === 'formula' || b.formulaText !== undefined
                ? { formulaText: newText }
                : {}),
              confidence: Math.max(b.confidence, 0.95),
            }
          : b
      );
      return {
        ...page,
        blocks: nextBlocks,
        rawText: nextBlocks.map((b) => b.extractedText).join('\n'),
        ocrAverageConfidence:
          nextBlocks.length > 0
            ? Math.round(
                (nextBlocks.reduce((s, b) => s + b.confidence, 0) / nextBlocks.length) * 100
              ) / 100
            : page.ocrAverageConfidence,
      };
    });
    onChangePages(nextPages);
  };

  const handleUpdateRawPageText = (newRawText: string) => {
    const lines = newRawText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const nextPages = pages.map((page, idx) => {
      if (idx !== activePageIndex) return page;
      const nextBlocks = (lines.length > 0 ? lines : [newRawText]).map((line, bIdx) => ({
        blockId: page.blocks[bIdx]?.blockId || `p${page.pageNumber}_b${bIdx + 1}`,
        pageNumber: page.pageNumber,
        readingOrder: bIdx + 1,
        textType: page.blocks[bIdx]?.textType || ('paragraph' as const),
        extractedText: line,
        confidence: 0.96,
      }));
      return {
        ...page,
        rawText: newRawText,
        blocks: nextBlocks,
        ocrAverageConfidence: 0.96,
      };
    });
    onChangePages(nextPages);
  };

  return (
    <div className="space-y-4">
      <div className="glass-surface rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-base sm:text-lg font-bold text-[#16243E] dark:text-[#E6EFFC]">
            Rà soát văn bản trích xuất trước khi đối chiếu SGK
          </h2>
          <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
            Kiểm tra nhanh nội dung trang {currentPage.pageNumber}/{pages.length}. Bạn có thể chỉnh sửa trực tiếp hoặc bấm xác nhận để kiểm định ngay.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onBack}
            className="glass-control px-3.5 py-2 rounded-xl text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer whitespace-nowrap"
          >
            Chọn lại tệp
          </button>
          <WaterRippleButton onClick={onConfirmOcr}>
            <CheckCircle2 className="w-4 h-4" />
            Xác nhận & Đối chiếu SGK ngay
          </WaterRippleButton>
        </div>
      </div>

      {lowConfidenceCount > 0 && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-800/70 bg-amber-50/90 dark:bg-amber-950/40 px-4 py-2.5 flex items-start gap-2.5 text-xs text-amber-950 dark:text-amber-200">
          <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <span>
            Có <strong>{lowConfidenceCount}</strong> đoạn chữ mờ / viết tay chưa rõ (đánh dấu màu vàng cam bên dưới). Bạn có thể sửa lại trước khi đối chiếu; hệ thống không chấm nhầm chữ mờ thành sai kiến thức.
          </span>
        </div>
      )}

      {/* Split OCR Preview & Editable Blocks */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        <div className="lg:col-span-6 document-paper rounded-2xl p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-3 border-b border-sky-200/70 dark:border-slate-700">
            <div className="flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-200">
              <button
                type="button"
                disabled={activePageIndex === 0}
                onClick={() => setActivePageIndex((i) => Math.max(0, i - 1))}
                className="glass-control p-1.5 rounded-lg disabled:opacity-40 cursor-pointer"
                aria-label="Trang trước"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="font-mono tabular-nums px-1">
                Trang {activePageIndex + 1} / {pages.length}
              </span>
              <button
                type="button"
                disabled={activePageIndex >= pages.length - 1}
                onClick={() => setActivePageIndex((i) => Math.min(pages.length - 1, i + 1))}
                className="glass-control p-1.5 rounded-lg disabled:opacity-40 cursor-pointer"
                aria-label="Trang sau"
              >
                <ChevronRight className="w-4 h-4" />
              </button>

              {pages.length > 1 && pages.length <= 8 && (
                <div className="hidden sm:flex items-center gap-1 ml-1">
                  {pages.map((p, idx) => (
                    <button
                      key={p.pageNumber}
                      type="button"
                      onClick={() => setActivePageIndex(idx)}
                      className={`size-6 rounded-md font-mono text-[11px] font-semibold cursor-pointer transition-colors ${
                        idx === activePageIndex
                          ? 'bg-[#2563EB] text-white'
                          : 'glass-control text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      {p.pageNumber}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(0.7, Number((z - 0.15).toFixed(2))))}
                className="glass-control p-1.5 rounded-lg cursor-pointer"
                aria-label="Thu nhỏ"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <span className="font-mono text-xs text-slate-600 dark:text-slate-300 tabular-nums w-11 text-center">
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(1.8, Number((z + 0.15).toFixed(2))))}
                className="glass-control p-1.5 rounded-lg cursor-pointer"
                aria-label="Phóng to"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="max-h-[540px] overflow-auto rounded-xl bg-sky-50/60 dark:bg-slate-900/70 p-3 flex justify-center">
            {mimeType === 'application/pdf' && previewFiles[0] ? (
              <PdfPageCanvas
                file={previewFiles[0]}
                pageNumber={currentPage.pageNumber}
                scale={zoom}
              />
            ) : mimeType.startsWith('image/') && objectUrls[activePageIndex] ? (
              <img
                src={objectUrls[activePageIndex]}
                alt={`Trang ${currentPage.pageNumber}`}
                style={{ width: `${Math.round(zoom * 100)}%` }}
                className="max-w-none h-auto rounded-xl border border-sky-200/70 dark:border-slate-700 bg-white"
              />
            ) : (
              <div className="w-full p-4 text-sm text-slate-700 dark:text-slate-200 leading-relaxed whitespace-pre-wrap">
                <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mb-2">
                  <FileText className="w-4 h-4" />
                  <span>Bản xem trước văn bản gốc</span>
                </div>
                {currentPage.rawText}
              </div>
            )}
          </div>
        </div>

        <div className="lg:col-span-6 glass-surface rounded-2xl p-4 sm:p-5 space-y-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-sky-200/60 dark:border-slate-700/80 pb-3">
            <div>
              <h3 className="font-display text-sm font-bold text-[#16243E] dark:text-[#E6EFFC]">
                Văn bản nhận diện — Trang {currentPage.pageNumber}
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums mt-0.5">
                {currentPage.blocks.length} đoạn · Độ tin cậy OCR: {Math.round(currentPage.ocrAverageConfidence * 100)}%
              </p>
            </div>

            <div className="inline-flex items-center gap-1 p-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs">
              <button
                type="button"
                onClick={() => setEditMode('blocks')}
                className={`px-2.5 py-1 rounded-md font-medium cursor-pointer transition-colors whitespace-nowrap ${
                  editMode === 'blocks'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                Theo từng đoạn
              </button>
              <button
                type="button"
                onClick={() => setEditMode('raw')}
                className={`px-2.5 py-1 rounded-md font-medium cursor-pointer transition-colors whitespace-nowrap ${
                  editMode === 'raw'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                Toàn trang
              </button>
            </div>
          </div>

          {editMode === 'raw' ? (
            <div className="space-y-2">
              <textarea
                value={currentPage.rawText}
                onChange={(e) => handleUpdateRawPageText(e.target.value)}
                rows={16}
                aria-label={`Toàn bộ văn bản trang ${currentPage.pageNumber}`}
                className="glass-control w-full rounded-xl p-3 text-sm text-[#16243E] dark:text-[#E6EFFC] leading-relaxed font-sans"
              />
            </div>
          ) : (
            <div className="max-h-[500px] overflow-y-auto space-y-2.5 pr-1">
              {currentPage.blocks.map((block) => {
                const isUncertain = block.confidence < 0.72;
                return (
                  <div
                    key={block.blockId}
                    className={`rounded-xl p-3 border transition-colors ${
                      isUncertain
                        ? 'bg-amber-50/80 dark:bg-amber-950/35 border-amber-300 dark:border-amber-700'
                        : 'glass-panel-subtle'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                      <span className="font-medium text-slate-700 dark:text-slate-200">
                        {TEXT_TYPE_LABELS[block.textType] || block.textType} · Đoạn #{block.readingOrder}
                      </span>
                      <span
                        className={`font-mono tabular-nums ${
                          isUncertain
                            ? 'text-amber-700 dark:text-amber-400 font-semibold'
                            : 'text-emerald-700 dark:text-emerald-400'
                        }`}
                      >
                        {isUncertain ? 'Cần kiểm tra chữ' : 'Rõ nét'}
                      </span>
                    </div>
                    <textarea
                      value={block.extractedText}
                      onChange={(e) => handleUpdateBlock(block.blockId, e.target.value)}
                      rows={Math.max(2, Math.min(5, Math.ceil(block.extractedText.length / 72)))}
                      className="glass-control w-full rounded-lg px-2.5 py-1.5 text-sm text-[#16243E] dark:text-[#E6EFFC] leading-relaxed"
                    />
                    {block.formulaText && (
                      <p className="mt-1.5 font-mono text-xs text-sky-800 dark:text-sky-300 bg-sky-50/80 dark:bg-sky-950/50 px-2.5 py-1 rounded-lg border border-sky-200/70 dark:border-sky-800/60">
                        Công thức: {block.formulaText}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
