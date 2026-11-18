import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
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
  'Tạm nắm vững': 'text-emerald-700 bg-emerald-50 border-emerald-200',
  'Đang củng cố': 'text-indigo-700 bg-indigo-50 border-indigo-200',
  'Cần ôn tập': 'text-rose-700 bg-rose-50 border-rose-200',
  'Đã học qua': 'text-sky-700 bg-sky-50 border-sky-200',
  'Đã tiếp cận': 'text-slate-700 bg-slate-100 border-slate-200',
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
      .filter((a) => new Date(a.createdAt).getTime() >= cutoffMs && a.accuracyScore !== null)
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
        <BarChart3 className="w-10 h-10 text-sky-700 mx-auto" />
        <h1 className="font-display text-2xl font-bold text-slate-950">
          Thống kê kiến thức đã học
        </h1>
        <p className="text-sm text-slate-600 max-w-lg mx-auto">
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
          <h1 className="font-display text-2xl font-bold text-slate-950">
            Thống kê kiến thức đã học
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 mt-1">
            Tổng hợp toàn bộ khái niệm đã tiếp cận từ tài liệu kiểm định và tiến độ làm trắc nghiệm
            qua nhiều phiên học.
          </p>
        </div>

        <div className="inline-flex rounded-xl border border-slate-200 bg-white/85 p-1 text-xs font-medium self-start">
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
              className={`px-3 py-1.5 rounded-lg cursor-pointer ${
                timeRange === id ? 'bg-sky-600 text-white' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Mastery Rule Transparency Banner */}
      <div className="rounded-2xl border border-sky-200 bg-sky-50/80 px-4 py-3 text-xs text-sky-950 flex items-start gap-2.5">
        <Info className="w-4 h-4 text-sky-700 shrink-0 mt-0.5" />
        <span>
          <strong>Quy tắc đánh giá “Tạm nắm vững”:</strong> Hệ thống không bao giờ đánh dấu nắm vững
          chỉ sau 1 câu trả lời đúng. Một khái niệm chỉ đạt <strong>Tạm nắm vững</strong> khi có ít
          nhất <strong>5 lần luyện tập</strong> qua tối thiểu <strong>2 phiên học khác nhau</strong>{' '}
          và đạt độ chính xác <strong>≥ 80%</strong> trong 5 lần gần nhất.
        </span>
      </div>

      {/* 7 Top Summary Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3.5">
        {[
          { label: 'Tổng khái niệm', val: summary.totalConcepts, cls: 'text-slate-950' },
          { label: 'Tạm nắm vững', val: summary.mastered, cls: 'text-emerald-700' },
          { label: 'Đang củng cố', val: summary.reinforcing, cls: 'text-indigo-700' },
          { label: 'Cần ôn tập', val: summary.needsReview, cls: 'text-rose-700' },
          { label: 'Đã tiếp cận / học qua', val: summary.studiedOrSeen, cls: 'text-sky-700' },
          { label: 'Câu trắc nghiệm đã làm', val: summary.totalAttempts, cls: 'text-slate-950' },
          {
            label: 'Đúng trắc nghiệm TB',
            val: summary.avgQuizAccuracy !== null ? `${summary.avgQuizAccuracy}%` : '—',
            cls: 'text-emerald-700',
          },
        ].map((card) => (
          <GlassSurface key={card.label} className="rounded-2xl p-4">
            <p className="text-[11px] font-medium text-slate-500">{card.label}</p>
            <p className={`font-mono text-2xl font-bold tabular-nums mt-1 ${card.cls}`}>{card.val}</p>
          </GlassSurface>
        ))}
      </div>

      {/* Subject Breakdown + Interactive Chapter Map */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 glass-surface rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-base font-bold text-slate-950">Mức độ theo môn học</h2>
            {selectedSubject !== 'all' && (
              <button
                type="button"
                onClick={() => {
                  setSelectedSubject('all');
                  setSelectedChapter(null);
                }}
                className="text-xs text-sky-700 hover:underline cursor-pointer"
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
                  className={`w-full text-left rounded-xl p-3.5 border transition-colors cursor-pointer ${
                    active ? 'border-sky-500 bg-sky-50/80' : 'border-slate-200 bg-white/80 hover:bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-900">
                    <span>{SUBJECT_LABELS[st.subject]}</span>
                    <span className="font-mono tabular-nums text-emerald-700">
                      {st.mastered}/{st.total} nắm vững ({masteryPct}%)
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-200 overflow-hidden mt-2">
                    <div
                      className="h-full bg-gradient-to-r from-sky-500 to-emerald-500"
                      style={{ width: `${Math.max(4, masteryPct)}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1.5">
                    Cần ôn: {st.needsReview} · Lượt làm câu hỏi: {st.attempts}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        <div className="lg:col-span-7 glass-surface rounded-2xl p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-base font-bold text-slate-950 flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-indigo-700" />
              Bản đồ chương học & Chi tiết khái niệm
            </h2>
            {selectedChapter && (
              <button
                type="button"
                onClick={() => setSelectedChapter(null)}
                className="text-xs text-sky-700 hover:underline cursor-pointer"
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
                className={`px-3 py-1.5 rounded-xl text-xs font-medium border cursor-pointer ${
                  selectedChapter === ch.chapter
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
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
                className="rounded-xl bg-white/90 border border-slate-200 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900">{c.conceptTitle}</p>
                  <p className="text-slate-500 mt-0.5">
                    {SUBJECT_LABELS[c.subjectId]} · {c.chapterId} · Gặp {c.encounteredCount} lần
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="font-mono text-slate-600 tabular-nums">
                    {c.practiceAttemptCount > 0
                      ? `${c.correctAttempts}/${c.practiceAttemptCount} đúng (${c.recentAccuracy ?? 0}%)`
                      : 'Chưa làm quiz'}
                  </span>
                  <span
                    className={`px-2.5 py-0.5 rounded-md border text-[11px] font-semibold ${
                      MASTERY_BADGE[c.masteryStatus]
                    }`}
                  >
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
        <GlassSurface className="rounded-2xl p-6 space-y-4">
          <h2 className="font-display text-base font-bold text-slate-950">
            Xu hướng độ chính xác tài liệu kiểm định
          </h2>
          {docScoreSeries.length === 0 ? (
            <p className="text-xs text-slate-500">Chưa có bài phân tích nào trong khoảng thời gian này.</p>
          ) : (
            <div className="space-y-2">
              <svg viewBox="0 0 420 150" className="w-full h-40 overflow-visible">
                {[0, 25, 50, 75, 100].map((tick) => {
                  const y = 130 - (tick / 100) * 110;
                  return (
                    <g key={tick}>
                      <line x1={32} y1={y} x2={410} y2={y} stroke="#e2e8f0" strokeDasharray="3 3" />
                      <text x={0} y={y + 4} fontSize="10" fill="#64748b" fontFamily="monospace">
                        {tick}%
                      </text>
                    </g>
                  );
                })}
                {docScoreSeries.length > 1 && (
                  <polyline
                    fill="none"
                    stroke="#0284c7"
                    strokeWidth="2.5"
                    points={docScoreSeries
                      .map((d, i) => {
                        const x = 42 + (i / (docScoreSeries.length - 1)) * 355;
                        const y = 130 - ((d.accuracyScore ?? 0) / 100) * 110;
                        return `${x},${y}`;
                      })
                      .join(' ')}
                  />
                )}
                {docScoreSeries.map((d, i) => {
                  const x =
                    docScoreSeries.length === 1
                      ? 210
                      : 42 + (i / (docScoreSeries.length - 1)) * 355;
                  const y = 130 - ((d.accuracyScore ?? 0) / 100) * 110;
                  return (
                    <g key={d.analysisId}>
                      <circle cx={x} cy={y} r="4.5" fill="#0284c7" stroke="#ffffff" strokeWidth="1.5" />
                      <title>{`${d.documentTitle}: ${d.accuracyScore}%`}</title>
                    </g>
                  );
                })}
              </svg>
            </div>
          )}
        </GlassSurface>

        <GlassSurface className="rounded-2xl p-6 space-y-4">
          <h2 className="font-display text-base font-bold text-slate-950">
            Tiến độ luyện tập câu hỏi theo ngày
          </h2>
          {timelineSeries.length === 0 ? (
            <p className="text-xs text-slate-500">Chưa có lượt trả lời trắc nghiệm trong khoảng thời gian này.</p>
          ) : (
            <div className="space-y-2.5 max-h-44 overflow-y-auto pr-1">
              {timelineSeries.map((row) => {
                const pct = row.total > 0 ? Math.round((row.correct / row.total) * 100) : 0;
                return (
                  <div key={row.date} className="text-xs space-y-1">
                    <div className="flex items-center justify-between font-mono text-slate-700">
                      <span>{row.date}</span>
                      <span>
                        {row.correct}/{row.total} đúng ({pct}%)
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
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
      <GlassSurface className="rounded-2xl p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-base font-bold text-slate-950 flex items-center gap-2">
              {weakConcepts.length > 0 ? (
                <AlertTriangle className="w-5 h-5 text-rose-600" />
              ) : (
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              )}
              Kiến thức yếu / hay nhầm lẫn ({weakConcepts.length})
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
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
          <p className="text-xs text-slate-600">
            Hiện chưa có khái niệm nào ở trạng thái “Cần ôn tập”. Tiếp tục duy trì luyện tập đa phiên!
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {weakConcepts.map((wc) => (
              <div
                key={wc.conceptId}
                className="rounded-xl bg-rose-50/70 border border-rose-200 p-4 text-xs space-y-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-rose-950">{wc.conceptTitle}</span>
                  <span className="font-mono text-rose-700">Sai {wc.incorrectAttempts} lần</span>
                </div>
                <p className="text-slate-600">
                  {SUBJECT_LABELS[wc.subjectId]} · {wc.chapterId}
                </p>
                {wc.lastMistakeNote && (
                  <p className="text-slate-700 italic line-clamp-2">“{wc.lastMistakeNote}”</p>
                )}
              </div>
            ))}
          </div>
        )}
      </GlassSurface>
    </div>
  );
};
