import React, { useEffect, useMemo, useState } from 'react';
import {
  Bookmark,
  CalendarClock,
  CheckCircle2,
  Layers,
  Play,
  Plus,
  RotateCw,
  Search,
  Trash2,
  XCircle,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  SUBJECT_LABELS,
  type FlashcardItem,
  type GradeLevel,
  type KnowledgeUnitType,
  type MasteryStatus,
  type PracticeItem,
  type QuizQuestion,
  type SubjectId,
} from '../core/types';
import {
  deleteFlashcard,
  listUserFlashcards,
  manuallyDeletePracticeItem,
  recordPracticeRetryWithSchedule,
  recordQuizAttemptAndProgress,
  saveFlashcard,
  togglePracticeItemFlag,
  updateFlashcardMastery,
} from '../services/firestoreService';
import { GlassSurface } from './LiquidGlass/GlassSurface';
import { WaterRippleButton } from './LiquidGlass/WaterRippleButton';

interface PracticeBankViewProps {
  items: PracticeItem[];
  onItemsChange: (updated: PracticeItem[]) => void;
  initialSubTab?: 'bank' | 'sprint10' | 'flashcards';
}

const MASTERY_STYLES: Record<MasteryStatus, string> = {
  'Đã tiếp cận': 'text-slate-700 dark:text-slate-300',
  'Đã học qua': 'text-blue-700 dark:text-blue-400',
  'Đang củng cố': 'text-indigo-700 dark:text-indigo-400',
  'Cần ôn tập': 'text-rose-700 dark:text-rose-400',
  'Tạm nắm vững': 'text-emerald-700 dark:text-emerald-400',
};

const UNIT_LABELS: Record<KnowledgeUnitType, string> = {
  concept: 'Khái niệm',
  mechanism: 'Cơ chế',
  condition: 'Điều kiện',
  characteristic: 'Tính chất',
  formula: 'Công thức',
  problem_type: 'Dạng bài tập',
};

export const PracticeBankView: React.FC<PracticeBankViewProps> = ({
  items,
  onItemsChange,
  initialSubTab = 'bank',
}) => {
  const { user, profile } = useAuth();
  const [subTab, setSubTab] = useState<'bank' | 'sprint10' | 'flashcards'>(initialSubTab);

  // Bank filters
  const [search, setSearch] = useState('');
  const [subjectFilter, setSubjectFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [unitFilter, setUnitFilter] = useState<string>('all');
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [onlyDueToday, setOnlyDueToday] = useState(false);
  const [sortBy, setSortBy] = useState<'recent' | 'mistakes' | 'oldest'>('mistakes');

  const [practicingItem, setPracticingItem] = useState<PracticeItem | null>(null);
  const [selectedChoice, setSelectedChoice] = useState<'A' | 'B' | 'C' | 'D' | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [sessionId] = useState(() => `prac_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);

  // 10-question mistake sprint (0 AI calls)
  const [sprintQueue, setSprintQueue] = useState<PracticeItem[]>([]);
  const [sprintAnswers, setSprintAnswers] = useState<Record<string, 'A' | 'B' | 'C' | 'D'>>({});

  // Flashcard state
  const [flashcards, setFlashcards] = useState<FlashcardItem[]>([]);
  const [flashcardFilter, setFlashcardFilter] = useState<'all' | 'Mới tạo' | 'Đang ôn' | 'Đã nhớ'>('all');
  const [activeCardIndex, setActiveCardIndex] = useState(0);
  const [cardFlipped, setCardFlipped] = useState(false);
  const [showNewCardForm, setShowNewCardForm] = useState(false);
  const [newFront, setNewFront] = useState('');
  const [newBack, setNewBack] = useState('');
  const [newSubject, setNewSubject] = useState<SubjectId>('toan');
  const [newGrade, setNewGrade] = useState<GradeLevel>(profile?.grade || '10');
  const [newChapter, setNewChapter] = useState('Tổng hợp');

  useEffect(() => {
    setSubTab(initialSubTab);
  }, [initialSubTab]);

  useEffect(() => {
    if (!user) return;
    listUserFlashcards(user.uid)
      .then((cards) => setFlashcards(cards))
      .catch(() => setFlashcards([]));
  }, [user]);

  const nowIso = new Date().toISOString();
  const dueCount = useMemo(
    () => items.filter((i) => !i.nextReviewAt || i.nextReviewAt <= nowIso).length,
    [items, nowIso]
  );

  const filtered = useMemo(() => {
    const now = new Date().toISOString();
    return items
      .filter((item) => {
        if (subjectFilter !== 'all' && item.subject !== subjectFilter) return false;
        if (statusFilter !== 'all' && item.masteryStatus !== statusFilter) return false;
        if (unitFilter !== 'all' && item.knowledgeUnitType !== unitFilter) return false;
        if (onlyFlagged && !item.flaggedForReview) return false;
        if (onlyDueToday && item.nextReviewAt && item.nextReviewAt > now) return false;
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
  }, [items, subjectFilter, statusFilter, unitFilter, onlyFlagged, onlyDueToday, search, sortBy]);

  const filteredCards = useMemo(
    () =>
      flashcards.filter((c) => (flashcardFilter === 'all' ? true : c.masteryStatus === flashcardFilter)),
    [flashcards, flashcardFilter]
  );

  const currentCard = filteredCards[activeCardIndex] || null;

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
      await recordQuizAttemptAndProgress({
        uid: user.uid,
        question: syntheticQuestion,
        quizSetId: 'practice_bank',
        selectedAnswer: choice,
        sessionId,
        idempotencyAttemptId: `${sessionId}_${item.itemId}_${Date.now()}`,
      });

      const updatedItem = await recordPracticeRetryWithSchedule(item, isCorrect);
      // Update in state WITHOUT ever auto-deleting!
      onItemsChange(items.map((x) => (x.itemId === item.itemId ? updatedItem : x)));
      setPracticingItem(updatedItem);
    } catch (err) {
      console.error('Retry failed:', err);
    }
  };

  const handleToggleFlag = async (item: PracticeItem) => {
    try {
      const updated = await togglePracticeItemFlag(item);
      onItemsChange(items.map((x) => (x.itemId === item.itemId ? updated : x)));
    } catch (err) {
      console.error('Toggle flag failed:', err);
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

  const startSprint10 = () => {
    const now = new Date().toISOString();
    const prioritized = [...items].sort((a, b) => {
      const aDue = !a.nextReviewAt || a.nextReviewAt <= now ? 1 : 0;
      const bDue = !b.nextReviewAt || b.nextReviewAt <= now ? 1 : 0;
      if (aDue !== bDue) return bDue - aDue;
      return b.incorrectCount - a.incorrectCount;
    });
    setSprintQueue(prioritized.slice(0, 10));
    setSprintAnswers({});
    setSubTab('sprint10');
  };

  const handleSprintSelect = async (item: PracticeItem, choice: 'A' | 'B' | 'C' | 'D') => {
    if (!user || sprintAnswers[item.itemId]) return;
    setSprintAnswers((prev) => ({ ...prev, [item.itemId]: choice }));
    const isCorrect = choice === item.correctAnswer;
    try {
      const updated = await recordPracticeRetryWithSchedule(item, isCorrect);
      onItemsChange(items.map((x) => (x.itemId === item.itemId ? updated : x)));
    } catch {
      // Keep UI responsive
    }
  };

  const handleCreateManualCard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newFront.trim() || !newBack.trim()) return;
    const now = new Date().toISOString();
    const card: FlashcardItem = {
      flashcardId: `fc_${user.uid}_${Date.now()}`,
      ownerUid: user.uid,
      front: newFront.trim(),
      back: newBack.trim(),
      sourceReference: 'Tự tạo bởi học sinh',
      subject: newSubject,
      grade: newGrade,
      chapter: newChapter.trim() || 'Tổng hợp',
      concept: newFront.trim().slice(0, 80),
      cardType: 'concept',
      masteryStatus: 'Mới tạo',
      reviewStage: 0,
      nextReviewAt: new Date(Date.now() + 86400000).toISOString(),
      createdAt: now,
      updatedAt: now,
    };
    await saveFlashcard(card);
    setFlashcards((prev) => [card, ...prev]);
    setNewFront('');
    setNewBack('');
    setShowNewCardForm(false);
    setActiveCardIndex(0);
    setCardFlipped(false);
  };

  const handleRateCard = async (
    card: FlashcardItem,
    mastery: FlashcardItem['masteryStatus'],
    stage: 0 | 1 | 2 | 3
  ) => {
    await updateFlashcardMastery(card.flashcardId, mastery, stage);
    setFlashcards((prev) =>
      prev.map((c) =>
        c.flashcardId === card.flashcardId
          ? { ...c, masteryStatus: mastery, reviewStage: stage }
          : c
      )
    );
    setCardFlipped(false);
    setActiveCardIndex((idx) => (filteredCards.length > 1 ? (idx + 1) % filteredCards.length : 0));
  };

  const handleDeleteCard = async (flashcardId: string) => {
    await deleteFlashcard(flashcardId);
    setFlashcards((prev) => prev.filter((c) => c.flashcardId !== flashcardId));
    setActiveCardIndex(0);
    setCardFlipped(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#17243A] dark:text-[#E5EDF9]">
            Ngân hàng luyện tập & Thẻ ghi nhớ
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 mt-1">
            Ôn tập câu làm sai theo lịch 1 / 3 / 7 / 14 ngày (<strong>không tự động xóa</strong> khi
            làm đúng), làm bộ 10 câu nhanh (0 tốn lượt AI), và học Flashcard.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSubTab('bank')}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold border cursor-pointer ${
              subTab === 'bank'
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-[#17243A] dark:text-[#E5EDF9]'
            }`}
          >
            Câu hỏi lưu ({items.length}) · Đến hạn ({dueCount})
          </button>
          <button
            type="button"
            disabled={items.length === 0}
            onClick={startSprint10}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold border cursor-pointer disabled:opacity-50 ${
              subTab === 'sprint10'
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-[#17243A] dark:text-[#E5EDF9]'
            }`}
          >
            <Play className="w-3.5 h-3.5" />
            Làm bộ 10 câu từ câu sai
          </button>
          <button
            type="button"
            onClick={() => setSubTab('flashcards')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold border cursor-pointer ${
              subTab === 'flashcards'
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-[#17243A] dark:text-[#E5EDF9]'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            Thẻ Flashcard ({flashcards.length})
          </button>
        </div>
      </div>

      {/* SUBTAB 1: Question Bank + Spaced Repetition */}
      {subTab === 'bank' && (
        <>
          <GlassSurface className="rounded-2xl p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              <div className="relative lg:col-span-2">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Tìm câu hỏi, khái niệm, chương..."
                  className="w-full pl-9 pr-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-[#17243A] dark:text-[#E5EDF9]"
                />
              </div>

              <select
                value={subjectFilter}
                onChange={(e) => setSubjectFilter(e.target.value)}
                className="px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-[#17243A] dark:text-[#E5EDF9]"
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
                className="px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-[#17243A] dark:text-[#E5EDF9]"
              >
                <option value="all">Tất cả trạng thái</option>
                <option value="Cần ôn tập">Cần ôn tập</option>
                <option value="Đang củng cố">Đang củng cố</option>
                <option value="Tạm nắm vững">Tạm nắm vững</option>
              </select>

              <select
                value={unitFilter}
                onChange={(e) => setUnitFilter(e.target.value)}
                className="px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-[#17243A] dark:text-[#E5EDF9]"
              >
                <option value="all">Tất cả đơn vị kiến thức</option>
                {(Object.keys(UNIT_LABELS) as KnowledgeUnitType[]).map((k) => (
                  <option key={k} value={k}>
                    {UNIT_LABELS[k]}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-xs">
              <div className="flex flex-wrap items-center gap-4">
                <label className="inline-flex items-center gap-2 cursor-pointer text-slate-700 dark:text-slate-200">
                  <input
                    type="checkbox"
                    checked={onlyDueToday}
                    onChange={(e) => setOnlyDueToday(e.target.checked)}
                    className="h-4 w-4 accent-blue-600"
                  />
                  <CalendarClock className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                  Chỉ hiện câu đến hạn ôn hôm nay ({dueCount})
                </label>
                <label className="inline-flex items-center gap-2 cursor-pointer text-slate-700 dark:text-slate-200">
                  <input
                    type="checkbox"
                    checked={onlyFlagged}
                    onChange={(e) => setOnlyFlagged(e.target.checked)}
                    className="h-4 w-4 accent-amber-500"
                  />
                  <Bookmark className="w-3.5 h-3.5 text-amber-500" />
                  Đã đánh dấu xem lại
                </label>
              </div>

              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as 'recent' | 'mistakes' | 'oldest')}
                className="px-3 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-[#17243A] dark:text-[#E5EDF9]"
              >
                <option value="mistakes">Sai nhiều nhất trước</option>
                <option value="recent">Luyện gần đây nhất</option>
                <option value="oldest">Lưu cũ nhất trước</option>
              </select>
            </div>
          </GlassSurface>

          {/* Active Retry Panel */}
          {practicingItem && (
            <GlassSurface className="rounded-3xl p-6 border-2 border-blue-400/70 space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-mono text-blue-700 dark:text-blue-400 font-semibold">
                    Đang luyện lại · {SUBJECT_LABELS[practicingItem.subject]} ·{' '}
                    {practicingItem.chapter}
                  </p>
                  <h2 className="text-base font-bold text-[#17243A] dark:text-[#E5EDF9] mt-1">
                    {practicingItem.questionText}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setPracticingItem(null);
                    setSelectedChoice(null);
                  }}
                  className="text-xs text-slate-500 dark:text-slate-400 hover:text-[#17243A] dark:hover:text-[#E5EDF9] cursor-pointer shrink-0"
                >
                  Đóng
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {(['A', 'B', 'C', 'D'] as const).map((key) => {
                  const text = practicingItem[`option${key}`];
                  const isChosen = selectedChoice === key;
                  const isRight = practicingItem.correctAnswer === key;
                  let cls =
                    'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 hover:border-blue-400 text-[#17243A] dark:text-[#E5EDF9]';
                  if (selectedChoice) {
                    if (isRight)
                      cls =
                        'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-400 dark:border-emerald-700 text-emerald-950 dark:text-emerald-200 font-semibold';
                    else if (isChosen)
                      cls =
                        'bg-rose-50 dark:bg-rose-950/60 border-rose-400 dark:border-rose-700 text-rose-950 dark:text-rose-200';
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
                  className={`rounded-xl p-4 text-xs border space-y-1.5 ${
                    selectedChoice === practicingItem.correctAnswer
                      ? 'bg-emerald-50 dark:bg-emerald-950/45 border-emerald-200 dark:border-emerald-800 text-emerald-950 dark:text-emerald-200'
                      : 'bg-rose-50 dark:bg-rose-950/45 border-rose-200 dark:border-rose-800 text-rose-950 dark:text-rose-200'
                  }`}
                >
                  <div className="flex items-center gap-2 font-semibold">
                    {selectedChoice === practicingItem.correctAnswer ? (
                      <>
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                        <span>
                          Đúng rồi! Lịch ôn tiếp theo: sau {practicingItem.reviewIntervalDays || 1}{' '}
                          ngày. Câu hỏi vẫn được giữ lại để bạn chủ động quản lý.
                        </span>
                      </>
                    ) : (
                      <>
                        <XCircle className="w-4 h-4 text-rose-600 dark:text-rose-400" />
                        <span>
                          Chưa chính xác (Đáp án chuẩn: {practicingItem.correctAnswer}). Đã đặt lịch
                          ôn lại vào ngày mai (1 ngày).
                        </span>
                      </>
                    )}
                  </div>
                  <p className="text-slate-800 dark:text-slate-200">{practicingItem.explanation}</p>
                </div>
              )}
            </GlassSurface>
          )}

          {/* List */}
          {filtered.length === 0 ? (
            <GlassSurface className="rounded-2xl p-8 text-center text-sm text-slate-600 dark:text-slate-300">
              {items.length === 0
                ? 'Ngân hàng luyện tập hiện chưa có câu sai nào. Khi bạn làm sai hoặc đánh dấu xem lại trong phần trắc nghiệm, câu hỏi sẽ xuất hiện tại đây.'
                : 'Không tìm thấy câu hỏi nào khớp bộ lọc hiện tại.'}
            </GlassSurface>
          ) : (
            <div className="space-y-3">
              {filtered.map((item) => (
                <GlassSurface
                  key={item.itemId}
                  className="rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-semibold text-blue-700 dark:text-blue-400">
                        {SUBJECT_LABELS[item.subject]}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="text-slate-600 dark:text-slate-300">{item.concept}</span>
                      <span aria-hidden="true">·</span>
                      <span className={`font-semibold ${MASTERY_STYLES[item.masteryStatus]}`}>
                        {item.masteryStatus}
                      </span>
                      {item.nextReviewAt && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-slate-500 dark:text-slate-400">
                            Ôn lại: {new Date(item.nextReviewAt).toLocaleDateString('vi-VN')}
                          </span>
                        </>
                      )}
                    </div>
                    <p className="text-sm font-semibold text-[#17243A] dark:text-[#E5EDF9] line-clamp-2">
                      {item.questionText}
                    </p>
                    <p className="font-mono text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                      Số lần làm: {item.attemptCount} · Đúng: {item.correctCount} · Sai:{' '}
                      {item.incorrectCount}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleToggleFlag(item)}
                      aria-label={item.flaggedForReview ? 'Bỏ đánh dấu xem lại' : 'Đánh dấu xem lại'}
                      className={`p-2 rounded-lg border cursor-pointer ${
                        item.flaggedForReview
                          ? 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400'
                          : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      <Bookmark className="w-4 h-4" />
                    </button>
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
                      className="p-2 rounded-lg border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/50 cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </GlassSurface>
              ))}
            </div>
          )}
        </>
      )}

      {/* SUBTAB 2: 10-Question Mistake Sprint (0 AI calls) */}
      {subTab === 'sprint10' && (
        <div className="space-y-4">
          <GlassSurface className="rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-lg font-bold text-[#17243A] dark:text-[#E5EDF9]">
                Bộ {sprintQueue.length} câu ôn tập nhanh từ câu sai (Không tốn lượt AI)
              </h2>
              <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5 tabular-nums">
                Đã trả lời: {Object.keys(sprintAnswers).length}/{sprintQueue.length} · Đúng:{' '}
                {sprintQueue.filter((q) => sprintAnswers[q.itemId] === q.correctAnswer).length}
              </p>
            </div>
            <WaterRippleButton variant="secondary" size="sm" onClick={startSprint10}>
              Tạo lượt 10 câu mới
            </WaterRippleButton>
          </GlassSurface>

          {sprintQueue.map((item, idx) => {
            const chosen = sprintAnswers[item.itemId];
            const isAnswered = Boolean(chosen);
            const isRight = chosen === item.correctAnswer;
            return (
              <GlassSurface key={item.itemId} className="rounded-2xl p-5 space-y-3">
                <p className="text-xs font-mono text-blue-700 dark:text-blue-400 font-semibold">
                  Câu {idx + 1}/{sprintQueue.length} · {SUBJECT_LABELS[item.subject]} ·{' '}
                  {item.concept}
                </p>
                <p className="text-sm font-semibold text-[#17243A] dark:text-[#E5EDF9]">
                  {item.questionText}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {(['A', 'B', 'C', 'D'] as const).map((k) => {
                    let cls =
                      'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-[#17243A] dark:text-[#E5EDF9]';
                    if (isAnswered) {
                      if (k === item.correctAnswer)
                        cls =
                          'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-400 dark:border-emerald-700 text-emerald-950 dark:text-emerald-200 font-semibold';
                      else if (k === chosen)
                        cls =
                          'bg-rose-50 dark:bg-rose-950/60 border-rose-400 dark:border-rose-700 text-rose-950 dark:text-rose-200';
                    }
                    return (
                      <button
                        key={k}
                        type="button"
                        disabled={isAnswered}
                        onClick={() => handleSprintSelect(item, k)}
                        className={`text-left px-3.5 py-2.5 rounded-xl border text-xs flex items-start gap-2 cursor-pointer disabled:cursor-default ${cls}`}
                      >
                        <span className="font-mono font-bold">{k}.</span>
                        <span>{item[`option${k}`]}</span>
                      </button>
                    );
                  })}
                </div>
                {isAnswered && (
                  <p className="text-xs text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-900/70 rounded-xl p-3">
                    <strong>{isRight ? 'Chính xác!' : `Đáp án đúng: ${item.correctAnswer}.`}</strong>{' '}
                    {item.explanation}
                  </p>
                )}
              </GlassSurface>
            );
          })}
        </div>
      )}

      {/* SUBTAB 3: Flashcards Study Deck */}
      {subTab === 'flashcards' && (
        <div className="space-y-5">
          <GlassSurface className="rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {(['all', 'Mới tạo', 'Đang ôn', 'Đã nhớ'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => {
                    setFlashcardFilter(f);
                    setActiveCardIndex(0);
                    setCardFlipped(false);
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer ${
                    flashcardFilter === f
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200'
                  }`}
                >
                  {f === 'all' ? 'Tất cả thẻ' : f}
                </button>
              ))}
            </div>

            <WaterRippleButton
              size="sm"
              onClick={() => setShowNewCardForm((v) => !v)}
            >
              <Plus className="w-4 h-4" />
              Tạo thẻ thủ công
            </WaterRippleButton>
          </GlassSurface>

          {showNewCardForm && (
            <GlassSurface className="rounded-2xl p-5">
              <form onSubmit={handleCreateManualCard} className="space-y-3 text-xs">
                <h3 className="font-display text-sm font-bold text-[#17243A] dark:text-[#E5EDF9]">
                  Thêm thẻ ghi nhớ mới
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <select
                    value={newSubject}
                    onChange={(e) => setNewSubject(e.target.value as SubjectId)}
                    className="px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700"
                  >
                    {(Object.keys(SUBJECT_LABELS) as SubjectId[]).map((s) => (
                      <option key={s} value={s}>
                        {SUBJECT_LABELS[s]}
                      </option>
                    ))}
                  </select>
                  <select
                    value={newGrade}
                    onChange={(e) => setNewGrade(e.target.value as GradeLevel)}
                    className="px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700"
                  >
                    <option value="10">Lớp 10</option>
                    <option value="11">Lớp 11</option>
                    <option value="12">Lớp 12</option>
                  </select>
                  <input
                    type="text"
                    value={newChapter}
                    onChange={(e) => setNewChapter(e.target.value)}
                    placeholder="Tên chương / chủ đề"
                    className="px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <textarea
                    rows={3}
                    required
                    value={newFront}
                    onChange={(e) => setNewFront(e.target.value)}
                    placeholder="Mặt trước (Câu hỏi / Khái niệm / Công thức)..."
                    className="w-full p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700"
                  />
                  <textarea
                    rows={3}
                    required
                    value={newBack}
                    onChange={(e) => setNewBack(e.target.value)}
                    placeholder="Mặt sau (Đáp án chuẩn / Điều kiện áp dụng / Ví dụ)..."
                    className="w-full p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowNewCardForm(false)}
                    className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 cursor-pointer"
                  >
                    Hủy
                  </button>
                  <WaterRippleButton type="submit" size="sm">
                    Lưu thẻ ghi nhớ
                  </WaterRippleButton>
                </div>
              </form>
            </GlassSurface>
          )}

          {currentCard ? (
            <GlassSurface className="rounded-3xl p-6 sm:p-8 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-300">
                <span className="font-mono font-semibold">
                  Thẻ {activeCardIndex + 1} / {filteredCards.length} ·{' '}
                  {SUBJECT_LABELS[currentCard.subject]} · {currentCard.masteryStatus}
                </span>
                <button
                  type="button"
                  onClick={() => handleDeleteCard(currentCard.flashcardId)}
                  className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400 hover:underline cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Xóa thẻ này
                </button>
              </div>

              <button
                type="button"
                onClick={() => setCardFlipped((f) => !f)}
                className="w-full min-h-[210px] document-paper rounded-2xl p-6 sm:p-8 text-center flex flex-col items-center justify-center gap-3 hover:border-blue-400 transition-colors cursor-pointer"
              >
                <span className="text-[11px] font-mono uppercase tracking-wider text-blue-600 dark:text-blue-400">
                  {cardFlipped ? 'Mặt sau · Giải thích chuẩn' : 'Mặt trước · Chạm để lật thẻ'}
                </span>
                <p className="text-base sm:text-lg font-semibold text-[#17243A] dark:text-[#E5EDF9] max-w-2xl leading-relaxed whitespace-pre-wrap">
                  {cardFlipped ? currentCard.back : currentCard.front}
                </p>
                <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 mt-1">
                  <RotateCw className="w-3.5 h-3.5" />
                  {currentCard.sourceReference}
                </span>
              </button>

              <div className="flex flex-wrap items-center justify-center gap-2.5">
                <button
                  type="button"
                  onClick={() => handleRateCard(currentCard, 'Mới tạo', 0)}
                  className="px-4 py-2 rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 text-xs font-semibold text-rose-800 dark:text-rose-300 cursor-pointer"
                >
                  Chưa nhớ (Ôn lại sau 1 ngày)
                </button>
                <button
                  type="button"
                  onClick={() => handleRateCard(currentCard, 'Đang ôn', 1)}
                  className="px-4 py-2 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-xs font-semibold text-amber-800 dark:text-amber-300 cursor-pointer"
                >
                  Đang nhớ dần (Sau 3 ngày)
                </button>
                <button
                  type="button"
                  onClick={() => handleRateCard(currentCard, 'Đã nhớ', 2)}
                  className="px-4 py-2 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-xs font-semibold text-emerald-800 dark:text-emerald-300 cursor-pointer"
                >
                  Đã nắm chắc (Sau 7 ngày)
                </button>
              </div>
            </GlassSurface>
          ) : (
            <GlassSurface className="rounded-2xl p-8 text-center text-sm text-slate-600 dark:text-slate-300">
              Chưa có thẻ Flashcard nào. Bạn có thể tạo tự động từ nút “Tạo Flashcard từ điểm yếu”
              trong Báo cáo phân tích hoặc bấm “Tạo thẻ thủ công” ở trên.
            </GlassSurface>
          )}
        </div>
      )}

      {/* Manual Delete Confirmation Modal */}
      {confirmDeleteId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/45 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <GlassSurface className="w-full max-w-sm rounded-2xl p-6 space-y-4">
            <h3 className="font-display text-base font-bold text-[#17243A] dark:text-[#E5EDF9]">
              Xác nhận xóa câu hỏi luyện tập?
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              Thao tác này sẽ xóa thủ công câu hỏi khỏi Ngân hàng luyện tập của bạn. Dữ liệu thống kê
              kiến thức lịch sử vẫn được giữ nguyên.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteId(null)}
                className="px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer"
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
