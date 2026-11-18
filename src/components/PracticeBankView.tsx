import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Search,
  Trash2,
  XCircle,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  SUBJECT_LABELS,
  type MasteryStatus,
  type PracticeItem,
  type QuizQuestion,
  type SubjectId,
} from '../core/types';
import {
  manuallyDeletePracticeItem,
  recordPracticeRetry,
  recordQuizAttemptAndProgress,
} from '../services/firestoreService';
import { GlassSurface } from './LiquidGlass/GlassSurface';
import { WaterRippleButton } from './LiquidGlass/WaterRippleButton';

interface PracticeBankViewProps {
  items: PracticeItem[];
  onItemsChange: (updated: PracticeItem[]) => void;
}

const MASTERY_STYLES: Record<MasteryStatus, string> = {
  'Đã tiếp cận': 'text-slate-700',
  'Đã học qua': 'text-sky-700',
  'Đang củng cố': 'text-indigo-700',
  'Cần ôn tập': 'text-rose-700',
  'Tạm nắm vững': 'text-emerald-700',
};

export const PracticeBankView: React.FC<PracticeBankViewProps> = ({
  items,
  onItemsChange,
}) => {
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [subjectFilter, setSubjectFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'recent' | 'mistakes' | 'oldest'>('mistakes');

  const [practicingItem, setPracticingItem] = useState<PracticeItem | null>(null);
  const [selectedChoice, setSelectedChoice] = useState<'A' | 'B' | 'C' | 'D' | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [sessionId] = useState(() => `prac_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);

  const filtered = useMemo(() => {
    return items
      .filter((item) => {
        if (subjectFilter !== 'all' && item.subject !== subjectFilter) return false;
        if (statusFilter !== 'all' && item.masteryStatus !== statusFilter) return false;
        if (search.trim()) {
          const q = search.trim().toLowerCase();
          return (
            item.questionText.toLowerCase().includes(q) ||
            item.concept.toLowerCase().includes(q) ||
            item.chapter.toLowerCase().includes(q)
          );
        }
        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'mistakes') return b.incorrectCount - a.incorrectCount;
        if (sortBy === 'oldest') return a.createdAt.localeCompare(b.createdAt);
        return b.lastAttemptAt.localeCompare(a.lastAttemptAt);
      });
  }, [items, subjectFilter, statusFilter, search, sortBy]);

  const handleRetryAnswer = async (item: PracticeItem, choice: 'A' | 'B' | 'C' | 'D') => {
    if (!user || selectedChoice) return;
    setSelectedChoice(choice);
    const isCorrect = choice === item.correctAnswer;

    const syntheticQuestion: QuizQuestion = {
      questionId: item.questionId,
      questionText: item.questionText,
      optionA: item.optionA,
      optionB: item.optionB,
      optionC: item.optionC,
      optionD: item.optionD,
      correctAnswer: item.correctAnswer,
      explanation: item.explanation,
      difficulty: item.difficulty,
      subject: item.subject,
      grade: item.grade,
      chapter: item.chapter,
      concept: item.concept,
      sourceReference: item.sourceReference,
      createdAt: item.createdAt,
    };

    try {
      const updatedProgress = await recordQuizAttemptAndProgress({
        uid: user.uid,
        question: syntheticQuestion,
        quizSetId: 'practice_bank',
        selectedAnswer: choice,
        sessionId,
        idempotencyAttemptId: `${sessionId}_${item.itemId}_${Date.now()}`,
      });

      const updatedItem = await recordPracticeRetry(
        item,
        isCorrect,
        updatedProgress?.masteryStatus
      );

      // Update in state WITHOUT ever auto-deleting!
      onItemsChange(items.map((x) => (x.itemId === item.itemId ? updatedItem : x)));
      setPracticingItem(updatedItem);
    } catch (err) {
      console.error('Retry failed:', err);
    }
  };

  const handleConfirmDelete = async (itemId: string) => {
    await manuallyDeletePracticeItem(itemId);
    onItemsChange(items.filter((i) => i.itemId !== itemId));
    if (practicingItem?.itemId === itemId) {
      setPracticingItem(null);
      setSelectedChoice(null);
    }
    setConfirmDeleteId(null);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-950">
          Ngân hàng luyện tập câu làm sai
        </h1>
        <p className="text-xs sm:text-sm text-slate-600 mt-1">
          Các câu hỏi từng làm sai được lưu vĩnh viễn để ôn tập đa phiên. Khi bạn trả lời đúng lại,
          trạng thái tiến bộ được cập nhật nhưng câu hỏi{' '}
          <strong>không bao giờ bị tự động xóa</strong> cho đến khi bạn tự bấm xóa.
        </p>
      </div>

      {/* Filters & Search */}
      <GlassSurface className="rounded-2xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm câu hỏi, khái niệm..."
            className="w-full pl-9 pr-3 py-2 rounded-xl bg-white border border-slate-200 text-xs"
          />
        </div>

        <select
          value={subjectFilter}
          onChange={(e) => setSubjectFilter(e.target.value)}
          className="px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs"
        >
          <option value="all">Tất cả môn học</option>
          {(Object.keys(SUBJECT_LABELS) as SubjectId[]).map((s) => (
            <option key={s} value={s}>
              {SUBJECT_LABELS[s]}
            </option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs"
        >
          <option value="all">Tất cả trạng thái</option>
          <option value="Cần ôn tập">Cần ôn tập</option>
          <option value="Đang củng cố">Đang củng cố</option>
          <option value="Tạm nắm vững">Tạm nắm vững</option>
        </select>

        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as 'recent' | 'mistakes' | 'oldest')}
          className="px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs"
        >
          <option value="mistakes">Sai nhiều nhất trước</option>
          <option value="recent">Luyện gần đây nhất</option>
          <option value="oldest">Lưu cũ nhất trước</option>
        </select>
      </GlassSurface>

      {/* Active Retry Panel */}
      {practicingItem && (
        <GlassSurface className="rounded-3xl p-6 border-2 border-sky-300 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-mono text-sky-700 font-semibold">
                Đang luyện lại · {SUBJECT_LABELS[practicingItem.subject]} · {practicingItem.chapter}
              </p>
              <h2 className="text-base font-bold text-slate-950 mt-1">
                {practicingItem.questionText}
              </h2>
            </div>
            <button
              type="button"
              onClick={() => {
                setPracticingItem(null);
                setSelectedChoice(null);
              }}
              className="text-xs text-slate-500 hover:text-slate-900 cursor-pointer shrink-0"
            >
              Đóng
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {(['A', 'B', 'C', 'D'] as const).map((key) => {
              const text = practicingItem[`option${key}`];
              const isChosen = selectedChoice === key;
              const isRight = practicingItem.correctAnswer === key;
              let cls = 'bg-white border-slate-200 hover:border-sky-400 text-slate-800';
              if (selectedChoice) {
                if (isRight) cls = 'bg-emerald-50 border-emerald-400 text-emerald-950 font-semibold';
                else if (isChosen) cls = 'bg-rose-50 border-rose-400 text-rose-950';
              }
              return (
                <button
                  key={key}
                  type="button"
                  disabled={Boolean(selectedChoice)}
                  onClick={() => handleRetryAnswer(practicingItem, key)}
                  className={`text-left px-4 py-3 rounded-xl border text-xs sm:text-sm flex items-start gap-2 cursor-pointer disabled:cursor-default ${cls}`}
                >
                  <span className="font-mono font-bold">{key}.</span>
                  <span>{text}</span>
                </button>
              );
            })}
          </div>

          {selectedChoice && (
            <div
              className={`rounded-xl p-4 text-xs border ${
                selectedChoice === practicingItem.correctAnswer
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                  : 'bg-rose-50 border-rose-200 text-rose-950'
              }`}
            >
              <div className="flex items-center gap-2 font-semibold mb-1">
                {selectedChoice === practicingItem.correctAnswer ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span>
                      Đúng rồi! Thống kê đã cập nhật ({practicingItem.correctCount}/
                      {practicingItem.attemptCount} lần đúng). Câu hỏi vẫn được giữ lại trong Ngân
                      hàng để bạn chủ động quản lý.
                    </span>
                  </>
                ) : (
                  <>
                    <XCircle className="w-4 h-4 text-rose-600" />
                    <span>Chưa chính xác (Đáp án chuẩn: {practicingItem.correctAnswer}).</span>
                  </>
                )}
              </div>
              <p>{practicingItem.explanation}</p>
            </div>
          )}
        </GlassSurface>
      )}

      {/* List */}
      {filtered.length === 0 ? (
        <GlassSurface className="rounded-2xl p-8 text-center text-sm text-slate-600">
          {items.length === 0
            ? 'Ngân hàng luyện tập hiện chưa có câu sai nào. Khi bạn làm sai trong phần trắc nghiệm, câu hỏi sẽ xuất hiện tại đây.'
            : 'Không tìm thấy câu hỏi nào khớp bộ lọc hiện tại.'}
        </GlassSurface>
      ) : (
        <div className="space-y-3">
          {filtered.map((item) => (
            <GlassSurface key={item.itemId} className="rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-semibold text-sky-800">{SUBJECT_LABELS[item.subject]}</span>
                  <span aria-hidden="true">·</span>
                  <span className="text-slate-600">{item.concept}</span>
                  <span aria-hidden="true">·</span>
                  <span className={`font-semibold ${MASTERY_STYLES[item.masteryStatus]}`}>
                    {item.masteryStatus}
                  </span>
                </div>
                <p className="text-sm font-semibold text-slate-900 line-clamp-2">
                  {item.questionText}
                </p>
                <p className="font-mono text-[11px] text-slate-500 tabular-nums">
                  Số lần làm: {item.attemptCount} · Đúng: {item.correctCount} · Sai: {item.incorrectCount}
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <WaterRippleButton
                  size="sm"
                  onClick={() => {
                    setPracticingItem(item);
                    setSelectedChoice(null);
                  }}
                >
                  Luyện lại
                </WaterRippleButton>
                <button
                  type="button"
                  onClick={() => setConfirmDeleteId(item.itemId)}
                  aria-label="Xóa khỏi ngân hàng luyện tập"
                  className="p-2 rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50 cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </GlassSurface>
          ))}
        </div>
      )}

      {/* Manual Delete Confirmation Modal */}
      {confirmDeleteId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/35 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <GlassSurface className="w-full max-w-sm rounded-2xl p-6 space-y-4">
            <h3 className="font-display text-base font-bold text-slate-950">
              Xác nhận xóa câu hỏi luyện tập?
            </h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Thao tác này sẽ xóa thủ công câu hỏi khỏi Ngân hàng luyện tập của bạn. Dữ liệu thống kê
              kiến thức lịch sử vẫn được giữ nguyên.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteId(null)}
                className="px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-xs font-medium text-slate-700 cursor-pointer"
              >
                Hủy
              </button>
              <WaterRippleButton
                variant="danger"
                size="sm"
                onClick={() => handleConfirmDelete(confirmDeleteId)}
              >
                Xóa câu hỏi
              </WaterRippleButton>
            </div>
          </GlassSurface>
        </div>
      )}
    </div>
  );
};
