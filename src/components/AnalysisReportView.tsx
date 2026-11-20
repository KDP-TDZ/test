import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BookCheck,
  Calculator,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  Flag,
  Globe,
  HelpCircle,
  Layers,
  Lightbulb,
  Loader2,
  Printer,
  Sparkles,
  TrendingUp,
  XCircle,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { compareAnalysesBeforeAfter } from '../core/examScoring';
import { SUBJECT_LABELS, type AnalysisRecord, type FeedbackEntry } from '../core/types';
import { gsap, MOTION_ALLOWED_MEDIA, ScrollTrigger, useGSAP } from '../lib/gsapSetup';
import { authorizedFetch, parseApiResponse } from '../services/apiClient';
import { saveFlashcard, submitFeedback } from '../services/firestoreService';
import { GlassSurface } from './LiquidGlass/GlassSurface';
import { ScoreRing } from './LiquidGlass/ScoreRing';
import { WaterRippleButton } from './LiquidGlass/WaterRippleButton';
import { SplitDocumentViewer } from './SplitDocumentViewer';

interface AnalysisReportViewProps {
  analysis: AnalysisRecord;
  allAnalyses?: AnalysisRecord[];
  localFile?: File | null;
  onStartQuiz: (analysis: AnalysisRecord) => void;
  onOpenFlashcards?: () => void;
  onBack?: () => void;
}

const FEEDBACK_CATEGORIES: FeedbackEntry['category'][] = [
  'Đáp án đúng nhưng bị đánh dấu sai',
  'Thiếu dẫn chứng',
  'Giải thích chưa đúng',
  'Ngoài phạm vi',
  'Khó hiểu',
];

export const AnalysisReportView: React.FC<AnalysisReportViewProps> = ({
  analysis,
  allAnalyses = [],
  localFile,
  onStartQuiz,
  onOpenFlashcards,
  onBack,
}) => {
  const reportRef = useRef<HTMLDivElement>(null);
  const { user, systemStatus } = useAuth();
  const [showFormula, setShowFormula] = useState(false);

  // Flashcard generation state
  const [generatingCards, setGeneratingCards] = useState(false);
  const [flashcardNotice, setFlashcardNotice] = useState<string | null>(null);

  // Feedback reporting state
  const [reportingClaimId, setReportingClaimId] = useState<string | null>(null);
  const [feedbackCategory, setFeedbackCategory] = useState<FeedbackEntry['category']>(
    'Đáp án đúng nhưng bị đánh dấu sai'
  );
  const [feedbackNote, setFeedbackNote] = useState('');
  const [sendingFeedback, setSendingFeedback] = useState(false);
  const [feedbackResult, setFeedbackResult] = useState<string | null>(null);

  const acc = analysis.accuracyBreakdown;
  const comp = analysis.completenessBreakdown;
  const aiEnabled = systemStatus ? systemStatus.enabled : true;

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_ALLOWED_MEDIA, () => {
        const tl = gsap.timeline({ defaults: { ease: 'power2.out' } });
        tl.from('.report-hero-block', {
          y: 12,
          autoAlpha: 0,
          duration: 0.34,
          clearProps: 'transform,opacity,visibility',
        }).from(
          '.report-metric-card',
          {
            y: 14,
            autoAlpha: 0,
            duration: 0.34,
            stagger: 0.06,
            clearProps: 'transform,opacity,visibility',
          },
          '-=0.18'
        );

        const sections = gsap.utils.toArray<HTMLElement>('.report-scroll-section', reportRef.current);
        sections.forEach((section) => {
          gsap.from(section, {
            y: 16,
            autoAlpha: 0,
            duration: 0.38,
            ease: 'power2.out',
            clearProps: 'transform,opacity,visibility',
            scrollTrigger: {
              trigger: section,
              start: 'top 92%',
              once: true,
            },
          });
        });
      });
    },
    { scope: reportRef, dependencies: [analysis.analysisId] }
  );

  // Refresh ScrollTrigger positions whenever collapsible panels change document height
  useEffect(() => {
    const rafId = window.requestAnimationFrame(() => {
      ScrollTrigger.refresh();
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [showFormula, reportingClaimId, flashcardNotice, feedbackResult]);

  // Before/After Comparison against an older analysis in the same subject
  const previousComparable = useMemo(() => {
    const candidates = allAnalyses
      .filter(
        (a) =>
          a.analysisId !== analysis.analysisId &&
          a.subject === analysis.subject &&
          a.createdAt < analysis.createdAt
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return candidates[0] || null;
  }, [allAnalyses, analysis.analysisId, analysis.subject, analysis.createdAt]);

  const beforeAfter = useMemo(() => {
    if (!previousComparable) return null;
    return compareAnalysesBeforeAfter(previousComparable, analysis);
  }, [previousComparable, analysis]);

  const incorrectClaims = useMemo(
    () =>
      analysis.claims.filter(
        (c) =>
          c.evaluationStatus === 'INCORRECT' ||
          c.evaluationStatus === 'PARTIALLY_CORRECT' ||
          c.evaluationStatus === 'MISSING'
      ),
    [analysis.claims]
  );

  const handleCreateFlashcards = async () => {
    if (!user || generatingCards) return;
    setGeneratingCards(true);
    setFlashcardNotice(null);
    try {
      const res = await authorizedFetch('/api/ai/flashcards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: analysis.subject,
          grade: analysis.grade,
          textbookTitle: analysis.textbookTitle,
          claims: analysis.claims,
          coverageItems: analysis.coverageItems,
          count: 6,
        }),
      });
      const data = await parseApiResponse<{ cards: any[] }>(res, 'Không tạo được Flashcard từ báo cáo.');
      const cards = data.cards || [];
      for (const card of cards) {
        await saveFlashcard({
          ...card,
          ownerUid: user.uid,
        });
      }
      setFlashcardNotice(
        `Đã tạo và lưu ${cards.length} thẻ Flashcard vào Ngân hàng luyện tập → Thẻ ghi nhớ.`
      );
    } catch (err) {
      setFlashcardNotice(
        err instanceof Error ? err.message : 'Lỗi khi tạo Flashcard từ điểm yếu.'
      );
    } finally {
      setGeneratingCards(false);
    }
  };

  const handleSubmitClaimFeedback = async (claimId: string) => {
    if (!user || !feedbackNote.trim()) return;
    setSendingFeedback(true);
    setFeedbackResult(null);
    try {
      let aiClassification: string | undefined;
      try {
        const res = await authorizedFetch('/api/feedback/classify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            targetType: 'claim',
            category: feedbackCategory,
            note: feedbackNote.trim(),
          }),
        });
        if (res.ok) {
          const parsed = await res.json();
          aiClassification = parsed.classification;
        }
      } catch {
        // Optional enrichment
      }

      const now = new Date().toISOString();
      await submitFeedback({
        feedbackId: `fb_${user.uid}_${Date.now()}`,
        ownerUid: user.uid,
        ownerEmail: user.email || undefined,
        targetType: 'claim',
        targetId: claimId,
        analysisId: analysis.analysisId,
        category: feedbackCategory,
        note: feedbackNote.trim(),
        status: 'pending',
        ...(aiClassification ? { aiClassification } : {}),
        createdAt: now,
        updatedAt: now,
      });
      setReportingClaimId(null);
      setFeedbackNote('');
      setFeedbackResult('Đã gửi phản hồi tới Quản trị viên để rà soát chất lượng kiểm định.');
    } catch (err) {
      setFeedbackResult(err instanceof Error ? err.message : 'Không thể gửi phản hồi.');
    } finally {
      setSendingFeedback(false);
    }
  };

  return (
    <div ref={reportRef} className="space-y-6 sm:space-y-8">
      {/* Header & Actions */}
      <GlassSurface className="report-hero-block rounded-3xl p-4 sm:p-7 no-print">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 sm:gap-5">
          <div>
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                className="text-xs font-medium text-sky-700 dark:text-sky-400 hover:underline mb-2 cursor-pointer min-h-[32px] inline-flex items-center"
              >
                ← Quay lại danh sách
              </button>
            )}
            <h1 className="font-display text-[clamp(1.3rem,4vw,1.875rem)] font-bold text-[#16243E] dark:text-[#E6EFFC] leading-[1.25]">
              {analysis.documentTitle}
            </h1>
            <p className="text-xs sm:text-sm text-[#475B78] dark:text-[#B4C7E2] mt-1.5 leading-[1.6]">
              {SUBJECT_LABELS[analysis.subject]} · Lớp {analysis.grade} ·{' '}
              {analysis.textbookTitle || 'Đối chiếu chương trình phổ thông'} ·{' '}
              {new Date(analysis.createdAt).toLocaleString('vi-VN')}
            </p>
            {analysis.scope && (
              <p className="text-xs text-[#475B78] dark:text-[#B4C7E2] mt-1">
                Phạm vi kiểm định: {analysis.scope}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => window.print()}
              className="glass-control min-h-[44px] inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold text-[#16243E] dark:text-[#E6EFFC] cursor-pointer"
            >
              <Printer className="w-4 h-4 text-sky-600 dark:text-sky-400" />
              Xuất Phiếu sửa lỗi (In / PDF)
            </button>

            <button
              type="button"
              disabled={generatingCards || !aiEnabled}
              onClick={handleCreateFlashcards}
              className="glass-control min-h-[44px] inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold text-[#16243E] dark:text-[#E6EFFC] disabled:opacity-50 cursor-pointer"
            >
              {generatingCards ? (
                <Loader2 className="w-4 h-4 animate-spin text-sky-600" />
              ) : (
                <Layers className="w-4 h-4 text-sky-600 dark:text-sky-400" />
              )}
              Tạo Flashcard từ điểm yếu
            </button>

            <WaterRippleButton size="lg" onClick={() => onStartQuiz(analysis)}>
              <HelpCircle className="w-4 h-4" />
              Tạo bài tập trắc nghiệm
            </WaterRippleButton>
          </div>
        </div>

        {flashcardNotice && (
          <div className="mt-4 rounded-xl border border-blue-200 dark:border-blue-800/70 bg-blue-50/80 dark:bg-blue-950/40 px-4 py-2.5 text-xs text-blue-900 dark:text-blue-200 flex flex-wrap items-center justify-between gap-2">
            <span>{flashcardNotice}</span>
            {onOpenFlashcards && (
              <button
                type="button"
                onClick={onOpenFlashcards}
                className="font-semibold underline cursor-pointer"
              >
                Mở Ngân hàng Flashcard →
              </button>
            )}
          </div>
        )}

        {feedbackResult && (
          <div className="mt-3 rounded-xl border border-emerald-200 dark:border-emerald-800/70 bg-emerald-50 dark:bg-emerald-950/40 px-4 py-2.5 text-xs text-emerald-900 dark:text-emerald-200">
            {feedbackResult}
          </div>
        )}
      </GlassSurface>

      {/* Printable Error Fix Sheet ("Phiếu sửa lỗi" - visible cleanly when printing) */}
      <div className="hidden print:block document-paper p-6 space-y-4">
        <div className="border-b border-slate-300 pb-3">
          <h2 className="text-xl font-bold">PHIẾU SỬA LỖI & BỔ SUNG KIẾN THỨC — STUDYCHECK AI</h2>
          <p className="text-xs mt-1">
            Tài liệu: {analysis.documentTitle} · {SUBJECT_LABELS[analysis.subject]} Lớp {analysis.grade} · Ngày:{' '}
            {new Date(analysis.createdAt).toLocaleDateString('vi-VN')}
          </p>
          <p className="text-xs font-semibold mt-1">
            Độ chính xác: {analysis.accuracyScore ?? 'Chưa đủ dữ liệu'}% · Độ đầy đủ:{' '}
            {analysis.completenessScore ?? 'Không áp dụng'}%
          </p>
        </div>

        <div>
          <h3 className="text-sm font-bold mb-2">1. Các nội dung cần chỉnh sửa ({incorrectClaims.length})</h3>
          {incorrectClaims.length === 0 ? (
            <p className="text-xs">Không có lỗi sai cần chỉnh sửa.</p>
          ) : (
            <ul className="space-y-2 text-xs">
              {incorrectClaims.map((c, idx) => (
                <li key={c.claimId} className="border-b border-slate-200 pb-2">
                  <p className="font-semibold">
                    {idx + 1}. [{c.evaluationStatus}] {c.concept} (Tr. {c.sourcePage}): “{c.sourceText}”
                  </p>
                  <p>Cách sửa chuẩn: {c.suggestedFix || c.correctKnowledge}</p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h3 className="text-sm font-bold mb-2">2. Kiến thức còn thiếu theo phạm vi chương</h3>
          {analysis.coverageItems.filter((i) => i.status !== 'COVERED').length === 0 ? (
            <p className="text-xs">Đã bao phủ đầy đủ các mục tiêu kiểm tra.</p>
          ) : (
            <ul className="space-y-1 text-xs">
              {analysis.coverageItems
                .filter((i) => i.status !== 'COVERED')
                .map((cov) => (
                  <li key={cov.itemId}>
                    • <strong>{cov.concept}</strong>: {cov.suggestedAddition}
                  </li>
                ))}
            </ul>
          )}
        </div>
      </div>

      {/* Four Independent Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 sm:gap-5 no-print">
        <GlassSurface className="report-metric-card rounded-3xl p-4 sm:p-5">
          <ScoreRing
            label="Độ chính xác (Accuracy)"
            value={analysis.accuracyScore}
            subtitle={
              acc
                ? `${acc.counts.correct} đúng · ${acc.counts.partiallyCorrect} thiếu ĐK · ${acc.counts.incorrect} sai`
                : 'Chỉ chấm trên kiến thức đã viết & kiểm chứng'
            }
            color="sky"
          />
        </GlassSurface>

        <GlassSurface className="report-metric-card rounded-3xl p-4 sm:p-5">
          <ScoreRing
            label="Độ đầy đủ (Completeness)"
            value={analysis.completenessScore}
            subtitle={
              comp && comp.totalRequiredWeight > 0
                ? `Đủ ${comp.coveredCount} · Thiếu một phần ${comp.partialCount} · Thiếu ${comp.missingCount}`
                : 'Chưa chọn phạm vi chương/sách tham chiếu'
            }
            color="sky"
          />
        </GlassSurface>

        <GlassSurface className="report-metric-card rounded-3xl p-4 sm:p-5">
          <ScoreRing
            label="Tỷ lệ có dẫn chứng"
            value={analysis.evidenceCoverage}
            subtitle="Tỷ lệ nội dung có nguồn đối chiếu xác thực"
            color="emerald"
          />
        </GlassSurface>

        <GlassSurface className="report-metric-card rounded-3xl p-4 sm:p-5 flex flex-col justify-between">
          <div>
            <p className="text-xs font-medium text-[#475B78] dark:text-[#B4C7E2]">
              Mức độ tin cậy đánh giá
            </p>
            <p className="font-display text-xl font-bold text-[#16243E] dark:text-[#E6EFFC] mt-1">
              {analysis.confidenceLevel}
            </p>
          </div>
          <p className="text-xs text-[#475B78] dark:text-[#B4C7E2] mt-2 leading-[1.6]">
            {analysis.confidenceReason}
          </p>
        </GlassSurface>
      </div>

      {/* Before/After Comparison Card (when older analysis in same subject exists) */}
      {previousComparable && beforeAfter && (
        <GlassSurface className="report-scroll-section rounded-3xl p-4 sm:p-5 border border-sky-200/70 dark:border-sky-800/50 no-print">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <TrendingUp className="w-5 h-5 text-sky-600 dark:text-sky-400 shrink-0 mt-0.5" />
              <div className="text-xs">
                <p className="font-bold text-[#16243E] dark:text-[#E6EFFC] text-sm">
                  So sánh tiến bộ trước & sau (so với “{previousComparable.documentTitle}”)
                </p>
                <p className="text-slate-600 dark:text-slate-300 mt-0.5">{beforeAfter.summary}</p>
              </div>
            </div>
            <div className="flex items-center gap-4 text-xs font-mono shrink-0 tabular-nums">
              {beforeAfter.accuracyDelta !== null && (
                <span
                  className={
                    beforeAfter.accuracyDelta >= 0
                      ? 'text-emerald-700 dark:text-emerald-400 font-bold'
                      : 'text-amber-700 dark:text-amber-400 font-bold'
                  }
                >
                  Độ chính xác: {beforeAfter.accuracyDelta >= 0 ? '+' : ''}
                  {beforeAfter.accuracyDelta}%
                </span>
              )}
              {beforeAfter.completenessDelta !== null && (
                <span
                  className={
                    beforeAfter.completenessDelta >= 0
                      ? 'text-sky-700 dark:text-sky-400 font-bold'
                      : 'text-amber-700 dark:text-amber-400 font-bold'
                  }
                >
                  Độ đầy đủ: {beforeAfter.completenessDelta >= 0 ? '+' : ''}
                  {beforeAfter.completenessDelta}%
                </span>
              )}
            </div>
          </div>
        </GlassSurface>
      )}

      {/* Formula Transparency Drawer */}
      <div className="report-scroll-section glass-panel-subtle rounded-3xl overflow-hidden no-print">
        <button
          type="button"
          onClick={() => setShowFormula((v) => !v)}
          className="w-full min-h-[44px] px-4 sm:px-5 py-3.5 flex items-center justify-between text-xs font-semibold text-[#16243E] dark:text-[#E6EFFC] cursor-pointer"
        >
          <span className="inline-flex items-center gap-2">
            <Calculator className="w-4 h-4 text-sky-600 dark:text-sky-400" />
            Xem công thức tách biệt Độ chính xác và Độ đầy đủ
          </span>
          <ChevronDown
            className={`w-4 h-4 text-[#475B78] dark:text-[#B4C7E2] transition-transform ${showFormula ? 'rotate-180' : ''}`}
          />
        </button>
        {showFormula && (
          <div className="px-4 sm:px-5 pb-4 pt-2 border-t border-sky-200/60 dark:border-slate-700/70 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-slate-700 dark:text-slate-300 leading-[1.6]">
            <div>
              <p className="font-semibold text-sky-800 dark:text-sky-300 mb-1">
                Độ chính xác = Trọng số đúng đạt được / Tổng trọng số đã xác minh
              </p>
              <p>
                Đúng = 1,0 · Thiếu điều kiện = 0,5 · Sai = 0. Các ý chưa đủ căn cứ (Chưa xác định),
                chữ OCR mờ (OCR_UNCERTAIN) hoặc kiến thức ngoài phạm vi không bị phạt vào mẫu số.
              </p>
              {acc && (
                <p className="font-mono mt-1.5 text-[#16243E] dark:text-[#E6EFFC]">
                  Thực tế: {acc.earnedWeight} / {acc.verifiedWeight} ={' '}
                  {acc.accuracyScore !== null ? `${acc.accuracyScore}%` : 'Chưa đủ dữ liệu'}
                </p>
              )}
            </div>
            <div>
              <p className="font-semibold text-sky-800 dark:text-sky-300 mb-1">
                Độ đầy đủ = Trọng số ý đã bao phủ / Tổng trọng số khung kiến thức chương
              </p>
              <p>
                Chỉ chấm khi có sách giáo khoa hoặc khung mục tiêu chương rõ ràng. Thiếu ý chỉ ảnh
                hưởng Độ đầy đủ, tuyệt đối không làm giảm Độ chính xác.
              </p>
              {comp && (
                <p className="font-mono mt-1.5 text-[#16243E] dark:text-[#E6EFFC]">
                  Thực tế: {comp.coveredWeight} / {comp.totalRequiredWeight} ={' '}
                  {comp.completenessScore !== null ? `${comp.completenessScore}%` : 'Không áp dụng'}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Explicit Quiz Offer Banner */}
      <GlassSurface enableRipple className="report-scroll-section rounded-3xl p-4 sm:p-6 border border-sky-200/80 dark:border-sky-800/60 no-print">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <Sparkles className="w-6 h-6 text-sky-600 dark:text-sky-400 shrink-0 mt-0.5" />
            <div>
              <h2 className="font-display text-base font-bold text-[#16243E] dark:text-[#E6EFFC]">
                Luyện tập trắc nghiệm thích ứng & Nâng cao từ bài vừa phân tích
              </h2>
              <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
                Nếu nội dung tải lên tạo dưới 5 câu riêng biệt, hệ thống tự bổ sung từ sách giáo khoa đã hoàn
                thiện; bạn cũng có thể bật nút Nâng cao (1–6 câu mở rộng).
              </p>
            </div>
          </div>
          <WaterRippleButton onClick={() => onStartQuiz(analysis)}>
            Tạo bài trắc nghiệm ngay
          </WaterRippleButton>
        </div>
      </GlassSurface>

      {/* Split Document & Evidence Workspace */}
      <section className="report-scroll-section space-y-3 no-print">
        <h2 className="font-display text-lg sm:text-xl font-bold text-[#16243E] dark:text-[#E6EFFC] mt-2 mb-2.5">
          Đối chiếu tài liệu & dẫn chứng nguồn chuẩn
        </h2>
        <SplitDocumentViewer analysis={analysis} localFile={localFile} />
      </section>

      {/* Claim Suggested Fixes & User Feedback Controls */}
      {analysis.claims.length > 0 && (
        <GlassSurface className="report-scroll-section rounded-3xl p-4 sm:p-6 space-y-4 no-print">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-base font-bold text-[#16243E] dark:text-[#E6EFFC]">
              Gợi ý sửa nhanh & Phản hồi kết quả kiểm định ({analysis.claims.length} mệnh đề)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Phát hiện AI nhận định nhầm? Bấm “Báo sai / Phản hồi” để Admin rà soát.
            </p>
          </div>
          <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
            {analysis.claims.map((c) => {
              const isReporting = reportingClaimId === c.claimId;
              return (
                <div
                  key={c.claimId}
                  className="document-paper rounded-2xl p-4 text-xs space-y-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-[#16243E] dark:text-[#E6EFFC]">
                      {c.concept} · {c.chapter} (Tr. {c.sourcePage})
                    </span>
                    <div className="flex items-center gap-3">
                      <span
                        className={`font-semibold ${
                          c.evaluationStatus === 'CORRECT'
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : c.evaluationStatus === 'INCORRECT'
                            ? 'text-rose-700 dark:text-rose-400'
                            : c.evaluationStatus === 'PARTIALLY_CORRECT'
                            ? 'text-amber-700 dark:text-amber-400'
                            : 'text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        {c.evaluationStatus === 'CORRECT'
                          ? 'Đúng'
                          : c.evaluationStatus === 'INCORRECT'
                          ? 'Sai'
                          : c.evaluationStatus === 'PARTIALLY_CORRECT'
                          ? 'Thiếu điều kiện'
                          : c.evaluationStatus === 'OCR_UNCERTAIN'
                          ? 'Chữ OCR mờ'
                          : c.evaluationStatus === 'OUT_OF_SCOPE'
                          ? 'Ngoài phạm vi'
                          : 'Chưa xác định'}
                      </span>
                      <button
                        type="button"
                        onClick={() => setReportingClaimId(isReporting ? null : c.claimId)}
                        className="inline-flex items-center gap-1 text-slate-500 dark:text-slate-400 hover:text-sky-600 dark:hover:text-sky-400 cursor-pointer"
                      >
                        <Flag className="w-3.5 h-3.5" />
                        Báo sai / Phản hồi
                      </button>
                    </div>
                  </div>
                  <p className="text-slate-700 dark:text-slate-300 italic">“{c.sourceText}”</p>
                  {c.suggestedFix && (
                    <p className="rounded-xl bg-sky-50/85 dark:bg-sky-950/40 px-3 py-2 text-sky-950 dark:text-sky-200">
                      <strong>Gợi ý sửa:</strong> {c.suggestedFix}
                    </p>
                  )}

                  {isReporting && (
                    <div className="pt-2 border-t border-sky-200/60 dark:border-slate-700 space-y-2">
                      <div className="flex flex-wrap gap-2">
                        <select
                          value={feedbackCategory}
                          onChange={(e) => setFeedbackCategory(e.target.value as FeedbackEntry['category'])}
                          className="glass-control px-2.5 py-1.5 rounded-xl text-xs"
                        >
                          {FEEDBACK_CATEGORIES.map((cat) => (
                            <option key={cat} value={cat}>
                              {cat}
                            </option>
                          ))}
                        </select>
                        <input
                          type="text"
                          value={feedbackNote}
                          onChange={(e) => setFeedbackNote(e.target.value)}
                          placeholder="Ghi rõ lý do hoặc dẫn chứng sách giáo khoa..."
                          className="glass-control flex-1 min-w-[200px] px-2.5 py-1.5 rounded-xl text-xs"
                        />
                        <button
                          type="button"
                          disabled={sendingFeedback || !feedbackNote.trim()}
                          onClick={() => handleSubmitClaimFeedback(c.claimId)}
                          className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 text-white font-semibold disabled:opacity-50 cursor-pointer"
                        >
                          {sendingFeedback ? 'Đang gửi...' : 'Gửi phản hồi'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </GlassSurface>
      )}

      {/* Strengths, Weaknesses, Suggestions */}
      <div className="report-scroll-section grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 no-print">
        <GlassSurface className="rounded-3xl p-4 sm:p-6 space-y-4">
          <h3 className="font-display text-base font-bold text-emerald-900 dark:text-emerald-300 flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            Điểm mạnh đã thể hiện ({analysis.strengths.length})
          </h3>
          {analysis.strengths.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">Chưa ghi nhận điểm mạnh nổi bật đủ căn cứ.</p>
          ) : (
            <div className="space-y-3">
              {analysis.strengths.map((s, idx) => (
                <div
                  key={idx}
                  className="rounded-2xl bg-emerald-50/75 dark:bg-emerald-950/35 border border-emerald-200/80 dark:border-emerald-800/60 p-3.5 text-xs space-y-1"
                >
                  <p className="font-semibold text-emerald-950 dark:text-emerald-200">{s.title}</p>
                  <p className="text-slate-700 dark:text-slate-300 leading-relaxed">{s.detail}</p>
                  {s.sourceExcerpt && (
                    <p className="text-emerald-800 dark:text-emerald-300 italic">
                      “{s.sourceExcerpt}” (Tr. {s.pageNumber})
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </GlassSurface>

        <GlassSurface className="rounded-3xl p-6 space-y-4">
          <h3 className="font-display text-base font-bold text-rose-900 dark:text-rose-300 flex items-center gap-2">
            <XCircle className="w-5 h-5 text-rose-600 dark:text-rose-400" />
            Điểm cần khắc phục ({analysis.weaknesses.length})
          </h3>
          {analysis.weaknesses.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">Không phát hiện lỗ hổng hay lỗi sai nghiêm trọng.</p>
          ) : (
            <div className="space-y-3">
              {analysis.weaknesses.map((w, idx) => (
                <div
                  key={idx}
                  className="rounded-2xl bg-rose-50/75 dark:bg-rose-950/35 border border-rose-200/80 dark:border-rose-800/60 p-3.5 text-xs space-y-1"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-rose-950 dark:text-rose-200">{w.title}</p>
                    {w.pageNumber && <span className="font-mono text-rose-700 dark:text-rose-400">Tr. {w.pageNumber}</span>}
                  </div>
                  <p className="text-slate-700 dark:text-slate-300 leading-relaxed">{w.detail}</p>
                </div>
              ))}
            </div>
          )}
        </GlassSurface>

        <GlassSurface className="rounded-3xl p-6 space-y-4">
          <h3 className="font-display text-base font-bold text-sky-900 dark:text-sky-300 flex items-center gap-2">
            <Lightbulb className="w-5 h-5 text-sky-600 dark:text-sky-400" />
            Gợi ý cải thiện theo thứ tự ưu tiên
          </h3>
          {analysis.suggestions.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">Tiếp tục ôn tập đều qua bộ câu hỏi trắc nghiệm.</p>
          ) : (
            <div className="space-y-3">
              {analysis.suggestions.map((sg, idx) => (
                <div
                  key={idx}
                  className="rounded-2xl bg-sky-50/75 dark:bg-sky-950/35 border border-sky-200/80 dark:border-sky-800/60 p-3.5 text-xs space-y-1"
                >
                  <p className="font-semibold text-sky-950 dark:text-sky-200">
                    #{sg.priority || idx + 1} · {sg.title}
                  </p>
                  <p className="text-slate-700 dark:text-slate-300 leading-relaxed">{sg.description}</p>
                </div>
              ))}
            </div>
          )}
        </GlassSurface>
      </div>

      {/* Coverage Checklist & Grounded Web Sources */}
      <div className="report-scroll-section grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6 no-print">
        <div className="lg:col-span-7 glass-surface rounded-3xl p-4 sm:p-6">
          <h3 className="font-display text-base font-bold text-[#16243E] dark:text-[#E6EFFC] mb-4 flex items-center gap-2">
            <BookCheck className="w-5 h-5 text-sky-600 dark:text-sky-400" />
            Bảng kiểm mức độ bao phủ kiến thức chương ({analysis.coverageItems.length})
          </h3>
          {analysis.coverageItems.length === 0 ? (
            <p className="text-xs text-slate-600 dark:text-slate-300">
              Không có danh sách mục tiêu chương cụ thể cho lần phân tích này.
            </p>
          ) : (
            <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
              {analysis.coverageItems.map((cov) => (
                <div
                  key={cov.itemId}
                  className="document-paper rounded-2xl p-3.5 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-[#16243E] dark:text-[#E6EFFC]">{cov.concept}</span>
                    <span
                      className={`font-semibold shrink-0 ${
                        cov.status === 'COVERED'
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : cov.status === 'PARTIALLY_COVERED'
                          ? 'text-amber-700 dark:text-amber-400'
                          : 'text-rose-700 dark:text-rose-400'
                      }`}
                    >
                      {cov.status === 'COVERED'
                        ? 'Đã bao phủ'
                        : cov.status === 'PARTIALLY_COVERED'
                        ? 'Thiếu một phần'
                        : 'Còn thiếu'}
                    </span>
                  </div>
                  <p className="text-slate-500 dark:text-slate-400 mt-0.5">
                    {cov.chapter}
                    {cov.referencePage ? ` · SGK Tr. ${cov.referencePage}` : ''}
                  </p>
                  {cov.status !== 'COVERED' && cov.suggestedAddition && (
                    <p className="text-slate-700 dark:text-slate-200 mt-1.5 bg-amber-50/75 dark:bg-amber-950/35 rounded-xl px-2.5 py-1.5">
                      Cần bổ sung: {cov.suggestedAddition}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="lg:col-span-5 glass-surface rounded-3xl p-6">
          <h3 className="font-display text-base font-bold text-[#16243E] dark:text-[#E6EFFC] mb-4 flex items-center gap-2">
            <Globe className="w-5 h-5 text-sky-600 dark:text-sky-400" />
            Nguồn tham khảo ngoài sách (Web Grounding)
          </h3>
          {analysis.webGroundingNotice && (
            <div className="mb-3 rounded-2xl border border-amber-200 dark:border-amber-800/70 bg-amber-50/80 dark:bg-amber-950/40 p-3 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <span>{analysis.webGroundingNotice}</span>
            </div>
          )}
          {analysis.webSources.length === 0 ? (
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              {analysis.usedWebGrounding
                ? 'Google Search Grounding không trả về liên kết ngoài bổ sung cho truy vấn này.'
                : 'Phiên kiểm định này chỉ đối chiếu trên bộ sách giáo khoa và kiến thức chuẩn chương trình.'}
            </p>
          ) : (
            <div className="space-y-2.5">
              {analysis.webSources.map((src) => (
                <a
                  key={src.evidenceId}
                  href={src.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block document-paper rounded-2xl p-3.5 text-xs hover:border-sky-400 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2 font-semibold text-sky-700 dark:text-sky-400">
                    <span className="truncate">{src.title}</span>
                    <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                  </div>
                  <p className="text-slate-500 dark:text-slate-400 font-mono text-[11px] mt-1 truncate">
                    {src.domain || src.url}
                  </p>
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
