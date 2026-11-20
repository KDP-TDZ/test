import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Award,
  BookOpen,
  CheckCircle2,
  Clock,
  FileCheck2,
  Printer,
  RotateCcw,
  ShieldCheck,
  Trophy,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
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
import { GlassSurface } from './LiquidGlass/GlassSurface';
import { LiquidCard } from './LiquidGlass/LiquidCard';
import { SlidingTabs } from './LiquidGlass/SlidingTabs';
import { WaterRippleButton } from './LiquidGlass/WaterRippleButton';

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

export const ExamCenterView: React.FC<ExamCenterViewProps> = ({ onOpenLeaderboard }) => {
  const { user, profile } = useAuth();
  const [exams, setExams] = useState<ExamDocument[]>([]);
  const [attempts, setAttempts] = useState<ExamAttempt[]>([]);
  const [loading, setLoading] = useState(true);

  const [activeTab, setActiveTab] = useState<'all' | ExamType | 'history'>('all');
  const [gradeFilter, setGradeFilter] = useState<'all' | GradeLevel>('all');
  const [subjectFilter, setSubjectFilter] = useState<'all' | SubjectId>('all');

  // Active exam runner state
  const [activeExam, setActiveExam] = useState<ExamDocument | null>(null);
  const [answersMap, setAnswersMap] = useState<Record<string, ExamQuestionAnswer>>({});
  const [secondsLeft, setSecondsLeft] = useState<number>(0);
  const [startedAtMs, setStartedAtMs] = useState<number>(0);
  const [submitting, setSubmitting] = useState(false);
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
    Promise.all([
      listExams(true),
      user ? listUserExamAttempts(user.uid) : Promise.resolve([]),
    ])
      .then(([exList, attList]) => {
        if (cancelled) return;
        setExams(exList);
        setAttempts(attList);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  useGSAP(
    () => {
      if (activeExam || printExam || loading) return;
      const mm = gsap.matchMedia();
      mm.add(MOTION_ALLOWED_MEDIA, () => {
        gsap.from('.exam-card', {
          y: 12,
          autoAlpha: 0,
          duration: 0.34,
          stagger: 0.04,
          ease: 'power2.out',
          clearProps: 'transform,opacity,visibility',
        });
      });
    },
    {
      scope: examRef,
      dependencies: [activeTab, loading, gradeFilter, subjectFilter, Boolean(activeExam), Boolean(printExam)],
    }
  );

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

  const filteredExams = useMemo(() => {
    return exams.filter((e) => {
      if (activeTab !== 'all' && activeTab !== 'history' && e.examType !== activeTab) return false;
      if (gradeFilter !== 'all' && e.grade !== gradeFilter) return false;
      if (subjectFilter !== 'all' && e.subject !== subjectFilter) return false;
      return true;
    });
  }, [exams, activeTab, gradeFilter, subjectFilter]);

  const startExam = (exam: ExamDocument) => {
    setActiveExam(exam);
    setAnswersMap({});
    setLatestResult(null);
    setSecondsLeft(exam.durationMinutes * 60);
    setStartedAtMs(Date.now());
  };

  const updateAnswer = (qId: string, updater: (prev: ExamQuestionAnswer) => ExamQuestionAnswer) => {
    setAnswersMap((prev) => {
      const current = prev[qId] || { questionId: qId };
      return { ...prev, [qId]: updater(current) };
    });
  };

  const isQuestionAnswered = (q: ExamQuestion): boolean => {
    const a = answersMap[q.questionId];
    if (!a) return false;
    if (q.questionType === 'abcd') return Boolean(a.selectedOption);
    if (q.questionType === 'true_false') {
      const tf = a.trueFalseChoices || {};
      return Object.keys(tf).length > 0;
    }
    return Boolean(a.shortAnswerText?.trim());
  };

  const handleSubmitExam = async () => {
    if (!user || !activeExam || submitting) return;
    setSubmitting(true);
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
    } finally {
      setSubmitting(false);
    }
  };

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
                    ? 'bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-sm'
                    : 'glass-control'
                }`}
              >
                {v.label}
              </button>
            ))}
            <label className="inline-flex items-center gap-1.5 ml-2 cursor-pointer">
              <input
                type="checkbox"
                checked={printIncludeKey}
                onChange={(e) => setPrintIncludeKey(e.target.checked)}
                className="h-4 w-4 accent-sky-600"
              />
              In kèm Đáp án & Hướng dẫn chấm
            </label>
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
                  Câu {idx + 1} ({q.scoreWeight} điểm): {q.questionText}
                </p>
                {q.questionType === 'abcd' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pl-3 text-xs">
                    <p>A. {q.optionA}</p>
                    <p>B. {q.optionB}</p>
                    <p>C. {q.optionC}</p>
                    <p>D. {q.optionD}</p>
                  </div>
                )}
                {q.questionType === 'true_false' && q.trueFalseStatements && (
                  <div className="space-y-1 pl-3 text-xs">
                    {q.trueFalseStatements.map((s) => (
                      <p key={s.label}>
                        {s.label}) {s.text}
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

          {printIncludeKey && (
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
                        : (q.shortAnswerAccepted || []).join(' hoặc ')}
                    </p>
                    <p className="text-slate-600 dark:text-slate-300">{q.explanation}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Active Exam Runner View
  if (activeExam) {
    const answeredTotal = activeExam.questions.filter((q) => isQuestionAnswered(q)).length;

    return (
      <div className="space-y-6">
        <GlassSurface className="rounded-3xl p-5 flex flex-wrap items-center justify-between gap-4 sticky top-20 z-20">
          <div>
            <p className="text-xs font-semibold text-sky-700 dark:text-sky-400">
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
          <p className="text-xs font-semibold text-slate-600 dark:text-slate-300 mb-2">
            Sơ đồ câu hỏi ({answeredTotal}/{activeExam.questions.length} đã trả lời)
          </p>
          <div className="flex flex-wrap gap-1.5">
            {activeExam.questions.map((q, idx) => {
              const answered = isQuestionAnswered(q);
              const bk = latestResult?.attempt.breakdown.find((b) => b.questionId === q.questionId);
              let cls =
                'glass-control text-slate-700 dark:text-slate-300';
              if (bk) {
                cls = bk.isFullCorrect
                  ? 'bg-emerald-600 border-emerald-600 text-white'
                  : bk.earnedScore > 0
                  ? 'bg-amber-500 border-amber-500 text-white'
                  : 'bg-rose-600 border-rose-600 text-white';
              } else if (answered) {
                cls = 'bg-gradient-to-r from-sky-500 to-blue-600 border-sky-500 text-white';
              }
              return (
                <a
                  key={q.questionId}
                  href={`#exam-q-${q.questionId}`}
                  className={`w-8 h-8 rounded-xl border font-mono text-xs font-bold flex items-center justify-center ${cls}`}
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

            return (
              <div
                key={q.questionId}
                id={`exam-q-${q.questionId}`}
                className="document-paper rounded-2xl p-5 sm:p-6 space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-mono font-semibold text-blue-700 dark:text-blue-400">
                    Câu {idx + 1} · {q.scoreWeight} điểm · {COGNITIVE_LABELS[q.cognitiveLevel]} ·{' '}
                    {q.questionType === 'abcd'
                      ? 'Trắc nghiệm 4 lựa chọn'
                      : q.questionType === 'true_false'
                      ? 'Đúng / Sai (4 ý)'
                      : 'Trả lời ngắn'}
                  </span>
                  {bk && (
                    <span
                      className={`font-mono font-bold ${
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

                <p className="text-sm sm:text-base font-semibold leading-relaxed">
                  {q.questionText}
                </p>

                {q.questionType === 'abcd' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {(['A', 'B', 'C', 'D'] as const).map((opt) => {
                      const optText = q[`option${opt}`] || '';
                      const selected = ans?.selectedOption === opt;
                      const isRight = q.correctAnswer === opt;
                      let cls =
                        'bg-slate-50/70 dark:bg-slate-900/70 border-slate-200 dark:border-slate-700 hover:border-blue-400';
                      if (latestResult) {
                        if (isRight)
                          cls =
                            'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-500 text-emerald-950 dark:text-emerald-200 font-semibold';
                        else if (selected)
                          cls =
                            'bg-rose-50 dark:bg-rose-950/60 border-rose-500 text-rose-950 dark:text-rose-200';
                      } else if (selected) {
                        cls =
                          'bg-blue-50 dark:bg-blue-950/60 border-blue-500 text-blue-950 dark:text-blue-200 font-semibold';
                      }

                      return (
                        <button
                          key={opt}
                          type="button"
                          disabled={Boolean(latestResult)}
                          onClick={() =>
                            updateAnswer(q.questionId, (prev) => ({
                              ...prev,
                              selectedOption: opt,
                            }))
                          }
                          className={`text-left px-4 py-3 rounded-xl border text-xs sm:text-sm flex items-start gap-2 cursor-pointer disabled:cursor-default ${cls}`}
                        >
                          <span className="font-mono font-bold">{opt}.</span>
                          <span>{optText}</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {q.questionType === 'true_false' && q.trueFalseStatements && (
                  <div className="space-y-2.5">
                    {q.trueFalseStatements.map((stmt) => {
                      const chosen = ans?.trueFalseChoices?.[stmt.label];
                      return (
                        <div
                          key={stmt.label}
                          className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs sm:text-sm"
                        >
                          <p>
                            <strong className="font-mono">{stmt.label})</strong> {stmt.text}
                          </p>
                          <div className="flex items-center gap-2 shrink-0">
                            {[
                              { val: true, label: 'Đúng' },
                              { val: false, label: 'Sai' },
                            ].map((btn) => (
                              <button
                                key={btn.label}
                                type="button"
                                disabled={Boolean(latestResult)}
                                onClick={() =>
                                  updateAnswer(q.questionId, (prev) => ({
                                    ...prev,
                                    trueFalseChoices: {
                                      ...(prev.trueFalseChoices || {}),
                                      [stmt.label]: btn.val,
                                    },
                                  }))
                                }
                                className={`px-3 py-1.5 rounded-lg border text-xs font-semibold cursor-pointer ${
                                  chosen === btn.val
                                    ? 'bg-blue-600 text-white border-blue-600'
                                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700'
                                }`}
                              >
                                {btn.label}
                              </button>
                            ))}
                            {latestResult && (
                              <span
                                className={`font-mono text-xs font-bold ${
                                  chosen === stmt.isTrue
                                    ? 'text-emerald-600 dark:text-emerald-400'
                                    : 'text-rose-600 dark:text-rose-400'
                                }`}
                              >
                                ({stmt.isTrue ? 'Đúng' : 'Sai'})
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
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
                      Đáp án chuẩn: {bk?.correctDisplay} · Bài làm của bạn: {bk?.studentDisplay}
                    </p>
                    <p className="text-slate-700 dark:text-slate-300">{q.explanation}</p>
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
        <GlassSurface className="rounded-3xl p-4 flex flex-wrap gap-3">
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
        </GlassSurface>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2].map((i) => (
            <div key={i} className="glass-surface rounded-3xl p-6 h-40 animate-pulse" />
          ))}
        </div>
      ) : activeTab === 'history' ? (
        attempts.length === 0 ? (
          <GlassSurface className="rounded-3xl p-8 text-center text-sm text-slate-600 dark:text-slate-300">
            Bạn chưa nộp bài kiểm tra nào. Chọn một đề ở các tab bên cạnh để bắt đầu thi thử và
            tích điểm Đua Top.
          </GlassSurface>
        ) : (
          <div className="space-y-3">
            {attempts.map((a) => (
              <LiquidCard
                key={a.attemptId}
                enableTilt={false}
                className="exam-card rounded-3xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div className="space-y-1">
                  <p className="text-sm font-bold text-[#16243E] dark:text-[#E6EFFC]">
                    {a.examTitle}
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
        )
      ) : filteredExams.length === 0 ? (
        <GlassSurface className="rounded-3xl p-8 text-center space-y-2 text-sm text-slate-600 dark:text-slate-300">
          <BookOpen className="w-8 h-8 text-sky-600 dark:text-sky-400 mx-auto" />
          <p className="font-semibold text-[#16243E] dark:text-[#E6EFFC]">
            Chưa có đề kiểm tra được xuất bản cho bộ lọc này
          </p>
          <p className="text-xs">
            Quản trị viên có thể tạo & duyệt ma trận đề thi mới tại mục Quản trị hệ thống → Quản
            trị Đề kiểm tra.
          </p>
        </GlassSurface>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {filteredExams.map((exam) => {
            const bestPct = bestScoreByExam.get(exam.examId);
            return (
              <LiquidCard key={exam.examId} className="exam-card rounded-3xl p-6 flex flex-col justify-between gap-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-semibold text-sky-700 dark:text-sky-400">
                      {EXAM_TYPE_LABELS[exam.examType]}
                    </span>
                    <span className="font-mono text-[#475B78] dark:text-[#B4C7E2]">
                      Khối {exam.grade} · {SUBJECT_LABELS[exam.subject]}
                    </span>
                  </div>
                  <h2 className="font-display text-lg font-bold text-[#16243E] dark:text-[#E6EFFC]">
                    {exam.title}
                  </h2>
                  <p className="text-xs text-[#475B78] dark:text-[#B4C7E2] leading-[1.6]">
                    {exam.description || `Bộ sách ${exam.textbookSeries} · Năm học ${exam.academicYear}`}
                  </p>
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
      )}
    </div>
  );
};
