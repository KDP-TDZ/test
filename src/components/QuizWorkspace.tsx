import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  HelpCircle,
  Loader2,
  RotateCcw,
  XCircle,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  SUBJECT_LABELS,
  type AnalysisRecord,
  type QuizDifficulty,
  type QuizQuestion,
  type QuizScope,
  type QuizSet,
} from '../core/types';
import { authorizedFetch } from '../services/apiClient';
import {
  listUserQuizSets,
  recordQuizAttemptAndProgress,
  saveQuizSet,
  saveWrongAnswerToPracticeBank,
} from '../services/firestoreService';
import { GlassSurface } from './LiquidGlass/GlassSurface';
import { WaterRippleButton } from './LiquidGlass/WaterRippleButton';

interface QuizWorkspaceProps {
  sourceAnalysis?: AnalysisRecord | null;
  onOpenPracticeBank: () => void;
}

export const QuizWorkspace: React.FC<QuizWorkspaceProps> = ({
  sourceAnalysis,
  onOpenPracticeBank,
}) => {
  const { user, systemStatus } = useAuth();
  const [savedQuizSets, setSavedQuizSets] = useState<QuizSet[]>([]);
  const [activeQuiz, setActiveQuiz] = useState<QuizSet | null>(null);

  // Generation config
  const [count, setCount] = useState<5 | 10 | 15 | 20>(10);
  const [difficulty, setDifficulty] = useState<QuizDifficulty>('mixed');
  const [scope, setScope] = useState<QuizScope>('all');
  const [chapterFilter, setChapterFilter] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Active quiz runner state
  const [sessionId] = useState(() => `sess_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
  const [answers, setAnswers] = useState<Record<string, 'A' | 'B' | 'C' | 'D'>>({});
  const [submittingQuestionId, setSubmittingQuestionId] = useState<string | null>(null);
  const [savedWrongCount, setSavedWrongCount] = useState(0);

  const aiEnabled = systemStatus ? systemStatus.enabled : true;

  useEffect(() => {
    if (!user) return;
    listUserQuizSets(user.uid)
      .then((sets) => setSavedQuizSets(sets))
      .catch(() => setSavedQuizSets([]));
  }, [user]);

  const handleGenerateQuiz = async () => {
    if (!user || !sourceAnalysis) return;
    if (!aiEnabled) {
      setError(systemStatus?.maintenanceMessage || 'Dịch vụ tạo câu hỏi AI hiện đang tạm ngừng.');
      return;
    }

    setError(null);
    setGenerating(true);
    try {
      const res = await authorizedFetch('/api/ai/quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idempotencyKey: `${sourceAnalysis.analysisId}_${count}_${difficulty}_${scope}_${Date.now()}`,
          subject: sourceAnalysis.subject,
          grade: sourceAnalysis.grade,
          textbookTitle: sourceAnalysis.textbookTitle,
          claims: sourceAnalysis.claims,
          coverageItems: sourceAnalysis.coverageItems,
          count,
          difficulty,
          scope,
          chapterFilter: chapterFilter.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Không thể tạo bộ câu hỏi trắc nghiệm.');
      }

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
        questions: data.questions || [],
        createdAt: new Date().toISOString(),
      };

      await saveQuizSet(newSet);
      setSavedQuizSets((prev) => [newSet, ...prev]);
      setActiveQuiz(newSet);
      setAnswers({});
      setSavedWrongCount(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi tạo đề trắc nghiệm.');
    } finally {
      setGenerating(false);
    }
  };

  const handleSelectOption = async (question: QuizQuestion, choice: 'A' | 'B' | 'C' | 'D') => {
    if (!user || !activeQuiz || answers[question.questionId]) return;
    setSubmittingQuestionId(question.questionId);
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
  };

  const answeredCount = activeQuiz ? Object.keys(answers).length : 0;
  const correctTotal = activeQuiz
    ? activeQuiz.questions.filter((q) => answers[q.questionId] === q.correctAnswer).length
    : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-950">
            Trắc nghiệm củng cố kiến thức (ABCD)
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 mt-1">
            Mỗi câu trả lời sai sẽ tự động được lưu vào Ngân hàng luyện tập cá nhân để bạn ôn tập
            lại nhiều phiên.
          </p>
        </div>

        {activeQuiz && (
          <WaterRippleButton
            variant="secondary"
            size="sm"
            onClick={() => {
              setActiveQuiz(null);
              setAnswers({});
            }}
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Chọn bộ câu hỏi khác
          </WaterRippleButton>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-800 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Configurator when launching from an analysis & no active quiz open */}
      {!activeQuiz && sourceAnalysis && (
        <GlassSurface className="rounded-3xl p-6 sm:p-7 space-y-5">
          <div>
            <p className="text-xs font-semibold text-sky-700">Tạo đề mới từ kết quả phân tích</p>
            <h2 className="font-display text-lg font-bold text-slate-950 mt-0.5">
              {sourceAnalysis.documentTitle}
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              {SUBJECT_LABELS[sourceAnalysis.subject]} · Lớp {sourceAnalysis.grade}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">Số câu hỏi</label>
              <div className="grid grid-cols-4 gap-1.5">
                {([5, 10, 15, 20] as const).map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setCount(n)}
                    className={`py-2 rounded-xl font-mono text-xs font-semibold border cursor-pointer ${
                      count === n
                        ? 'bg-sky-600 text-white border-sky-600'
                        : 'bg-white text-slate-700 border-slate-200'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label htmlFor="quiz-diff" className="block text-xs font-medium text-slate-700 mb-1.5">
                Độ khó
              </label>
              <select
                id="quiz-diff"
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value as QuizDifficulty)}
                className="w-full px-3 py-2 rounded-xl bg-white border border-slate-200 text-sm"
              >
                <option value="mixed">Tổng hợp nhiều mức</option>
                <option value="basic">Cơ bản (Nhận biết)</option>
                <option value="medium">Trung bình (Thông hiểu)</option>
                <option value="advanced">Nâng cao (Vận dụng)</option>
              </select>
            </div>

            <div>
              <label htmlFor="quiz-scope" className="block text-xs font-medium text-slate-700 mb-1.5">
                Phạm vi tập trung
              </label>
              <select
                id="quiz-scope"
                value={scope}
                onChange={(e) => setScope(e.target.value as QuizScope)}
                className="w-full px-3 py-2 rounded-xl bg-white border border-slate-200 text-sm"
              >
                <option value="all">Toàn bộ nội dung đã phân tích</option>
                <option value="incorrect">Chỉ tập trung vào chỗ làm sai</option>
                <option value="missing">Chỉ tập trung vào phần còn thiếu</option>
                <option value="partial">Các phần đúng một phần</option>
                <option value="chapter">Lọc theo chương cụ thể</option>
              </select>
            </div>
          </div>

          {scope === 'chapter' && (
            <div>
              <label htmlFor="quiz-chapter" className="block text-xs font-medium text-slate-700 mb-1.5">
                Tên chương muốn ôn tập
              </label>
              <input
                id="quiz-chapter"
                type="text"
                value={chapterFilter}
                onChange={(e) => setChapterFilter(e.target.value)}
                placeholder="Ví dụ: Chương 3"
                className="w-full px-3.5 py-2 rounded-xl bg-white border border-slate-200 text-sm"
              />
            </div>
          )}

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
                Tạo bộ {count} câu hỏi trắc nghiệm
              </>
            )}
          </WaterRippleButton>
        </GlassSurface>
      )}

      {/* Active Quiz Runner */}
      {activeQuiz && (
        <div className="space-y-5">
          <GlassSurface className="rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-lg font-bold text-slate-950">{activeQuiz.title}</h2>
              <p className="text-xs text-slate-600 mt-0.5">
                Đã trả lời: <span className="font-mono font-semibold">{answeredCount}/{activeQuiz.questions.length}</span>{' '}
                · Đúng: <span className="font-mono font-semibold text-emerald-700">{correctTotal}</span>
                {savedWrongCount > 0 && (
                  <>
                    {' '}
                    · Đã lưu{' '}
                    <span className="font-mono font-semibold text-amber-700">{savedWrongCount}</span> câu
                    sai vào Ngân hàng luyện tập
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
              const options: Array<{ key: 'A' | 'B' | 'C' | 'D'; text: string }> = [
                { key: 'A', text: q.optionA },
                { key: 'B', text: q.optionB },
                { key: 'C', text: q.optionC },
                { key: 'D', text: q.optionD },
              ];

              return (
                <GlassSurface key={q.questionId} className="rounded-2xl p-6 space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="text-xs font-mono text-sky-700 font-semibold">
                        Câu {idx + 1} · {q.chapter} · {q.concept}
                      </p>
                      <h3 className="text-sm sm:text-base font-semibold text-slate-950 leading-relaxed">
                        {q.questionText}
                      </h3>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {options.map((opt) => {
                      const isThisChosen = chosen === opt.key;
                      const isThisCorrect = q.correctAnswer === opt.key;

                      let btnStyle = 'bg-white/85 border-slate-200 hover:border-sky-400 text-slate-800';
                      if (isAnswered) {
                        if (isThisCorrect) {
                          btnStyle = 'bg-emerald-50 border-emerald-400 text-emerald-950 font-semibold';
                        } else if (isThisChosen && !isThisCorrect) {
                          btnStyle = 'bg-rose-50 border-rose-400 text-rose-950';
                        } else {
                          btnStyle = 'bg-white/50 border-slate-200 text-slate-500';
                        }
                      }

                      return (
                        <button
                          key={opt.key}
                          type="button"
                          disabled={isAnswered || submittingQuestionId === q.questionId}
                          onClick={() => handleSelectOption(q, opt.key)}
                          className={`text-left px-4 py-3 rounded-xl border text-xs sm:text-sm transition-all flex items-start gap-2.5 cursor-pointer disabled:cursor-default ${btnStyle}`}
                        >
                          <span className="font-mono font-bold shrink-0">{opt.key}.</span>
                          <span>{opt.text}</span>
                        </button>
                      );
                    })}
                  </div>

                  {isAnswered && (
                    <div
                      className={`rounded-xl p-4 text-xs leading-relaxed border ${
                        isCorrect
                          ? 'bg-emerald-50/85 border-emerald-200 text-emerald-950'
                          : 'bg-rose-50/85 border-rose-200 text-rose-950'
                      }`}
                    >
                      <div className="flex items-center gap-2 font-semibold mb-1">
                        {isCorrect ? (
                          <>
                            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                            <span>Chính xác!</span>
                          </>
                        ) : (
                          <>
                            <XCircle className="w-4 h-4 text-rose-600" />
                            <span>
                              Chưa đúng (Đáp án chuẩn: {q.correctAnswer}). Câu hỏi đã được lưu vào Ngân
                              hàng luyện tập.
                            </span>
                          </>
                        )}
                      </div>
                      <p className="text-slate-800">{q.explanation}</p>
                      {q.sourceReference && (
                        <p className="mt-1.5 font-mono text-[11px] text-slate-600">
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

      {/* Saved Quiz Sets (accessible even when AI is disabled) */}
      {!activeQuiz && (
        <div className="glass-surface rounded-2xl p-6 space-y-4">
          <h2 className="font-display text-base font-bold text-slate-950">
            Bộ câu hỏi trắc nghiệm đã lưu ({savedQuizSets.length})
          </h2>
          {savedQuizSets.length === 0 ? (
            <p className="text-xs text-slate-600">
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
                  }}
                  className="text-left rounded-2xl bg-white/85 border border-slate-200 p-4 hover:border-sky-300 transition-colors cursor-pointer"
                >
                  <p className="text-sm font-semibold text-slate-900 truncate">{set.title}</p>
                  <p className="text-xs text-slate-500 mt-1">
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
