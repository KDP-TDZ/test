import React, { useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Eye,
  EyeOff,
  Globe,
  Maximize2,
  Minimize2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  SUBJECT_LABELS,
  type AnalysisRecord,
  type AnnotationItem,
  type ExtractedClaim,
  type KnowledgeCoverageItem,
} from '../core/types';
import { PdfPageCanvas } from './PdfPageCanvas';

interface SplitDocumentViewerProps {
  analysis: AnalysisRecord;
  localFile?: File | null;
}

const COLOR_STYLES: Record<
  AnnotationItem['annotationColor'],
  { bg: string; border: string; ring: string; label: string; text: string }
> = {
  red: {
    bg: 'bg-rose-50/90',
    border: 'border-rose-300',
    ring: 'ring-rose-200',
    label: 'Sai kiến thức',
    text: 'text-rose-800',
  },
  orange: {
    bg: 'bg-amber-50/90',
    border: 'border-amber-300',
    ring: 'ring-amber-200',
    label: 'Đúng một phần',
    text: 'text-amber-800',
  },
  yellow: {
    bg: 'bg-yellow-50/90',
    border: 'border-yellow-300',
    ring: 'ring-yellow-200',
    label: 'Cần xác minh / OCR chưa rõ',
    text: 'text-yellow-800',
  },
  green: {
    bg: 'bg-emerald-50/85',
    border: 'border-emerald-300',
    ring: 'ring-emerald-200',
    label: 'Chính xác có dẫn chứng',
    text: 'text-emerald-800',
  },
};

export const SplitDocumentViewer: React.FC<SplitDocumentViewerProps> = ({
  analysis,
  localFile,
}) => {
  const [pageIndex, setPageIndex] = useState(0);
  const [zoom, setZoom] = useState(1.0);
  const [showAnnotations, setShowAnnotations] = useState(true);
  const [viewMode, setViewMode] = useState<'split' | 'original' | 'annotations'>('split');
  const [mobileTab, setMobileTab] = useState<'student' | 'reference' | 'explanation'>('student');
  const [expanded, setExpanded] = useState(false);

  const [selectedClaimId, setSelectedClaimId] = useState<string | null>(
    analysis.claims[0]?.claimId || null
  );
  const [selectedCoverageId, setSelectedCoverageId] = useState<string | null>(null);

  const rightPanelRef = useRef<HTMLDivElement>(null);

  const pages = analysis.extractedPages || [];
  const currentPage = pages[pageIndex] || pages[0];
  const currentPageNumber = currentPage?.pageNumber || 1;

  const pageAnnotations = useMemo(
    () => (analysis.annotations || []).filter((a) => a.pageNumber === currentPageNumber),
    [analysis.annotations, currentPageNumber]
  );

  const selectedClaim: ExtractedClaim | undefined = useMemo(
    () => analysis.claims.find((c) => c.claimId === selectedClaimId),
    [analysis.claims, selectedClaimId]
  );

  const selectedCoverage: KnowledgeCoverageItem | undefined = useMemo(
    () => analysis.coverageItems.find((cov) => cov.itemId === selectedCoverageId),
    [analysis.coverageItems, selectedCoverageId]
  );

  const selectClaim = (claimId: string) => {
    setSelectedCoverageId(null);
    setSelectedClaimId(claimId);
    setMobileTab('explanation');
    if (rightPanelRef.current) {
      rightPanelRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const selectCoverage = (itemId: string) => {
    setSelectedClaimId(null);
    setSelectedCoverageId(itemId);
    setMobileTab('explanation');
  };

  const matchAnnotationForBlock = (blockId: string, blockText: string): AnnotationItem | undefined => {
    const byId = pageAnnotations.find((a) => a.blockId && a.blockId === blockId);
    if (byId) return byId;
    const normalized = blockText.toLowerCase();
    return pageAnnotations.find((a) => {
      const needle = a.textExcerpt.trim().toLowerCase().slice(0, 36);
      return needle.length >= 8 && normalized.includes(needle);
    });
  };

  const canRenderPdfPreview =
    analysis.mimeType === 'application/pdf' &&
    Boolean(localFile || analysis.storageDownloadUrl);

  return (
    <div
      className={`${
        expanded ? 'fixed inset-3 z-50 bg-slate-50/95 backdrop-blur-md p-4 rounded-3xl shadow-2xl overflow-auto' : ''
      } space-y-4`}
    >
      {/* Toolbar */}
      <div className="glass-surface rounded-2xl px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={pageIndex === 0}
            onClick={() => setPageIndex((i) => Math.max(0, i - 1))}
            className="p-1.5 rounded-lg border border-slate-200 bg-white disabled:opacity-40 cursor-pointer"
            aria-label="Trang trước"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="font-mono text-xs font-medium text-slate-700 tabular-nums px-1">
            Trang {currentPageNumber} / {Math.max(1, pages.length)}
          </span>
          <button
            type="button"
            disabled={pageIndex >= pages.length - 1}
            onClick={() => setPageIndex((i) => Math.min(pages.length - 1, i + 1))}
            className="p-1.5 rounded-lg border border-slate-200 bg-white disabled:opacity-40 cursor-pointer"
            aria-label="Trang sau"
          >
            <ChevronRight className="w-4 h-4" />
          </button>

          <div className="h-4 w-px bg-slate-200 mx-1 hidden sm:block" />

          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(0.75, Number((z - 0.1).toFixed(2))))}
            className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 cursor-pointer"
            aria-label="Thu nhỏ"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <span className="font-mono text-xs text-slate-600 tabular-nums w-11 text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(1.5, Number((z + 0.1).toFixed(2))))}
            className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 cursor-pointer"
            aria-label="Phóng to"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowAnnotations((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            {showAnnotations ? <Eye className="w-3.5 h-3.5 text-sky-600" /> : <EyeOff className="w-3.5 h-3.5" />}
            {showAnnotations ? 'Ẩn đánh dấu' : 'Hiện đánh dấu'}
          </button>

          <div className="hidden lg:inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs">
            {(
              [
                ['split', 'Hai cột'],
                ['original', 'Chỉ bài làm'],
                ['annotations', 'Chỉ dẫn chứng'],
              ] as const
            ).map(([m, label]) => (
              <button
                key={m}
                type="button"
                onClick={() => setViewMode(m)}
                className={`px-2.5 py-1 rounded-md font-medium cursor-pointer ${
                  viewMode === m ? 'bg-sky-600 text-white' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 cursor-pointer"
            aria-label={expanded ? 'Thu gọn trình đối chiếu' : 'Mở rộng toàn màn hình'}
          >
            {expanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Tablet/Mobile Tabs */}
      <div className="flex lg:hidden rounded-xl border border-slate-200 bg-white/85 p-1 text-xs font-medium">
        {(
          [
            ['student', 'Tài liệu học sinh'],
            ['reference', 'Dẫn chứng & Nguồn'],
            ['explanation', 'Giải thích chi tiết'],
          ] as const
        ).map(([tab, label]) => (
          <button
            key={tab}
            type="button"
            onClick={() => setMobileTab(tab)}
            className={`flex-1 py-2 rounded-lg text-center cursor-pointer ${
              mobileTab === tab ? 'bg-sky-600 text-white' : 'text-slate-600'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Color Legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-600 px-1">
        <span className="font-medium text-slate-700">Chú giải vùng đánh dấu:</span>
        <span className="text-rose-700 font-medium">● Đỏ: Sai kiến thức</span>
        <span className="text-amber-700 font-medium">● Cam: Đúng một phần / Thiếu điều kiện</span>
        <span className="text-yellow-700 font-medium">● Vàng: Cần xác minh / OCR chưa rõ</span>
        <span className="text-emerald-700 font-medium">● Xanh lá: Chính xác / Dẫn chứng chuẩn</span>
      </div>

      {/* Split Columns */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* LEFT COLUMN: Crisp Student Document */}
        {(viewMode === 'split' || viewMode === 'original') && (
          <div
            className={`${
              viewMode === 'original' ? 'lg:col-span-12' : 'lg:col-span-6'
            } ${mobileTab === 'student' ? 'block' : 'hidden lg:block'} document-paper rounded-2xl p-5 sm:p-6`}
          >
            <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-200 text-xs text-slate-500">
              <span className="font-semibold text-slate-800 truncate">{analysis.documentTitle}</span>
              <span className="font-mono shrink-0">
                {SUBJECT_LABELS[analysis.subject]} · Lớp {analysis.grade}
              </span>
            </div>

            {/* Visual Page Preview with optional Bounding Box Overlays */}
            {(canRenderPdfPreview || currentPage?.imageUrl) && (
              <div className="mb-5 relative overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-3 flex justify-center">
                <div className="relative inline-block">
                  {canRenderPdfPreview ? (
                    <PdfPageCanvas
                      file={localFile}
                      url={analysis.storageDownloadUrl}
                      pageNumber={currentPageNumber}
                      scale={zoom}
                    />
                  ) : currentPage?.imageUrl ? (
                    <img
                      src={currentPage.imageUrl}
                      alt={`Trang ${currentPageNumber}`}
                      style={{ width: `${Math.round(zoom * 100)}%` }}
                      className="rounded-lg bg-white"
                    />
                  ) : null}

                  {showAnnotations &&
                    pageAnnotations
                      .filter((a) => a.boundingBox)
                      .map((ann) => {
                        const bb = ann.boundingBox!;
                        const style = COLOR_STYLES[ann.annotationColor];
                        const isSelected = selectedClaimId === ann.claimId;
                        return (
                          <button
                            key={ann.annotationId}
                            type="button"
                            onClick={() => selectClaim(ann.claimId)}
                            title={ann.reason}
                            style={{
                              left: `${bb.x * 100}%`,
                              top: `${bb.y * 100}%`,
                              width: `${bb.width * 100}%`,
                              height: `${bb.height * 100}%`,
                            }}
                            className={`absolute rounded border-2 transition-all cursor-pointer ${
                              ann.annotationColor === 'red'
                                ? 'border-rose-500 bg-rose-400/20'
                                : ann.annotationColor === 'orange'
                                ? 'border-amber-500 bg-amber-400/20'
                                : ann.annotationColor === 'yellow'
                                ? 'border-yellow-500 bg-yellow-300/25'
                                : 'border-emerald-500 bg-emerald-400/20'
                            } ${isSelected ? `ring-4 ${style.ring}` : ''}`}
                          />
                        );
                      })}
                </div>
              </div>
            )}

            {/* Structured Document Text with Inline Color Highlights */}
            <div className="space-y-3 max-h-[560px] overflow-y-auto pr-1">
              {currentPage?.blocks.map((block) => {
                const ann = showAnnotations
                  ? matchAnnotationForBlock(block.blockId, block.extractedText)
                  : undefined;
                const style = ann ? COLOR_STYLES[ann.annotationColor] : null;
                const isSelected = ann && selectedClaimId === ann.claimId;

                return (
                  <div
                    key={block.blockId}
                    onClick={() => ann && selectClaim(ann.claimId)}
                    role={ann ? 'button' : undefined}
                    tabIndex={ann ? 0 : undefined}
                    onKeyDown={(e) => {
                      if (ann && (e.key === 'Enter' || e.key === ' ')) {
                        e.preventDefault();
                        selectClaim(ann.claimId);
                      }
                    }}
                    className={`rounded-xl px-4 py-3 text-sm leading-relaxed border transition-all ${
                      style
                        ? `${style.bg} ${style.border} cursor-pointer ${
                            isSelected ? `ring-2 ${style.ring}` : ''
                          }`
                        : 'bg-slate-50/70 border-slate-200/70 text-slate-800'
                    }`}
                  >
                    {ann && style && (
                      <div className="flex items-center justify-between gap-2 mb-1 text-[11px]">
                        <span className={`font-semibold ${style.text}`}>{style.label}</span>
                        <span className="font-mono text-slate-500">Nhấp để xem đối chiếu</span>
                      </div>
                    )}
                    <p className="text-slate-900 whitespace-pre-wrap">{block.extractedText}</p>
                    {block.formulaText && (
                      <p className="mt-1.5 font-mono text-xs text-indigo-800 bg-white/80 px-2.5 py-1 rounded border border-indigo-200">
                        {block.formulaText}
                      </p>
                    )}
                  </div>
                );
              })}

              {/* Fallback list of page annotations if blocks didn't directly align */}
              {showAnnotations &&
                pageAnnotations.length > 0 &&
                (!currentPage || currentPage.blocks.length === 0) && (
                  <div className="space-y-2.5">
                    {pageAnnotations.map((ann) => {
                      const style = COLOR_STYLES[ann.annotationColor];
                      return (
                        <button
                          key={ann.annotationId}
                          type="button"
                          onClick={() => selectClaim(ann.claimId)}
                          className={`w-full text-left rounded-xl p-3.5 border ${style.bg} ${style.border} cursor-pointer`}
                        >
                          <p className={`text-xs font-semibold ${style.text}`}>{style.label}</p>
                          <p className="text-sm text-slate-900 mt-1">{ann.textExcerpt}</p>
                        </button>
                      );
                    })}
                  </div>
                )}
            </div>
          </div>
        )}

        {/* RIGHT COLUMN: Explanation Side Panel + Reference Textbook & Grounded Web Evidence */}
        {(viewMode === 'split' || viewMode === 'annotations') && (
          <div
            ref={rightPanelRef}
            className={`${
              viewMode === 'annotations' ? 'lg:col-span-12' : 'lg:col-span-6'
            } ${
              mobileTab === 'reference' || mobileTab === 'explanation' ? 'block' : 'hidden lg:block'
            } space-y-5 max-h-[760px] overflow-y-auto pr-1`}
          >
            {/* Interactive Explanation Side Panel */}
            <div
              className={`glass-surface rounded-2xl p-5 sm:p-6 ${
                mobileTab === 'reference' ? 'hidden lg:block' : 'block'
              }`}
            >
              <h3 className="font-display text-base font-bold text-slate-950 mb-3">
                Giải thích đối chiếu chi tiết
              </h3>

              {selectedClaim ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="font-semibold text-sky-800">
                      {selectedClaim.concept} · {selectedClaim.chapter}
                    </span>
                    <span className="font-mono text-slate-500">
                      Trọng số: {selectedClaim.importanceWeight} · Trang {selectedClaim.sourcePage}
                    </span>
                  </div>

                  <div className="rounded-xl bg-white/90 border border-slate-200 p-3.5">
                    <p className="text-[11px] font-medium text-slate-500 mb-1">
                      Nội dung trong tài liệu học sinh
                    </p>
                    <p className="text-sm text-slate-900 leading-relaxed">{selectedClaim.sourceText}</p>
                  </div>

                  <div className="rounded-xl bg-emerald-50/85 border border-emerald-200 p-3.5">
                    <p className="text-[11px] font-semibold text-emerald-800 mb-1">
                      Kiến thức chuẩn xác cần nắm
                    </p>
                    <p className="text-sm text-emerald-950 leading-relaxed">
                      {selectedClaim.correctKnowledge || selectedClaim.explanation}
                    </p>
                  </div>

                  <div>
                    <p className="text-[11px] font-medium text-slate-500 mb-1">Phân tích & lý do</p>
                    <p className="text-sm text-slate-700 leading-relaxed">{selectedClaim.explanation}</p>
                  </div>

                  {selectedClaim.evidences && selectedClaim.evidences.length > 0 && (
                    <div className="space-y-2 pt-2 border-t border-slate-200/80">
                      <p className="text-xs font-semibold text-slate-800">Dẫn chứng đối chiếu</p>
                      {selectedClaim.evidences.map((ev) => (
                        <div
                          key={ev.evidenceId}
                          className="rounded-xl bg-emerald-50/60 border border-emerald-200/80 p-3 text-xs space-y-1"
                        >
                          <div className="flex items-center justify-between gap-2 font-semibold text-emerald-900">
                            <span className="inline-flex items-center gap-1.5">
                              {ev.sourceType === 'web' ? (
                                <Globe className="w-3.5 h-3.5 text-sky-600" />
                              ) : (
                                <BookOpen className="w-3.5 h-3.5 text-emerald-700" />
                              )}
                              {ev.title}
                            </span>
                            {ev.pageNumber && <span className="font-mono">Trang {ev.pageNumber}</span>}
                          </div>
                          {ev.excerpt && <p className="text-slate-700 leading-relaxed">{ev.excerpt}</p>}
                          {ev.url && (
                            <a
                              href={ev.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-sky-700 hover:underline font-medium"
                            >
                              {ev.domain || ev.url}
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : selectedCoverage ? (
                <div className="space-y-3">
                  <p className="text-xs font-semibold text-amber-800">
                    Phần kiến thức cần bổ sung · {selectedCoverage.chapter}
                  </p>
                  <p className="text-sm font-bold text-slate-900">{selectedCoverage.concept}</p>
                  <div className="rounded-xl bg-amber-50/85 border border-amber-200 p-3.5 text-sm text-amber-950">
                    {selectedCoverage.suggestedAddition}
                  </div>
                  {selectedCoverage.referenceExcerpt && (
                    <div className="rounded-xl bg-emerald-50/75 border border-emerald-200 p-3.5 text-xs text-slate-800">
                      <p className="font-semibold text-emerald-900 mb-1">
                        Trích đoạn sách giáo khoa{' '}
                        {selectedCoverage.referencePage ? `(Trang ${selectedCoverage.referencePage})` : ''}
                      </p>
                      <p>{selectedCoverage.referenceExcerpt}</p>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-xs text-slate-600">
                  Nhấp vào một vùng màu bên trái hoặc một mục kiến thức bên dưới để xem giải thích chi tiết.
                </p>
              )}
            </div>

            {/* Claim Navigator + Missing Concepts List */}
            <div
              className={`glass-surface rounded-2xl p-5 space-y-4 ${
                mobileTab === 'explanation' ? 'hidden lg:block' : 'block'
              }`}
            >
              <div>
                <h4 className="font-display text-sm font-bold text-slate-900 mb-2.5">
                  Danh sách mệnh đề đã phân tích ({analysis.claims.length})
                </h4>
                <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                  {analysis.claims.map((claim) => {
                    const isErr = claim.evaluationStatus === 'INCORRECT';
                    const isPart = claim.evaluationStatus === 'PARTIALLY_CORRECT';
                    const isOk = claim.evaluationStatus === 'CORRECT';
                    const active = selectedClaimId === claim.claimId;
                    return (
                      <button
                        key={claim.claimId}
                        type="button"
                        onClick={() => selectClaim(claim.claimId)}
                        className={`w-full text-left rounded-xl p-3 border text-xs transition-all cursor-pointer ${
                          active
                            ? 'border-sky-500 bg-sky-50/80 ring-2 ring-sky-200'
                            : 'border-slate-200 bg-white/80 hover:bg-white'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={`font-semibold ${
                              isErr
                                ? 'text-rose-700'
                                : isPart
                                ? 'text-amber-700'
                                : isOk
                                ? 'text-emerald-700'
                                : 'text-yellow-700'
                            }`}
                          >
                            {claim.evaluationStatus === 'CORRECT'
                              ? 'Đúng'
                              : claim.evaluationStatus === 'PARTIALLY_CORRECT'
                              ? 'Đúng một phần'
                              : claim.evaluationStatus === 'INCORRECT'
                              ? 'Sai kiến thức'
                              : claim.evaluationStatus === 'OCR_UNCERTAIN'
                              ? 'OCR chưa rõ'
                              : 'Cần xác minh'}
                          </span>
                          <span className="font-mono text-slate-500">Tr. {claim.sourcePage}</span>
                        </div>
                        <p className="text-slate-900 font-medium mt-1 line-clamp-2">{claim.concept}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {analysis.coverageItems.filter((c) => c.status !== 'COVERED').length > 0 && (
                <div className="pt-3 border-t border-slate-200/80">
                  <h4 className="font-display text-sm font-bold text-slate-900 mb-2.5 flex items-center gap-1.5">
                    <AlertCircle className="w-4 h-4 text-amber-600" />
                    Kiến thức còn thiếu / chưa trọn vẹn
                  </h4>
                  <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                    {analysis.coverageItems
                      .filter((c) => c.status !== 'COVERED')
                      .map((cov) => (
                        <button
                          key={cov.itemId}
                          type="button"
                          onClick={() => selectCoverage(cov.itemId)}
                          className={`w-full text-left rounded-xl p-3 border text-xs cursor-pointer ${
                            selectedCoverageId === cov.itemId
                              ? 'border-amber-500 bg-amber-50 ring-2 ring-amber-200'
                              : 'border-amber-200/80 bg-amber-50/50 hover:bg-amber-50'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-amber-800">
                              {cov.status === 'MISSING' ? 'Còn thiếu' : 'Chưa đầy đủ'}
                            </span>
                            <span className="font-mono text-slate-500">{cov.chapter}</span>
                          </div>
                          <p className="text-slate-900 font-medium mt-1">{cov.concept}</p>
                        </button>
                      ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
