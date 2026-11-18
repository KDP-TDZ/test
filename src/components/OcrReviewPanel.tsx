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
              confidence: Math.max(b.confidence, 0.95), // Student manually verified
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

  return (
    <div className="space-y-5">
      <div className="glass-surface rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-bold text-slate-950">
            Rà soát văn bản trích xuất (OCR Review)
          </h2>
          <p className="text-xs text-slate-600 mt-1">
            Kiểm tra và chỉnh sửa chữ nhận diện nếu ảnh bị mờ hoặc chữ viết tay chưa rõ trước khi AI
            đối chiếu kiến thức.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={onBack}
            className="px-3.5 py-2 rounded-xl text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 cursor-pointer"
          >
            Chọn lại tệp
          </button>
          <WaterRippleButton onClick={onConfirmOcr}>
            <CheckCircle2 className="w-4 h-4" />
            Xác nhận nội dung OCR
          </WaterRippleButton>
        </div>
      </div>

      {lowConfidenceCount > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/90 px-4 py-3 flex items-start gap-3 text-xs text-amber-950">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <span>
            Phát hiện <strong>{lowConfidenceCount}</strong> đoạn có độ tin cậy nhận diện thấp (dưới
            72%). Những đoạn này được tô viền vàng bên dưới để bạn sửa lại nếu cần; hệ thống sẽ không
            tính nhầm lỗi nhận diện thành sai kiến thức.
          </span>
        </div>
      )}

      {/* Split OCR Preview & Editable Blocks */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Crisp Document Preview */}
        <div className="lg:col-span-6 document-paper rounded-2xl p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-4 border-b border-slate-200">
            <div className="flex items-center gap-2 text-xs font-medium text-slate-700">
              <button
                type="button"
                disabled={activePageIndex === 0}
                onClick={() => setActivePageIndex((i) => Math.max(0, i - 1))}
                className="p-1.5 rounded-lg border border-slate-200 disabled:opacity-40 hover:bg-slate-50 cursor-pointer"
                aria-label="Trang trước"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="font-mono tabular-nums">
                Trang {activePageIndex + 1} / {pages.length}
              </span>
              <button
                type="button"
                disabled={activePageIndex >= pages.length - 1}
                onClick={() => setActivePageIndex((i) => Math.min(pages.length - 1, i + 1))}
                className="p-1.5 rounded-lg border border-slate-200 disabled:opacity-40 hover:bg-slate-50 cursor-pointer"
                aria-label="Trang sau"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(0.7, Number((z - 0.15).toFixed(2))))}
                className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer"
                aria-label="Thu nhỏ"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <span className="font-mono text-xs text-slate-600 tabular-nums w-12 text-center">
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(1.8, Number((z + 0.15).toFixed(2))))}
                className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer"
                aria-label="Phóng to"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="max-h-[560px] overflow-auto rounded-xl bg-slate-50 p-3 flex justify-center">
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
                className="max-w-none h-auto rounded-lg border border-slate-200 bg-white"
              />
            ) : (
              <div className="w-full p-5 text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
                <div className="flex items-center gap-2 text-xs text-slate-500 mb-3">
                  <FileText className="w-4 h-4" />
                  <span>Xem trước văn bản trích xuất từ DOCX</span>
                </div>
                {currentPage.rawText}
              </div>
            )}
          </div>
        </div>

        {/* Right: Editable Extracted Blocks */}
        <div className="lg:col-span-6 glass-surface rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-200/80 pb-3">
            <h3 className="font-display text-sm font-bold text-slate-900">
              Văn bản nhận diện — Trang {currentPage.pageNumber}
            </h3>
            <span className="font-mono text-xs text-slate-600 tabular-nums">
              Độ tin cậy TB: {Math.round(currentPage.ocrAverageConfidence * 100)}%
            </span>
          </div>

          <div className="max-h-[520px] overflow-y-auto space-y-3 pr-1">
            {currentPage.blocks.map((block) => {
              const isUncertain = block.confidence < 0.72;
              return (
                <div
                  key={block.blockId}
                  className={`rounded-xl p-3 border transition-colors ${
                    isUncertain
                      ? 'bg-amber-50/80 border-amber-300'
                      : 'bg-white/90 border-slate-200'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1.5 text-[11px] text-slate-500">
                    <span className="font-medium text-slate-700">
                      {TEXT_TYPE_LABELS[block.textType] || block.textType} · Đoạn #{block.readingOrder}
                    </span>
                    <span
                      className={`font-mono tabular-nums ${
                        isUncertain ? 'text-amber-700 font-semibold' : 'text-emerald-700'
                      }`}
                    >
                      Tin cậy {Math.round(block.confidence * 100)}%
                    </span>
                  </div>
                  <textarea
                    value={block.extractedText}
                    onChange={(e) => handleUpdateBlock(block.blockId, e.target.value)}
                    rows={Math.max(2, Math.min(6, Math.ceil(block.extractedText.length / 68)))}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 leading-relaxed focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                  {block.formulaText && (
                    <p className="mt-1.5 font-mono text-xs text-indigo-700 bg-indigo-50/70 px-2.5 py-1 rounded-md">
                      Công thức nhận diện: {block.formulaText}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
