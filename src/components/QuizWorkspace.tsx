import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Bookmark,
  CheckCircle2,
  Flag,
  HelpCircle,
  Info,
  Loader2,
  RotateCcw,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { gsap, MOTION_ALLOWED_MEDIA, useGSAP } from '../lib/gsapSetup';
import {
  SUBJECT_LABELS,
  type AnalysisRecord,
  type CognitiveLevel,
  type FeedbackEntry,
  type QuizDifficulty,
  type QuizQuestion,
  type QuizScope,
  type QuizSet,
  type ReferenceChunk,
} from '../core/types';
import { authorizedFetch, parseApiResponse } from '../services/apiClient';
import {
  flagQuizQuestionForReview,
  listReferenceChunksForBook,
  listUserQuizSets,
  recordQuizAttemptAndProgress,
  saveQuizSet,
  saveWrongAnswerToPracticeBank,
  submitFeedback,
} from '../services/firestoreService';
import { GlassSurface } from './LiquidGlass/GlassSurface';
import { WaterRippleButton } from './LiquidGlass/WaterRippleButton';

interface QuizWorkspaceProps {
  sourceAnalysis?: AnalysisRecord | null;
  onOpenPracticeBank: () => void;
}

const COGNITIVE_LABELS: Record<CognitiveLevel, string> = {
  nhan_biet: 'Nhận biết',
  thong_hieu: 'Thông hiểu',
  van_dung: 'Vận dụng',
  van_dung_cao: 'Vận dụng cao',
};

const QUIZ_FEEDBACK_CATEGORIES: FeedbackEntry['category'][] = [
  'Câu hỏi sai kiến thức',
  'Đáp án gây nhiễu lỗi',
  'Giải thích chưa đúng',
  'Ngoài phạm vi',
  'Khó hiểu',
];

export const QuizWorkspace: React.FC<QuizWorkspaceProps> = ({
  sourceAnalysis,
  onOpenPracticeBank,
}) => {
  const quizRef = useRef<HTMLDivElement>(null);
  const { user, systemStatus } = useAuth();
  const [savedQuizSets, setSavedQuizSets] = useState<QuizSet[]>([]);
  const [activeQuiz, setActiveQuiz] = useState<QuizSet | null>(null);

  // Generation config
  const [count, setCount] = useState<5 | 10 | 15 | 20>(10);
  const [difficulty, setDifficulty] = useState<QuizDifficulty>('mixed');
  const [scope, setScope] = useState<QuizScope>('all');
  const [chapterFilter, setChapterFilter] = useState('');
  const [advancedEnabled, setAdvancedEnabled] = useState(false);
  const [advancedCount, setAdvancedCount] = useState<1 | 2 | 3 | 4 | 5 | 6>(2);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Active quiz runner state
  const [sessionId] = useState(() => `sess_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
  const [answers, setAnswers] = useState<Record<string, 'A' | 'B' | 'C' | 'D'>>({});
  const [lastAnsweredId, setLastAnsweredId] = useState<string | null>(null);
  const [submittingQuestionId, setSubmittingQuestionId] = useState<string | null>(null);
  const [savedWrongCount, setSavedWrongCount] = useState(0);
  const [flaggedMap, setFlaggedMap] = useState<Record<string, boolean>>({});
  const [reportingQuestionId, setReportingQuestionId] = useState<string | null>(null);
  const [reportCategory, setReportCategory] = useState<FeedbackEntry['category']>('Câu hỏi sai kiến thức');
  const [reportNote, setReportNote] = useState('');
  const [reportSuccess, setReportSuccess] = useState<string | null>(null);

  const aiEnabled = systemStatus ? systemStatus.enabled : true;

  useEffect(() => {
    if (!user) return;
    listUserQuizSets(user.uid)
      .then((sets) => setSavedQuizSets(sets))
      .catch(() => setSavedQuizSets([]));
  }, [user]);

  const { contextSafe } = useGSAP(
    () => {
      if (!activeQuiz) return;
      const mm = gsap.matchMedia();
      mm.add(MOTION_ALLOWED_MEDIA, () => {
        gsap.from('.quiz-question-card', {
          y: 14,
          autoAlpha: 0,
          duration: 0.34,
          stagger: 0.05,
          ease: 'power2.out',
          clearProps: 'transform,opacity,visibility',
        });
      });
    },
    { scope: quizRef, dependencies: [activeQuiz?.quizSetId] }
  );

  useGSAP(
    () => {
      if (!lastAnsweredId) return;
      const mm = gsap.matchMedia();
      mm.add(MOTION_ALLOWED_MEDIA, () => {
        gsap.from(`[data-quiz-feedback="${lastAnsweredId}"]`, {
          y: 8,
          autoAlpha: 0,
          duration: 0.26,
          ease: 'power2.out',
          clearProps: 'transform,opacity,visibility',
        });
      });
    },
    { scope: quizRef, dependencies: [lastAnsweredId] }
  );

  const handleGenerateQuiz = async () => {
    if (!user || !sourceAnalysis) return;
    if (!aiEnabled) {
      setError(systemStatus?.maintenanceMessage || 'Dịch vụ tạo câu hỏi AI hiện đang tạm ngừng.');
      return;
    }

    setError(null);
    setGenerating(true);
    try {
      let referenceChunks: ReferenceChunk[] = [];
      if (sourceAnalysis.textbookReferenceId) {
        try {
          const allChunks = await listReferenceChunksForBook(sourceAnalysis.textbookReferenceId);
          referenceChunks = allChunks.slice(0, 12);
        } catch {
          referenceChunks = [];
        }
      }

      const res = await authorizedFetch('/api/ai/quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idempotencyKey: `${sourceAnalysis.analysisId}_${count}_${difficulty}_${scope}_${advancedEnabled ? advancedCount : 0}_${Date.now()}`,
          subject: sourceAnalysis.subject,
          grade: sourceAnalysis.grade,
          textbookTitle: sourceAnalysis.textbookTitle,
          claims: sourceAnalysis.claims,
          coverageItems: sourceAnalysis.coverageItems,
          referenceChunks,
          count,
          difficulty,
          scope,
          chapterFilter: chapterFilter.trim() || undefined,
          advancedEnabled,
          advancedCount: advancedEnabled ? advancedCount : 0,
        }),
      });
      const data = await parseApiResponse<any>(res, 'Không thể tạo bộ câu hỏi trắc nghiệm.');

      const newSet: QuizSet = {
        quizSetId: `quiz_${Date.now()}`,
        ownerUid: user.uid,
        analysisId: sourceAnalysis.analysisId,
        title: `Ôn tập: ${sourceAnalysis.documentTitle}`,
        subject: sourceAnalysis.subject,
        grade: sourceAnalysis.grade,
        difficulty,
        scope,
        questionCount: (data.questions || []).length,
        requestedCount: count,
        advancedEnabled,
        advancedCount: advancedEnabled ? advancedCount : 0,
        supplementedFromTextbook: Boolean(data.supplementedFromTextbook),
        supplementNotice: data.supplementNotice || undefined,
        modelUsed: data.modelUsed || undefined,
        questions: data.questions || [],
        createdAt: new Date().toISOString(),
      };

      await saveQuizSet(newSet);
      setSavedQuizSets((prev) => [newSet, ...prev]);
      setActiveQuiz(newSet);
      setAnswers({});
      setSavedWrongCount(0);
      setFlaggedMap({});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi tạo đề trắc nghiệm.');
    } finally {
      setGenerating(false);
    }
  };

  const handleSelectOption = contextSafe(
    async (
      question: QuizQuestion,
      choice: 'A' | 'B' | 'C' | 'D',
      btnEl?: HTMLButtonElement | null
    ) => {
      if (!user || !activeQuiz || answers[question.questionId]) return;
      if (btnEl) {
        const mm = gsap.matchMedia();
        mm.add(MOTION_ALLOWED_MEDIA, () => {
          gsap.fromTo(
            btnEl,
            { scale: 0.97 },
            { scale: 1, duration: 0.22, ease: 'power2.out', clearProps: 'transform' }
          );
        });
      }
      setSubmittingQuestionId(question.questionId);
      setLastAnsweredId(question.questionId);
      setAnswers((prev) => ({ ...prev, [question.questionId]: choice }));

      const isCorrect = choice === question.correctAnswer;
      try {
        await recordQuizAttemptAndProgress({
          uid: user.uid,
          question,
          quizSetId: activeQuiz.quizSetId,
          selectedAnswer: choice,
          sessionId,
          idempotencyAttemptId: `${sessionId}_${activeQuiz.quizSetId}_${question.questionId}`,
        });

        if (!isCorrect) {
          await saveWrongAnswerToPracticeBank(user.uid, question);
          setSavedWrongCount((c) => c + 1);
        }
      } catch (err) {
        console.error('Failed to persist quiz attempt:', err);
      } finally {
        setSubmittingQuestionId(null);
      }
    }
  );

  const handleToggleFlag = async (question: QuizQuestion) => {
    if (!user) return;
    try {
      const flagged = await flagQuizQuestionForReview(user.uid, question);
      setFlaggedMap((prev) => ({ ...prev, [question.questionId]: flagged }));
    } catch (err) {
      console.error('Flag question failed:', err);
    }
  };

  const handleReportQuestion = async (questionId: string) => {
    if (!user || !reportNote.trim()) return;
    try {
      const now = new Date().toISOString();
      await submitFeedback({
        feedbackId: `fbq_${user.uid}_${Date.now()}`,
        ownerUid: user.uid,
        ownerEmail: user.email || undefined,
        targetType: 'quiz_question',
        targetId: questionId,
        analysisId: activeQuiz?.analysisId,
        category: reportCategory,
        note: reportNote.trim(),
        status: 'pending',
        createdAt: now,
        updatedAt: now,
      });
      setReportingQuestionId(null);
      setReportNote('');
      setReportSuccess('Đã gửi báo lỗi câu hỏi cho Quản trị viên rà soát.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không gửi được phản hồi.');
    }
  };

  const answeredCount = activeQuiz ? Object.keys(answers).length : 0;
  const correctTotal = activeQuiz
    ? activeQuiz.questions.filter((q) => answers[q.questionId] === q.correctAnswer).length
    : 0;

  return (
    <div ref={quizRef} className="space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-[clamp(1.25rem,3.6vw,1.5rem)] font-bold text-[#16243E] dark:text-[#E6EFFC]">
            Trắc nghiệm củng cố kiến thức (ABCD)
          </h1>
          <p className="text-xs sm:text-sm text-[#475B78] dark:text-[#B4C7E2] mt-1 leading-[1.6] prose-measure">
            Mỗi câu trả lời sai hoặc đánh dấu xem lại sẽ tự động lưu vào Ngân hàng luyện tập theo
            lịch lặp lại ngắt quãng 1 / 3 / 7 ngày.
          </p>
        </div>

        {activeQuiz && (
          <WaterRippleButton
            variant="secondary"
            size="sm"
            onClick={() => {
              setActiveQuiz(null);
              setAnswers({});
              setLastAnsweredId(null);
              setReportSuccess(null);
            }}
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Chọn bộ câu hỏi khác
          </WaterRippleButton>
        )}
      </div>

      {error && (
        <div className="rounded-2xl border border-rose-200 dark:border-rose-800/70 bg-rose-50/90 dark:bg-rose-950/50 px-4 py-3 text-xs text-rose-800 dark:text-rose-200 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {reportSuccess && (
        <div className="rounded-2xl border border-emerald-200 dark:border-emerald-800/70 bg-emerald-50/90 dark:bg-emerald-950/40 px-4 py-3 text-xs text-emerald-800 dark:text-emerald-200">
          {reportSuccess}
        </div>
      )}

      {/* Configurator when launching from an analysis & no active quiz open */}
      {!activeQuiz && sourceAnalysis && (
        <GlassSurface className="rounded-3xl p-6 sm:p-7 space-y-5">
          <div>
            <p className="text-xs font-semibold text-sky-700 dark:text-sky-400">
              Tạo đề mới từ kết quả phân tích
            </p>
            <h2 className="font-display text-lg font-bold text-[#16243E] dark:text-[#E6EFFC] mt-0.5">
              {sourceAnalysis.documentTitle}
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
              {SUBJECT_LABELS[sourceAnalysis.subject]} · Lớp {sourceAnalysis.grade}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-1.5">
                Số câu hỏi cơ bản
              </label>
              <div className="glass-segment grid grid-cols-4 gap-1.5 p-1 rounded-xl">
                {([5, 10, 15, 20] as const).map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setCount(n)}
                    className={`py-2 rounded-lg font-mono text-xs font-semibold cursor-pointer transition-all ${
                      count === n
                        ? 'bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-sm'
                        : 'text-slate-700 dark:text-slate-200 hover:bg-white/60 dark:hover:bg-slate-800/60'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label htmlFor="quiz-diff" className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-1.5">
                Độ khó
              </label>
              <select
                id="quiz-diff"
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value as QuizDifficulty)}
                className="glass-control w-full px-3 py-2 rounded-xl text-sm text-[#16243E] dark:text-[#E6EFFC]"
              >
                <option value="mixed">Tổng hợp nhiều mức</option>
                <option value="basic">Cơ bản (Nhận biết)</option>
                <option value="medium">Trung bình (Thông hiểu)</option>
                <option value="advanced">Nâng cao (Vận dụng)</option>
              </select>
            </div>

            <div>
              <label htmlFor="quiz-scope" className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-1.5">
                Phạm vi tập trung
              </label>
              <select
                id="quiz-scope"
                value={scope}
                onChange={(e) => setScope(e.target.value as QuizScope)}
                className="glass-control w-full px-3 py-2 rounded-xl text-sm text-[#16243E] dark:text-[#E6EFFC]"
              >
                <option value="all">Toàn bộ nội dung đã phân tích</option>
                <option value="incorrect">Chỉ tập trung vào chỗ làm sai</option>
                <option value="missing">Chỉ tập trung vào phần còn thiếu</option>
                <option value="partial">Các phần thiếu điều kiện</option>
                <option value="chapter">Lọc theo chương cụ thể</option>
              </select>
            </div>
          </div>

          {scope === 'chapter' && (
            <div>
              <label htmlFor="quiz-chapter" className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-1.5">
                Tên chương muốn ôn tập
              </label>
              <input
                id="quiz-chapter"
                type="text"
                value={chapterFilter}
                onChange={(e) => setChapterFilter(e.target.value)}
                placeholder="Ví dụ: Chương 3"
                className="glass-control w-full px-3.5 py-2 rounded-xl text-sm text-[#16243E] dark:text-[#E6EFFC]"
              />
            </div>
          )}

          {/* Nâng cao Toggle + 1-6 External Questions Selector (Single Sky Accent) */}
          <div className="rounded-2xl border border-sky-200/85 dark:border-sky-800/60 bg-sky-50/60 dark:bg-sky-950/30 p-4 space-y-3">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={advancedEnabled}
                onChange={(e) => setAdvancedEnabled(e.target.checked)}
                className="mt-1 h-4 w-4 accent-sky-600"
              />
              <div className="text-xs">
                <p className="font-semibold text-[#16243E] dark:text-[#E6EFFC] flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                  Bổ sung câu Nâng cao bên ngoài (Vận dụng / Vận dụng cao)
                </p>
                <p className="text-[#475B78] dark:text-[#B4C7E2] mt-0.5 leading-[1.6]">
                  Tạo thêm 1 đến 6 câu trắc nghiệm nâng cao mở rộng từ chương trình chuẩn bên ngoài
                  tài liệu tải lên để rèn kỹ năng giải quyết vấn đề.
                </p>
              </div>
            </label>

            {advancedEnabled && (
              <div className="pl-7 flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-slate-700 dark:text-slate-200">
                  Số câu nâng cao thêm:
                </span>
                {([1, 2, 3, 4, 5, 6] as const).map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setAdvancedCount(n)}
                    className={`w-9 h-9 rounded-xl font-mono text-xs font-semibold border cursor-pointer transition-colors ${
                      advancedCount === n
                        ? 'bg-sky-600 text-white border-sky-600 shadow-sm'
                        : 'glass-control text-slate-700 dark:text-slate-200'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="glass-panel-subtle rounded-2xl px-4 py-2.5 text-xs text-slate-700 dark:text-slate-300 flex items-start gap-2">
            <Info className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0 mt-0.5" />
            <span>
              Chế độ thích ứng thông minh: Nếu tài liệu bạn tải lên tạo được ít hơn 5 câu hỏi khác
              nhau, hệ thống tự động bổ sung từ kiến thức hoàn thiện của sách giáo khoa để đủ bộ đề.
            </span>
          </div>

          <WaterRippleButton
            size="lg"
            disabled={generating || !aiEnabled}
            onClick={handleGenerateQuiz}
          >
            {generating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Đang sinh bộ câu hỏi ABCD...
              </>
            ) : (
              <>
                <HelpCircle className="w-4 h-4" />
                Tạo {count} câu{advancedEnabled ? ` + ${advancedCount} câu nâng cao` : ''} trắc nghiệm
              </>
            )}
          </WaterRippleButton>
        </GlassSurface>
      )}

      {/* Active Quiz Runner */}
      {activeQuiz && (
        <div className="space-y-5">
          {activeQuiz.supplementedFromTextbook && activeQuiz.supplementNotice && (
            <div className="rounded-2xl border border-amber-200 dark:border-amber-800/70 bg-amber-50/85 dark:bg-amber-950/40 px-4 py-3 text-xs text-amber-950 dark:text-amber-200 flex items-start gap-2.5">
              <Info className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <span>{activeQuiz.supplementNotice}</span>
            </div>
          )}

          <GlassSurface className="rounded-3xl p-5 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-lg font-bold text-[#16243E] dark:text-[#E6EFFC]">
                {activeQuiz.title}
              </h2>
              <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
                Đã trả lời:{' '}
                <span className="font-mono font-semibold">
                  {answeredCount}/{activeQuiz.questions.length}
                </span>{' '}
                · Đúng:{' '}
                <span className="font-mono font-semibold text-emerald-700 dark:text-emerald-400">
                  {correctTotal}
                </span>
                {savedWrongCount > 0 && (
                  <>
                    {' '}
                    · Đã lưu{' '}
                    <span className="font-mono font-semibold text-amber-700 dark:text-amber-400">
                      {savedWrongCount}
                    </span>{' '}
                    câu sai vào Ngân hàng luyện tập
                  </>
                )}
              </p>
            </div>
            {savedWrongCount > 0 && (
              <WaterRippleButton variant="secondary" size="sm" onClick={onOpenPracticeBank}>
                Mở Ngân hàng luyện tập
              </WaterRippleButton>
            )}
          </GlassSurface>

          <div className="space-y-4">
            {activeQuiz.questions.map((q, idx) => {
              const chosen = answers[q.questionId];
              const isAnswered = Boolean(chosen);
              const isCorrect = chosen === q.correctAnswer;
              const isFlagged = Boolean(flaggedMap[q.questionId]);
              const isReporting = reportingQuestionId === q.questionId;
              const options: Array<{ key: 'A' | 'B' | 'C' | 'D'; text: string }> = [
                { key: 'A', text: q.optionA },
                { key: 'B', text: q.optionB },
                { key: 'C', text: q.optionC },
                { key: 'D', text: q.optionD },
              ];

              return (
                <GlassSurface key={q.questionId} className="quiz-question-card rounded-3xl p-4 sm:p-6 space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1 flex-1 min-w-[220px]">
                      <p className="text-xs font-mono text-sky-700 dark:text-sky-400 font-semibold">
                        Câu {idx + 1} · {q.chapter} · {q.concept}
                        {q.cognitiveLevel ? ` · ${COGNITIVE_LABELS[q.cognitiveLevel]}` : ''}
                        {q.isExternalAdvanced ? ' · Nâng cao mở rộng' : ''}
                      </p>
                      <h3 className="text-sm sm:text-base font-semibold text-[#16243E] dark:text-[#E6EFFC] leading-[1.6]">
                        {q.questionText}
                      </h3>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleToggleFlag(q)}
                        aria-label={isFlagged ? 'Bỏ đánh dấu xem lại' : 'Đánh dấu xem lại'}
                        className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border text-xs font-medium cursor-pointer transition-all ${
                          isFlagged
                            ? 'bg-amber-50/90 dark:bg-amber-950/50 border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-300'
                            : 'glass-control text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        <Bookmark className="w-3.5 h-3.5" />
                        {isFlagged ? 'Đã đánh dấu' : 'Đánh dấu xem lại'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setReportingQuestionId(isReporting ? null : q.questionId)}
                        aria-label="Báo lỗi câu hỏi"
                        className="glass-control inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs text-slate-600 dark:text-slate-300 hover:text-rose-600 cursor-pointer"
                      >
                        <Flag className="w-3.5 h-3.5" />
                        Báo lỗi
                      </button>
                    </div>
                  </div>

                  {isReporting && (
                    <div className="glass-panel-subtle rounded-2xl p-3 flex flex-wrap gap-2 text-xs">
                      <select
                        value={reportCategory}
                        onChange={(e) => setReportCategory(e.target.value as FeedbackEntry['category'])}
                        className="glass-control px-2.5 py-1.5 rounded-xl"
                      >
                        {QUIZ_FEEDBACK_CATEGORIES.map((cat) => (
                          <option key={cat} value={cat}>
                            {cat}
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        value={reportNote}
                        onChange={(e) => setReportNote(e.target.value)}
                        placeholder="Mô tả lỗi sai của câu hỏi..."
                        className="glass-control flex-1 min-w-[180px] px-2.5 py-1.5 rounded-xl"
                      />
                      <button
                        type="button"
                        disabled={!reportNote.trim()}
                        onClick={() => handleReportQuestion(q.questionId)}
                        className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 text-white font-semibold disabled:opacity-50 cursor-pointer"
                      >
                        Gửi
                      </button>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {options.map((opt) => {
                      const isThisChosen = chosen === opt.key;
                      const isThisCorrect = q.correctAnswer === opt.key;

                      let btnStyle =
                        'glass-control text-[#16243E] dark:text-[#E6EFFC]';
                      if (isAnswered) {
                        if (isThisCorrect) {
                          btnStyle =
                            'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-400 dark:border-emerald-700 text-emerald-950 dark:text-emerald-200 font-semibold';
                        } else if (isThisChosen && !isThisCorrect) {
                          btnStyle =
                            'bg-rose-50 dark:bg-rose-950/60 border-rose-400 dark:border-rose-700 text-rose-950 dark:text-rose-200';
                        } else {
                          btnStyle =
                            'bg-white/50 dark:bg-slate-900/40 border-sky-200/50 dark:border-slate-800 text-slate-500 dark:text-slate-400';
                        }
                      }

                      return (
                        <button
                          key={opt.key}
                          type="button"
                          disabled={isAnswered || submittingQuestionId === q.questionId}
                          onClick={(e) => handleSelectOption(q, opt.key, e.currentTarget)}
                          className={`min-h-[44px] text-left px-3.5 sm:px-4 py-3 rounded-xl border text-xs sm:text-sm transition-colors flex items-start justify-between gap-2.5 cursor-pointer disabled:cursor-default ${btnStyle}`}
                        >
                          <span className="flex items-start gap-2.5">
                            <span className="font-mono font-bold shrink-0">{opt.key}.</span>
                            <span>{opt.text}</span>
                          </span>
                          {isAnswered && isThisCorrect && (
                            <CheckCircle2
                              aria-label="Đáp án đúng"
                              className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5"
                            />
                          )}
                          {isAnswered && isThisChosen && !isThisCorrect && (
                            <XCircle
                              aria-label="Lựa chọn chưa đúng"
                              className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5"
                            />
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {isAnswered && (
                    <div
                      data-quiz-feedback={q.questionId}
                      className={`rounded-2xl p-4 text-xs leading-[1.6] border space-y-2 ${
                        isCorrect
                          ? 'bg-emerald-50/85 dark:bg-emerald-950/45 border-emerald-200 dark:border-emerald-800 text-emerald-950 dark:text-emerald-200'
                          : 'bg-rose-50/85 dark:bg-rose-950/45 border-rose-200 dark:border-rose-800 text-rose-950 dark:text-rose-200'
                      }`}
                    >
                      <div className="flex items-center gap-2 font-semibold">
                        {isCorrect ? (
                          <>
                            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                            <span>Chính xác!</span>
                          </>
                        ) : (
                          <>
                            <XCircle className="w-4 h-4 text-rose-600 dark:text-rose-400" />
                            <span>
                              Chưa đúng (Đáp án chuẩn: {q.correctAnswer}). Câu hỏi đã được lưu vào
                              Ngân hàng luyện tập.
                            </span>
                          </>
                        )}
                      </div>
                      <p className="text-slate-800 dark:text-slate-200">{q.explanation}</p>

                      {q.distractorExplanations && (
                        <div className="pt-2 border-t border-slate-200/70 dark:border-slate-700/70 grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[11px] text-slate-700 dark:text-slate-300">
                          {(['A', 'B', 'C', 'D'] as const).map((k) =>
                            q.distractorExplanations?.[k] ? (
                              <p key={k}>
                                <strong className="font-mono">{k}:</strong>{' '}
                                {q.distractorExplanations[k]}
                              </p>
                            ) : null
                          )}
                        </div>
                      )}

                      {q.sourceReference && (
                        <p className="font-mono text-[11px] text-slate-600 dark:text-slate-400">
                          Nguồn tham chiếu: {q.sourceReference}
                        </p>
                      )}
                    </div>
                  )}
                </GlassSurface>
              );
            })}
          </div>
        </div>
      )}

      {/* Saved Quiz Sets */}
      {!activeQuiz && (
        <div className="glass-surface rounded-3xl p-6 space-y-4">
          <h2 className="font-display text-base font-bold text-[#16243E] dark:text-[#E6EFFC]">
            Bộ câu hỏi trắc nghiệm đã lưu ({savedQuizSets.length})
          </h2>
          {savedQuizSets.length === 0 ? (
            <p className="text-xs text-slate-600 dark:text-slate-300">
              Chưa có bộ trắc nghiệm nào. Hãy mở một bài phân tích bất kỳ và chọn “Tạo bài tập trắc
              nghiệm ôn tập”.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {savedQuizSets.map((set) => (
                <button
                  key={set.quizSetId}
                  type="button"
                  onClick={() => {
                    setActiveQuiz(set);
                    setAnswers({});
                    setSavedWrongCount(0);
                    setFlaggedMap({});
                  }}
                  className="text-left document-paper rounded-2xl p-4 hover:border-sky-400 transition-colors cursor-pointer"
                >
                  <p className="text-sm font-semibold text-[#16243E] dark:text-[#E6EFFC] truncate">
                    {set.title}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    {SUBJECT_LABELS[set.subject]} · Lớp {set.grade} · {set.questionCount} câu ·{' '}
                    {new Date(set.createdAt).toLocaleDateString('vi-VN')}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
