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
  sortClaimsByDocumentPosition,
  splitFormulaBlockDisplay,
  type InlineHighlightTarget,
  type InlineTextSegment,
} from '../core/semanticBlocks';
import {
  isBlockOcrUncertain,
  OCR_PAGE_LOW_CONFIDENCE_THRESHOLD,
} from '../core/verificationPostProcess';
import { sanitizeExternalHttpUrl } from '../core/urlSecurity';
import { MathText } from './MathText';
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

function getClaimStatusLabel(status: ExtractedClaim['evaluationStatus']): string {
  switch (status) {
    case 'INCORRECT':
      return 'Sai kiến thức / Công thức';
    case 'PARTIALLY_CORRECT':
      return 'Thiếu thông tin / Đơn vị / Điều kiện';
    case 'MISSING':
      return 'Thiếu ý kiến thức';
    case 'OCR_UNCERTAIN':
      return 'Chữ OCR chưa rõ';
    case 'UNVERIFIED':
      return 'Chưa đủ căn cứ xác minh';
    case 'AMBIGUOUS':
      return 'Diễn đạt chưa rõ';
    case 'OUT_OF_SCOPE':
      return 'Ngoài phạm vi';
    default:
      return 'Đúng có dẫn chứng';
  }
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
  const [filterMode, setFilterMode] = useState<
    'errors' | 'incorrect' | 'partial' | 'correct' | 'all'
  >('errors');
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
  const ocrConfirmed = Boolean(analysis.accuracyBreakdown?.gradingAudit?.ocrConfirmed);

  // Deterministically sort claims by real appearance order (page -> block -> offset)
  const orderedClaims = useMemo(
    () => sortClaimsByDocumentPosition(analysis.claims || [], pages),
    [analysis.claims, pages]
  );

  // Number all issue claims #1, #2, #3... strictly in document appearance order
  const issueClaims = useMemo(
    () => orderedClaims.filter((c) => isIssueClaim(c)),
    [orderedClaims]
  );

  const incorrectOnlyClaims = useMemo(
    () => orderedClaims.filter((c) => c.evaluationStatus === 'INCORRECT'),
    [orderedClaims]
  );

  const partialOnlyClaims = useMemo(
    () =>
      orderedClaims.filter(
        (c) =>
          c.evaluationStatus === 'PARTIALLY_CORRECT' ||
          c.evaluationStatus === 'MISSING'
      ),
    [orderedClaims]
  );

  const correctOnlyClaims = useMemo(
    () => orderedClaims.filter((c) => c.evaluationStatus === 'CORRECT'),
    [orderedClaims]
  );

  const claimOrderNumberMap = useMemo(() => {
    const map = new Map<string, number>();
    let n = 1;
    for (const c of orderedClaims) {
      if (isIssueClaim(c)) {
        map.set(c.claimId, n);
        n += 1;
      }
    }
    return map;
  }, [orderedClaims]);

  const [selectedClaimId, setSelectedClaimId] = useState<string | null>(
    issueClaims[0]?.claimId || orderedClaims[0]?.claimId || null
  );

  useEffect(() => {
    setSelectedClaimId(issueClaims[0]?.claimId || orderedClaims[0]?.claimId || null);
    setExpandedClaimIds(new Set());
    setExpandedCoverageIds(new Set());
  }, [analysis.analysisId, issueClaims, orderedClaims]);

  const noteCardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const leftMarkRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const pendingScrollClaimIdRef = useRef<string | null>(null);
  const isProgrammaticScrollRef = useRef(false);
  const scrollGuardTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (scrollGuardTimerRef.current !== null) {
        window.clearTimeout(scrollGuardTimerRef.current);
      }
    };
  }, []);

  const runGuardedScroll = (scrollFn: () => void) => {
    if (isProgrammaticScrollRef.current) return;
    isProgrammaticScrollRef.current = true;
    scrollFn();
    if (scrollGuardTimerRef.current !== null) {
      window.clearTimeout(scrollGuardTimerRef.current);
    }
    scrollGuardTimerRef.current = window.setTimeout(() => {
      isProgrammaticScrollRef.current = false;
      scrollGuardTimerRef.current = null;
    }, 320);
  };

  // Scroll to target mark after page switch completes
  useEffect(() => {
    const pendingId = pendingScrollClaimIdRef.current;
    if (!pendingId) return;
    pendingScrollClaimIdRef.current = null;
    window.requestAnimationFrame(() => {
      const markEl = leftMarkRefs.current[pendingId];
      if (markEl) {
        runGuardedScroll(() => {
          markEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
      }
    });
  }, [pageIndex]);

  const visibleClaims = useMemo(() => {
    if (filterMode === 'all') return orderedClaims;
    if (filterMode === 'incorrect') return incorrectOnlyClaims;
    if (filterMode === 'partial') return partialOnlyClaims;
    if (filterMode === 'correct') return correctOnlyClaims;
    return issueClaims;
  }, [
    orderedClaims,
    filterMode,
    issueClaims,
    incorrectOnlyClaims,
    partialOnlyClaims,
    correctOnlyClaims,
  ]);

  const pageHighlightTargets: InlineHighlightTarget[] = useMemo(() => {
    const annByClaim = new Map<string, AnnotationItem>();
    for (const ann of analysis.annotations || []) {
      if (ann.pageNumber === currentPageNumber && !annByClaim.has(ann.claimId)) {
        annByClaim.set(ann.claimId, ann);
      }
    }

    const claimsOnPage = orderedClaims.filter(
      (c) =>
        (c.sourcePage || 1) === currentPageNumber &&
        c.evaluationStatus !== 'MISSING' &&
        c.evaluationStatus !== 'OUT_OF_SCOPE'
    );

    const targets: InlineHighlightTarget[] = [];
    for (const claim of claimsOnPage) {
      if (filterMode === 'errors' && claim.evaluationStatus === 'CORRECT') {
        continue;
      }
      if (filterMode === 'incorrect' && claim.evaluationStatus !== 'INCORRECT') {
        continue;
      }
      if (
        filterMode === 'partial' &&
        claim.evaluationStatus !== 'PARTIALLY_CORRECT'
      ) {
        continue;
      }
      if (filterMode === 'correct' && claim.evaluationStatus !== 'CORRECT') {
        continue;
      }
      const ann = annByClaim.get(claim.claimId);
      targets.push({
        claimId: claim.claimId,
        blockId: claim.blockId || ann?.blockId,
        blockIds: claim.blockIds || ann?.blockIds,
        errorSpan: claim.errorSpan || ann?.errorSpan,
        textExcerpt: ann?.textExcerpt || claim.sourceText,
        startOffset: claim.startOffset ?? ann?.startOffset,
        endOffset: claim.endOffset ?? ann?.endOffset,
        contextBefore: claim.contextBefore,
        contextAfter: claim.contextAfter,
        locationStatus: claim.locationStatus || ann?.locationStatus,
        annotationColor: ann?.annotationColor || getClaimColor(claim.evaluationStatus),
        orderNumber: claimOrderNumberMap.get(claim.claimId),
      });
    }
    return targets;
  }, [analysis.annotations, orderedClaims, currentPageNumber, filterMode, claimOrderNumberMap]);

  // Dedicated MISSING claim anchors grouped by blockId (or page-end) so missing content never draws fake underlines
  const missingAnchorsByBlock = useMemo(() => {
    const byBlock = new Map<string, ExtractedClaim[]>();
    const pageEnd: ExtractedClaim[] = [];
    const currentBlockIds = new Set((currentPage?.blocks || []).map((b) => b.blockId));

    for (const claim of orderedClaims) {
      if (claim.evaluationStatus !== 'MISSING') continue;
      if ((claim.sourcePage || 1) !== currentPageNumber) continue;
      if (claim.blockId && currentBlockIds.has(claim.blockId)) {
        const list = byBlock.get(claim.blockId) || [];
        list.push(claim);
        byBlock.set(claim.blockId, list);
      } else {
        pageEnd.push(claim);
      }
    }
    return { byBlock, pageEnd };
  }, [orderedClaims, currentPage, currentPageNumber]);

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
      runGuardedScroll(() => {
        targetCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    }
  };

  const selectClaimFromRight = (claimId: string, sourcePage?: number) => {
    setSelectedClaimId(claimId);
    if (sourcePage && pages.length > 1) {
      const targetIdx = pages.findIndex((p) => p.pageNumber === sourcePage);
      if (targetIdx >= 0 && targetIdx !== pageIndex) {
        pendingScrollClaimIdRef.current = claimId;
        setPageIndex(targetIdx);
        return;
      }
    }
    window.requestAnimationFrame(() => {
      const markEl = leftMarkRefs.current[claimId];
      if (markEl) {
        runGuardedScroll(() => {
          markEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
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

  const renderMissingAnchors = (missingClaims: ExtractedClaim[], keyPrefix: string) => {
    if (!showAnnotations || missingClaims.length === 0) return null;
    return (
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {missingClaims.map((claim) => {
          const orderNum = claimOrderNumberMap.get(claim.claimId);
          const isSelected = selectedClaimId === claim.claimId;
          return (
            <button
              key={`${keyPrefix}_miss_${claim.claimId}`}
              ref={(el) => {
                if (el) {
                  leftMarkRefs.current[claim.claimId] = el;
                }
              }}
              type="button"
              onClick={() => selectClaimFromLeft(claim.claimId)}
              title="Ý kiến thức còn thiếu — Nhấp để xem chi tiết bên phải"
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-dashed text-xs font-medium transition-all cursor-pointer ${
                isSelected
                  ? 'border-amber-600 bg-amber-100 dark:bg-amber-900/60 text-amber-950 dark:text-amber-100 ring-2 ring-amber-400/80'
                  : 'border-amber-400 dark:border-amber-700 bg-amber-50/85 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 hover:bg-amber-100/80 dark:hover:bg-amber-900/50'
              }`}
            >
              {typeof orderNum === 'number' && (
                <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded bg-amber-600 text-white font-mono text-[10px] font-bold tabular-nums">
                  {orderNum}
                </span>
              )}
              <span>Thiếu ý: {claim.concept || 'Nội dung cần bổ sung'}</span>
            </button>
          );
        })}
      </div>
    );
  };

  const renderInlineSegments = (segments: InlineTextSegment[], keyPrefix: string) => {
    return segments.map((seg, idx) => {
      if (!seg.claimId || !seg.annotationColor || !showAnnotations) {
        return (
          <React.Fragment key={`${keyPrefix}_t_${idx}`}>
            <MathText text={seg.text} />
          </React.Fragment>
        );
      }
      const style = INLINE_MARK_STYLES[seg.annotationColor];
      const activeIds = seg.claimIds && seg.claimIds.length > 0 ? seg.claimIds : [seg.claimId];
      const isSelected = Boolean(selectedClaimId && activeIds.includes(selectedClaimId));
      const badges =
        seg.coLocatedBadges && seg.coLocatedBadges.length > 0
          ? seg.coLocatedBadges
          : typeof seg.orderNumber === 'number'
          ? [{ claimId: seg.claimId, annotationColor: seg.annotationColor, orderNumber: seg.orderNumber }]
          : [];

      return (
        <span key={`${keyPrefix}_m_${idx}`} className="inline">
          <button
            ref={(el) => {
              if (!el) return;
              for (const cid of activeIds) {
                if (!leftMarkRefs.current[cid]) {
                  leftMarkRefs.current[cid] = el;
                }
              }
            }}
            type="button"
            onClick={() => selectClaimFromLeft(seg.claimId!)}
            title={`${style.label} — Nhấp để xem chú thích`}
            className={`inline text-left rounded px-0.5 transition-all duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
              style.mark
            } ${isSelected ? style.activeRing : ''}`}
          >
            <MathText text={seg.text} />
          </button>
          {badges.map((badge) => {
            if (typeof badge.orderNumber !== 'number') return null;
            const badgeStyle = INLINE_MARK_STYLES[badge.annotationColor];
            const isBadgeSelected = selectedClaimId === badge.claimId;
            return (
              <button
                key={`${keyPrefix}_b_${idx}_${badge.claimId}`}
                ref={(el) => {
                  if (el && !leftMarkRefs.current[badge.claimId]) {
                    leftMarkRefs.current[badge.claimId] = el;
                  }
                }}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  selectClaimFromLeft(badge.claimId);
                }}
                title={`Chú thích #${badge.orderNumber} (${badgeStyle.label})`}
                className={`ml-0.5 inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded text-[10px] font-mono font-bold tabular-nums leading-none align-super select-none cursor-pointer transition-transform hover:scale-110 ${
                  badgeStyle.badgeBg
                } ${isBadgeSelected ? 'ring-2 ring-sky-400' : ''}`}
              >
                {badge.orderNumber}
              </button>
            );
          })}
        </span>
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
              (currentPage.ocrAverageConfidence < OCR_PAGE_LOW_CONFIDENCE_THRESHOLD ||
                !currentPage.rawText?.trim() ||
                /\[KHÔNG NHÌN RÕ\]/i.test(currentPage.rawText || '')) && (
                <div className="mb-4 rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50/90 dark:bg-amber-950/40 px-3.5 py-2.5 flex items-start gap-2.5 text-xs text-amber-950 dark:text-amber-200">
                  <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold">
                      Không thể nhìn rõ toàn bộ nội dung trang {currentPageNumber}
                    </p>
                    <p className="mt-0.5 text-amber-900/90 dark:text-amber-200/90">
                      Hệ thống giữ nguyên bản sao chép và không tự đoán hay sửa thay. Các đoạn đọc rõ vẫn được kiểm định bình thường; vui lòng chụp lại trang rõ nét hơn nếu có phần chữ bị mờ hoặc mất nét.
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
                const blockLowOcr = isBlockOcrUncertain(block, ocrConfirmed);
                const blockMissingClaims = missingAnchorsByBlock.byBlock.get(block.blockId) || [];

                const blockOcrWarningBanner = blockLowOcr ? (
                  <div className="mb-1 inline-flex items-center gap-1.5 text-[11px] font-medium text-amber-800 dark:text-amber-300 bg-amber-50/90 dark:bg-amber-950/50 border border-amber-300/80 dark:border-amber-700/70 rounded-md px-2 py-0.5">
                    <AlertCircle className="w-3 h-3 shrink-0" />
                    <span>
                      Đoạn OCR chưa rõ ({Math.round((block.confidence ?? 0) * 100)}%) — Không suy đoán
                    </span>
                  </div>
                ) : null;

                // Formula cluster (lead-in + formula OR standalone formula) — rendered ONCE, never duplicated!
                if (formulaBody) {
                  const formulaTargets = showAnnotations
                    ? pageHighlightTargets
                    : [];
                  // Adjust verified offsets when block has leadInLabel\nformulaBody
                  const formulaOffsetDelta =
                    leadInLabel && block.extractedText.includes(formulaBody)
                      ? block.extractedText.indexOf(formulaBody)
                      : 0;
                  const adjustedFormulaTargets: InlineHighlightTarget[] = formulaTargets.map((t) => {
                    if (
                      t.blockId === block.blockId &&
                      typeof t.startOffset === 'number' &&
                      typeof t.endOffset === 'number' &&
                      formulaOffsetDelta > 0 &&
                      t.startOffset >= formulaOffsetDelta
                    ) {
                      return {
                        ...t,
                        startOffset: t.startOffset - formulaOffsetDelta,
                        endOffset: t.endOffset - formulaOffsetDelta,
                      };
                    }
                    return t;
                  });
                  const formulaMatch = computeInlineHighlightSegments(
                    formulaBody,
                    block.blockId,
                    adjustedFormulaTargets
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
                      {blockOcrWarningBanner}
                      {leadInLabel && (
                        <p className="text-[15px] font-medium text-slate-800 dark:text-slate-100">
                          {labelMatch
                            ? renderInlineSegments(labelMatch.segments, `${block.blockId}_lbl`)
                            : <MathText text={leadInLabel} />}
                        </p>
                      )}
                      <div className="flex justify-center py-2.5 px-4 rounded-xl bg-slate-50/90 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-700/70">
                        <span className="font-mono text-[15px] tracking-wide text-slate-900 dark:text-slate-50 whitespace-pre-wrap text-center">
                          {renderInlineSegments(formulaMatch.segments, `${block.blockId}_fm`)}
                        </span>
                      </div>
                      {renderMissingAnchors(blockMissingClaims, block.blockId)}
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
                    <div key={block.blockId} className="pt-1">
                      {blockOcrWarningBanner}
                      <h4 className="font-display text-base font-semibold text-slate-900 dark:text-slate-50">
                        {renderInlineSegments(segments, block.blockId)}
                      </h4>
                      {renderMissingAnchors(blockMissingClaims, block.blockId)}
                    </div>
                  );
                }

                if (block.textType === 'list') {
                  return (
                    <div key={block.blockId}>
                      {blockOcrWarningBanner}
                      <div className="whitespace-pre-wrap pl-1 text-[14.5px] leading-7 text-slate-700 dark:text-slate-200">
                        {renderInlineSegments(segments, block.blockId)}
                      </div>
                      {renderMissingAnchors(blockMissingClaims, block.blockId)}
                    </div>
                  );
                }

                return (
                  <div key={block.blockId}>
                    {blockOcrWarningBanner}
                    <p className="whitespace-pre-wrap">
                      {renderInlineSegments(segments, block.blockId)}
                    </p>
                    {renderMissingAnchors(blockMissingClaims, block.blockId)}
                  </div>
                );
              })}

              {/* Page-level MISSING anchors not bound to a specific block */}
              {renderMissingAnchors(missingAnchorsByBlock.pageEnd, `p${currentPageNumber}_end`)}

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
            {/* Header, Quick Prev/Next Stepper & Granular Filter Tabs */}
            <div className="space-y-2.5 pb-3.5 mb-3.5 border-b border-slate-200/80 dark:border-slate-800">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Chú thích kiểm định ({visibleClaims.length})
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                    {issueClaims.length > 0
                      ? `${incorrectOnlyClaims.length} sai · ${partialOnlyClaims.length} thiếu · ${correctOnlyClaims.length} đúng chuẩn`
                      : 'Tất cả mệnh đề đã đối chiếu đều đúng chuẩn SGK'}
                  </p>
                </div>

                {visibleClaims.length > 1 && (
                  <div className="inline-flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        const idx = visibleClaims.findIndex((c) => c.claimId === selectedClaimId);
                        const prevIdx = idx <= 0 ? visibleClaims.length - 1 : idx - 1;
                        const target = visibleClaims[prevIdx];
                        if (target) {
                          selectClaimFromRight(target.claimId, target.sourcePage);
                          noteCardRefs.current[target.claimId]?.scrollIntoView({
                            behavior: 'smooth',
                            block: 'nearest',
                          });
                        }
                      }}
                      className="glass-control px-2 py-1 rounded-lg text-[11px] font-medium text-slate-700 dark:text-slate-200 cursor-pointer whitespace-nowrap"
                      title="Mục trước"
                    >
                      ↑ Trước
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const idx = visibleClaims.findIndex((c) => c.claimId === selectedClaimId);
                        const nextIdx = idx < 0 || idx >= visibleClaims.length - 1 ? 0 : idx + 1;
                        const target = visibleClaims[nextIdx];
                        if (target) {
                          selectClaimFromRight(target.claimId, target.sourcePage);
                          noteCardRefs.current[target.claimId]?.scrollIntoView({
                            behavior: 'smooth',
                            block: 'nearest',
                          });
                        }
                      }}
                      className="glass-control px-2 py-1 rounded-lg text-[11px] font-medium text-slate-700 dark:text-slate-200 cursor-pointer whitespace-nowrap"
                      title="Mục tiếp theo"
                    >
                      Tiếp ↓
                    </button>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800/90 rounded-xl text-[11px]">
                {(
                  [
                    ['errors', `Cần sửa (${issueClaims.length})`],
                    ['incorrect', `Sai (${incorrectOnlyClaims.length})`],
                    ['partial', `Thiếu (${partialOnlyClaims.length})`],
                    ['correct', `Đúng (${correctOnlyClaims.length})`],
                    ['all', `Tất cả (${analysis.claims.length})`],
                  ] as const
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setFilterMode(mode)}
                    className={`px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 tabular-nums ${
                      filterMode === mode
                        ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 font-semibold shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    {label}
                  </button>
                ))}
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
                  const statusLabel = getClaimStatusLabel(claim.evaluationStatus);
                  const orderNum = claimOrderNumberMap.get(claim.claimId);
                  const isSelected = selectedClaimId === claim.claimId;
                  const isExpanded = expandedClaimIds.has(claim.claimId);
                  const conciseFix = getConciseFixText(claim);
                  const isMissingClaim = claim.evaluationStatus === 'MISSING';
                  const isUnverifiedLocation = claim.locationStatus === 'unverified';
                  const displaySnippet = isMissingClaim
                    ? (claim.concept || claim.sourceText || 'Nội dung kiến thức còn thiếu').trim()
                    : (claim.errorSpan || claim.sourceText || '').trim();
                  const showFullSourceInDrawer =
                    !isMissingClaim &&
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
                              {statusLabel}
                            </span>
                          </div>
                          <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400 tabular-nums shrink-0">
                            Tr. {claim.sourcePage}
                          </span>
                        </div>

                        {/* Exact flawed phrase / formula OR missing concept description */}
                        <p className="text-xs font-medium text-slate-700 dark:text-slate-200 leading-relaxed line-clamp-2">
                          {isMissingClaim ? (
                            <MathText text={displaySnippet} />
                          ) : (
                            <>
                              <span className="text-slate-400 dark:text-slate-500">“</span>
                              <MathText text={displaySnippet} />
                              <span className="text-slate-400 dark:text-slate-500">”</span>
                            </>
                          )}
                        </p>

                        {isUnverifiedLocation && (
                          <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400 font-medium">
                            Chưa xác minh được vị trí gạch chân duy nhất trên bản gốc — đối chiếu theo trích đoạn
                          </p>
                        )}

                        {/* Concise 1-line direct fix */}
                        {claim.evaluationStatus !== 'CORRECT' && conciseFix && (
                          <p className="mt-1.5 text-xs text-slate-900 dark:text-slate-100 leading-relaxed">
                            <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                              Sửa chuẩn:{' '}
                            </span>
                            <MathText text={conciseFix} />
                          </p>
                        )}
                      </div>

                      {/* Progressive Disclosure Trigger: "Xem thêm" to expand concept clarification */}
                      <div className="mt-2.5 pt-2 border-t border-slate-200/70 dark:border-slate-800/80 flex items-center justify-between gap-2">
                        <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                          <MathText text={claim.concept} />
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
                              <MathText text={claim.explanation} />
                            </p>
                          </div>

                          {claim.verificationNote && (
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 italic">
                              Ghi chú kiểm định: <MathText text={claim.verificationNote} />
                            </p>
                          )}

                          {claim.correctKnowledge && (
                            <div className="rounded-lg bg-emerald-50/75 dark:bg-emerald-950/35 border border-emerald-200/80 dark:border-emerald-800/60 p-2.5">
                              <p className="text-[11px] font-semibold text-emerald-800 dark:text-emerald-300 mb-0.5">
                                Kiến thức chuẩn xác cần nắm
                              </p>
                              <p className="text-emerald-950 dark:text-emerald-100 leading-relaxed">
                                <MathText text={claim.correctKnowledge} />
                              </p>
                            </div>
                          )}

                          {claim.suggestedFix && claim.suggestedFix !== conciseFix && (
                            <div className="rounded-lg bg-sky-50/75 dark:bg-sky-950/35 border border-sky-200/80 dark:border-sky-800/60 p-2.5">
                              <p className="text-[11px] font-semibold text-sky-800 dark:text-sky-300 mb-0.5">
                                Gợi ý viết lại đầy đủ
                              </p>
                              <p className="text-sky-950 dark:text-sky-100 leading-relaxed">
                                <MathText text={claim.suggestedFix} />
                              </p>
                            </div>
                          )}

                          {showFullSourceInDrawer && (
                            <div>
                              <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-0.5">
                                Nguyên văn câu trong bài làm
                              </p>
                              <p className="text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">
                                <MathText text={claim.sourceText} />
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
                                        <MathText text={ev.excerpt} />
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
                              <MathText text={cov.concept} />
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
                                <MathText text={cov.suggestedAddition} />
                              </p>
                            )}
                            {cov.referenceExcerpt && (
                              <div className="rounded-lg bg-white/80 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-700 p-2.5 text-slate-700 dark:text-slate-300">
                                <p className="font-semibold text-emerald-800 dark:text-emerald-300 mb-0.5">
                                  Trích đoạn SGK
                                  {cov.referencePage ? ` · Tr. ${cov.referencePage}` : ''}
                                </p>
                                <p className="leading-relaxed">
                                  <MathText text={cov.referenceExcerpt} />
                                </p>
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
