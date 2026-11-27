import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ExternalLink,
  Eye,
  EyeOff,
  Globe,
  HelpCircle,
  Image as ImageIcon,
  Maximize2,
  Minimize2,
  XCircle,
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
import {
  computeInlineHighlightSegments,
  getConciseFixText,
  splitFormulaBlockDisplay,
  type InlineHighlightTarget,
  type InlineTextSegment,
} from '../core/semanticBlocks';
import { sanitizeExternalHttpUrl } from '../core/urlSecurity';
import { PdfPageCanvas } from './PdfPageCanvas';

interface SplitDocumentViewerProps {
  analysis: AnalysisRecord;
  localFile?: File | null;
}

const INLINE_MARK_STYLES: Record<
  AnnotationItem['annotationColor'],
  {
    mark: string;
    activeRing: string;
    badgeBg: string;
    label: string;
    text: string;
    noteActive: string;
  }
> = {
  red: {
    mark: 'bg-rose-100 dark:bg-rose-950/75 text-rose-950 dark:text-rose-100 font-medium underline decoration-rose-600 decoration-[2.5px] underline-offset-4 hover:bg-rose-200/85 dark:hover:bg-rose-900/75',
    activeRing: 'ring-2 ring-rose-500/90 dark:ring-rose-500/80 bg-rose-200/95 dark:bg-rose-900/90',
    badgeBg: 'bg-rose-600 text-white',
    label: 'Sai kiến thức / Công thức',
    text: 'text-rose-700 dark:text-rose-400',
    noteActive:
      'border-rose-300 dark:border-rose-700 bg-rose-50/75 dark:bg-rose-950/35 ring-2 ring-rose-200/80 dark:ring-rose-800/70',
  },
  orange: {
    mark: 'bg-amber-100 dark:bg-amber-950/70 text-amber-950 dark:text-amber-100 font-medium underline decoration-amber-500 decoration-dashed decoration-[2.5px] underline-offset-4 hover:bg-amber-200/85 dark:hover:bg-amber-900/70',
    activeRing: 'ring-2 ring-amber-500/90 dark:ring-amber-500/80 bg-amber-200/95 dark:bg-amber-900/85',
    badgeBg: 'bg-amber-600 text-white',
    label: 'Thiếu thông tin / Điều kiện',
    text: 'text-amber-700 dark:text-amber-400',
    noteActive:
      'border-amber-300 dark:border-amber-700 bg-amber-50/75 dark:bg-amber-950/35 ring-2 ring-amber-200/80 dark:ring-amber-800/70',
  },
  yellow: {
    mark: 'bg-yellow-100/85 dark:bg-yellow-950/60 text-yellow-950 dark:text-yellow-100 underline decoration-yellow-500 decoration-dotted decoration-2 underline-offset-4 hover:bg-yellow-200/80 dark:hover:bg-yellow-900/60',
    activeRing: 'ring-2 ring-yellow-400/90 dark:ring-yellow-500/80 bg-yellow-200/90 dark:bg-yellow-900/75',
    badgeBg: 'bg-yellow-600 text-white',
    label: 'Chưa xác định / OCR chưa rõ',
    text: 'text-yellow-700 dark:text-yellow-400',
    noteActive:
      'border-yellow-300 dark:border-yellow-700 bg-yellow-50/75 dark:bg-yellow-950/35 ring-2 ring-yellow-200/80 dark:ring-yellow-800/70',
  },
  green: {
    mark: 'bg-emerald-50/90 dark:bg-emerald-950/50 text-emerald-950 dark:text-emerald-100 underline decoration-emerald-500/70 decoration-1 underline-offset-4 hover:bg-emerald-100/85 dark:hover:bg-emerald-900/55',
    activeRing: 'ring-2 ring-emerald-400/80 dark:ring-emerald-600/80 bg-emerald-100/90 dark:bg-emerald-900/70',
    badgeBg: 'bg-emerald-600 text-white',
    label: 'Đúng có dẫn chứng',
    text: 'text-emerald-700 dark:text-emerald-400',
    noteActive:
      'border-emerald-300 dark:border-emerald-700 bg-emerald-50/70 dark:bg-emerald-950/30 ring-2 ring-emerald-200/80 dark:ring-emerald-800/70',
  },
};

function getClaimColor(status: ExtractedClaim['evaluationStatus']): AnnotationItem['annotationColor'] {
  if (status === 'INCORRECT') return 'red';
  if (status === 'PARTIALLY_CORRECT' || status === 'MISSING') return 'orange';
  if (status === 'UNVERIFIED' || status === 'OCR_UNCERTAIN' || status === 'AMBIGUOUS') return 'yellow';
  return 'green';
}

function isIssueClaim(claim: ExtractedClaim): boolean {
  return (
    claim.evaluationStatus === 'INCORRECT' ||
    claim.evaluationStatus === 'PARTIALLY_CORRECT' ||
    claim.evaluationStatus === 'MISSING' ||
    claim.evaluationStatus === 'OCR_UNCERTAIN' ||
    claim.evaluationStatus === 'UNVERIFIED' ||
    claim.evaluationStatus === 'AMBIGUOUS'
  );
}

function StatusGlyph({ color }: { color: AnnotationItem['annotationColor'] }) {
  if (color === 'red') return <XCircle className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400 shrink-0" />;
  if (color === 'orange') return <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />;
  if (color === 'yellow') return <HelpCircle className="w-3.5 h-3.5 text-yellow-600 dark:text-yellow-400 shrink-0" />;
  return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />;
}

export const SplitDocumentViewer: React.FC<SplitDocumentViewerProps> = ({
  analysis,
  localFile,
}) => {
  const [pageIndex, setPageIndex] = useState(0);
  const [zoom, setZoom] = useState(1.0);
  const [showAnnotations, setShowAnnotations] = useState(true);
  const [filterMode, setFilterMode] = useState<'errors' | 'all'>('errors');
  const [viewMode, setViewMode] = useState<'split' | 'original' | 'annotations'>('split');
  const [mobileTab, setMobileTab] = useState<'student' | 'notes'>('student');
  const [expanded, setExpanded] = useState(false);
  const [showOriginalMedia, setShowOriginalMedia] = useState(false);

  const [expandedClaimIds, setExpandedClaimIds] = useState<Set<string>>(() => new Set());
  const [expandedCoverageIds, setExpandedCoverageIds] = useState<Set<string>>(() => new Set());

  const [localImageUrl, setLocalImageUrl] = useState<string | null>(null);

  useEffect(() => {
    const isLocalImg =
      Boolean(localFile) &&
      (localFile!.type.startsWith('image/') ||
        /\.(jpg|jpeg|png|webp|gif)$/i.test(localFile!.name || ''));

    if (!isLocalImg || !localFile) {
      setLocalImageUrl(null);
      return;
    }

    const url = URL.createObjectURL(localFile);
    setLocalImageUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [localFile]);

  useEffect(() => {
    if (!expanded) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setExpanded(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [expanded]);

  const pages = analysis.extractedPages || [];
  const currentPage = pages[pageIndex] || pages[0];
  const currentPageNumber = currentPage?.pageNumber || 1;

  // Claims indexed in document reading order; number all issue claims #1, #2, #3...
  const issueClaims = useMemo(
    () => (analysis.claims || []).filter((c) => isIssueClaim(c)),
    [analysis.claims]
  );

  const claimOrderNumberMap = useMemo(() => {
    const map = new Map<string, number>();
    let n = 1;
    for (const c of analysis.claims || []) {
      if (isIssueClaim(c)) {
        map.set(c.claimId, n);
        n += 1;
      }
    }
    return map;
  }, [analysis.claims]);

  const [selectedClaimId, setSelectedClaimId] = useState<string | null>(
    issueClaims[0]?.claimId || analysis.claims[0]?.claimId || null
  );

  useEffect(() => {
    setSelectedClaimId(issueClaims[0]?.claimId || analysis.claims[0]?.claimId || null);
    setExpandedClaimIds(new Set());
    setExpandedCoverageIds(new Set());
  }, [analysis.analysisId, issueClaims, analysis.claims]);

  const noteCardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const leftMarkRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const visibleClaims = useMemo(() => {
    const all = analysis.claims || [];
    if (filterMode === 'all') return all;
    return issueClaims;
  }, [analysis.claims, filterMode, issueClaims]);

  const pageHighlightTargets: InlineHighlightTarget[] = useMemo(() => {
    const annByClaim = new Map<string, AnnotationItem>();
    for (const ann of analysis.annotations || []) {
      if (ann.pageNumber === currentPageNumber && !annByClaim.has(ann.claimId)) {
        annByClaim.set(ann.claimId, ann);
      }
    }

    const claimsOnPage = (analysis.claims || []).filter(
      (c) =>
        (c.sourcePage || 1) === currentPageNumber &&
        c.evaluationStatus !== 'MISSING' &&
        c.evaluationStatus !== 'OUT_OF_SCOPE'
    );

    const targets: InlineHighlightTarget[] = [];
    for (const claim of claimsOnPage) {
      // By default only underline/highlight errors, missing info, or uncertain spans so correct text stays clean & readable
      if (filterMode === 'errors' && claim.evaluationStatus === 'CORRECT') {
        continue;
      }
      const ann = annByClaim.get(claim.claimId);
      targets.push({
        claimId: claim.claimId,
        blockId: claim.blockId || ann?.blockId,
        blockIds: claim.blockIds || ann?.blockIds,
        errorSpan: claim.errorSpan || ann?.errorSpan,
        textExcerpt: ann?.textExcerpt || claim.sourceText,
        annotationColor: ann?.annotationColor || getClaimColor(claim.evaluationStatus),
        orderNumber: claimOrderNumberMap.get(claim.claimId),
      });
    }
    return targets;
  }, [analysis.annotations, analysis.claims, currentPageNumber, filterMode, claimOrderNumberMap]);

  const pageBoundingBoxAnnotations = useMemo(
    () => (analysis.annotations || []).filter((a) => a.pageNumber === currentPageNumber && a.boundingBox),
    [analysis.annotations, currentPageNumber]
  );

  const canRenderPdfPreview =
    analysis.mimeType === 'application/pdf' && Boolean(localFile || analysis.storageDownloadUrl);
  const resolvedPageImageUrl =
    currentPage?.imageUrl || (pageIndex === 0 ? localImageUrl : null);
  const hasOriginalMedia = canRenderPdfPreview || Boolean(resolvedPageImageUrl);

  const selectClaimFromLeft = (claimId: string) => {
    setSelectedClaimId(claimId);
    setMobileTab('notes');
    const targetCard = noteCardRefs.current[claimId];
    if (targetCard) {
      targetCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  };

  const selectClaimFromRight = (claimId: string, sourcePage?: number) => {
    setSelectedClaimId(claimId);
    if (sourcePage && pages.length > 1) {
      const targetIdx = pages.findIndex((p) => p.pageNumber === sourcePage);
      if (targetIdx >= 0 && targetIdx !== pageIndex) {
        setPageIndex(targetIdx);
      }
    }
    window.requestAnimationFrame(() => {
      const markEl = leftMarkRefs.current[claimId];
      if (markEl) {
        markEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  };

  const toggleExpandClaim = (claimId: string) => {
    setExpandedClaimIds((prev) => {
      const next = new Set(prev);
      if (next.has(claimId)) {
        next.delete(claimId);
      } else {
        next.add(claimId);
      }
      return next;
    });
  };

  const toggleExpandCoverage = (itemId: string) => {
    setExpandedCoverageIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  };

  const renderInlineSegments = (segments: InlineTextSegment[], keyPrefix: string) => {
    return segments.map((seg, idx) => {
      if (!seg.claimId || !seg.annotationColor || !showAnnotations) {
        return <React.Fragment key={`${keyPrefix}_t_${idx}`}>{seg.text}</React.Fragment>;
      }
      const style = INLINE_MARK_STYLES[seg.annotationColor];
      const isSelected = selectedClaimId === seg.claimId;
      const isFirstOccurrence = !leftMarkRefs.current[seg.claimId];

      return (
        <button
          key={`${keyPrefix}_m_${idx}`}
          ref={(el) => {
            if (el && (isFirstOccurrence || leftMarkRefs.current[seg.claimId!] === el)) {
              leftMarkRefs.current[seg.claimId!] = el;
            }
          }}
          type="button"
          onClick={() => selectClaimFromLeft(seg.claimId!)}
          title={`${style.label} — Nhấp để xem chú thích`}
          className={`inline text-left rounded px-0.5 transition-all duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
            style.mark
          } ${isSelected ? style.activeRing : ''}`}
        >
          <span>{seg.text}</span>
          {typeof seg.orderNumber === 'number' && (
            <sup
              className={`ml-0.5 inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded text-[10px] font-mono font-bold tabular-nums leading-none align-super select-none ${style.badgeBg}`}
            >
              {seg.orderNumber}
            </sup>
          )}
        </button>
      );
    });
  };

  // Clear stale refs before rendering blocks for the current page
  leftMarkRefs.current = {};

  const missingCoverageItems: KnowledgeCoverageItem[] = useMemo(
    () => (analysis.coverageItems || []).filter((c) => c.status !== 'COVERED'),
    [analysis.coverageItems]
  );

  return (
    <div
      className={`${
        expanded
          ? 'fixed inset-3 z-50 bg-slate-50/98 dark:bg-slate-950/98 backdrop-blur-md p-4 rounded-3xl shadow-2xl overflow-auto'
          : ''
      } space-y-4`}
    >
      {/* Clean Single-Row Toolbar */}
      <div className="glass-surface rounded-2xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={pageIndex === 0}
            onClick={() => setPageIndex((i) => Math.max(0, i - 1))}
            className="glass-control p-1.5 rounded-lg disabled:opacity-40 cursor-pointer"
            aria-label="Trang trước"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="font-mono text-xs font-medium text-slate-700 dark:text-slate-200 tabular-nums px-1 whitespace-nowrap">
            Trang {currentPageNumber} / {Math.max(1, pages.length)}
          </span>
          <button
            type="button"
            disabled={pageIndex >= pages.length - 1}
            onClick={() => setPageIndex((i) => Math.min(pages.length - 1, i + 1))}
            className="glass-control p-1.5 rounded-lg disabled:opacity-40 cursor-pointer"
            aria-label="Trang sau"
          >
            <ChevronRight className="w-4 h-4" />
          </button>

          {hasOriginalMedia && (
            <>
              <div className="h-4 w-px bg-slate-200 dark:bg-slate-700 mx-1 hidden sm:block" />
              <button
                type="button"
                onClick={() => setShowOriginalMedia((v) => !v)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  showOriginalMedia
                    ? 'bg-sky-600 text-white shadow-sm'
                    : 'glass-control text-slate-700 dark:text-slate-200'
                }`}
              >
                <ImageIcon className="w-3.5 h-3.5" />
                {showOriginalMedia ? 'Ẩn ảnh gốc' : 'Xem ảnh gốc'}
              </button>
            </>
          )}

          {showOriginalMedia && hasOriginalMedia && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(0.75, Number((z - 0.1).toFixed(2))))}
                className="glass-control p-1.5 rounded-lg cursor-pointer"
                aria-label="Thu nhỏ ảnh"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <span className="font-mono text-xs text-slate-600 dark:text-slate-300 tabular-nums w-10 text-center">
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(1.5, Number((z + 0.1).toFixed(2))))}
                className="glass-control p-1.5 rounded-lg cursor-pointer"
                aria-label="Phóng to ảnh"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowAnnotations((v) => !v)}
            className="glass-control inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer whitespace-nowrap shrink-0"
          >
            {showAnnotations ? (
              <Eye className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
            ) : (
              <EyeOff className="w-3.5 h-3.5" />
            )}
            {showAnnotations ? 'Ẩn gạch chân' : 'Hiện gạch chân'}
          </button>

          <div className="glass-segment hidden lg:inline-flex rounded-lg p-0.5 text-xs">
            {(
              [
                ['split', 'Hai cột'],
                ['original', 'Chỉ bài làm'],
                ['annotations', 'Chỉ chú thích'],
              ] as const
            ).map(([m, label]) => (
              <button
                key={m}
                type="button"
                onClick={() => setViewMode(m)}
                className={`px-2.5 py-1 rounded-md font-medium cursor-pointer transition-colors whitespace-nowrap shrink-0 ${
                  viewMode === m
                    ? 'bg-sky-600 text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="glass-control p-1.5 rounded-lg text-slate-700 dark:text-slate-200 cursor-pointer"
            aria-label={expanded ? 'Thu gọn trình đối chiếu' : 'Mở rộng toàn màn hình'}
          >
            {expanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Tablet/Mobile Tabs */}
      <div className="glass-segment flex lg:hidden rounded-xl p-1 text-xs font-medium">
        <button
          type="button"
          onClick={() => setMobileTab('student')}
          className={`flex-1 py-2 rounded-lg text-center cursor-pointer transition-colors whitespace-nowrap ${
            mobileTab === 'student'
              ? 'bg-sky-600 text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-300'
          }`}
        >
          Bài làm ({pages.length} trang)
        </button>
        <button
          type="button"
          onClick={() => setMobileTab('notes')}
          className={`flex-1 py-2 rounded-lg text-center cursor-pointer transition-colors whitespace-nowrap ${
            mobileTab === 'notes'
              ? 'bg-sky-600 text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-300'
          }`}
        >
          Chú thích lỗi ({issueClaims.length})
        </button>
      </div>

      {/* Quiet Inline Legend (Zero-Pill Metadata) */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600 dark:text-slate-300 px-1">
        <span className="font-medium text-slate-700 dark:text-slate-200">Ký hiệu gạch chân:</span>
        <span className="inline-flex items-center gap-1 text-rose-700 dark:text-rose-400 font-medium">
          <span className="underline decoration-rose-500 decoration-2 underline-offset-2">Đỏ liền</span>
          <span className="font-normal text-slate-500 dark:text-slate-400">Sai kiến thức / Công thức</span>
        </span>
        <span className="text-slate-300 dark:text-slate-600" aria-hidden="true">·</span>
        <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400 font-medium">
          <span className="underline decoration-amber-500 decoration-dashed decoration-2 underline-offset-2">Cam đứt</span>
          <span className="font-normal text-slate-500 dark:text-slate-400">Thiếu thông tin / Điều kiện</span>
        </span>
        <span className="text-slate-300 dark:text-slate-600" aria-hidden="true">·</span>
        <span className="text-slate-500 dark:text-slate-400">
          Nhấp cụm gạch chân để nhảy tới chú thích tương ứng
        </span>
      </div>

      {/* Balanced Editorial Two-Zone Split (7 : 5) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* LEFT COLUMN: Seamless Document Reading Sheet with Surgical Inline Error Highlighting */}
        {(viewMode === 'split' || viewMode === 'original') && (
          <div
            className={`${
              viewMode === 'original' ? 'lg:col-span-12' : 'lg:col-span-7'
            } ${
              mobileTab === 'student' ? 'block' : 'hidden lg:block'
            } bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-5 sm:p-7 shadow-sm`}
          >
            {/* Clean Unboxed Document Header */}
            <div className="flex flex-wrap items-baseline justify-between gap-2 pb-3.5 mb-5 border-b border-slate-200/80 dark:border-slate-800 text-xs">
              <div className="min-w-0">
                <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                  {analysis.documentTitle}
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  Sao chép nguyên văn bài làm · Chỉ gạch chân & tô nổi bật chỗ sai/thiếu (không tự sửa)
                </p>
              </div>
              <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 font-mono tabular-nums shrink-0">
                <span>{SUBJECT_LABELS[analysis.subject]}</span>
                <span aria-hidden="true">·</span>
                <span>Lớp {analysis.grade}</span>
                <span aria-hidden="true">·</span>
                <span>{issueClaims.length} điểm cần sửa</span>
              </div>
            </div>

            {currentPage &&
              (currentPage.ocrAverageConfidence < 0.55 ||
                !currentPage.rawText?.trim() ||
                /\[KHÔNG NHÌN RÕ\]/i.test(currentPage.rawText || '')) && (
                <div className="mb-4 rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50/90 dark:bg-amber-950/40 px-3.5 py-2.5 flex items-start gap-2.5 text-xs text-amber-950 dark:text-amber-200">
                  <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold">
                      Không thể nhìn rõ toàn bộ nội dung trang {currentPageNumber}
                    </p>
                    <p className="mt-0.5 text-amber-900/90 dark:text-amber-200/90">
                      Hệ thống giữ nguyên bản sao chép và không tự đoán hay sửa thay. Vui lòng chụp lại trang rõ nét hơn nếu có phần chữ bị mờ hoặc mất nét.
                    </p>
                  </div>
                </div>
              )}

            {/* Optional Collapsible Original Uploaded Image / PDF Canvas */}
            {showOriginalMedia && hasOriginalMedia && (
              <div className="mb-6 relative overflow-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 p-3 flex justify-center">
                <div className="relative inline-block">
                  {canRenderPdfPreview ? (
                    <PdfPageCanvas
                      file={localFile}
                      url={analysis.storageDownloadUrl}
                      pageNumber={currentPageNumber}
                      scale={zoom}
                    />
                  ) : resolvedPageImageUrl ? (
                    <img
                      src={resolvedPageImageUrl}
                      alt={`Ảnh bài làm trang ${currentPageNumber}`}
                      referrerPolicy="no-referrer"
                      style={{ width: `${Math.round(zoom * 100)}%` }}
                      className="rounded-lg bg-white max-w-full h-auto"
                    />
                  ) : null}

                  {showAnnotations &&
                    pageBoundingBoxAnnotations.map((ann) => {
                      const bb = ann.boundingBox!;
                      const isSelected = selectedClaimId === ann.claimId;
                      return (
                        <button
                          key={ann.annotationId}
                          type="button"
                          onClick={() => selectClaimFromLeft(ann.claimId)}
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
                          } ${isSelected ? 'ring-4 ring-sky-300/80' : ''}`}
                        />
                      );
                    })}
                </div>
              </div>
            )}

            {/* Seamless Flowing Document Body — NO nested card boxes per line */}
            <article
              className={`space-y-4 text-[15px] leading-7 text-slate-800 dark:text-slate-100 ${
                expanded ? 'max-h-[calc(100dvh-14rem)]' : 'max-h-[640px]'
              } overflow-y-auto pr-2`}
            >
              {currentPage?.blocks.map((block) => {
                const { leadInLabel, formulaBody } = splitFormulaBlockDisplay(block);

                // Formula cluster (lead-in + formula OR standalone formula) — rendered ONCE, never duplicated!
                if (formulaBody) {
                  const formulaTargets = showAnnotations
                    ? pageHighlightTargets
                    : [];
                  const formulaMatch = computeInlineHighlightSegments(
                    formulaBody,
                    block.blockId,
                    formulaTargets
                  );
                  const labelMatch = leadInLabel
                    ? computeInlineHighlightSegments(
                        leadInLabel,
                        `${block.blockId}__label`,
                        formulaTargets.filter((t) => !formulaMatch.matchedClaimIds.includes(t.claimId))
                      )
                    : null;

                  return (
                    <div key={block.blockId} className="space-y-2 py-1">
                      {leadInLabel && (
                        <p className="text-[15px] font-medium text-slate-800 dark:text-slate-100">
                          {labelMatch
                            ? renderInlineSegments(labelMatch.segments, `${block.blockId}_lbl`)
                            : leadInLabel}
                        </p>
                      )}
                      <div className="flex justify-center py-2.5 px-4 rounded-xl bg-slate-50/90 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-700/70">
                        <span className="font-mono text-[15px] tracking-wide text-slate-900 dark:text-slate-50 whitespace-pre-wrap text-center">
                          {renderInlineSegments(formulaMatch.segments, `${block.blockId}_fm`)}
                        </span>
                      </div>
                    </div>
                  );
                }

                // Multi-line annotation block ("Trong đó:\n• s...\n• v...") or regular prose / heading
                const { segments } = computeInlineHighlightSegments(
                  block.extractedText,
                  block.blockId,
                  showAnnotations ? pageHighlightTargets : []
                );

                if (block.textType === 'heading') {
                  return (
                    <h4
                      key={block.blockId}
                      className="font-display text-base font-semibold text-slate-900 dark:text-slate-50 pt-1"
                    >
                      {renderInlineSegments(segments, block.blockId)}
                    </h4>
                  );
                }

                if (block.textType === 'list') {
                  return (
                    <div
                      key={block.blockId}
                      className="whitespace-pre-wrap pl-1 text-[14.5px] leading-7 text-slate-700 dark:text-slate-200"
                    >
                      {renderInlineSegments(segments, block.blockId)}
                    </div>
                  );
                }

                return (
                  <p key={block.blockId} className="whitespace-pre-wrap">
                    {renderInlineSegments(segments, block.blockId)}
                  </p>
                );
              })}

              {/* Fallback when page has no extracted blocks */}
              {(!currentPage || currentPage.blocks.length === 0) && (
                <p className="text-sm text-slate-500 dark:text-slate-400 py-4">
                  {currentPage?.rawText || 'Không có nội dung văn bản cho trang này.'}
                </p>
              )}
            </article>
          </div>
        )}

        {/* RIGHT COLUMN: Concise Error Annotations + Progressive Disclosure ("Xem thêm") */}
        {(viewMode === 'split' || viewMode === 'annotations') && (
          <div
            className={`${
              viewMode === 'annotations' ? 'lg:col-span-12' : 'lg:col-span-5'
            } ${
              mobileTab === 'notes' ? 'block' : 'hidden lg:block'
            } bg-white/90 dark:bg-slate-900/90 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-4 sm:p-5 shadow-sm flex flex-col`}
          >
            {/* Header & Filter Segmented Control */}
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3.5 mb-3.5 border-b border-slate-200/80 dark:border-slate-800">
              <div>
                <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Chú thích kiểm định
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                  {issueClaims.length > 0
                    ? `${issueClaims.length} điểm sai/thiếu · Bấm Xem thêm để làm rõ khái niệm`
                    : 'Không phát hiện lỗi sai kiến thức trong tài liệu'}
                </p>
              </div>

              <div className="inline-flex items-center gap-1 p-0.5 bg-slate-100 dark:bg-slate-800 rounded-lg text-xs">
                <button
                  type="button"
                  onClick={() => setFilterMode('errors')}
                  className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 tabular-nums ${
                    filterMode === 'errors'
                      ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  Lỗi & thiếu ({issueClaims.length})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterMode('all')}
                  className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 tabular-nums ${
                    filterMode === 'all'
                      ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  Tất cả ({analysis.claims.length})
                </button>
              </div>
            </div>

            {/* Scrollable Compact Annotation List */}
            <div
              className={`space-y-3 ${
                expanded ? 'max-h-[calc(100dvh-15rem)]' : 'max-h-[620px]'
              } overflow-y-auto pr-1`}
            >
              {visibleClaims.length === 0 ? (
                <div className="rounded-xl border border-emerald-200/80 dark:border-emerald-800/60 bg-emerald-50/50 dark:bg-emerald-950/25 p-4 text-xs text-emerald-900 dark:text-emerald-200 flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold">Không có lỗi sai hoặc thiếu thông tin nào</p>
                    <p className="text-slate-600 dark:text-slate-300 mt-0.5">
                      Bạn có thể chuyển sang tab <strong>Tất cả</strong> để xem chi tiết từng mệnh đề đúng.
                    </p>
                  </div>
                </div>
              ) : (
                visibleClaims.map((claim) => {
                  const color = getClaimColor(claim.evaluationStatus);
                  const style = INLINE_MARK_STYLES[color];
                  const orderNum = claimOrderNumberMap.get(claim.claimId);
                  const isSelected = selectedClaimId === claim.claimId;
                  const isExpanded = expandedClaimIds.has(claim.claimId);
                  const conciseFix = getConciseFixText(claim);
                  const displaySnippet = (claim.errorSpan || claim.sourceText || '').trim();
                  const showFullSourceInDrawer =
                    Boolean(claim.errorSpan) &&
                    claim.sourceText.trim().length > (claim.errorSpan || '').trim().length + 4;

                  return (
                    <div
                      key={claim.claimId}
                      ref={(el) => {
                        noteCardRefs.current[claim.claimId] = el;
                      }}
                      className={`rounded-xl border p-3.5 transition-all duration-150 ${
                        isSelected
                          ? style.noteActive
                          : 'border-slate-200/85 dark:border-slate-800 bg-slate-50/55 dark:bg-slate-900/60 hover:border-slate-300 dark:hover:border-slate-700'
                      }`}
                    >
                      {/* Clickable compact header + concise error/fix body */}
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => selectClaimFromRight(claim.claimId, claim.sourcePage)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            selectClaimFromRight(claim.claimId, claim.sourcePage);
                          }
                        }}
                        className="cursor-pointer focus-visible:outline-none"
                      >
                        {/* Clean Unboxed Metadata Row (Zero Pills) */}
                        <div className="flex items-center justify-between gap-2 text-xs mb-1.5">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <StatusGlyph color={color} />
                            {typeof orderNum === 'number' && (
                              <span className="font-mono font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                                #{orderNum}
                              </span>
                            )}
                            {typeof orderNum === 'number' && (
                              <span className="text-slate-300 dark:text-slate-600" aria-hidden="true">·</span>
                            )}
                            <span className={`font-semibold truncate ${style.text}`}>
                              {style.label}
                            </span>
                          </div>
                          <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400 tabular-nums shrink-0">
                            Tr. {claim.sourcePage}
                          </span>
                        </div>

                        {/* Exact flawed phrase / formula */}
                        <p className="text-xs font-medium text-slate-700 dark:text-slate-200 leading-relaxed line-clamp-2">
                          <span className="text-slate-400 dark:text-slate-500">“</span>
                          {displaySnippet}
                          <span className="text-slate-400 dark:text-slate-500">”</span>
                        </p>

                        {/* Concise 1-line direct fix */}
                        {claim.evaluationStatus !== 'CORRECT' && conciseFix && (
                          <p className="mt-1.5 text-xs text-slate-900 dark:text-slate-100 leading-relaxed">
                            <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                              Sửa chuẩn:{' '}
                            </span>
                            {conciseFix}
                          </p>
                        )}
                      </div>

                      {/* Progressive Disclosure Trigger: "Xem thêm" to expand concept clarification */}
                      <div className="mt-2.5 pt-2 border-t border-slate-200/70 dark:border-slate-800/80 flex items-center justify-between gap-2">
                        <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                          {claim.concept}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedClaimId(claim.claimId);
                            toggleExpandClaim(claim.claimId);
                          }}
                          className="inline-flex items-center gap-1 text-xs font-medium text-sky-700 dark:text-sky-400 hover:text-sky-900 dark:hover:text-sky-300 cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:underline"
                          aria-expanded={isExpanded}
                        >
                          {isExpanded ? (
                            <>
                              Thu gọn
                              <ChevronUp className="w-3.5 h-3.5" />
                            </>
                          ) : (
                            <>
                              Xem thêm
                              <ChevronDown className="w-3.5 h-3.5" />
                            </>
                          )}
                        </button>
                      </div>

                      {/* Expanded Concept Clarification & Evidence Drawer (Only on Click) */}
                      {isExpanded && (
                        <div className="mt-3 pt-3 border-t border-slate-200/80 dark:border-slate-700/80 space-y-2.5 text-xs">
                          <div>
                            <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-0.5">
                              Làm rõ khái niệm & lý do
                            </p>
                            <p className="text-slate-700 dark:text-slate-200 leading-relaxed">
                              {claim.explanation}
                            </p>
                          </div>

                          {claim.correctKnowledge && (
                            <div className="rounded-lg bg-emerald-50/75 dark:bg-emerald-950/35 border border-emerald-200/80 dark:border-emerald-800/60 p-2.5">
                              <p className="text-[11px] font-semibold text-emerald-800 dark:text-emerald-300 mb-0.5">
                                Kiến thức chuẩn xác cần nắm
                              </p>
                              <p className="text-emerald-950 dark:text-emerald-100 leading-relaxed">
                                {claim.correctKnowledge}
                              </p>
                            </div>
                          )}

                          {claim.suggestedFix && claim.suggestedFix !== conciseFix && (
                            <div className="rounded-lg bg-sky-50/75 dark:bg-sky-950/35 border border-sky-200/80 dark:border-sky-800/60 p-2.5">
                              <p className="text-[11px] font-semibold text-sky-800 dark:text-sky-300 mb-0.5">
                                Gợi ý viết lại đầy đủ
                              </p>
                              <p className="text-sky-950 dark:text-sky-100 leading-relaxed">
                                {claim.suggestedFix}
                              </p>
                            </div>
                          )}

                          {showFullSourceInDrawer && (
                            <div>
                              <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-0.5">
                                Nguyên văn câu trong bài làm
                              </p>
                              <p className="text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">
                                {claim.sourceText}
                              </p>
                            </div>
                          )}

                          <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                            {claim.chapter} · Trọng số {claim.importanceWeight}
                          </div>

                          {claim.evidences && claim.evidences.length > 0 && (
                            <div className="space-y-1.5 pt-1">
                              <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                                Dẫn chứng đối chiếu
                              </p>
                              {claim.evidences.map((ev) => {
                                const safeUrl = sanitizeExternalHttpUrl(ev.url);
                                return (
                                  <div
                                    key={ev.evidenceId}
                                    className="rounded-lg bg-slate-100/80 dark:bg-slate-800/70 border border-slate-200/80 dark:border-slate-700 p-2.5 space-y-1"
                                  >
                                    <div className="flex items-center justify-between gap-2 font-semibold text-slate-800 dark:text-slate-200">
                                      <span className="inline-flex items-center gap-1.5 min-w-0 truncate">
                                        {ev.sourceType === 'web' ? (
                                          <Globe className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400 shrink-0" />
                                        ) : (
                                          <BookOpen className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400 shrink-0" />
                                        )}
                                        <span className="truncate">{ev.title}</span>
                                      </span>
                                      {ev.pageNumber && (
                                        <span className="font-mono text-[11px] shrink-0 tabular-nums">
                                          Tr. {ev.pageNumber}
                                        </span>
                                      )}
                                    </div>
                                    {ev.excerpt && (
                                      <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                                        {ev.excerpt}
                                      </p>
                                    )}
                                    {safeUrl && (
                                      <a
                                        href={safeUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1 text-sky-700 dark:text-sky-400 hover:underline font-medium"
                                      >
                                        {ev.domain || safeUrl}
                                        <ExternalLink className="w-3 h-3" />
                                      </a>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}

              {/* Compact Missing Coverage Section with Same "Xem thêm" Pattern */}
              {missingCoverageItems.length > 0 && (
                <div className="pt-3 mt-2 border-t border-slate-200/80 dark:border-slate-800 space-y-2.5">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800 dark:text-slate-200">
                    <AlertCircle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                    <span>Kiến thức còn thiếu theo phạm vi ({missingCoverageItems.length})</span>
                  </div>

                  {missingCoverageItems.map((cov) => {
                    const isCovExpanded = expandedCoverageIds.has(cov.itemId);
                    return (
                      <div
                        key={cov.itemId}
                        className="rounded-xl border border-amber-200/80 dark:border-amber-800/60 bg-amber-50/45 dark:bg-amber-950/25 p-3 text-xs"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-semibold text-amber-800 dark:text-amber-300">
                              {cov.status === 'MISSING' ? 'Còn thiếu' : 'Chưa đầy đủ'}
                              <span className="font-normal text-slate-500 dark:text-slate-400">
                                {' '}· {cov.chapter}
                              </span>
                            </p>
                            <p className="font-medium text-slate-900 dark:text-slate-100 mt-0.5">
                              {cov.concept}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => toggleExpandCoverage(cov.itemId)}
                            className="inline-flex items-center gap-1 text-xs font-medium text-sky-700 dark:text-sky-400 hover:underline cursor-pointer whitespace-nowrap shrink-0"
                            aria-expanded={isCovExpanded}
                          >
                            {isCovExpanded ? 'Thu gọn' : 'Xem thêm'}
                            {isCovExpanded ? (
                              <ChevronUp className="w-3.5 h-3.5" />
                            ) : (
                              <ChevronDown className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>

                        {isCovExpanded && (
                          <div className="mt-2.5 pt-2.5 border-t border-amber-200/70 dark:border-amber-800/50 space-y-2">
                            {cov.suggestedAddition && (
                              <p className="text-slate-700 dark:text-slate-200 leading-relaxed">
                                {cov.suggestedAddition}
                              </p>
                            )}
                            {cov.referenceExcerpt && (
                              <div className="rounded-lg bg-white/80 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-700 p-2.5 text-slate-700 dark:text-slate-300">
                                <p className="font-semibold text-emerald-800 dark:text-emerald-300 mb-0.5">
                                  Trích đoạn SGK
                                  {cov.referencePage ? ` · Tr. ${cov.referencePage}` : ''}
                                </p>
                                <p className="leading-relaxed">{cov.referenceExcerpt}</p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
