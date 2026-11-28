import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Award,
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Clock,
  FileCheck2,
  Printer,
  RotateCcw,
  Search,
  ShieldCheck,
  Trophy,
  X,
} from 'lucide-react';
import { BRAND_CONFIG } from '../config/brand';
import { useAuth } from '../context/AuthContext';
import {
  computeNextQuestionIndex,
  isEditableKeyboardTarget,
  mapKeyToAbcdChoice,
} from '../core/answerKeyboard';
import { generateShuffledExamVariant } from '../core/quizValidation';
import {
  EXAM_TYPE_LABELS,
  SUBJECT_LABELS,
  type CognitiveLevel,
  type ExamAttempt,
  type ExamDocument,
  type ExamQuestion,
  type ExamQuestionAnswer,
  type ExamType,
  type GradeLevel,
  type SubjectId,
} from '../core/types';
import { gsap, MOTION_ALLOWED_MEDIA, useGSAP } from '../lib/gsapSetup';
import {
  listExams,
  listUserExamAttempts,
  submitExamAttemptAndSyncLeaderboard,
} from '../services/firestoreService';
import { AbcdOptionGrid, TrueFalseOptionList } from './AnswerOptionCards';
import { GlassSurface } from './LiquidGlass/GlassSurface';
import { LiquidCard } from './LiquidGlass/LiquidCard';
import { SlidingTabs } from './LiquidGlass/SlidingTabs';
import { WaterRippleButton } from './LiquidGlass/WaterRippleButton';
import { MathText } from './MathText';

interface ExamCenterViewProps {
  onOpenLeaderboard?: () => void;
}

const COGNITIVE_LABELS: Record<CognitiveLevel, string> = {
  nhan_biet: 'Nhận biết',
  thong_hieu: 'Thông hiểu',
  van_dung: 'Vận dụng',
  van_dung_cao: 'Vận dụng cao',
};

function formatClock(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds);
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractExamChapters(exam: ExamDocument): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const ch of exam.chapters || []) {
    const trimmed = (ch || '').trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      result.push(trimmed);
    }
  }
  for (const q of exam.questions || []) {
    const trimmed = (q.chapterId || '').trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      result.push(trimmed);
    }
  }
  return result;
}

export const ExamCenterView: React.FC<ExamCenterViewProps> = ({ onOpenLeaderboard }) => {
  const { user, profile, isSuperAdmin } = useAuth();
  const [exams, setExams] = useState<ExamDocument[]>([]);
  const [attempts, setAttempts] = useState<ExamAttempt[]>([]);
  const [loading, setLoading] = useState(true);

  const [activeTab, setActiveTab] = useState<'all' | ExamType | 'history'>('all');
  const [gradeFilter, setGradeFilter] = useState<'all' | GradeLevel>('all');
  const [subjectFilter, setSubjectFilter] = useState<'all' | SubjectId>('all');
  const [chapterFilter, setChapterFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(6);
  const [historyPage, setHistoryPage] = useState<number>(1);

  // Active exam runner state
  const [activeExam, setActiveExam] = useState<ExamDocument | null>(null);
  const [answersMap, setAnswersMap] = useState<Record<string, ExamQuestionAnswer>>({});
  const [focusedQuestionIdx, setFocusedQuestionIdx] = useState<number>(0);
  const [secondsLeft, setSecondsLeft] = useState<number>(0);
  const [startedAtMs, setStartedAtMs] = useState<number>(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [latestResult, setLatestResult] = useState<{
    attempt: ExamAttempt;
    pointsDelta: number;
    examPoints: number;
    totalLeaderboardScore: number;
  } | null>(null);

  // Print / Variant view
  const [printExam, setPrintExam] = useState<ExamDocument | null>(null);
  const [printVariantSeed, setPrintVariantSeed] = useState<number>(0); // 0 = gốc, 101, 102, 103
  const [printIncludeKey, setPrintIncludeKey] = useState(false);
  const examRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.allSettled([
      listExams(true),
      user ? listUserExamAttempts(user.uid) : Promise.resolve([]),
    ])
      .then(([exRes, attRes]) => {
        if (cancelled) return;
        setExams(exRes.status === 'fulfilled' ? exRes.value : []);
        setAttempts(attRes.status === 'fulfilled' ? attRes.value : []);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (!activeExam || latestResult) return;
    const timer = window.setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          window.clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [activeExam, latestResult]);

  const bestScoreByExam = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of attempts) {
      const prev = map.get(a.examId) ?? -1;
      if (a.percentScore > prev) map.set(a.examId, a.percentScore);
    }
    return map;
  }, [attempts]);

  const availableChapters = useMemo(() => {
    const chapterSet = new Set<string>();
    for (const e of exams) {
      if (activeTab !== 'all' && activeTab !== 'history' && e.examType !== activeTab) continue;
      if (gradeFilter !== 'all' && e.grade !== gradeFilter) continue;
      if (subjectFilter !== 'all' && e.subject !== subjectFilter) continue;
      for (const ch of extractExamChapters(e)) {
        chapterSet.add(ch);
      }
    }
    return Array.from(chapterSet);
  }, [exams, activeTab, gradeFilter, subjectFilter]);

  useEffect(() => {
    if (chapterFilter !== 'all' && !availableChapters.includes(chapterFilter)) {
      setChapterFilter('all');
    }
  }, [availableChapters, chapterFilter]);

  const filteredExams = useMemo(() => {
    const rawQuery = searchQuery.trim().toLowerCase();
    const normQuery = normalizeSearchText(searchQuery);
    return exams.filter((e) => {
      if (activeTab !== 'all' && activeTab !== 'history' && e.examType !== activeTab) return false;
      if (gradeFilter !== 'all' && e.grade !== gradeFilter) return false;
      if (subjectFilter !== 'all' && e.subject !== subjectFilter) return false;
      const examChapters = extractExamChapters(e);
      if (chapterFilter !== 'all' && !examChapters.includes(chapterFilter)) return false;
      if (rawQuery) {
        const hayRaw = `${e.title} ${examChapters.join(' ')} ${e.description || ''} ${e.textbookSeries || ''} ${SUBJECT_LABELS[e.subject] || ''} ${EXAM_TYPE_LABELS[e.examType] || ''}`.toLowerCase();
        const hayNorm = normalizeSearchText(hayRaw);
        if (!hayRaw.includes(rawQuery) && (!normQuery || !hayNorm.includes(normQuery))) {
          return false;
        }
      }
      return true;
    });
  }, [exams, activeTab, gradeFilter, subjectFilter, chapterFilter, searchQuery]);

  useEffect(() => {
    setCurrentPage(1);
    setHistoryPage(1);
  }, [activeTab, gradeFilter, subjectFilter, chapterFilter, searchQuery, pageSize]);

  const totalExamPages = Math.max(1, Math.ceil(filteredExams.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalExamPages);
  const paginatedExams = useMemo(() => {
    const start = (safeCurrentPage - 1) * pageSize;
    return filteredExams.slice(start, start + pageSize);
  }, [filteredExams, safeCurrentPage, pageSize]);

  const historyPageSize = 8;
  const totalHistoryPages = Math.max(1, Math.ceil(attempts.length / historyPageSize));
  const safeHistoryPage = Math.min(historyPage, totalHistoryPages);
  const paginatedAttempts = useMemo(() => {
    const start = (safeHistoryPage - 1) * historyPageSize;
    return attempts.slice(start, start + historyPageSize);
  }, [attempts, safeHistoryPage]);

  const goToExamPage = (targetPage: number) => {
    const clamped = Math.max(1, Math.min(totalExamPages, targetPage));
    setCurrentPage(clamped);
    examRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const buildVisiblePageNumbers = (current: number, total: number): Array<number | 'ellipsis-left' | 'ellipsis-right'> => {
    if (total <= 7) {
      return Array.from({ length: total }, (_, i) => i + 1);
    }
    const pages: Array<number | 'ellipsis-left' | 'ellipsis-right'> = [1];
    const left = Math.max(2, current - 1);
    const right = Math.min(total - 1, current + 1);
    if (left > 2) pages.push('ellipsis-left');
    for (let p = left; p <= right; p += 1) {
      pages.push(p);
    }
    if (right < total - 1) pages.push('ellipsis-right');
    pages.push(total);
    return pages;
  };

  const startExam = (exam: ExamDocument) => {
    setActiveExam(exam);
    setAnswersMap({});
    setFocusedQuestionIdx(0);
    setLatestResult(null);
    setSubmitError('');
    setSecondsLeft(exam.durationMinutes * 60);
    setStartedAtMs(Date.now());
  };

  // Desktop keyboard shortcuts (1-4 / A-D for focused ABCD question, ArrowUp/ArrowDown to switch question)
  useEffect(() => {
    if (!activeExam || latestResult) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isEditableKeyboardTarget(document.activeElement as HTMLElement | null)) return;

      const nextIdx = computeNextQuestionIndex(
        focusedQuestionIdx,
        e.key,
        activeExam.questions.length
      );
      if (nextIdx !== null) {
        e.preventDefault();
        setFocusedQuestionIdx(nextIdx);
        const targetQ = activeExam.questions[nextIdx];
        if (targetQ) {
          document.getElementById(`exam-q-${targetQ.questionId}`)?.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
          });
        }
        return;
      }

      const choice = mapKeyToAbcdChoice(e.key);
      if (!choice) return;
      const currentQ = activeExam.questions[focusedQuestionIdx];
      if (!currentQ || currentQ.questionType !== 'abcd') return;

      e.preventDefault();
      setAnswersMap((prev) => ({
        ...prev,
        [currentQ.questionId]: {
          ...(prev[currentQ.questionId] || { questionId: currentQ.questionId }),
          selectedOption: choice,
        },
      }));
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeExam, latestResult, focusedQuestionIdx]);

  const updateAnswer = (qId: string, updater: (prev: ExamQuestionAnswer) => ExamQuestionAnswer) => {
    setAnswersMap((prev) => {
      const current = prev[qId] || { questionId: qId };
      return { ...prev, [qId]: updater(current) };
    });
  };

  const getTrueFalseAnsweredCount = (q: ExamQuestion): { chosenCount: number; requiredCount: number } => {
    const a = answersMap[q.questionId];
    const statements = q.trueFalseStatements || [];
    const requiredCount = statements.length > 0 ? statements.length : 4;
    if (!a?.trueFalseChoices) return { chosenCount: 0, requiredCount };
    const chosenCount =
      statements.length > 0
        ? statements.filter((s) => typeof a.trueFalseChoices?.[s.label] === 'boolean').length
        : Object.values(a.trueFalseChoices).filter((v) => typeof v === 'boolean').length;
    return { chosenCount, requiredCount };
  };

  const isQuestionAnswered = (q: ExamQuestion): boolean => {
    const a = answersMap[q.questionId];
    if (!a) return false;
    if (q.questionType === 'abcd') return Boolean(a.selectedOption);
    if (q.questionType === 'true_false') {
      const { chosenCount, requiredCount } = getTrueFalseAnsweredCount(q);
      return chosenCount >= requiredCount;
    }
    return Boolean(a.shortAnswerText?.trim());
  };

  const handleSubmitExam = async () => {
    if (!user || !activeExam || submitting) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      const spent = Math.max(1, Math.round((Date.now() - startedAtMs) / 1000));
      const res = await submitExamAttemptAndSyncLeaderboard({
        exam: activeExam,
        uid: user.uid,
        displayName: profile?.displayName || user.displayName || 'Học sinh',
        grade: profile?.grade || activeExam.grade,
        answers: Object.values(answersMap),
        durationSpentSeconds: spent,
      });
      setLatestResult({
        attempt: res.attempt,
        pointsDelta: res.pointsDelta,
        examPoints: res.examPoints,
        totalLeaderboardScore: res.leaderboardEntry.totalScore,
      });
      setAttempts((prev) => [res.attempt, ...prev]);
    } catch (err) {
      setSubmitError(
        err instanceof Error
          ? err.message
          : 'Không thể nộp bài lúc này. Vui lòng kiểm tra kết nối mạng và bấm Nộp bài lại.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  // Auto-submit exam when countdown reaches 00:00
  useEffect(() => {
    if (
      activeExam &&
      !latestResult &&
      !submitting &&
      !submitError &&
      startedAtMs > 0 &&
      secondsLeft === 0
    ) {
      void handleSubmitExam();
    }
  }, [secondsLeft, activeExam, latestResult, submitting, submitError, startedAtMs]);

  // Print Exam Sheet Mode
  if (printExam) {
    const displayedQuestions: ExamQuestion[] =
      printVariantSeed === 0
        ? printExam.questions
        : generateShuffledExamVariant(printExam, String(printVariantSeed)).questions;

    return (
      <div className="space-y-6">
        <GlassSurface className="rounded-3xl p-5 flex flex-wrap items-center justify-between gap-3 no-print">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() => setPrintExam(null)}
              className="glass-control px-3 py-1.5 rounded-xl font-medium cursor-pointer"
            >
              ← Quay lại Trung tâm đề thi
            </button>
            <span className="font-semibold text-[#16243E] dark:text-[#E6EFFC] ml-2">Chọn mã đề:</span>
            {[
              { seed: 0, label: 'Đề gốc' },
              { seed: 101, label: 'Mã đề 101' },
              { seed: 102, label: 'Mã đề 102' },
              { seed: 103, label: 'Mã đề 103' },
            ].map((v) => (
              <button
                key={v.seed}
                type="button"
                onClick={() => setPrintVariantSeed(v.seed)}
                className={`px-3 py-1.5 rounded-xl font-medium cursor-pointer transition-all ${
                  printVariantSeed === v.seed
                    ? 'bg-[#2563EB] text-white shadow-sm'
                    : 'glass-control'
                }`}
              >
                {v.label}
              </button>
            ))}
            {(isSuperAdmin || bestScoreByExam.has(printExam.examId)) ? (
              <label className="inline-flex items-center gap-1.5 ml-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={printIncludeKey}
                  onChange={(e) => setPrintIncludeKey(e.target.checked)}
                  className="h-4 w-4 accent-sky-600"
                />
                In kèm Đáp án & Hướng dẫn chấm
              </label>
            ) : (
              <span className="ml-2 text-[11px] text-slate-500 dark:text-slate-400 italic">
                (Nộp bài thi ít nhất 1 lần để mở khóa in Đáp án)
              </span>
            )}
          </div>
          <WaterRippleButton size="sm" onClick={() => window.print()}>
            <Printer className="w-4 h-4" />
            In / Xuất PDF
          </WaterRippleButton>
        </GlassSurface>

        <div className="document-paper rounded-2xl p-6 sm:p-10 space-y-6">
          <div className="border-b border-slate-300 pb-4 text-center space-y-1">
            <p className="text-xs font-mono uppercase tracking-wider text-slate-600 dark:text-slate-400">
              {EXAM_TYPE_LABELS[printExam.examType]} · Năm học {printExam.academicYear} ·{' '}
              {printVariantSeed === 0 ? 'ĐỀ GỐC' : `MÃ ĐỀ ${printVariantSeed}`}
            </p>
            <h2 className="text-xl font-bold">{printExam.title}</h2>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Môn {SUBJECT_LABELS[printExam.subject]} · Lớp {printExam.grade} · Bộ sách{' '}
              {printExam.textbookSeries} · Thời gian làm bài: {printExam.durationMinutes} phút ·
              Thang điểm: {printExam.totalScore}
            </p>
          </div>

          <div className="space-y-5 text-sm">
            {displayedQuestions.map((q, idx) => (
              <div key={q.questionId} className="space-y-2 border-b border-slate-200/70 dark:border-slate-700/70 pb-4">
                <p className="font-semibold">
                  Câu {idx + 1} ({q.scoreWeight} điểm): <MathText text={q.questionText} />
                </p>
                {q.questionType === 'abcd' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pl-3 text-xs">
                    <p>A. <MathText text={q.optionA} /></p>
                    <p>B. <MathText text={q.optionB} /></p>
                    <p>C. <MathText text={q.optionC} /></p>
                    <p>D. <MathText text={q.optionD} /></p>
                  </div>
                )}
                {q.questionType === 'true_false' && q.trueFalseStatements && (
                  <div className="space-y-1 pl-3 text-xs">
                    {q.trueFalseStatements.map((s) => (
                      <p key={s.label}>
                        {s.label}) <MathText text={s.text} />
                      </p>
                    ))}
                  </div>
                )}
                {q.questionType === 'short_answer' && (
                  <p className="pl-3 text-xs italic text-slate-500">
                    Trả lời ngắn: ..................................................
                  </p>
                )}
              </div>
            ))}
          </div>

          {printIncludeKey && (isSuperAdmin || bestScoreByExam.has(printExam.examId)) && (
            <div className="pt-6 border-t-2 border-slate-400 space-y-3">
              <h3 className="text-base font-bold">ĐÁP ÁN & HƯỚNG DẪN CHẤM CHI TIẾT</h3>
              <div className="space-y-2 text-xs">
                {displayedQuestions.map((q, idx) => (
                  <div key={q.questionId} className="border-b border-slate-200/70 pb-2">
                    <p className="font-semibold">
                      Câu {idx + 1}:{' '}
                      {q.questionType === 'abcd'
                        ? q.correctAnswer
                        : q.questionType === 'true_false'
                        ? (q.trueFalseStatements || [])
                            .map((s) => `${s.label}:${s.isTrue ? 'Đúng' : 'Sai'}`)
                            .join(' | ')
                        : <MathText text={(q.shortAnswerAccepted || []).join(' hoặc ')} />}
                    </p>
                    <p className="text-slate-600 dark:text-slate-300">
                      <MathText text={q.explanation} />
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="pt-4 border-t border-slate-300 dark:border-slate-700 flex flex-wrap items-center justify-between gap-4">
            <div className="text-xs text-slate-600 dark:text-slate-400 space-y-0.5">
              <p className="font-semibold text-[#16243E] dark:text-[#E6EFFC]">
                Hệ thống kiểm định & đề thi chuẩn GDPT 2018 — {BRAND_CONFIG.name}
              </p>
              <p>Tác giả & Quản trị chuyên môn: {BRAND_CONFIG.authorName}</p>
            </div>
            <div className="flex flex-col items-center">
              <span className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Xác nhận đề thi
              </span>
              <div className="h-11 w-32 overflow-hidden flex items-center justify-center">
                <img
                  src={BRAND_CONFIG.signatureImageUrl}
                  alt={`Chữ ký ${BRAND_CONFIG.authorName}`}
                  data-no-privacy-blur="true"
                  className="w-full h-full object-contain scale-[2.3] mix-blend-multiply dark:invert dark:mix-blend-screen select-none"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Active Exam Runner View
  if (activeExam) {
    const answeredTotal = activeExam.questions.filter((q) => isQuestionAnswered(q)).length;

    return (
      <div className="space-y-6">
        <GlassSurface className="rounded-3xl p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4 sticky top-[60px] md:top-20 z-20">
          <div>
            <p className="text-xs font-semibold text-[#2563EB] dark:text-[#60A5FA]">
              {EXAM_TYPE_LABELS[activeExam.examType]} · {SUBJECT_LABELS[activeExam.subject]} Lớp{' '}
              {activeExam.grade}
            </p>
            <h1 className="font-display text-lg font-bold text-[#16243E] dark:text-[#E6EFFC]">
              {activeExam.title}
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {!latestResult && (
              <div
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border font-mono text-xs font-bold tabular-nums ${
                  secondsLeft <= 120
                    ? 'bg-rose-50/85 dark:bg-rose-950/50 border-rose-300 dark:border-rose-700 text-rose-700 dark:text-rose-300'
                    : 'glass-control text-[#16243E] dark:text-[#E6EFFC]'
                }`}
              >
                <Clock className="w-4 h-4" />
                {formatClock(secondsLeft)}
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                setActiveExam(null);
                setLatestResult(null);
              }}
              className="glass-control px-3.5 py-2 rounded-xl text-xs font-semibold cursor-pointer"
            >
              Thoát phòng thi
            </button>

            {!latestResult && (
              <WaterRippleButton onClick={handleSubmitExam} disabled={submitting}>
                <CheckCircle2 className="w-4 h-4" />
                {submitting
                  ? 'Đang chấm điểm...'
                  : `Nộp bài (${answeredTotal}/${activeExam.questions.length})`}
              </WaterRippleButton>
            )}
          </div>
        </GlassSurface>

        {submitError && (
          <GlassSurface className="rounded-2xl p-4 border border-rose-300 dark:border-rose-700 bg-rose-50/85 dark:bg-rose-950/50 text-xs text-rose-700 dark:text-rose-300 flex items-center justify-between gap-3">
            <span>{submitError}</span>
            <WaterRippleButton size="sm" onClick={handleSubmitExam} disabled={submitting}>
              Thử nộp lại
            </WaterRippleButton>
          </GlassSurface>
        )}

        {/* Graded Result Summary */}
        {latestResult && (
          <GlassSurface className="rounded-3xl p-6 sm:p-8 border-2 border-emerald-300/70 dark:border-emerald-700/60 space-y-5">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1">
                <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                  Đã chấm điểm & cập nhật bảng xếp hạng Đua Top
                </p>
                <h2 className="font-display text-2xl sm:text-3xl font-bold text-[#16243E] dark:text-[#E6EFFC] tabular-nums">
                  {latestResult.attempt.earnedScore} / {latestResult.attempt.maxScore} điểm (
                  {latestResult.attempt.percentScore}%)
                </h2>
                <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300">
                  Quy đổi Đua Top: <strong>{latestResult.examPoints}/100</strong> điểm đề này ·{' '}
                  {latestResult.pointsDelta > 0 ? (
                    <span className="text-emerald-700 dark:text-emerald-400 font-bold">
                      +{latestResult.pointsDelta} điểm mới cộng vào tổng Đua Top (Tổng hiện tại:{' '}
                      {latestResult.totalLeaderboardScore})
                    </span>
                  ) : (
                    <span>
                      Điểm cao nhất của bạn ở đề này đã được bảo toàn (Tổng hiện tại:{' '}
                      {latestResult.totalLeaderboardScore}).
                    </span>
                  )}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                {onOpenLeaderboard && (
                  <WaterRippleButton onClick={onOpenLeaderboard}>
                    <Trophy className="w-4 h-4" />
                    Xem Bảng Đua Top
                  </WaterRippleButton>
                )}
                {activeExam.allowRetake && (
                  <WaterRippleButton variant="secondary" onClick={() => startExam(activeExam)}>
                    <RotateCcw className="w-4 h-4" />
                    Làm lại đề này
                  </WaterRippleButton>
                )}
              </div>
            </div>
          </GlassSurface>
        )}

        {/* Navigator Grid */}
        <GlassSurface className="rounded-3xl p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <p className="text-xs font-semibold text-slate-600 dark:text-slate-300 tabular-nums">
              Sơ đồ câu hỏi ({answeredTotal}/{activeExam.questions.length} đã trả lời)
            </p>
            {!latestResult && (
              <p className="hidden sm:block font-mono text-[11px] text-[#525E75] dark:text-[#94A3B8]">
                Phím tắt: 1–4 / A–D chọn đáp án · ↑/↓ chuyển câu
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {activeExam.questions.map((q, idx) => {
              const answered = isQuestionAnswered(q);
              const tfCounts =
                q.questionType === 'true_false' ? getTrueFalseAnsweredCount(q) : null;
              const isPartialTf =
                tfCounts !== null && tfCounts.chosenCount > 0 && tfCounts.chosenCount < tfCounts.requiredCount;
              const bk = latestResult?.attempt.breakdown.find((b) => b.questionId === q.questionId);
              let cls =
                'glass-control text-slate-700 dark:text-slate-300';
              if (bk) {
                cls = bk.isFullCorrect
                  ? 'bg-[#059669] border-[#059669] text-white'
                  : bk.earnedScore > 0
                  ? 'bg-[#F5A623] border-[#F5A623] text-white'
                  : 'bg-[#E11D48] border-[#E11D48] text-white';
              } else if (answered) {
                cls = 'bg-[#2563EB] border-[#2563EB] text-white';
              } else if (isPartialTf) {
                cls = 'border-amber-500 bg-amber-500/15 text-amber-800 dark:text-amber-300';
              }
              return (
                <a
                  key={q.questionId}
                  href={`#exam-q-${q.questionId}`}
                  onClick={() => setFocusedQuestionIdx(idx)}
                  title={
                    isPartialTf && tfCounts
                      ? `Câu ${idx + 1}: Đã chọn ${tfCounts.chosenCount}/${tfCounts.requiredCount} mệnh đề Đúng/Sai`
                      : undefined
                  }
                  className={`size-8 rounded-xl border font-mono text-xs font-bold flex items-center justify-center ${cls} ${
                    focusedQuestionIdx === idx && !latestResult
                      ? 'ring-2 ring-[#2563EB] ring-offset-1 dark:ring-offset-[#09111E]'
                      : ''
                  }`}
                >
                  {idx + 1}
                </a>
              );
            })}
          </div>
        </GlassSurface>

        {/* Questions (Solid Paper Surface inside Glass Shell) */}
        <div className="space-y-4">
          {activeExam.questions.map((q, idx) => {
            const ans = answersMap[q.questionId];
            const bk = latestResult?.attempt.breakdown.find((b) => b.questionId === q.questionId);
            const isFocused = !latestResult && focusedQuestionIdx === idx;

            return (
              <div
                key={q.questionId}
                id={`exam-q-${q.questionId}`}
                onClick={() => setFocusedQuestionIdx(idx)}
                className={`document-paper rounded-2xl p-5 sm:p-6 space-y-4 transition-[border-color,box-shadow] duration-150 ${
                  isFocused
                    ? 'ring-2 ring-[#2563EB]/30 dark:ring-[#3B82F6]/35 border-[#2563EB]/60 dark:border-[#3B82F6]/60'
                    : ''
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-mono font-semibold text-blue-700 dark:text-blue-400 tabular-nums">
                    Câu {idx + 1} · {q.scoreWeight} điểm · {COGNITIVE_LABELS[q.cognitiveLevel]} ·{' '}
                    {q.questionType === 'abcd'
                      ? 'Trắc nghiệm 4 lựa chọn'
                      : q.questionType === 'true_false'
                      ? 'Đúng / Sai (4 ý)'
                      : 'Trả lời ngắn'}
                  </span>
                  {bk && (
                    <span
                      className={`font-mono font-bold tabular-nums ${
                        bk.isFullCorrect
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : bk.earnedScore > 0
                          ? 'text-amber-700 dark:text-amber-400'
                          : 'text-rose-700 dark:text-rose-400'
                      }`}
                    >
                      +{bk.earnedScore}/{bk.maxScore} điểm
                    </span>
                  )}
                </div>

                <p className="text-sm sm:text-base font-semibold leading-relaxed text-pretty">
                  <MathText text={q.questionText} />
                </p>

                {q.questionType === 'abcd' && (
                  <AbcdOptionGrid
                    options={(['A', 'B', 'C', 'D'] as const).map((opt) => ({
                      key: opt,
                      text: q[`option${opt}`] || '',
                    }))}
                    selectedOption={ans?.selectedOption}
                    correctOption={q.correctAnswer}
                    isGraded={Boolean(latestResult)}
                    showShortcutHints={isFocused}
                    onSelect={(choice) => {
                      setFocusedQuestionIdx(idx);
                      updateAnswer(q.questionId, (prev) => ({
                        ...prev,
                        selectedOption: choice,
                      }));
                    }}
                  />
                )}

                {q.questionType === 'true_false' && q.trueFalseStatements && (
                  <TrueFalseOptionList
                    statements={q.trueFalseStatements}
                    choices={ans?.trueFalseChoices}
                    isGraded={Boolean(latestResult)}
                    onChoose={(stmtLabel, val) => {
                      setFocusedQuestionIdx(idx);
                      updateAnswer(q.questionId, (prev) => ({
                        ...prev,
                        trueFalseChoices: {
                          ...(prev.trueFalseChoices || {}),
                          [stmtLabel]: val,
                        },
                      }));
                    }}
                  />
                )}

                {q.questionType === 'short_answer' && (
                  <div>
                    <input
                      type="text"
                      disabled={Boolean(latestResult)}
                      value={ans?.shortAnswerText || ''}
                      onChange={(e) =>
                        updateAnswer(q.questionId, (prev) => ({
                          ...prev,
                          shortAnswerText: e.target.value,
                        }))
                      }
                      placeholder="Nhập đáp số hoặc cụm từ trả lời ngắn..."
                      className="w-full sm:max-w-md px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-sm font-mono"
                    />
                  </div>
                )}

                {latestResult && (
                  <div className="rounded-xl glass-panel-subtle p-3.5 text-xs space-y-1">
                    <p className="font-semibold text-[#16243E] dark:text-[#E6EFFC]">
                      Đáp án chuẩn: <MathText text={bk?.correctDisplay} /> · Bài làm của bạn:{' '}
                      <MathText text={bk?.studentDisplay} />
                    </p>
                    <p className="text-slate-700 dark:text-slate-300">
                      <MathText text={q.explanation} />
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div ref={examRef} className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#16243E] dark:text-[#E6EFFC]">
            Trung tâm Đề Kiểm Tra Giữa kỳ & Cuối kỳ
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 mt-1">
            Đề thi theo ma trận chuẩn (ABCD, Đúng/Sai, Trả lời ngắn). Hoàn thành bài thi để cộng
            điểm vào bảng Đua Top theo Khối & Toàn trường.
          </p>
        </div>

        {onOpenLeaderboard && (
          <WaterRippleButton variant="secondary" onClick={onOpenLeaderboard}>
            <Trophy className="w-4 h-4 text-amber-500" />
            Xem Bảng Đua Top
          </WaterRippleButton>
        )}
      </div>

      {/* Category Tabs */}
      <SlidingTabs<'all' | ExamType | 'history'>
        layoutGroupId="exam-center-tabs"
        ariaLabel="Phân loại kỳ thi"
        activeId={activeTab}
        onChange={setActiveTab}
        items={[
          { id: 'all', label: 'Tất cả kỳ thi' },
          { id: 'giua_ky_1', label: 'Giữa kỳ I' },
          { id: 'cuoi_ky_1', label: 'Cuối kỳ I' },
          { id: 'giua_ky_2', label: 'Giữa kỳ II' },
          { id: 'cuoi_ky_2', label: 'Cuối kỳ II' },
          { id: 'on_tap_tong_hop', label: 'Ôn tập tổng hợp' },
          { id: 'history', label: `Lịch sử bài thi (${attempts.length})` },
        ]}
      />

      {activeTab !== 'history' && (
        <GlassSurface className="rounded-3xl p-4 sm:p-5 space-y-3.5">
          {/* Prominent Search Bar above the exam list */}
          <div className="relative w-full">
            <Search className="w-4 h-4 text-sky-600 dark:text-sky-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Tìm kiếm đề thi theo tiêu đề hoặc chương"
              placeholder="Tìm nhanh đề thi theo tiêu đề hoặc chương (VD: Giữa kỳ I, Chương 1, Hàm số, Dao động điều hòa...)"
              className="glass-control w-full pl-10 pr-24 py-2.5 rounded-2xl text-xs sm:text-sm text-[#16243E] dark:text-[#E6EFFC] placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
            />
            {searchQuery.trim() && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                title="Xóa từ khóa tìm kiếm"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-[11px] font-semibold bg-slate-200/70 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 hover:bg-slate-300/70 dark:hover:bg-slate-700 cursor-pointer"
              >
                <X className="w-3 h-3" />
                Xóa
              </button>
            )}
          </div>

          {/* Filter Row: Grade, Subject, Chapter, and Page Size */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[240px]">
              <select
                value={gradeFilter}
                onChange={(e) => setGradeFilter(e.target.value as 'all' | GradeLevel)}
                className="glass-control px-3.5 py-2 rounded-xl text-xs text-[#16243E] dark:text-[#E6EFFC]"
              >
                <option value="all">Tất cả khối (10 / 11 / 12)</option>
                <option value="10">Khối 10</option>
                <option value="11">Khối 11</option>
                <option value="12">Khối 12</option>
              </select>

              <select
                value={subjectFilter}
                onChange={(e) => setSubjectFilter(e.target.value as 'all' | SubjectId)}
                className="glass-control px-3.5 py-2 rounded-xl text-xs text-[#16243E] dark:text-[#E6EFFC]"
              >
                <option value="all">Tất cả môn học</option>
                {(Object.keys(SUBJECT_LABELS) as SubjectId[]).map((s) => (
                  <option key={s} value={s}>
                    {SUBJECT_LABELS[s]}
                  </option>
                ))}
              </select>

              <select
                value={chapterFilter}
                onChange={(e) => setChapterFilter(e.target.value)}
                aria-label="Lọc theo chương"
                className="glass-control px-3.5 py-2 rounded-xl text-xs text-[#16243E] dark:text-[#E6EFFC] max-w-[260px] truncate"
              >
                <option value="all">
                  Tất cả chương ({availableChapters.length})
                </option>
                {availableChapters.map((ch) => (
                  <option key={ch} value={ch}>
                    {ch}
                  </option>
                ))}
              </select>

              {(gradeFilter !== 'all' ||
                subjectFilter !== 'all' ||
                chapterFilter !== 'all' ||
                searchQuery.trim() !== '') && (
                <button
                  type="button"
                  onClick={() => {
                    setGradeFilter('all');
                    setSubjectFilter('all');
                    setChapterFilter('all');
                    setSearchQuery('');
                  }}
                  className="inline-flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Đặt lại bộ lọc
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 text-xs text-[#475B78] dark:text-[#B4C7E2]">
              <span className="font-mono tabular-nums font-semibold text-sky-700 dark:text-sky-400">
                {filteredExams.length} đề
              </span>
              <span>·</span>
              <label className="inline-flex items-center gap-1.5">
                <span>Hiển thị:</span>
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value) || 6)}
                  className="glass-control px-2.5 py-1.5 rounded-xl text-xs font-mono font-semibold text-[#16243E] dark:text-[#E6EFFC]"
                >
                  <option value={6}>6 đề / trang</option>
                  <option value={12}>12 đề / trang</option>
                  <option value={24}>24 đề / trang</option>
                </select>
              </label>
            </div>
          </div>
        </GlassSurface>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2].map((i) => (
            <div key={i} className="glass-surface sc-skeleton rounded-3xl p-6 h-40" />
          ))}
        </div>
      ) : activeTab === 'history' ? (
        attempts.length === 0 ? (
          <GlassSurface className="rounded-3xl p-8 sm:p-10 text-center space-y-3">
            <svg viewBox="0 0 96 72" className="w-24 h-18 mx-auto" aria-hidden="true">
              <rect x="14" y="8" width="68" height="56" rx="12" className="fill-[#EAF2FF] dark:fill-[#1E293B]" />
              <rect x="24" y="20" width="32" height="6" rx="3" className="fill-[#2563EB]/75 dark:fill-[#60A5FA]/80" />
              <rect x="24" y="32" width="48" height="5" rx="2.5" className="fill-[#CBD5E1] dark:fill-[#475569]" />
              <rect x="24" y="43" width="38" height="5" rx="2.5" className="fill-[#CBD5E1] dark:fill-[#475569]" />
              <circle cx="72" cy="52" r="11" className="fill-[#2563EB]" />
              <path d="M67.5 52.2l3 3 6-6.2" fill="none" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <p className="font-semibold text-[#172033] dark:text-[#E6EFFC]">
              Chưa có bài kiểm tra nào được nộp
            </p>
            <p className="text-xs sm:text-sm text-[#525E75] dark:text-[#94A3B8] max-w-md mx-auto">
              Chọn một đề ở các tab bên cạnh để bắt đầu thi thử theo thời gian thực và tích điểm Đua Top.
            </p>
          </GlassSurface>
        ) : (
          <div className="space-y-4">
            <div className="space-y-3">
              {paginatedAttempts.map((a) => (
                <LiquidCard
                  key={a.attemptId}
                  enableTilt={false}
                  className="exam-card rounded-3xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="space-y-1">
                    <p className="text-sm font-bold text-[#16243E] dark:text-[#E6EFFC]">
                      <MathText text={a.examTitle} />
                    </p>
                    <p className="text-xs text-[#475B78] dark:text-[#B4C7E2]">
                      {SUBJECT_LABELS[a.subject]} · Lớp {a.grade} · {EXAM_TYPE_LABELS[a.examType]} ·{' '}
                      {new Date(a.submittedAt).toLocaleString('vi-VN')}
                    </p>
                  </div>
                  <div className="text-right font-mono text-xs tabular-nums">
                    <p className="text-base font-bold text-sky-700 dark:text-sky-400">
                      {a.earnedScore}/{a.maxScore} ({a.percentScore}%)
                    </p>
                    <p className="text-emerald-700 dark:text-emerald-400">
                      +{a.leaderboardPointsAwarded} điểm Đua Top
                    </p>
                  </div>
                </LiquidCard>
              ))}
            </div>

            {totalHistoryPages > 1 && (
              <GlassSurface className="rounded-2xl p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
                <span className="text-[#475B78] dark:text-[#B4C7E2] font-mono tabular-nums">
                  Hiển thị {(safeHistoryPage - 1) * historyPageSize + 1}–
                  {Math.min(attempts.length, safeHistoryPage * historyPageSize)} / {attempts.length} lượt thi (Trang{' '}
                  {safeHistoryPage}/{totalHistoryPages})
                </span>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    disabled={safeHistoryPage <= 1}
                    onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                    className="glass-control inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl font-semibold disabled:opacity-40 cursor-pointer disabled:cursor-default"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                    Trước
                  </button>
                  {buildVisiblePageNumbers(safeHistoryPage, totalHistoryPages).map((item) =>
                    typeof item === 'number' ? (
                      <button
                        key={item}
                        type="button"
                        onClick={() => setHistoryPage(item)}
                        className={`min-w-[34px] h-8 px-2 rounded-xl font-mono text-xs font-bold cursor-pointer transition-all ${
                          safeHistoryPage === item
                            ? 'bg-[#2563EB] text-white shadow-sm'
                            : 'glass-control text-[#16243E] dark:text-[#E6EFFC]'
                        }`}
                      >
                        {item}
                      </button>
                    ) : (
                      <span key={item} className="px-1 text-slate-400 font-mono">
                        ...
                      </span>
                    )
                  )}
                  <button
                    type="button"
                    disabled={safeHistoryPage >= totalHistoryPages}
                    onClick={() => setHistoryPage((p) => Math.min(totalHistoryPages, p + 1))}
                    className="glass-control inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl font-semibold disabled:opacity-40 cursor-pointer disabled:cursor-default"
                  >
                    Sau
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </GlassSurface>
            )}
          </div>
        )
      ) : filteredExams.length === 0 ? (
        <GlassSurface className="rounded-3xl p-8 sm:p-10 text-center space-y-3 text-sm text-[#525E75] dark:text-[#94A3B8]">
          <svg viewBox="0 0 96 72" className="w-24 h-18 mx-auto" aria-hidden="true">
            <rect x="12" y="12" width="48" height="50" rx="10" className="fill-[#F1F5FA] dark:fill-[#111B30] stroke-[#BFDBFE] dark:stroke-[#1E293B]" strokeWidth="2" />
            <rect x="34" y="8" width="50" height="52" rx="10" className="fill-[#EAF2FF] dark:fill-[#1E293B]" />
            <rect x="44" y="20" width="30" height="5" rx="2.5" className="fill-[#2563EB]/80 dark:fill-[#60A5FA]" />
            <rect x="44" y="31" width="24" height="4.5" rx="2.25" className="fill-[#94A3B8]/60" />
            <rect x="44" y="41" width="28" height="4.5" rx="2.25" className="fill-[#94A3B8]/45" />
          </svg>
          <p className="font-semibold text-[#172033] dark:text-[#E6EFFC]">
            Chưa có đề kiểm tra được xuất bản cho bộ lọc này
          </p>
          <p className="text-xs max-w-md mx-auto">
            Quản trị viên có thể tạo & duyệt ma trận đề thi mới tại mục Quản trị hệ thống → Quản
            trị Đề kiểm tra.
          </p>
        </GlassSurface>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {paginatedExams.map((exam) => {
              const bestPct = bestScoreByExam.get(exam.examId);
              const examChapters = extractExamChapters(exam);
              return (
                <LiquidCard key={exam.examId} className="exam-card rounded-3xl p-6 flex flex-col justify-between gap-4">
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-semibold text-sky-700 dark:text-sky-400">
                        {EXAM_TYPE_LABELS[exam.examType]}
                      </span>
                      <span className="font-mono text-[#475B78] dark:text-[#B4C7E2]">
                        Khối {exam.grade} · {SUBJECT_LABELS[exam.subject]}
                      </span>
                    </div>
                    <h2 className="font-display text-lg font-bold text-[#16243E] dark:text-[#E6EFFC]">
                      <MathText text={exam.title} />
                    </h2>
                    <p className="text-xs text-[#475B78] dark:text-[#B4C7E2] leading-[1.6]">
                      <MathText
                        text={
                          exam.description ||
                          `Bộ sách ${exam.textbookSeries} · Năm học ${exam.academicYear}`
                        }
                      />
                    </p>
                    {examChapters.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                          <BookOpen className="w-3 h-3 text-sky-600 dark:text-sky-400" />
                          Chương:
                        </span>
                        {examChapters.slice(0, 4).map((ch) => (
                          <button
                            key={ch}
                            type="button"
                            onClick={() => setSearchQuery(ch)}
                            title={`Lọc nhanh theo chương: ${ch}`}
                            className="px-2 py-0.5 rounded-lg text-[11px] font-medium bg-sky-500/10 hover:bg-sky-500/20 text-sky-800 dark:text-sky-300 border border-sky-500/20 transition-colors cursor-pointer text-left"
                          >
                            <MathText text={ch} />
                          </button>
                        ))}
                        {examChapters.length > 4 && (
                          <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                            +{examChapters.length - 4} chương
                          </span>
                        )}
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-4 pt-1 text-xs font-mono text-[#475B78] dark:text-[#B4C7E2] tabular-nums">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                        {exam.durationMinutes} phút
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <FileCheck2 className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                        {exam.questions.length} câu ({exam.totalScore} điểm)
                      </span>
                      {bestPct !== undefined && (
                        <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-bold">
                          <Award className="w-3.5 h-3.5" />
                          Cao nhất: {bestPct}%
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-sky-200/60 dark:border-slate-700/70">
                    <button
                      type="button"
                      onClick={() => {
                        setPrintExam(exam);
                        setPrintVariantSeed(0);
                        setPrintIncludeKey(false);
                      }}
                      className="glass-control inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium cursor-pointer"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      In / Đảo mã đề
                    </button>

                    <WaterRippleButton size="sm" onClick={() => startExam(exam)}>
                      <ShieldCheck className="w-4 h-4" />
                      {bestPct !== undefined && exam.allowRetake ? 'Làm lại bài thi' : 'Vào phòng thi'}
                    </WaterRippleButton>
                  </div>
                </LiquidCard>
              );
            })}
          </div>

          {/* Bottom Pagination Controls for Exam Center */}
          <GlassSurface className="rounded-3xl p-4 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-[#475B78] dark:text-[#B4C7E2] font-mono tabular-nums">
              <span>
                Hiển thị{' '}
                <strong className="text-[#16243E] dark:text-[#E6EFFC]">
                  {(safeCurrentPage - 1) * pageSize + 1}–
                  {Math.min(filteredExams.length, safeCurrentPage * pageSize)}
                </strong>{' '}
                trong tổng số{' '}
                <strong className="text-sky-700 dark:text-sky-400">{filteredExams.length}</strong> đề
              </span>
              <span>·</span>
              <span>
                Trang <strong>{safeCurrentPage}</strong>/{totalExamPages}
              </span>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-1.5">
              <button
                type="button"
                disabled={safeCurrentPage <= 1}
                onClick={() => goToExamPage(1)}
                title="Trang đầu"
                aria-label="Trang đầu"
                className="glass-control inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-semibold disabled:opacity-40 cursor-pointer disabled:cursor-default"
              >
                <ChevronsLeft className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Đầu</span>
              </button>
              <button
                type="button"
                disabled={safeCurrentPage <= 1}
                onClick={() => goToExamPage(safeCurrentPage - 1)}
                title="Trang trước"
                aria-label="Trang trước"
                className="glass-control inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-semibold disabled:opacity-40 cursor-pointer disabled:cursor-default"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>Trước</span>
              </button>

              {buildVisiblePageNumbers(safeCurrentPage, totalExamPages).map((item) =>
                typeof item === 'number' ? (
                  <button
                    key={item}
                    type="button"
                    onClick={() => goToExamPage(item)}
                    aria-current={safeCurrentPage === item ? 'page' : undefined}
                    className={`min-w-[34px] h-8 px-2.5 rounded-xl font-mono text-xs font-bold cursor-pointer transition-all ${
                      safeCurrentPage === item
                        ? 'bg-[#2563EB] text-white shadow-sm'
                        : 'glass-control text-[#16243E] dark:text-[#E6EFFC] hover:border-[#2563EB]/60'
                    }`}
                  >
                    {item}
                  </button>
                ) : (
                  <span key={item} className="px-1 text-slate-400 font-mono text-xs select-none">
                    ...
                  </span>
                )
              )}

              <button
                type="button"
                disabled={safeCurrentPage >= totalExamPages}
                onClick={() => goToExamPage(safeCurrentPage + 1)}
                title="Trang sau"
                aria-label="Trang sau"
                className="glass-control inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-semibold disabled:opacity-40 cursor-pointer disabled:cursor-default"
              >
                <span>Sau</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                disabled={safeCurrentPage >= totalExamPages}
                onClick={() => goToExamPage(totalExamPages)}
                title="Trang cuối"
                aria-label="Trang cuối"
                className="glass-control inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-semibold disabled:opacity-40 cursor-pointer disabled:cursor-default"
              >
                <span className="hidden sm:inline">Cuối</span>
                <ChevronsRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </GlassSurface>
        </div>
      )}
    </div>
  );
};
