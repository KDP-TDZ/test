import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BookCheck,
  Calculator,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  FileCheck2,
  FileSpreadsheet,
  FileText,
  Flag,
  Globe,
  HelpCircle,
  Layers,
  Lightbulb,
  Printer,
  ScrollText,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  XCircle,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { compareAnalysesBeforeAfter } from '../core/examScoring';
import { computeClaimScoreSummary } from '../core/scoring';
import {
  buildVerificationSummaryReport,
  type VerificationSummaryReport,
} from '../core/summaryReportBuilder';
import { SUBJECT_LABELS, type AnalysisRecord, type FeedbackEntry } from '../core/types';
import { sanitizeExternalHttpUrl } from '../core/urlSecurity';
import { authorizedFetch, parseApiResponse } from '../services/apiClient';
import { saveFlashcard, submitFeedback } from '../services/firestoreService';
import {
  exportSummaryAsDocx,
  exportSummaryAsTxt,
  exportSummaryAsXlsx,
  type SummaryExportFormat,
} from '../services/summaryExportService';
import { CalmDots } from './CalmLoadingIndicator';
import { GlassSurface } from './LiquidGlass/GlassSurface';
import { ScoreRing } from './LiquidGlass/ScoreRing';
import { SmoothAccordion } from './LiquidGlass/SmoothAccordion';
import { WaterRippleButton } from './LiquidGlass/WaterRippleButton';
import { SplitDocumentViewer } from './SplitDocumentViewer';
import { SummaryExportModal } from './SummaryExportModal';
import { VerificationFiveStepBar } from './VerificationFiveStepBar';
import {
  buildErrorCorrectionQueue,
  type VerificationStepId,
} from '../core/verificationStepper';

interface StudentCorrectionRecord {
  studentText: string;
  resolved: boolean;
  updatedAt: string;
}

interface AnalysisReportViewProps {
  analysis: AnalysisRecord;
  allAnalyses?: AnalysisRecord[];
  localFile?: File | null;
  onStartQuiz: (analysis: AnalysisRecord) => void;
  onOpenFlashcards?: () => void;
  onBack?: () => void;
  onStartNewUpload?: () => void;
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
  onStartNewUpload,
}) => {
  const reportRef = useRef<HTMLDivElement>(null);
  const { user, profile, systemStatus } = useAuth();
  const [showFormula, setShowFormula] = useState(false);
  const [showAuditTrail, setShowAuditTrail] = useState(false);

  // Confirmed Summary Report Export State (strictly null until user explicitly confirms)
  const [summaryModalOpen, setSummaryModalOpen] = useState(false);
  const [confirmedSummary, setConfirmedSummary] = useState<VerificationSummaryReport | null>(null);
  const [includeStudentCorrections, setIncludeStudentCorrections] = useState(true);
  const [includeCoverageAndSources, setIncludeCoverageAndSources] = useState(true);
  const [summaryCustomNote, setSummaryCustomNote] = useState('');
  const [printSheetMode, setPrintSheetMode] = useState<'fix_sheet' | 'full_summary'>('fix_sheet');
  const [inlineExportingFormat, setInlineExportingFormat] = useState<SummaryExportFormat | null>(null);
  const [inlineExportNotice, setInlineExportNotice] = useState<string | null>(null);
  const [inlineExportError, setInlineExportError] = useState<string | null>(null);

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

  // Step 4 & Step 5 Guided Error-Correction Workflow State
  const actionableQueue = useMemo(() => buildErrorCorrectionQueue(analysis), [analysis]);
  const storageKey = `studycheck_corrections_v1_${analysis.analysisId}`;

  const [correctionsMap, setCorrectionsMap] = useState<Record<string, StudentCorrectionRecord>>(() => {
    try {
      const raw = window.localStorage.getItem(`studycheck_corrections_v1_${analysis.analysisId}`);
      return raw ? (JSON.parse(raw) as Record<string, StudentCorrectionRecord>) : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      setCorrectionsMap(raw ? (JSON.parse(raw) as Record<string, StudentCorrectionRecord>) : {});
    } catch {
      setCorrectionsMap({});
    }
  }, [storageKey]);

  const persistCorrectionsMap = (next: Record<string, StudentCorrectionRecord>) => {
    setCorrectionsMap(next);
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // Ignore quota errors
    }
  };

  const resolvedItemsCount = useMemo(
    () => actionableQueue.filter((item) => Boolean(correctionsMap[item.id]?.resolved)).length,
    [actionableQueue, correctionsMap]
  );

  const allActionableResolved =
    actionableQueue.length === 0 || resolvedItemsCount >= actionableQueue.length;

  const [activeWorkflowStep, setActiveWorkflowStep] = useState<4 | 5>(() =>
    actionableQueue.length === 0 ? 5 : 4
  );
  const [correctionFilter, setCorrectionFilter] = useState<
    'all' | 'claim_error' | 'gaps' | 'resolved'
  >('all');

  useEffect(() => {
    setActiveWorkflowStep(actionableQueue.length === 0 ? 5 : 4);
    setCorrectionFilter('all');
    setConfirmedSummary(null);
    setSummaryModalOpen(false);
    setSummaryCustomNote('');
    setPrintSheetMode('fix_sheet');
    setInlineExportNotice(null);
    setInlineExportError(null);
  }, [analysis.analysisId, actionableQueue.length]);

  useEffect(() => {
    const handleAfterPrint = () => {
      setPrintSheetMode('fix_sheet');
    };
    window.addEventListener('afterprint', handleAfterPrint);
    return () => window.removeEventListener('afterprint', handleAfterPrint);
  }, []);

  const triggerPrintWithMode = (mode: 'fix_sheet' | 'full_summary') => {
    if (mode === 'full_summary' && !confirmedSummary) return;
    setPrintSheetMode(mode);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        window.print();
      });
    });
  };

  const handleConfirmCreateSummary = () => {
    const generatedByName =
      profile?.displayName || user?.displayName || user?.email || 'Học sinh StudyCheck AI';
    const report = buildVerificationSummaryReport(analysis, {
      confirmed: true,
      confirmedAt: new Date().toISOString(),
      includeStudentCorrections,
      includeCoverageAndSources,
      customNote: summaryCustomNote,
      correctionsMap,
      generatedByName,
    });
    setConfirmedSummary(report);
    setInlineExportNotice(null);
    setInlineExportError(null);
  };

  const handleInlineSummaryDownload = async (format: SummaryExportFormat) => {
    if (!confirmedSummary || inlineExportingFormat) return;
    setInlineExportingFormat(format);
    setInlineExportNotice(null);
    setInlineExportError(null);
    try {
      if (format === 'txt') {
        const fileName = exportSummaryAsTxt(confirmedSummary);
        setInlineExportNotice(`Đã tải xuống bản tổng kết TXT: ${fileName}`);
      } else if (format === 'docx') {
        const fileName = await exportSummaryAsDocx(confirmedSummary);
        setInlineExportNotice(`Đã tải xuống bản tổng kết Word: ${fileName}`);
      } else if (format === 'xlsx') {
        const fileName = await exportSummaryAsXlsx(confirmedSummary);
        setInlineExportNotice(`Đã tải xuống bản tổng kết Excel: ${fileName}`);
      } else if (format === 'pdf') {
        triggerPrintWithMode('full_summary');
        setInlineExportNotice('Đã mở hộp thoại In / Lưu PDF cho bản tổng kết.');
      }
    } catch (err) {
      setInlineExportError(
        err instanceof Error ? err.message : 'Không thể tạo tệp bản tổng kết lúc này.'
      );
    } finally {
      setInlineExportingFormat(null);
    }
  };

  const handleUpdateStudentCorrectionText = (itemId: string, text: string) => {
    const existing = correctionsMap[itemId];
    persistCorrectionsMap({
      ...correctionsMap,
      [itemId]: {
        studentText: text,
        resolved: existing?.resolved ?? false,
        updatedAt: new Date().toISOString(),
      },
    });
  };

  const handleToggleItemResolved = (itemId: string, suggestedFallback: string) => {
    const existing = correctionsMap[itemId];
    const nextResolved = !existing?.resolved;
    const nextMap: Record<string, StudentCorrectionRecord> = {
      ...correctionsMap,
      [itemId]: {
        studentText: existing?.studentText?.trim()
          ? existing.studentText
          : nextResolved
          ? suggestedFallback
          : '',
        resolved: nextResolved,
        updatedAt: new Date().toISOString(),
      },
    };
    persistCorrectionsMap(nextMap);
  };

  const handleMarkAllItemsResolved = () => {
    const now = new Date().toISOString();
    const nextMap: Record<string, StudentCorrectionRecord> = { ...correctionsMap };
    for (const item of actionableQueue) {
      const existing = nextMap[item.id];
      nextMap[item.id] = {
        studentText: existing?.studentText?.trim() ? existing.studentText : item.suggestedFix,
        resolved: true,
        updatedAt: now,
      };
    }
    persistCorrectionsMap(nextMap);
    setActiveWorkflowStep(5);
  };

  const filteredActionableQueue = useMemo(() => {
    return actionableQueue.filter((item) => {
      const isResolved = Boolean(correctionsMap[item.id]?.resolved);
      if (correctionFilter === 'claim_error') return item.kind === 'claim_error';
      if (correctionFilter === 'gaps')
        return item.kind === 'claim_partial' || item.kind === 'coverage_gap';
      if (correctionFilter === 'resolved') return isResolved;
      return true;
    });
  }, [actionableQueue, correctionsMap, correctionFilter]);

  const dynamicProgressPct =
    activeWorkflowStep === 5
      ? 100
      : actionableQueue.length === 0
      ? 100
      : Math.min(96, 80 + Math.round((resolvedItemsCount / actionableQueue.length) * 16));

  const acc = analysis.accuracyBreakdown;
  const comp = analysis.completenessBreakdown;
  const scoreSummary = useMemo(
    () => computeClaimScoreSummary(analysis.claims || [], acc),
    [analysis.claims, acc]
  );
  const aiEnabled = systemStatus ? systemStatus.enabled : true;

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

  const errorClaimsCount = useMemo(
    () => analysis.claims.filter((c) => c.evaluationStatus === 'INCORRECT').length,
    [analysis.claims]
  );

  const missingInfoCount = useMemo(() => {
    const partialClaims = analysis.claims.filter(
      (c) => c.evaluationStatus === 'PARTIALLY_CORRECT' || c.evaluationStatus === 'MISSING'
    ).length;
    const missingCoverage = analysis.coverageItems.filter((i) => i.status !== 'COVERED').length;
    return Math.max(partialClaims, missingCoverage);
  }, [analysis.claims, analysis.coverageItems]);

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

  const reportInteractiveSteps: VerificationStepId[] = [
    ...(onStartNewUpload ? ([1] as VerificationStepId[]) : []),
    4,
    5,
  ];

  return (
    <div ref={reportRef} className="space-y-6 sm:space-y-8">
      {/* 5-Step Progress Stepper Card (Matched to Reference Design — Steps 4 & 5 Active) */}
      <VerificationFiveStepBar
        activeStep={activeWorkflowStep}
        customProgressPct={dynamicProgressPct}
        interactiveSteps={reportInteractiveSteps}
        statusSummaryText={
          activeWorkflowStep === 4
            ? actionableQueue.length === 0
              ? 'Bài làm đạt chuẩn 100% — Không có lỗi kiến thức cần chỉnh sửa'
              : `Đã rà soát & sửa ${resolvedItemsCount}/${actionableQueue.length} mục cần khắc phục`
            : `Đã hoàn tất kiểm định · Chính xác ${analysis.accuracyScore ?? '—'}% · Đầy đủ ${
                analysis.completenessScore ?? '—'
              }%`
        }
        onSelectStep={(stepId) => {
          if (stepId === 1 && onStartNewUpload) {
            onStartNewUpload();
          } else if (stepId === 4 || stepId === 5) {
            setActiveWorkflowStep(stepId);
          }
        }}
      />

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
              onClick={() => triggerPrintWithMode('fix_sheet')}
              className="glass-control min-h-[44px] inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold text-[#16243E] dark:text-[#E6EFFC] cursor-pointer"
            >
              <Printer className="w-4 h-4 text-sky-600 dark:text-sky-400" />
              Xuất Phiếu sửa lỗi (In / PDF)
            </button>

            <button
              type="button"
              onClick={() => setSummaryModalOpen(true)}
              className="glass-control min-h-[44px] inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold text-[#1746A2] dark:text-[#93C5FD] cursor-pointer"
            >
              <FileCheck2 className="w-4 h-4 text-[#2563EB] dark:text-[#60A5FA]" />
              {confirmedSummary ? 'Tải bản tổng kết (Đã tạo)' : 'Tạo & Tải bản tổng kết'}
            </button>

            <button
              type="button"
              disabled={generatingCards || !aiEnabled}
              onClick={handleCreateFlashcards}
              className="glass-control min-h-[44px] inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold text-[#16243E] dark:text-[#E6EFFC] disabled:opacity-50 cursor-pointer"
            >
              {generatingCards ? (
                <CalmDots className="text-[#2563EB] dark:text-[#60A5FA]" />
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

      {/* Printable Sheet (Error Fix Sheet OR Confirmed Full Summary Report) */}
      {printSheetMode === 'full_summary' && confirmedSummary ? (
        <div className="hidden print:block document-paper p-6 space-y-5 text-slate-900">
          <div className="border-b border-slate-300 pb-3">
            <h2 className="text-xl font-bold">BẢN TỔNG KẾT KIỂM ĐỊNH KIẾN THỨC — STUDYCHECK AI</h2>
            <p className="text-xs mt-1">
              Tài liệu: <strong>{confirmedSummary.documentTitle}</strong> ·{' '}
              {confirmedSummary.subjectLabel} Lớp {confirmedSummary.grade} · Nguồn:{' '}
              {confirmedSummary.textbookTitle}
            </p>
            <p className="text-xs mt-0.5">
              Phạm vi: {confirmedSummary.scope} · Kiểm định: {confirmedSummary.analyzedAtDisplay} ·
              Xác nhận tạo bản tổng kết: {confirmedSummary.confirmedAtDisplay}
            </p>
            {confirmedSummary.customNote && (
              <p className="text-xs mt-1 italic">Ghi chú: {confirmedSummary.customNote}</p>
            )}
            <p className="text-xs font-semibold mt-2">
              Độ chính xác: {confirmedSummary.metrics.accuracyScoreDisplay} · Độ đầy đủ:{' '}
              {confirmedSummary.metrics.completenessScoreDisplay} · Tỷ lệ dẫn chứng:{' '}
              {confirmedSummary.metrics.evidenceCoverageDisplay} · Tin cậy:{' '}
              {confirmedSummary.metrics.confidenceLevel}
            </p>
          </div>

          <div className="grid grid-cols-3 gap-4 text-xs">
            <div>
              <h3 className="font-bold mb-1">Điểm mạnh ({confirmedSummary.strengths.length})</h3>
              {confirmedSummary.strengths.length === 0 ? (
                <p>Chưa ghi nhận điểm mạnh nổi bật.</p>
              ) : (
                <ul className="space-y-1">
                  {confirmedSummary.strengths.map((s, idx) => (
                    <li key={idx}>• {s.title}: {s.detail}</li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h3 className="font-bold mb-1">Cần khắc phục ({confirmedSummary.weaknesses.length})</h3>
              {confirmedSummary.weaknesses.length === 0 ? (
                <p>Không phát hiện lỗi sai nghiêm trọng.</p>
              ) : (
                <ul className="space-y-1">
                  {confirmedSummary.weaknesses.map((w, idx) => (
                    <li key={idx}>• [{w.categoryLabel}] {w.title}: {w.detail}</li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h3 className="font-bold mb-1">Gợi ý ưu tiên ({confirmedSummary.suggestions.length})</h3>
              {confirmedSummary.suggestions.length === 0 ? (
                <p>Tiếp tục ôn tập đều qua đề trắc nghiệm.</p>
              ) : (
                <ul className="space-y-1">
                  {confirmedSummary.suggestions.map((sg) => (
                    <li key={sg.priority}>• #{sg.priority} {sg.title}: {sg.description}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-bold mb-2">
              Chi tiết mệnh đề đã kiểm định ({confirmedSummary.claims.length})
            </h3>
            {confirmedSummary.claims.length === 0 ? (
              <p className="text-xs">Không có mệnh đề trích xuất.</p>
            ) : (
              <ul className="space-y-2 text-xs">
                {confirmedSummary.claims.map((c) => (
                  <li key={c.claimId} className="border-b border-slate-200 pb-2">
                    <p className="font-semibold">
                      #{c.index} [{c.statusLabel}] {c.concept} (Tr. {c.sourcePage}): “{c.sourceText}”
                    </p>
                    <p>Giải thích: {c.explanation}</p>
                    {(c.suggestedFix || c.correctKnowledge) && (
                      <p>Kiến thức chuẩn / Gợi ý sửa: {c.suggestedFix || c.correctKnowledge}</p>
                    )}
                    {confirmedSummary.includeStudentCorrections && c.status !== 'CORRECT' && (
                      <p>
                        Tự sửa của học sinh ({c.studentResolved ? 'Đã sửa' : 'Chưa đánh dấu sửa'}):{' '}
                        {c.studentFixText || '(Chưa nhập)'}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {confirmedSummary.includeCoverageAndSources && confirmedSummary.coverageItems.length > 0 && (
            <div>
              <h3 className="text-sm font-bold mb-2">
                Bảng kiểm độ bao phủ chương ({confirmedSummary.coverageItems.length})
              </h3>
              <ul className="space-y-1 text-xs">
                {confirmedSummary.coverageItems.map((cov) => (
                  <li key={cov.itemId}>
                    • [{cov.statusLabel}] <strong>{cov.concept}</strong> ({cov.chapter}):{' '}
                    {cov.status === 'COVERED'
                      ? 'Đã bao phủ đầy đủ'
                      : cov.suggestedAddition || cov.referenceExcerpt}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="pt-4 border-t border-slate-200 flex items-center justify-between text-xs">
            <span>
              Người xuất: {confirmedSummary.generatedByName} · Xác thực bởi StudyCheck AI
            </span>
            <div className="flex items-center gap-2">
              <span className="font-semibold">Tác giả hệ thống: Tuấn Khang</span>
              <div className="h-10 w-28 overflow-hidden flex items-center justify-center">
                <img
                  src="/assets/aistudio/taoanhdep_chu_ky_35965_c16c11c6.png"
                  alt="Chữ ký Tuấn Khang"
                  data-no-privacy-blur="true"
                  className="w-full h-full object-contain scale-[2.3] mix-blend-multiply"
                />
              </div>
            </div>
          </div>
        </div>
      ) : (
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

          <div className="pt-4 border-t border-slate-200 flex items-center justify-between text-xs">
            <span>Xác thực bởi hệ thống StudyCheck AI</span>
            <div className="flex items-center gap-2">
              <span className="font-semibold">Tác giả hệ thống: Tuấn Khang</span>
              <div className="h-10 w-28 overflow-hidden flex items-center justify-center">
                <img
                  src="/assets/aistudio/taoanhdep_chu_ky_35965_c16c11c6.png"
                  alt="Chữ ký Tuấn Khang"
                  data-no-privacy-blur="true"
                  className="w-full h-full object-contain scale-[2.3] mix-blend-multiply"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Four Independent Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 sm:gap-5 no-print">
        <GlassSurface className="report-metric-card rounded-3xl p-4 sm:p-5 space-y-2.5">
          <ScoreRing
            label="Độ chính xác (Accuracy)"
            value={scoreSummary.correctPercent ?? analysis.accuracyScore}
            subtitle={
              scoreSummary.evaluatedTotal > 0
                ? `Tổng ${scoreSummary.evaluatedTotal} ý: ${scoreSummary.correctCount} đúng · ${scoreSummary.partialCount} thiếu/1 phần · ${scoreSummary.incorrectCount} sai${
                    scoreSummary.missingCount > 0 ? ` · ${scoreSummary.missingCount} thiếu ý` : ''
                  }`
                : 'Chưa đủ mệnh đề xác minh để tính điểm'
            }
            color="sky"
          />
          {scoreSummary.evaluatedTotal > 0 &&
            scoreSummary.exactCorrectPercent !== null &&
            scoreSummary.partialPercent !== null &&
            scoreSummary.exactIncorrectPercent !== null && (
              <div className="pt-2 border-t border-slate-200/70 dark:border-slate-700/70 flex flex-wrap items-center justify-between gap-1 text-[11px] font-mono tabular-nums">
                <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                  Đúng {scoreSummary.exactCorrectPercent}%
                </span>
                <span className="font-semibold text-amber-700 dark:text-amber-400">
                  Một phần {scoreSummary.partialPercent}%
                </span>
                <span className="font-semibold text-rose-700 dark:text-rose-400">
                  Sai {scoreSummary.exactIncorrectPercent}%
                </span>
              </div>
            )}
        </GlassSurface>

        <GlassSurface className="report-metric-card rounded-3xl p-4 sm:p-5">
          <ScoreRing
            label="Độ đầy đủ (Completeness)"
            value={analysis.completenessScore}
            subtitle={
              comp && comp.totalRequiredWeight > 0
                ? comp.rubricMode === 'fixed_textbook_rubric'
                  ? `Rubric SGK cố định (${comp.rubricItemCount ?? analysis.coverageItems.length} tiêu chí) · Đủ ${comp.coveredCount} · Thiếu một phần ${comp.partialCount} · Thiếu ${comp.missingCount}`
                  : `Theo phạm vi chương · Đủ ${comp.coveredCount} · Thiếu một phần ${comp.partialCount} · Thiếu ${comp.missingCount}`
                : 'Chưa có rubric chuẩn SGK cho phạm vi này (chỉ chấm Độ chính xác)'
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
      <SmoothAccordion
        open={showFormula}
        onToggle={(next) => {
          setShowFormula(next);
        }}
        icon={<Calculator className="w-4 h-4 text-sky-600 dark:text-sky-400" />}
        title={
          <span className="text-xs font-semibold text-[#16243E] dark:text-[#E6EFFC]">
            Xem công thức tính Tổng đúng/sai & % Đúng / % Sai minh bạch
          </span>
        }
        className="report-scroll-section glass-panel-subtle !rounded-3xl no-print"
        triggerClassName="px-4 sm:px-5 py-3.5 hover:bg-white/45 dark:hover:bg-slate-800/45"
        contentClassName="px-4 sm:px-5 pb-4 pt-3 border-t border-sky-200/60 dark:border-slate-700/70 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-slate-700 dark:text-slate-300 leading-[1.6]"
      >
        <div>
          <p className="font-semibold text-sky-800 dark:text-sky-300 mb-1">
            Điểm chính xác = (Số ý đúng + 0,5 × Số ý một phần) / Tổng số ý đã chấm · Phân bổ 3 nhóm = 100%
          </p>
          <p>
            Mỗi ý đã kiểm chứng tính đều 1 đơn vị (Đúng = 1,0 · Thiếu/đúng 1 phần = 0,5 · Sai = 0).
            Các ý chưa đủ căn cứ, OCR mờ hoặc ý thiếu (thuộc Độ đầy đủ) không bị tính trùng vào mẫu số Độ chính xác.
          </p>
          <p className="font-mono mt-1.5 text-[#16243E] dark:text-[#E6EFFC] tabular-nums">
            Thực tế: ({scoreSummary.correctCount} + 0,5 × {scoreSummary.partialCount}) / {scoreSummary.evaluatedTotal} ={' '}
            {scoreSummary.correctPercent !== null
              ? `${scoreSummary.correctPercent}% (Đúng ${scoreSummary.exactCorrectPercent}% · Một phần ${scoreSummary.partialPercent}% · Sai ${scoreSummary.exactIncorrectPercent}%)`
              : 'Chưa đủ dữ liệu'}
          </p>
        </div>
        <div>
          <p className="font-semibold text-sky-800 dark:text-sky-300 mb-1">
            Độ đầy đủ = (Số ý đã phủ + 0,5 × Số ý phủ 1 phần) / Tổng số ý khung kiến thức
          </p>
          <p>
            Chỉ chấm khi có sách giáo khoa hoặc khung mục tiêu chương rõ ràng. Thiếu ý chỉ ảnh
            hưởng Độ đầy đủ, tuyệt đối không làm giảm Độ chính xác.
          </p>
          {comp && (
            <p className="font-mono mt-1.5 text-[#16243E] dark:text-[#E6EFFC] tabular-nums">
              Thực tế: {comp.coveredWeight} / {comp.totalRequiredWeight} ={' '}
              {comp.completenessScore !== null ? `${comp.completenessScore}%` : 'Không áp dụng'}
            </p>
          )}
        </div>
      </SmoothAccordion>

      {/* Deterministic Grading Audit Trail */}
      {acc?.gradingAudit && (
        <SmoothAccordion
          open={showAuditTrail}
          onToggle={(next) => {
            setShowAuditTrail(next);
          }}
          icon={<ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />}
          title={
            <span className="text-xs font-semibold text-[#16243E] dark:text-[#E6EFFC]">
              Dấu vết kiểm định & Độ ổn định điểm số ·{' '}
              <span className="font-mono font-normal text-[#475B78] dark:text-[#B4C7E2]">
                {acc.gradingAudit.actualModel}
                {acc.gradingAudit.cached ? ' · Bộ nhớ đệm' : ''}
                {acc.gradingAudit.strictModelLock ? ' · Khóa model chuẩn' : ''}
              </span>
            </span>
          }
          className="report-scroll-section glass-panel-subtle !rounded-3xl no-print"
          triggerClassName="px-4 sm:px-5 py-3.5 hover:bg-white/45 dark:hover:bg-slate-800/45"
          contentClassName="px-4 sm:px-5 pb-4 pt-3 border-t border-sky-200/60 dark:border-slate-700/70 space-y-3 text-xs text-slate-700 dark:text-slate-300"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2.5 leading-[1.6]">
            <div>
              <p className="text-[11px] text-[#475B78] dark:text-[#B4C7E2]">Model yêu cầu / thực chạy</p>
              <p className="font-mono text-[#16243E] dark:text-[#E6EFFC] break-all">
                {acc.gradingAudit.requestedModel === acc.gradingAudit.actualModel
                  ? acc.gradingAudit.actualModel
                  : `${acc.gradingAudit.requestedModel} → ${acc.gradingAudit.actualModel}`}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-[#475B78] dark:text-[#B4C7E2]">Cơ chế ổn định & nguồn chạy</p>
              <p className="text-[#16243E] dark:text-[#E6EFFC] tabular-nums">
                {acc.gradingAudit.strictModelLock ? 'Khóa model chuẩn' : 'Cho phép dự phòng'} ·{' '}
                {acc.gradingAudit.usedFallback ? 'Đã dùng dự phòng' : 'Đúng model chính'} ·{' '}
                {acc.gradingAudit.cached ? 'Trùng bộ nhớ đệm' : 'Chấm trực tiếp'}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-[#475B78] dark:text-[#B4C7E2]">Thang chấm Độ đầy đủ (Rubric)</p>
              <p className="text-[#16243E] dark:text-[#E6EFFC] tabular-nums">
                {acc.gradingAudit.rubricMode === 'fixed_textbook_rubric'
                  ? `Rubric cố định SGK (${acc.gradingAudit.rubricItemCount} tiêu chí)`
                  : acc.gradingAudit.rubricMode === 'scope_guided'
                  ? 'Theo phạm vi chương'
                  : 'Chưa có rubric SGK'}
                {acc.gradingAudit.chunkIds.length > 0
                  ? ` · ${acc.gradingAudit.chunkIds.length} đoạn SGK`
                  : ''}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-[#475B78] dark:text-[#B4C7E2]">Mã băm văn bản OCR / đầu vào</p>
              <p className="font-mono text-[#16243E] dark:text-[#E6EFFC] tabular-nums">
                OCR: {acc.gradingAudit.ocrTextHash.slice(0, 12)} · Input: {acc.gradingAudit.inputHash.slice(0, 12)}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-[#475B78] dark:text-[#B4C7E2]">Trạng thái OCR & Độ dài tài liệu</p>
              <p className="text-[#16243E] dark:text-[#E6EFFC] tabular-nums">
                {acc.gradingAudit.ocrConfirmed ? 'Đã xác nhận OCR' : 'OCR tự động'} ·{' '}
                {acc.gradingAudit.studentCharCount.toLocaleString('vi-VN')} ký tự
                {acc.gradingAudit.truncationApplied ? ' · Có rút gọn ngữ cảnh dài' : ' · Đủ toàn văn'}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-[#525E75] dark:text-[#94A3B8]">Phiên bản kiểm định & Seed</p>
              <p className="font-mono text-[#172033] dark:text-[#E6EFFC] tabular-nums">
                {acc.gradingAudit.promptVersion} · Seed {acc.gradingAudit.deterministicSeed}
                {acc.gradingAudit.systemFingerprint ? ` · ${acc.gradingAudit.systemFingerprint}` : ''}
              </p>
            </div>
            {acc.gradingAudit.adaptiveApiPlan && (
              <div className="sm:col-span-2 lg:col-span-3 pt-2 border-t border-[#E6ECF5] dark:border-[#1E293B] grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-2">
                <div>
                  <p className="text-[11px] text-[#525E75] dark:text-[#94A3B8]">Chế độ luồng API kiểm định</p>
                  <p className="font-mono text-[#1746A2] dark:text-[#93C5FD] font-semibold tabular-nums">
                    Cố định 1 Quét · 1 Chấm · 1 Dò
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-[#525E75] dark:text-[#94A3B8]">Kiểm chứng chéo nhà cung cấp</p>
                  <p className="font-mono text-[#172033] dark:text-[#E6EFFC] break-all">
                    {acc.gradingAudit.adaptiveApiPlan.verifyModels?.length
                      ? acc.gradingAudit.adaptiveApiPlan.verifyModels.join(' · ')
                      : 'Đối chiếu đồng bộ 3-provider'}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-[#525E75] dark:text-[#94A3B8]">Số luồng thực thi (Chấm / Dò)</p>
                  <p className="font-mono text-[#172033] dark:text-[#E6EFFC] tabular-nums">
                    {acc.gradingAudit.adaptiveApiPlan.gradeApiCount} chấm ·{' '}
                    {acc.gradingAudit.adaptiveApiPlan.verifyExecutedApiCount} dò ·{' '}
                    {acc.gradingAudit.adaptiveApiPlan.textLength.toLocaleString('vi-VN')} ký tự
                  </p>
                </div>
              </div>
            )}
          </div>
          {acc.gradingAudit.truncationApplied && (
            <p className="text-[11px] text-amber-800 dark:text-amber-300 border-t border-amber-200/70 dark:border-amber-800/50 pt-2">
              Lưu ý: Tài liệu hoặc ngữ cảnh SGK vượt ngưỡng tối đa trong một lượt chấm và đã được rút gọn ở phần cuối. Nên tách tài liệu rất dài theo từng chương để kiểm định chi tiết nhất.
            </p>
          )}
        </SmoothAccordion>
      )}

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

      {/* STEP 4 & STEP 5: Guided 5-Part Error-Correction Workflow & Completion Workspace */}
      <GlassSurface className="report-scroll-section rounded-3xl p-4 sm:p-7 space-y-5 no-print">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-sky-200/70 dark:border-slate-700/80 pb-4">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-[#525E75] dark:text-[#94A3B8] mb-1">
              <span className="font-semibold text-[#2563EB] dark:text-[#60A5FA] font-mono tabular-nums">
                {activeWorkflowStep === 4 ? 'Bước 4 / 5 · Không gian sửa lỗi chi tiết' : 'Bước 5 / 5 · Tổng kết & Hoàn tất'}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">
                Đã khắc phục {resolvedItemsCount}/{actionableQueue.length} mục
              </span>
              <span aria-hidden="true">·</span>
              <span>
                {errorClaimsCount} lỗi sai kiến thức/công thức · {missingInfoCount} mục thiếu điều kiện/ý SGK
              </span>
            </div>
            <h2 className="font-display text-lg sm:text-xl font-bold text-[#172033] dark:text-[#E6EFFC]">
              {activeWorkflowStep === 4
                ? 'Quy trình sửa lỗi từng mệnh đề & bổ sung kiến thức thiếu'
                : 'Hoàn tất rà soát lỗi & củng cố kiến thức sau kiểm định'}
            </h2>
          </div>

          {/* Interactive Mode Switcher between Step 4 (Sửa lỗi) and Step 5 (Hoàn tất) */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-[#F1F5FA] dark:bg-[#0D1628] border border-[#E6ECF5] dark:border-[#1E293B]">
              <button
                type="button"
                onClick={() => setActiveWorkflowStep(4)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  activeWorkflowStep === 4
                    ? 'bg-[#2563EB] text-white shadow-xs'
                    : 'text-[#525E75] dark:text-[#94A3B8] hover:text-[#172033] dark:hover:text-white'
                }`}
              >
                4. Sửa lỗi ({resolvedItemsCount}/{actionableQueue.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveWorkflowStep(5)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  activeWorkflowStep === 5
                    ? 'bg-[#2563EB] text-white shadow-xs'
                    : 'text-[#525E75] dark:text-[#94A3B8] hover:text-[#172033] dark:hover:text-white'
                }`}
              >
                5. Hoàn tất (100%)
              </button>
            </div>
          </div>
        </div>

        {activeWorkflowStep === 4 ? (
          actionableQueue.length === 0 ? (
            /* Zero-error positive empty state required by contract */
            <div className="rounded-2xl border border-emerald-200/90 dark:border-emerald-800/70 bg-emerald-50/75 dark:bg-emerald-950/35 p-6 text-center space-y-3">
              <CheckCircle2 className="w-10 h-10 text-emerald-600 dark:text-emerald-400 mx-auto" />
              <div className="space-y-1">
                <h3 className="font-display text-base font-bold text-emerald-950 dark:text-emerald-200">
                  Bài làm không có lỗi kiến thức cần chỉnh sửa
                </h3>
                <p className="text-xs text-slate-700 dark:text-slate-300 max-w-xl mx-auto leading-relaxed">
                  Toàn bộ mệnh đề đã kiểm chứng trong bài làm đều chính xác và các mục tiêu chương
                  tham chiếu đã được bao phủ đầy đủ. Bạn có thể chuyển thẳng sang Bước 5 để xuất
                  phiếu xác nhận hoặc luyện đề nâng cao.
                </p>
              </div>
              <div className="pt-1">
                <WaterRippleButton onClick={() => setActiveWorkflowStep(5)}>
                  <CheckCircle2 className="w-4 h-4" />
                  Chuyển thẳng sang Bước 5: Hoàn tất →
                </WaterRippleButton>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Filter Tabs & Bulk Complete Action */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-1 p-1 rounded-xl bg-slate-100/90 dark:bg-slate-800/80 border border-slate-200/70 dark:border-slate-700/80">
                  {[
                    { id: 'all' as const, label: `Tất cả cần sửa (${actionableQueue.length})` },
                    {
                      id: 'claim_error' as const,
                      label: `Sai kiến thức / CT (${
                        actionableQueue.filter((i) => i.kind === 'claim_error').length
                      })`,
                    },
                    {
                      id: 'gaps' as const,
                      label: `Thiếu điều kiện / Ý SGK (${
                        actionableQueue.filter(
                          (i) => i.kind === 'claim_partial' || i.kind === 'coverage_gap'
                        ).length
                      })`,
                    },
                    {
                      id: 'resolved' as const,
                      label: `Đã đánh dấu sửa (${resolvedItemsCount})`,
                    },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setCorrectionFilter(tab.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                        correctionFilter === tab.id
                          ? 'bg-white dark:bg-[#111C2D] text-[#0F172A] dark:text-white font-semibold shadow-xs'
                          : 'text-[#475B78] dark:text-[#B4C7E2] hover:text-[#0F172A] dark:hover:text-white'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {!allActionableResolved && (
                    <button
                      type="button"
                      onClick={handleMarkAllItemsResolved}
                      className="glass-control min-h-[38px] px-3.5 py-1.5 rounded-xl text-xs font-semibold text-[#1746A2] dark:text-[#93C5FD] cursor-pointer whitespace-nowrap"
                    >
                      Áp dụng gợi ý chuẩn cho tất cả & Hoàn tất
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setActiveWorkflowStep(5)}
                    className="min-h-[38px] px-4 py-1.5 rounded-xl text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1746A2] transition-colors cursor-pointer whitespace-nowrap"
                  >
                    Sang Bước 5: Hoàn tất →
                  </button>
                </div>
              </div>

              {/* 5-Part Error Correction Cards (a..e) */}
              {filteredActionableQueue.length === 0 ? (
                <div className="document-paper rounded-2xl p-6 text-center text-xs text-slate-600 dark:text-slate-300">
                  Không có mục nào trong bộ lọc này. Hãy chọn tab “Tất cả cần sửa” để xem toàn bộ danh sách.
                </div>
              ) : (
                <div className="space-y-4">
                  {filteredActionableQueue.map((item, idx) => {
                    const correctionState = correctionsMap[item.id];
                    const isResolved = Boolean(correctionState?.resolved);
                    const isReporting = Boolean(item.claimId && reportingClaimId === item.claimId);

                    return (
                      <article
                        key={item.id}
                        className={`document-paper rounded-2xl p-4 sm:p-5 text-xs space-y-3.5 border transition-colors ${
                          isResolved
                            ? 'border-emerald-300/90 dark:border-emerald-700/80 bg-emerald-50/40 dark:bg-emerald-950/20'
                            : item.kind === 'claim_error'
                            ? 'border-rose-200/90 dark:border-rose-800/70'
                            : 'border-amber-200/90 dark:border-amber-800/70'
                        }`}
                      >
                        {/* Card Header: Concept, Chapter & Dual-Coded Status */}
                        <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-slate-200/80 dark:border-slate-700/80">
                          <div className="flex flex-wrap items-center gap-1.5 text-sm font-bold text-[#16243E] dark:text-[#E6EFFC]">
                            <span className="font-mono tabular-nums text-[#2563EB] dark:text-[#60A5FA]">
                              #{idx + 1}
                            </span>
                            <span>·</span>
                            <span>{item.concept}</span>
                            <span className="text-xs font-normal text-[#475B78] dark:text-[#B4C7E2]">
                              · {item.chapter}
                              {item.sourcePage ? ` · Trang ${item.sourcePage}` : ''}
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-3">
                            {/* Dual-coded Icon + Explicit Vietnamese Status Text */}
                            <span
                              className={`inline-flex items-center gap-1.5 font-semibold ${
                                isResolved
                                  ? 'text-emerald-700 dark:text-emerald-400'
                                  : item.kind === 'claim_error'
                                  ? 'text-rose-700 dark:text-rose-400'
                                  : 'text-amber-700 dark:text-amber-400'
                              }`}
                            >
                              {isResolved ? (
                                <CheckCircle2 className="w-4 h-4 shrink-0" />
                              ) : item.kind === 'claim_error' ? (
                                <XCircle className="w-4 h-4 shrink-0" />
                              ) : (
                                <AlertTriangle className="w-4 h-4 shrink-0" />
                              )}
                              <span>{isResolved ? 'Đã hiểu & đã sửa' : item.statusLabel}</span>
                            </span>

                            {item.claimId && (
                              <button
                                type="button"
                                onClick={() =>
                                  setReportingClaimId(isReporting ? null : item.claimId || null)
                                }
                                className="inline-flex items-center gap-1 text-slate-500 dark:text-slate-400 hover:text-sky-600 dark:hover:text-sky-400 cursor-pointer"
                              >
                                <Flag className="w-3.5 h-3.5" />
                                <span>Báo sai / Phản hồi</span>
                              </button>
                            )}
                          </div>
                        </div>

                        {/* (a) Trích đoạn bài làm & (b) Phân loại trạng thái + lý do */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                          <div className="rounded-xl bg-slate-50/90 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800 p-3 space-y-1">
                            <p className="text-[11px] font-semibold text-[#475B78] dark:text-[#B4C7E2]">
                              (a) Trích đoạn trong bài làm {item.sourcePage ? `· Trang ${item.sourcePage}` : ''}
                            </p>
                            <p className="text-slate-800 dark:text-slate-200 italic leading-relaxed">
                              “{item.sourceText}”
                            </p>
                          </div>

                          <div className="rounded-xl bg-slate-50/90 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800 p-3 space-y-1">
                            <p className="text-[11px] font-semibold text-[#475B78] dark:text-[#B4C7E2]">
                              (b) Nguyên nhân & giải thích học thuật
                            </p>
                            <p className="text-slate-800 dark:text-slate-200 leading-relaxed">
                              {item.explanation}
                            </p>
                            {item.reason && item.reason !== item.explanation && (
                              <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                                Lưu ý thêm: {item.reason}
                              </p>
                            )}
                          </div>
                        </div>

                        {/* (c) Kiến thức chuẩn & gợi ý sửa + (d) Nguồn đối chiếu SGK/Web */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                          <div className="rounded-xl bg-sky-50/85 dark:bg-sky-950/35 border border-sky-200/80 dark:border-sky-800/60 p-3 space-y-1.5">
                            <p className="text-[11px] font-semibold text-sky-900 dark:text-sky-300">
                              (c) Kiến thức chuẩn & Gợi ý sửa
                            </p>
                            <p className="text-sky-950 dark:text-sky-100 font-medium leading-relaxed">
                              {item.suggestedFix}
                            </p>
                            {item.correctKnowledge &&
                              item.correctKnowledge !== item.suggestedFix && (
                                <p className="text-slate-700 dark:text-slate-300 leading-relaxed">
                                  Chuẩn SGK: {item.correctKnowledge}
                                </p>
                              )}
                          </div>

                          <div className="rounded-xl bg-slate-50/90 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800 p-3 space-y-1.5">
                            <p className="text-[11px] font-semibold text-[#475B78] dark:text-[#B4C7E2]">
                              (d) Dẫn chứng SGK / Nguồn chuẩn ({item.evidences.length})
                            </p>
                            {item.evidences.length === 0 ? (
                              <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                                Đối chiếu trực tiếp theo khung kiến thức chuẩn chương{' '}
                                {item.chapter || analysis.scope || SUBJECT_LABELS[analysis.subject]}.
                              </p>
                            ) : (
                              <div className="space-y-1.5">
                                {item.evidences.map((ev) => (
                                  <div key={ev.evidenceId} className="space-y-0.5">
                                    <p className="font-semibold text-[#16243E] dark:text-[#E6EFFC]">
                                      {ev.title}
                                      {ev.chapter ? ` · ${ev.chapter}` : ''}
                                      {ev.pageNumber ? ` · Tr. ${ev.pageNumber}` : ''}
                                    </p>
                                    <p className="text-slate-600 dark:text-slate-300 italic leading-relaxed">
                                      “{ev.excerpt}”
                                    </p>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* (e) Tương tác của học sinh: Ô tự sửa + Đánh dấu đã sửa + Báo sai */}
                        <div className="pt-2 border-t border-slate-200/70 dark:border-slate-700/70 space-y-2.5">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <label
                              htmlFor={`student-fix-${item.id}`}
                              className="text-[11px] font-semibold text-[#16243E] dark:text-[#E6EFFC]"
                            >
                              (e) Bản tự sửa của bạn (tự viết lại câu đúng hoặc công thức chuẩn để ghi nhớ)
                            </label>
                            <button
                              type="button"
                              onClick={() =>
                                handleUpdateStudentCorrectionText(item.id, item.suggestedFix)
                              }
                              className="text-[11px] font-semibold text-[#2563EB] dark:text-[#60A5FA] hover:underline cursor-pointer"
                            >
                              Điền nhanh từ gợi ý chuẩn
                            </button>
                          </div>

                          <div className="flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-center">
                            <input
                              id={`student-fix-${item.id}`}
                              type="text"
                              value={correctionState?.studentText || ''}
                              onChange={(e) =>
                                handleUpdateStudentCorrectionText(item.id, e.target.value)
                              }
                              placeholder="Nhập câu hoặc công thức đã sửa chuẩn của bạn..."
                              className="glass-control flex-1 min-h-[40px] px-3 py-2 rounded-xl text-xs text-[#172033] dark:text-[#E6EFFC]"
                            />

                            <button
                              type="button"
                              onClick={() =>
                                handleToggleItemResolved(item.id, item.suggestedFix)
                              }
                              className={`min-h-[40px] inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                                isResolved
                                  ? 'bg-[#059669] hover:bg-emerald-700 text-white'
                                  : 'bg-[#2563EB] hover:bg-[#1746A2] text-white'
                              }`}
                            >
                              <CheckCircle2 className="w-4 h-4 shrink-0" />
                              <span>
                                {isResolved ? 'Đã sửa xong (Bấm để mở lại)' : 'Đã hiểu & đã sửa'}
                              </span>
                            </button>
                          </div>
                        </div>

                        {isReporting && item.claimId && (
                          <div className="pt-2 border-t border-sky-200/60 dark:border-slate-700 space-y-2">
                            <div className="flex flex-wrap gap-2">
                              <select
                                value={feedbackCategory}
                                onChange={(e) =>
                                  setFeedbackCategory(
                                    e.target.value as FeedbackEntry['category']
                                  )
                                }
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
                                onClick={() => handleSubmitClaimFeedback(item.claimId!)}
                                className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 text-white font-semibold disabled:opacity-50 cursor-pointer"
                              >
                                {sendingFeedback ? 'Đang gửi...' : 'Gửi phản hồi'}
                              </button>
                            </div>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          )
        ) : (
          /* STEP 5: Completion Summary Panel (keeps Accuracy & Completeness strictly independent) */
          <div className="rounded-2xl border border-[#BFDBFE] dark:border-[#3B82F6]/35 bg-[#EAF2FF]/65 dark:bg-[#0D1628] p-5 sm:p-6 space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2 text-xs text-[#1746A2] dark:text-[#93C5FD] font-semibold">
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-[#059669] dark:text-emerald-400" />
                  <span>Hoàn tất quy trình 5 bước kiểm định & sửa lỗi bài tập</span>
                </div>
                <h3 className="font-display text-base sm:text-lg font-bold text-[#172033] dark:text-[#E6EFFC]">
                  Đã khắc phục {resolvedItemsCount}/{actionableQueue.length} mục cần chỉnh sửa · Sẵn sàng xuất phiếu hoặc luyện tập
                </h3>
                <p className="text-xs text-[#525E75] dark:text-[#94A3B8] leading-relaxed prose-measure">
                  Hai chỉ số được giữ độc lập tuyệt đối: Độ chính xác phản ánh tỷ lệ kiến thức bạn đã viết đúng ({analysis.accuracyScore ?? '—'}%), còn Độ đầy đủ phản ánh mức bao phủ khung kiến thức chương SGK ({analysis.completenessScore ?? '—'}%).
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setActiveWorkflowStep(4)}
                  className="glass-control min-h-[42px] px-3.5 py-2 rounded-xl text-xs font-semibold text-[#172033] dark:text-[#E6EFFC] cursor-pointer"
                >
                  ← Xem lại Bước 4 (Sửa lỗi)
                </button>
                <button
                  type="button"
                  onClick={() => triggerPrintWithMode('fix_sheet')}
                  className="glass-control min-h-[42px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-[#172033] dark:text-[#E6EFFC] cursor-pointer"
                >
                  <Printer className="w-4 h-4 text-[#2563EB] dark:text-[#60A5FA]" />
                  <span>In Phiếu sửa lỗi</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSummaryModalOpen(true)}
                  className="glass-control min-h-[42px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-[#1746A2] dark:text-[#93C5FD] cursor-pointer"
                >
                  <FileCheck2 className="w-4 h-4 text-[#2563EB] dark:text-[#60A5FA]" />
                  <span>{confirmedSummary ? 'Tải bản tổng kết' : 'Tạo bản tổng kết'}</span>
                </button>
                <WaterRippleButton onClick={() => onStartQuiz(analysis)}>
                  <HelpCircle className="w-4 h-4" />
                  <span>Làm trắc nghiệm củng cố</span>
                </WaterRippleButton>
              </div>
            </div>
          </div>
        )}
      </GlassSurface>

      {/* Dedicated Confirmed Summary Report Download Card */}
      <GlassSurface className="report-scroll-section rounded-3xl p-4 sm:p-6 border border-sky-200/80 dark:border-sky-800/60 space-y-4 no-print">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="size-10 rounded-2xl bg-sky-500/15 dark:bg-sky-400/15 border border-sky-300/60 dark:border-sky-500/30 flex items-center justify-center shrink-0">
              <FileCheck2 className="w-5 h-5 text-sky-600 dark:text-sky-400" />
            </div>
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-display text-base sm:text-lg font-bold text-[#16243E] dark:text-[#E6EFFC]">
                  Tải bản tổng kết kiểm định (DOCX / Excel / TXT / PDF)
                </h2>
                {confirmedSummary && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-500/12 px-2.5 py-0.5 rounded-lg border border-emerald-300/60 dark:border-emerald-700/60">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Đã xác nhận tạo lúc {confirmedSummary.confirmedAtDisplay}
                  </span>
                )}
              </div>
              <p className="text-xs text-[#475B78] dark:text-[#B4C7E2] leading-relaxed prose-measure">
                {confirmedSummary
                  ? `Bản tổng kết cho "${confirmedSummary.documentTitle}" đã được tạo theo xác nhận của bạn. Bạn có thể tải xuống ngay ở bất kỳ định dạng nào bên dưới.`
                  : 'Hệ thống không tự động tạo tệp tổng kết. Hãy bấm nút xác nhận để tổng hợp điểm độc lập, chi tiết lỗi, bản tự sửa ở Bước 4 và bảng bao phủ chương rồi chọn định dạng tải về.'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            {!confirmedSummary ? (
              <WaterRippleButton onClick={() => setSummaryModalOpen(true)}>
                <FileCheck2 className="w-4 h-4" />
                <span>Xác nhận & Tạo bản tổng kết</span>
              </WaterRippleButton>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setConfirmedSummary(null);
                  setInlineExportNotice(null);
                  setInlineExportError(null);
                  setSummaryModalOpen(true);
                }}
                className="glass-control min-h-[40px] px-3.5 py-2 rounded-xl text-xs font-semibold cursor-pointer"
              >
                Tạo lại với tùy chọn khác
              </button>
            )}
          </div>
        </div>

        {confirmedSummary && (
          <div className="space-y-3 pt-1">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
              <button
                type="button"
                disabled={inlineExportingFormat !== null}
                onClick={() => handleInlineSummaryDownload('docx')}
                className="glass-control min-h-[44px] px-3.5 py-2.5 rounded-xl text-xs font-semibold inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
              >
                {inlineExportingFormat === 'docx' ? (
                  <CalmDots className="text-blue-600" />
                ) : (
                  <FileText className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                )}
                <span>Tải Word (.docx)</span>
              </button>

              <button
                type="button"
                disabled={inlineExportingFormat !== null}
                onClick={() => handleInlineSummaryDownload('xlsx')}
                className="glass-control min-h-[44px] px-3.5 py-2.5 rounded-xl text-xs font-semibold inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
              >
                {inlineExportingFormat === 'xlsx' ? (
                  <CalmDots className="text-emerald-600" />
                ) : (
                  <FileSpreadsheet className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                )}
                <span>Tải Excel (.xlsx)</span>
              </button>

              <button
                type="button"
                disabled={inlineExportingFormat !== null}
                onClick={() => handleInlineSummaryDownload('txt')}
                className="glass-control min-h-[44px] px-3.5 py-2.5 rounded-xl text-xs font-semibold inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
              >
                {inlineExportingFormat === 'txt' ? (
                  <CalmDots className="text-[#2563EB]" />
                ) : (
                  <ScrollText className="w-4 h-4 text-[#2563EB] dark:text-[#60A5FA]" />
                )}
                <span>Tải Văn bản (.txt)</span>
              </button>

              <button
                type="button"
                disabled={inlineExportingFormat !== null}
                onClick={() => handleInlineSummaryDownload('pdf')}
                className="glass-control min-h-[44px] px-3.5 py-2.5 rounded-xl text-xs font-semibold inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
              >
                {inlineExportingFormat === 'pdf' ? (
                  <CalmDots className="text-rose-600" />
                ) : (
                  <Printer className="w-4 h-4 text-rose-600 dark:text-rose-400" />
                )}
                <span>Xuất PDF (In / Lưu)</span>
              </button>
            </div>

            {inlineExportNotice && (
              <p className="text-xs text-sky-900 dark:text-sky-200 bg-sky-50/80 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800/70 rounded-xl px-3.5 py-2">
                {inlineExportNotice}
              </p>
            )}
            {inlineExportError && (
              <p className="text-xs text-rose-800 dark:text-rose-200 bg-rose-50/80 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/70 rounded-xl px-3.5 py-2">
                {inlineExportError}
              </p>
            )}
          </div>
        )}
      </GlassSurface>

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
              {analysis.webSources.map((src) => {
                const safeUrl = sanitizeExternalHttpUrl(src.url);
                if (!safeUrl) {
                  return (
                    <div
                      key={src.evidenceId}
                      className="block document-paper rounded-2xl p-3.5 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2 font-semibold text-slate-700 dark:text-slate-300">
                        <span className="truncate">{src.title}</span>
                      </div>
                      <p className="text-slate-500 dark:text-slate-400 font-mono text-[11px] mt-1 truncate">
                        {src.domain || 'Nguồn tham khảo'}
                      </p>
                    </div>
                  );
                }
                return (
                  <a
                    key={src.evidenceId}
                    href={safeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block document-paper rounded-2xl p-3.5 text-xs hover:border-sky-400 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2 font-semibold text-sky-700 dark:text-sky-400">
                      <span className="truncate">{src.title}</span>
                      <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                    </div>
                    <p className="text-slate-500 dark:text-slate-400 font-mono text-[11px] mt-1 truncate">
                      {src.domain || safeUrl}
                    </p>
                  </a>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <SummaryExportModal
        open={summaryModalOpen}
        onClose={() => setSummaryModalOpen(false)}
        analysis={analysis}
        actionableCount={actionableQueue.length}
        resolvedCount={resolvedItemsCount}
        confirmedSummary={confirmedSummary}
        includeStudentCorrections={includeStudentCorrections}
        onChangeIncludeStudentCorrections={setIncludeStudentCorrections}
        includeCoverageAndSources={includeCoverageAndSources}
        onChangeIncludeCoverageAndSources={setIncludeCoverageAndSources}
        customNote={summaryCustomNote}
        onChangeCustomNote={setSummaryCustomNote}
        onConfirmCreate={handleConfirmCreateSummary}
        onResetConfirmation={() => setConfirmedSummary(null)}
        onPrintSummaryPdf={() => triggerPrintWithMode('full_summary')}
      />
    </div>
  );
};
