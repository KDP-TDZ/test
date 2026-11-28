import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Info,
  Repeat,
} from 'lucide-react';
import {
  SUBJECT_LABELS,
  type AnalysisRecord,
  type KnowledgeProgress,
  type MasteryStatus,
  type QuizAttempt,
  type SubjectId,
} from '../core/types';
import { GlassSurface } from './LiquidGlass/GlassSurface';
import { WaterRippleButton } from './LiquidGlass/WaterRippleButton';

interface LearningAnalyticsViewProps {
  progressList: KnowledgeProgress[];
  quizAttempts: QuizAttempt[];
  analyses: AnalysisRecord[];
  onJumpToPractice: () => void;
  onStartUpload: () => void;
}

const MASTERY_BADGE: Record<MasteryStatus, string> = {
  'Tạm nắm vững': 'text-emerald-700 dark:text-emerald-400',
  'Đang củng cố': 'text-sky-800 dark:text-sky-300',
  'Cần ôn tập': 'text-rose-700 dark:text-rose-400',
  'Đã học qua': 'text-sky-700 dark:text-sky-400',
  'Đã tiếp cận': 'text-[#475B78] dark:text-[#B4C7E2]',
};

export const LearningAnalyticsView: React.FC<LearningAnalyticsViewProps> = ({
  progressList,
  quizAttempts,
  analyses,
  onJumpToPractice,
  onStartUpload,
}) => {
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | '90d' | 'all'>('30d');
  const [selectedSubject, setSelectedSubject] = useState<SubjectId | 'all'>('all');
  const [selectedChapter, setSelectedChapter] = useState<string | null>(null);

  const summary = useMemo(() => {
    const mastered = progressList.filter((p) => p.masteryStatus === 'Tạm nắm vững').length;
    const reinforcing = progressList.filter((p) => p.masteryStatus === 'Đang củng cố').length;
    const needsReview = progressList.filter((p) => p.masteryStatus === 'Cần ôn tập').length;
    const studiedOrSeen = progressList.filter(
      (p) => p.masteryStatus === 'Đã học qua' || p.masteryStatus === 'Đã tiếp cận'
    ).length;

    const totalAttempts = quizAttempts.length;
    const correctAttempts = quizAttempts.filter((a) => a.isCorrect).length;
    const avgQuizAccuracy =
      totalAttempts > 0 ? Math.round((correctAttempts / totalAttempts) * 1000) / 10 : null;

    return {
      totalConcepts: progressList.length,
      mastered,
      reinforcing,
      needsReview,
      studiedOrSeen,
      totalAttempts,
      avgQuizAccuracy,
    };
  }, [progressList, quizAttempts]);

  const subjectStats = useMemo(() => {
    const map = new Map<
      SubjectId,
      { subject: SubjectId; total: number; mastered: number; needsReview: number; attempts: number; correct: number }
    >();
    for (const item of progressList) {
      const cur = map.get(item.subjectId) || {
        subject: item.subjectId,
        total: 0,
        mastered: 0,
        needsReview: 0,
        attempts: 0,
        correct: 0,
      };
      cur.total += 1;
      if (item.masteryStatus === 'Tạm nắm vững') cur.mastered += 1;
      if (item.masteryStatus === 'Cần ôn tập') cur.needsReview += 1;
      cur.attempts += item.practiceAttemptCount;
      cur.correct += item.correctAttempts;
      map.set(item.subjectId, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [progressList]);

  const filteredConcepts = useMemo(() => {
    return progressList.filter((p) => {
      if (selectedSubject !== 'all' && p.subjectId !== selectedSubject) return false;
      if (selectedChapter && p.chapterId !== selectedChapter) return false;
      return true;
    });
  }, [progressList, selectedSubject, selectedChapter]);

  const chaptersForSubject = useMemo(() => {
    const map = new Map<string, { chapter: string; total: number; mastered: number; needsReview: number }>();
    for (const p of progressList) {
      if (selectedSubject !== 'all' && p.subjectId !== selectedSubject) continue;
      const cur = map.get(p.chapterId) || {
        chapter: p.chapterId,
        total: 0,
        mastered: 0,
        needsReview: 0,
      };
      cur.total += 1;
      if (p.masteryStatus === 'Tạm nắm vững') cur.mastered += 1;
      if (p.masteryStatus === 'Cần ôn tập') cur.needsReview += 1;
      map.set(p.chapterId, cur);
    }
    return Array.from(map.values());
  }, [progressList, selectedSubject]);

  const timelineSeries = useMemo(() => {
    const now = Date.now();
    const cutoffMs =
      timeRange === '7d'
        ? now - 7 * 86400_000
        : timeRange === '30d'
        ? now - 30 * 86400_000
        : timeRange === '90d'
        ? now - 90 * 86400_000
        : 0;

    const bucket = new Map<string, { date: string; total: number; correct: number }>();
    for (const a of quizAttempts) {
      const ts = new Date(a.attemptedAt).getTime();
      if (ts < cutoffMs) continue;
      const day = a.attemptedAt.slice(0, 10);
      const cur = bucket.get(day) || { date: day, total: 0, correct: 0 };
      cur.total += 1;
      if (a.isCorrect) cur.correct += 1;
      bucket.set(day, cur);
    }
    return Array.from(bucket.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [quizAttempts, timeRange]);

  const docScoreSeries = useMemo(() => {
    const now = Date.now();
    const cutoffMs =
      timeRange === '7d'
        ? now - 7 * 86400_000
        : timeRange === '30d'
        ? now - 30 * 86400_000
        : timeRange === '90d'
        ? now - 90 * 86400_000
        : 0;

    return analyses
      .filter((a) => new Date(a.createdAt).getTime() >= cutoffMs)
      .slice()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(-12);
  }, [analyses, timeRange]);

  const weakConcepts = useMemo(
    () =>
      progressList
        .filter((p) => p.masteryStatus === 'Cần ôn tập')
        .sort((a, b) => b.incorrectAttempts - a.incorrectAttempts),
    [progressList]
  );

  if (progressList.length === 0 && quizAttempts.length === 0) {
    return (
      <GlassSurface className="rounded-3xl p-8 sm:p-10 text-center space-y-4">
        <svg viewBox="0 0 112 80" className="w-28 h-20 mx-auto" aria-hidden="true">
          <rect x="8" y="8" width="96" height="64" rx="14" className="fill-[#F1F5FA] dark:fill-[#0D1628]" />
          <rect x="24" y="44" width="12" height="18" rx="4" className="fill-[#BFDBFE] dark:fill-[#1E3A8A]" />
          <rect x="42" y="34" width="12" height="28" rx="4" className="fill-[#60A5FA] dark:fill-[#2563EB]" />
          <rect x="60" y="24" width="12" height="38" rx="4" className="fill-[#2563EB] dark:fill-[#3B82F6]" />
          <rect x="78" y="18" width="12" height="44" rx="4" className="fill-[#059669]" />
          <path d="M22 38 L48 28 L66 19 L84 13" fill="none" stroke="#F5A623" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="84" cy="13" r="3.5" fill="#F5A623" />
        </svg>
        <h1 className="font-display text-2xl font-bold text-[#172033] dark:text-[#E6EFFC]">
          Thống kê kiến thức đã học
        </h1>
        <p className="text-sm text-[#525E75] dark:text-[#94A3B8] max-w-lg mx-auto">
          Bạn chưa có dữ liệu khái niệm nào được ghi nhận. Hãy kiểm định một tài liệu hoặc làm bài
          trắc nghiệm để hệ thống lập bản đồ kiến thức theo từng môn và chương.
        </p>
        <WaterRippleButton onClick={onStartUpload}>Kiểm định tài liệu đầu tiên</WaterRippleButton>
      </GlassSurface>
    );
  }

  return (
    <div className="space-y-7">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#16243E] dark:text-[#E6EFFC]">
            Thống kê kiến thức đã học
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 mt-1">
            Tổng hợp toàn bộ khái niệm đã tiếp cận từ tài liệu kiểm định và tiến độ làm trắc nghiệm
            qua nhiều phiên học.
          </p>
        </div>

        <div className="glass-segment inline-flex rounded-2xl p-1 text-xs font-medium self-start">
          {(
            [
              ['7d', '7 ngày'],
              ['30d', '30 ngày'],
              ['90d', '90 ngày'],
              ['all', 'Tất cả'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTimeRange(id)}
              className={`px-3 py-1.5 rounded-xl font-semibold cursor-pointer transition-all ${
                timeRange === id
                  ? 'bg-[#2563EB] text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-white/60 dark:hover:bg-slate-800/60'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Mastery Rule Transparency Banner */}
      <div className="glass-panel-subtle rounded-2xl px-4 py-3 text-xs text-sky-950 dark:text-sky-100 flex items-start gap-2.5">
        <Info className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0 mt-0.5" />
        <span>
          <strong>Quy tắc đánh giá “Tạm nắm vững”:</strong> Hệ thống không bao giờ đánh dấu nắm vững
          chỉ sau 1 câu trả lời đúng. Một khái niệm chỉ đạt <strong>Tạm nắm vững</strong> khi có ít
          nhất <strong>5 lần luyện tập</strong> qua tối thiểu <strong>2 phiên học khác nhau</strong>{' '}
          và đạt độ chính xác <strong>≥ 80%</strong> trong 5 lần gần nhất.
        </span>
      </div>

      {/* 7 Top Summary Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3 sm:gap-3.5">
        {[
          { label: 'Tổng khái niệm', val: summary.totalConcepts, cls: 'text-[#16243E] dark:text-[#E6EFFC]' },
          { label: 'Tạm nắm vững', val: summary.mastered, cls: 'text-emerald-700 dark:text-emerald-400' },
          { label: 'Đang củng cố', val: summary.reinforcing, cls: 'text-sky-800 dark:text-sky-300' },
          { label: 'Cần ôn tập', val: summary.needsReview, cls: 'text-rose-700 dark:text-rose-400' },
          { label: 'Đã tiếp cận / học qua', val: summary.studiedOrSeen, cls: 'text-sky-700 dark:text-sky-400' },
          { label: 'Câu trắc nghiệm đã làm', val: summary.totalAttempts, cls: 'text-[#16243E] dark:text-[#E6EFFC]' },
          {
            label: 'Đúng trắc nghiệm TB',
            val: summary.avgQuizAccuracy !== null ? `${summary.avgQuizAccuracy}%` : '—',
            cls: 'text-emerald-700 dark:text-emerald-400',
          },
        ].map((card) => (
          <GlassSurface key={card.label} className="rounded-3xl p-4">
            <p className="text-[11px] font-medium text-[#475B78] dark:text-[#B4C7E2]">{card.label}</p>
            <p className={`font-mono text-2xl font-bold tabular-nums mt-1 ${card.cls}`}>{card.val}</p>
          </GlassSurface>
        ))}
      </div>

      {/* Subject Breakdown + Interactive Chapter Map */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 glass-surface rounded-3xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-base font-bold text-[#16243E] dark:text-[#E6EFFC]">
              Mức độ theo môn học
            </h2>
            {selectedSubject !== 'all' && (
              <button
                type="button"
                onClick={() => {
                  setSelectedSubject('all');
                  setSelectedChapter(null);
                }}
                className="text-xs font-medium text-sky-700 dark:text-sky-400 hover:underline cursor-pointer"
              >
                Xem tất cả môn
              </button>
            )}
          </div>

          <div className="space-y-3">
            {subjectStats.map((st) => {
              const masteryPct = st.total > 0 ? Math.round((st.mastered / st.total) * 100) : 0;
              const active = selectedSubject === st.subject;
              return (
                <button
                  key={st.subject}
                  type="button"
                  onClick={() => {
                    setSelectedSubject(st.subject);
                    setSelectedChapter(null);
                  }}
                  className={`w-full text-left rounded-2xl p-3.5 border transition-all cursor-pointer ${
                    active
                      ? 'border-sky-400 bg-sky-50/85 dark:bg-sky-950/50 shadow-sm'
                      : 'glass-control'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs font-semibold text-[#16243E] dark:text-[#E6EFFC]">
                    <span>{SUBJECT_LABELS[st.subject]}</span>
                    <span className="font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                      {st.mastered}/{st.total} nắm vững ({masteryPct}%)
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-[#EAF2FF] dark:bg-slate-800 overflow-hidden mt-2">
                    <div
                      className="h-full bg-[#2563EB] dark:bg-[#3B82F6]"
                      style={{ width: `${Math.max(4, masteryPct)}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5">
                    Cần ôn: {st.needsReview} · Lượt làm câu hỏi: {st.attempts}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        <div className="lg:col-span-7 glass-surface rounded-3xl p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-base font-bold text-[#16243E] dark:text-[#E6EFFC] flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-sky-600 dark:text-sky-400" />
              Bản đồ chương học & Chi tiết khái niệm
            </h2>
            {selectedChapter && (
              <button
                type="button"
                onClick={() => setSelectedChapter(null)}
                className="text-xs font-medium text-sky-700 dark:text-sky-400 hover:underline cursor-pointer"
              >
                Hiện tất cả chương
              </button>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {chaptersForSubject.map((ch) => (
              <button
                key={ch.chapter}
                type="button"
                onClick={() => setSelectedChapter(selectedChapter === ch.chapter ? null : ch.chapter)}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium cursor-pointer transition-all ${
                  selectedChapter === ch.chapter
                    ? 'bg-[#2563EB] text-white shadow-sm'
                    : 'glass-control text-slate-700 dark:text-slate-200'
                }`}
              >
                {ch.chapter} ({ch.total})
              </button>
            ))}
          </div>

          <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
            {filteredConcepts.map((c) => (
              <div
                key={c.conceptId}
                className="document-paper rounded-2xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-[#16243E] dark:text-[#E6EFFC]">{c.conceptTitle}</p>
                  <p className="text-slate-500 dark:text-slate-400 mt-0.5">
                    {SUBJECT_LABELS[c.subjectId]} · {c.chapterId} · Gặp {c.encounteredCount} lần
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="font-mono text-slate-600 dark:text-slate-300 tabular-nums">
                    {c.practiceAttemptCount > 0
                      ? `${c.correctAttempts}/${c.practiceAttemptCount} đúng (${c.recentAccuracy ?? 0}%)`
                      : 'Chưa làm quiz'}
                  </span>
                  <span className={`text-[11px] font-semibold ${MASTERY_BADGE[c.masteryStatus]}`}>
                    {c.masteryStatus}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Time-Series Progress Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <GlassSurface className="rounded-3xl p-6 space-y-4">
          <h2 className="font-display text-base font-bold text-[#16243E] dark:text-[#E6EFFC]">
            Thống kê mệnh đề đã đối chiếu theo tài liệu
          </h2>
          {docScoreSeries.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Chưa có bài phân tích nào trong khoảng thời gian này.
            </p>
          ) : (
            <div className="space-y-2.5 max-h-44 overflow-y-auto pr-1">
              {docScoreSeries.map((d) => {
                const total = d.claims.length;
                const correctCount = d.claims.filter((c) => c.evaluationStatus === 'CORRECT').length;
                const issueCount = d.claims.filter(
                  (c) =>
                    c.evaluationStatus === 'INCORRECT' ||
                    c.evaluationStatus === 'PARTIALLY_CORRECT' ||
                    c.evaluationStatus === 'MISSING'
                ).length;
                const fillPct = total > 0 ? Math.round((correctCount / total) * 100) : 100;
                return (
                  <div key={d.analysisId} className="text-xs space-y-1">
                    <div className="flex items-center justify-between gap-2 text-slate-700 dark:text-slate-200">
                      <span className="font-medium truncate">{d.documentTitle}</span>
                      <span className="font-mono tabular-nums shrink-0 text-[11px]">
                        {correctCount}/{total} chuẩn · {issueCount} cần sửa
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-sky-100 dark:bg-slate-800 overflow-hidden">
                      <div
                        className="h-full bg-[#2563EB] dark:bg-[#3B82F6]"
                        style={{ width: `${Math.max(6, fillPct)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </GlassSurface>

        <GlassSurface className="rounded-3xl p-6 space-y-4">
          <h2 className="font-display text-base font-bold text-[#16243E] dark:text-[#E6EFFC]">
            Tiến độ luyện tập câu hỏi theo ngày
          </h2>
          {timelineSeries.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Chưa có lượt trả lời trắc nghiệm trong khoảng thời gian này.
            </p>
          ) : (
            <div className="space-y-2.5 max-h-44 overflow-y-auto pr-1">
              {timelineSeries.map((row) => {
                const pct = row.total > 0 ? Math.round((row.correct / row.total) * 100) : 0;
                return (
                  <div key={row.date} className="text-xs space-y-1">
                    <div className="flex items-center justify-between font-mono text-slate-700 dark:text-slate-200">
                      <span>{row.date}</span>
                      <span>
                        {row.correct}/{row.total} đúng ({pct}%)
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-sky-100 dark:bg-slate-800 overflow-hidden">
                      <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </GlassSurface>
      </div>

      {/* Weak Concepts + 1-click Practice Jump */}
      <GlassSurface className="rounded-3xl p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-base font-bold text-[#16243E] dark:text-[#E6EFFC] flex items-center gap-2">
              {weakConcepts.length > 0 ? (
                <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400" />
              ) : (
                <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              )}
              Kiến thức yếu / hay nhầm lẫn ({weakConcepts.length})
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
              Các khái niệm cần ưu tiên luyện tập lại trong Ngân hàng luyện tập.
            </p>
          </div>

          {weakConcepts.length > 0 && (
            <WaterRippleButton size="sm" onClick={onJumpToPractice}>
              <Repeat className="w-3.5 h-3.5" />
              Ôn tập ngay trong Ngân hàng
            </WaterRippleButton>
          )}
        </div>

        {weakConcepts.length === 0 ? (
          <p className="text-xs text-slate-600 dark:text-slate-300">
            Hiện chưa có khái niệm nào ở trạng thái “Cần ôn tập”. Tiếp tục duy trì luyện tập đa phiên!
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {weakConcepts.map((wc) => (
              <div
                key={wc.conceptId}
                className="rounded-xl bg-rose-50/70 dark:bg-rose-950/35 border border-rose-200 dark:border-rose-800/70 p-4 text-xs space-y-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-rose-950 dark:text-rose-200">
                    {wc.conceptTitle}
                  </span>
                  <span className="font-mono text-rose-700 dark:text-rose-400">
                    Sai {wc.incorrectAttempts} lần
                  </span>
                </div>
                <p className="text-slate-600 dark:text-slate-300">
                  {SUBJECT_LABELS[wc.subjectId]} · {wc.chapterId}
                </p>
                {wc.lastMistakeNote && (
                  <p className="text-slate-700 dark:text-slate-300 italic line-clamp-2">
                    “{wc.lastMistakeNote}”
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </GlassSurface>
    </div>
  );
};
