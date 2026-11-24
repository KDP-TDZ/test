import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  Award,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Lock,
  ShieldCheck,
  Trophy,
  XCircle,
} from 'lucide-react';

interface LandingWorkspacePreviewProps {
  onOpenAuth: (mode: 'login' | 'register') => void;
}

type ExamPartTab = 'part1_abcd' | 'part2_tf' | 'part3_short';
type LeaderboardScope = '10' | '11' | '12' | 'all';

interface TfSubStatement {
  id: 'a' | 'b' | 'c' | 'd';
  label: string;
  text: string;
  correctAnswer: boolean;
  explanation: string;
}

const SAMPLE_TF_STATEMENTS: readonly TfSubStatement[] = [
  {
    id: 'a',
    label: 'a)',
    text: 'Biên độ dao động điều hòa A là đại lượng luôn dương và không phụ thuộc gốc thời gian.',
    correctAnswer: true,
    explanation: 'Đúng theo định nghĩa SGK Vật lý 11 (Chương 1 · Trang 8).',
  },
  {
    id: 'b',
    label: 'b)',
    text: 'Vận tốc của vật dao động điều hòa đạt độ lớn cực đại khi vật đi qua vị trí biên.',
    correctAnswer: false,
    explanation: 'Sai: tại vị trí biên vận tốc bằng 0; tốc độ cực đại đạt tại vị trí cân bằng.',
  },
  {
    id: 'c',
    label: 'c)',
    text: 'Vectơ gia tốc của vật dao động điều hòa luôn hướng về vị trí cân bằng.',
    correctAnswer: true,
    explanation: 'Đúng vì a = -ω²x luôn trái dấu với li độ x.',
  },
  {
    id: 'd',
    label: 'd)',
    text: 'Khi vật đi từ vị trí cân bằng ra biên, động năng tăng dần còn thế năng giảm dần.',
    correctAnswer: false,
    explanation: 'Sai: từ VTCB ra biên tốc độ giảm nên động năng giảm và thế năng tăng.',
  },
] as const;

const PROGRESSIVE_TF_SCORE_TABLE: Record<number, string> = {
  0: '0,00',
  1: '0,10',
  2: '0,25',
  3: '0,50',
  4: '1,00',
};

interface LeaderboardPreviewRow {
  rank: number;
  studentName: string;
  gradeLabel: string;
  examsCompleted: number;
  avgScore: string;
  totalPoints: string;
  streakText: string;
}

const LEADERBOARD_PREVIEW_DATA: Record<LeaderboardScope, readonly LeaderboardPreviewRow[]> = {
  '10': [
    {
      rank: 1,
      studentName: 'Nguyễn Minh Quân',
      gradeLabel: 'Lớp 10A1 · Hóa - Toán',
      examsCompleted: 14,
      avgScore: '9,45',
      totalPoints: '1.323 đ',
      streakText: 'Chuỗi 9 đề > 9,0',
    },
    {
      rank: 2,
      studentName: 'Trần Hà My',
      gradeLabel: 'Lớp 10A2 · Hóa - Sinh',
      examsCompleted: 13,
      avgScore: '9,20',
      totalPoints: '1.196 đ',
      streakText: 'Chuỗi 6 đề > 9,0',
    },
    {
      rank: 3,
      studentName: 'Lê Hoàng Nam',
      gradeLabel: 'Lớp 10A1 · Vật lý',
      examsCompleted: 12,
      avgScore: '8,95',
      totalPoints: '1.074 đ',
      streakText: 'Tốc độ TB 31 phút',
    },
    {
      rank: 4,
      studentName: 'Phạm Bảo Ngọc',
      gradeLabel: 'Lớp 10A4 · Toán',
      examsCompleted: 11,
      avgScore: '8,80',
      totalPoints: '968 đ',
      streakText: 'Đúng 100% Phần II',
    },
  ],
  '11': [
    {
      rank: 1,
      studentName: 'Đặng Quốc Khánh',
      gradeLabel: 'Lớp 11A1 · Vật lý - Toán',
      examsCompleted: 16,
      avgScore: '9,50',
      totalPoints: '1.520 đ',
      streakText: 'Chuỗi 11 đề > 9,0',
    },
    {
      rank: 2,
      studentName: 'Vũ Thanh Thảo',
      gradeLabel: 'Lớp 11A3 · Hóa học',
      examsCompleted: 15,
      avgScore: '9,25',
      totalPoints: '1.388 đ',
      streakText: 'Chuỗi 8 đề > 9,0',
    },
    {
      rank: 3,
      studentName: 'Hoàng Gia Huy',
      gradeLabel: 'Lớp 11A2 · Toán - Lý',
      examsCompleted: 14,
      avgScore: '8,90',
      totalPoints: '1.246 đ',
      streakText: 'Tốc độ TB 29 phút',
    },
    {
      rank: 4,
      studentName: 'Bùi Khánh Linh',
      gradeLabel: 'Lớp 11A1 · Sinh học',
      examsCompleted: 13,
      avgScore: '8,75',
      totalPoints: '1.138 đ',
      streakText: 'Đúng 100% Phần III',
    },
  ],
  '12': [
    {
      rank: 1,
      studentName: 'Trương Tuấn Kiệt',
      gradeLabel: 'Lớp 12A1 · Tổ hợp KHTN',
      examsCompleted: 19,
      avgScore: '9,60',
      totalPoints: '1.824 đ',
      streakText: 'Chuỗi 14 đề > 9,0',
    },
    {
      rank: 2,
      studentName: 'Ngô Phương Anh',
      gradeLabel: 'Lớp 12A2 · Toán - Hóa',
      examsCompleted: 18,
      avgScore: '9,40',
      totalPoints: '1.692 đ',
      streakText: 'Chuỗi 10 đề > 9,0',
    },
    {
      rank: 3,
      studentName: 'Đỗ Minh Đức',
      gradeLabel: 'Lớp 12A1 · Toán - Lý',
      examsCompleted: 17,
      avgScore: '9,15',
      totalPoints: '1.556 đ',
      streakText: 'Tốc độ TB 34 phút',
    },
    {
      rank: 4,
      studentName: 'Lý Ngọc Hân',
      gradeLabel: 'Lớp 12A5 · Toán - Anh',
      examsCompleted: 16,
      avgScore: '8,95',
      totalPoints: '1.432 đ',
      streakText: 'Đúng 100% Phần II',
    },
  ],
  all: [
    {
      rank: 1,
      studentName: 'Trương Tuấn Kiệt',
      gradeLabel: 'Khối 12 · Lớp 12A1',
      examsCompleted: 19,
      avgScore: '9,60',
      totalPoints: '1.824 đ',
      streakText: 'Dẫn đầu Toàn trường',
    },
    {
      rank: 2,
      studentName: 'Ngô Phương Anh',
      gradeLabel: 'Khối 12 · Lớp 12A2',
      examsCompleted: 18,
      avgScore: '9,40',
      totalPoints: '1.692 đ',
      streakText: 'Hạng 2 Toàn trường',
    },
    {
      rank: 3,
      studentName: 'Đặng Quốc Khánh',
      gradeLabel: 'Khối 11 · Lớp 11A1',
      examsCompleted: 16,
      avgScore: '9,50',
      totalPoints: '1.520 đ',
      streakText: 'Dẫn đầu Khối 11',
    },
    {
      rank: 4,
      studentName: 'Nguyễn Minh Quân',
      gradeLabel: 'Khối 10 · Lớp 10A1',
      examsCompleted: 14,
      avgScore: '9,45',
      totalPoints: '1.323 đ',
      streakText: 'Dẫn đầu Khối 10',
    },
  ],
};

export const LandingWorkspacePreview: React.FC<LandingWorkspacePreviewProps> = ({
  onOpenAuth,
}) => {
  const [activeExamPart, setActiveExamPart] = useState<ExamPartTab>('part2_tf');
  const [leaderboardScope, setLeaderboardScope] = useState<LeaderboardScope>('11');

  // Interactive Part I (ABCD) state
  const [selectedAbcd, setSelectedAbcd] = useState<'A' | 'B' | 'C' | 'D'>('B');

  // Interactive Part II (True/False 4 statements) state
  const [tfAnswers, setTfAnswers] = useState<Record<'a' | 'b' | 'c' | 'd', boolean>>({
    a: true,
    b: false,
    c: true,
    d: false,
  });

  // Interactive Part III (Short Answer) state
  const [shortAnswerInput, setShortAnswerInput] = useState<string>('2,5');

  const tfCorrectCount = useMemo(() => {
    return SAMPLE_TF_STATEMENTS.filter((st) => tfAnswers[st.id] === st.correctAnswer).length;
  }, [tfAnswers]);

  const tfEarnedScore = PROGRESSIVE_TF_SCORE_TABLE[tfCorrectCount] || '0,00';
  const isShortAnswerCorrect = shortAnswerInput.trim().replace('.', ',') === '2,5';
  const activeLeaderboardRows = LEADERBOARD_PREVIEW_DATA[leaderboardScope];

  return (
    <section
      id="workspace-preview"
      className="scroll-mt-20 mx-auto max-w-[1380px] px-4 sm:px-8 py-12 sm:py-20 border-t border-[#E8EDF4] dark:border-slate-800/80"
    >
      {/* Section Header Strictly Focused on Exam Arena 2025 & Leaderboard Race */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 mb-8 sm:mb-10">
        <div className="max-w-2xl">
          <p className="text-xs font-bold tracking-[0.14em] uppercase text-[#2563EB] dark:text-sky-400">
            THI THỬ CHUẨN GDPT 2018 · ĐUA TOP CÔNG BẰNG THEO KHỐI 10 · 11 · 12
          </p>
          <h2
            style={{ fontFamily: 'var(--font-serif)' }}
            className="text-[clamp(1.6rem,3.4vw,2.35rem)] font-bold tracking-tight text-[#172033] dark:text-white mt-1.5 text-balance"
          >
            Làm đề cấu trúc mới 2025 và cạnh tranh thứ hạng minh bạch toàn trường
          </h2>
        </div>
        <p className="text-sm text-[#525E75] dark:text-slate-300 max-w-md leading-[1.6]">
          Chấm điểm tự động theo đúng quy chế mới của Bộ GD&amp;ĐT (ABCD, Đúng/Sai lũy tiến 4 ý, Trả lời ngắn) và chỉ ghi nhận điểm Đua Top ở lượt làm chính thức đầu tiên.
        </p>
      </div>

      {/* 2-Column Interactive Split: Left = 2025 Exam Simulator | Right = Live Grade Leaderboard */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* LEFT COLUMN: Interactive 3-Part 2025 Exam Simulator */}
        <div className="lg:col-span-6 rounded-[28px] bg-white dark:bg-[#111B30] border border-[#E8EDF4] dark:border-slate-800 shadow-[0_18px_45px_-22px_rgba(23,32,51,0.08)] p-5 sm:p-7 flex flex-col justify-between space-y-5">
          <div className="space-y-4">
            {/* Top Room Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3.5 border-b border-[#E8EDF4] dark:border-slate-800 text-xs">
              <div className="flex items-center gap-2 font-bold text-[#172033] dark:text-white">
                <ClipboardCheck className="w-4 h-4 text-[#2563EB] dark:text-sky-400 shrink-0" />
                <span>Phòng thi mẫu · Đề Vật lý &amp; Hóa học chuẩn 2025</span>
              </div>
              <div className="inline-flex items-center gap-1.5 font-mono font-semibold text-[#2563EB] dark:text-sky-400 tabular-nums">
                <Clock className="w-3.5 h-3.5 shrink-0" />
                <span>45:00 · Tự nộp khi hết giờ</span>
              </div>
            </div>

            {/* 3 Exam Parts Selector Tabs */}
            <div
              role="tablist"
              aria-label="Ba phần cấu trúc đề thi chuẩn 2025"
              className="grid grid-cols-3 gap-1.5 p-1 rounded-2xl bg-[#F8FAFC] dark:bg-slate-900/80 border border-[#E8EDF4] dark:border-slate-800"
            >
              {[
                { id: 'part1_abcd' as const, label: 'Phần I · ABCD', sub: '0,25 đ / câu' },
                { id: 'part2_tf' as const, label: 'Phần II · Đúng/Sai', sub: '0,1 → 1,0 đ' },
                { id: 'part3_short' as const, label: 'Phần III · Trả lời ngắn', sub: 'Điền số chuẩn' },
              ].map((tab) => {
                const active = activeExamPart === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setActiveExamPart(tab.id)}
                    className={`rounded-xl px-2.5 py-2 text-left transition-colors cursor-pointer ${
                      active
                        ? 'bg-[#2563EB] text-white shadow-xs'
                        : 'text-[#475B78] dark:text-slate-300 hover:text-[#172033] dark:hover:text-white'
                    }`}
                  >
                    <span className="block text-xs font-bold truncate">{tab.label}</span>
                    <span
                      className={`block text-[10px] font-mono tabular-nums truncate ${
                        active ? 'text-blue-100' : 'text-[#525E75] dark:text-slate-400'
                      }`}
                    >
                      {tab.sub}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Interactive Question Content */}
            <div key={activeExamPart} className="landing-fade-up space-y-3.5">
                {activeExamPart === 'part2_tf' && (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="text-[#475B78] dark:text-slate-300 font-medium">
                        Bấm đổi Đúng / Sai ở từng ý để xem thang điểm lũy tiến:
                      </span>
                      <span className="font-mono font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                        Đúng {tfCorrectCount}/4 ý → +{tfEarnedScore} điểm
                      </span>
                    </div>

                    <div className="space-y-2">
                      {SAMPLE_TF_STATEMENTS.map((st) => {
                        const chosen = tfAnswers[st.id];
                        const isRight = chosen === st.correctAnswer;
                        return (
                          <div
                            key={st.id}
                            className="rounded-2xl border border-[#E8EDF4] dark:border-slate-800 bg-[#F8FAFC]/80 dark:bg-slate-900/60 p-3 space-y-1.5"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <p className="text-xs sm:text-[13px] text-[#172033] dark:text-white leading-snug">
                                <strong className="font-mono mr-1.5">{st.label}</strong>
                                {st.text}
                              </p>
                              <div className="inline-flex items-center gap-1 shrink-0">
                                {[
                                  { val: true, text: 'Đúng' },
                                  { val: false, text: 'Sai' },
                                ].map((btn) => {
                                  const active = chosen === btn.val;
                                  return (
                                    <button
                                      key={btn.text}
                                      type="button"
                                      onClick={() =>
                                        setTfAnswers((prev) => ({ ...prev, [st.id]: btn.val }))
                                      }
                                      className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer ${
                                        active
                                          ? isRight
                                            ? 'bg-emerald-600 text-white'
                                            : 'bg-rose-600 text-white'
                                          : 'bg-white dark:bg-slate-800 text-[#475B78] dark:text-slate-300 border border-[#E8EDF4] dark:border-slate-700'
                                      }`}
                                    >
                                      {btn.text}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                            <p
                              className={`text-[11px] flex items-center gap-1.5 ${
                                isRight
                                  ? 'text-emerald-700 dark:text-emerald-400'
                                  : 'text-rose-700 dark:text-rose-400'
                              }`}
                            >
                              {isRight ? (
                                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                              ) : (
                                <XCircle className="w-3.5 h-3.5 shrink-0" />
                              )}
                              <span>{st.explanation}</span>
                            </p>
                          </div>
                        );
                      })}
                    </div>

                    <div className="rounded-xl bg-[#EAF2FF]/70 dark:bg-blue-950/40 border border-blue-200/70 dark:border-blue-800/60 px-3.5 py-2.5 text-xs text-[#172033] dark:text-blue-100 flex flex-wrap items-center justify-between gap-2 font-mono tabular-nums">
                      <span>Quy tắc chấm Phần II:</span>
                      <span>1 ý: 0,10đ · 2 ý: 0,25đ · 3 ý: 0,50đ · 4 ý: 1,00đ</span>
                    </div>
                  </div>
                )}

                {activeExamPart === 'part1_abcd' && (
                  <div className="space-y-3">
                    <div className="rounded-2xl border border-[#E8EDF4] dark:border-slate-800 bg-[#F8FAFC]/80 dark:bg-slate-900/60 p-4 space-y-3">
                      <p className="text-xs sm:text-sm font-semibold text-[#172033] dark:text-white leading-relaxed">
                        Câu 1 (Hóa học 10): Trong các phân tử sau, phân tử nào có liên kết cộng hóa trị không phân cực?
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {[
                          { id: 'A' as const, text: 'A. HCl' },
                          { id: 'B' as const, text: 'B. N₂' },
                          { id: 'C' as const, text: 'C. H₂O' },
                          { id: 'D' as const, text: 'D. NH₃' },
                        ].map((opt) => {
                          const isSelected = selectedAbcd === opt.id;
                          const isCorrect = opt.id === 'B';
                          return (
                            <button
                              key={opt.id}
                              type="button"
                              onClick={() => setSelectedAbcd(opt.id)}
                              className={`min-h-[42px] px-3.5 py-2 rounded-xl border text-left text-xs font-semibold flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                                isSelected
                                  ? isCorrect
                                    ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-400 text-emerald-800 dark:text-emerald-200'
                                    : 'bg-rose-50 dark:bg-rose-950/50 border-rose-400 text-rose-800 dark:text-rose-200'
                                  : 'bg-white dark:bg-slate-800 border-[#E8EDF4] dark:border-slate-700 text-[#172033] dark:text-slate-200 hover:border-[#2563EB]'
                              }`}
                            >
                              <span>{opt.text}</span>
                              {isSelected &&
                                (isCorrect ? (
                                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                                ) : (
                                  <XCircle className="w-4 h-4 text-rose-600 shrink-0" />
                                ))}
                            </button>
                          );
                        })}
                      </div>
                      <p className="text-xs text-[#475B78] dark:text-slate-300 pt-1">
                        {selectedAbcd === 'B'
                          ? 'Chính xác (+0,25 điểm): Phân tử N₂ gồm 2 nguyên tử cùng nguyên tố nên cặp electron dùng chung không lệch về phía nào (SGK Hóa 10 · Trang 48).'
                          : 'Chưa đúng (0,00 điểm): Phân tử này có hiệu độ âm điện khác 0 nên liên kết bị phân cực. Đáp án chuẩn là B (N₂).'}
                      </p>
                    </div>
                  </div>
                )}

                {activeExamPart === 'part3_short' && (
                  <div className="space-y-3">
                    <div className="rounded-2xl border border-[#E8EDF4] dark:border-slate-800 bg-[#F8FAFC]/80 dark:bg-slate-900/60 p-4 space-y-3">
                      <p className="text-xs sm:text-sm font-semibold text-[#172033] dark:text-white leading-relaxed">
                        Câu 1 (Vật lý 11 · Trả lời ngắn): Một vật dao động điều hòa có chu kỳ T = 0,4 s. Tần số dao động f của vật bằng bao nhiêu Hz? (Làm tròn đến 1 chữ số thập phân)
                      </p>
                      <div className="flex flex-wrap items-center gap-2.5">
                        <input
                          type="text"
                          value={shortAnswerInput}
                          onChange={(e) => setShortAnswerInput(e.target.value)}
                          aria-label="Nhập đáp án trả lời ngắn"
                          placeholder="Ví dụ: 2,5"
                          className="min-h-[42px] w-36 px-3.5 py-2 rounded-xl border border-[#E8EDF4] dark:border-slate-700 bg-white dark:bg-slate-900 font-mono text-sm font-bold text-[#172033] dark:text-white tabular-nums"
                        />
                        {['2,5', '0,4', '5,0'].map((preset) => (
                          <button
                            key={preset}
                            type="button"
                            onClick={() => setShortAnswerInput(preset)}
                            className="px-3 py-1.5 rounded-xl border border-[#E8EDF4] dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-mono font-semibold text-[#475B78] dark:text-slate-300 hover:border-[#2563EB] cursor-pointer"
                          >
                            Thử điền {preset}
                          </button>
                        ))}
                      </div>
                      <p
                        className={`text-xs font-medium flex items-center gap-1.5 ${
                          isShortAnswerCorrect
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-amber-700 dark:text-amber-400'
                        }`}
                      >
                        {isShortAnswerCorrect ? (
                          <>
                            <CheckCircle2 className="w-4 h-4 shrink-0" />
                            <span>
                              Chính xác (+0,25 điểm): f = 1 / T = 1 / 0,4 = 2,5 Hz (hệ thống tự chuẩn hóa cả dấu phẩy 2,5 và dấu chấm 2.5).
                            </span>
                          </>
                        ) : (
                          <>
                            <XCircle className="w-4 h-4 shrink-0" />
                            <span>
                              Chưa khớp đáp án chuẩn (2,5 Hz). Áp dụng công thức f = 1 / T = 1 / 0,4 = 2,5 Hz.
                            </span>
                          </>
                        )}
                      </p>
                    </div>
                  </div>
                )}
            </div>
          </div>

          {/* Anti-Cheat & Fairness Footer inside Left Exam Card */}
          <div className="pt-3.5 border-t border-[#E8EDF4] dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs text-[#525E75] dark:text-slate-400">
            <span className="inline-flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-[#2563EB] dark:text-sky-400 shrink-0" />
              <span>Khóa in đáp án cho tới khi nộp xong lượt thi đầu tiên</span>
            </span>
            <button
              type="button"
              onClick={() => onOpenAuth('login')}
              className="font-bold text-[#2563EB] dark:text-sky-400 hover:underline cursor-pointer"
            >
              Vào làm đề thi thật →
            </button>
          </div>
        </div>

        {/* RIGHT COLUMN: Transparent Grade 10 · 11 · 12 Leaderboard Race */}
        <div className="lg:col-span-6 rounded-[28px] bg-white dark:bg-[#111B30] border border-[#E8EDF4] dark:border-slate-800 shadow-[0_18px_45px_-22px_rgba(23,32,51,0.08)] p-5 sm:p-7 flex flex-col justify-between space-y-5">
          <div className="space-y-4">
            {/* Top Leaderboard Bar & Grade Filter */}
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3.5 border-b border-[#E8EDF4] dark:border-slate-800">
              <div className="flex items-center gap-2">
                <Trophy className="w-4 h-4 text-amber-500 shrink-0" />
                <h3 className="font-display text-sm sm:text-base font-bold text-[#172033] dark:text-white">
                  Bảng Xếp Hạng Đua Top Học Tập
                </h3>
              </div>

              <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-[#F8FAFC] dark:bg-slate-900 border border-[#E8EDF4] dark:border-slate-800">
                {[
                  { id: '10' as const, label: 'Khối 10' },
                  { id: '11' as const, label: 'Khối 11' },
                  { id: '12' as const, label: 'Khối 12' },
                  { id: 'all' as const, label: 'Toàn trường' },
                ].map((g) => {
                  const active = leaderboardScope === g.id;
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => setLeaderboardScope(g.id)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                        active
                          ? 'bg-[#2563EB] text-white shadow-xs'
                          : 'text-[#475B78] dark:text-slate-300 hover:text-[#172033] dark:hover:text-white'
                      }`}
                    >
                      {g.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Leaderboard Rows */}
            <div className="space-y-2.5">
              {activeLeaderboardRows.map((row) => (
                <div
                  key={`${leaderboardScope}_${row.rank}`}
                  className={`rounded-2xl border p-3.5 flex items-center justify-between gap-3 transition-colors ${
                    row.rank === 1
                      ? 'bg-amber-50/65 dark:bg-amber-950/25 border-amber-300/80 dark:border-amber-700/70'
                      : 'bg-[#F8FAFC]/80 dark:bg-slate-900/60 border-[#E8EDF4] dark:border-slate-800'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className={`size-8 rounded-full font-mono text-xs font-bold tabular-nums inline-flex items-center justify-center shrink-0 ${
                        row.rank === 1
                          ? 'bg-amber-500 text-[#0A0F1A]'
                          : row.rank === 2
                          ? 'bg-slate-300 dark:bg-slate-700 text-slate-900 dark:text-white'
                          : row.rank === 3
                          ? 'bg-amber-800 text-white'
                          : 'bg-slate-100 dark:bg-slate-800 text-[#475B78] dark:text-slate-300'
                      }`}
                    >
                      #{row.rank}
                    </span>

                    <div className="min-w-0">
                      <p className="text-xs sm:text-sm font-bold text-[#172033] dark:text-white truncate">
                        {row.studentName}
                      </p>
                      <p className="text-[11px] text-[#525E75] dark:text-slate-400 truncate">
                        {row.gradeLabel} · {row.examsCompleted} đề chính thức · {row.streakText}
                      </p>
                    </div>
                  </div>

                  <div className="text-right shrink-0 font-mono tabular-nums">
                    <p className="text-xs sm:text-sm font-bold text-[#2563EB] dark:text-sky-400">
                      {row.totalPoints}
                    </p>
                    <p className="text-[11px] text-[#475B78] dark:text-slate-400">
                      TB: {row.avgScore} / 10
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {/* Scoring Fairness Rules */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 text-xs">
              <div className="rounded-2xl bg-[#F8FAFC] dark:bg-slate-900/70 border border-[#E8EDF4] dark:border-slate-800 p-3 flex items-start gap-2.5">
                <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold text-[#172033] dark:text-white">
                    Chống cày điểm ảo
                  </p>
                  <p className="text-[#525E75] dark:text-slate-400 mt-0.5 leading-relaxed">
                    Chỉ lượt làm đầu tiên của mỗi mã đề được cộng vào Bảng xếp hạng Đua Top; các lượt thi lại dùng để ôn tập.
                  </p>
                </div>
              </div>

              <div className="rounded-2xl bg-[#F8FAFC] dark:bg-slate-900/70 border border-[#E8EDF4] dark:border-slate-800 p-3 flex items-start gap-2.5">
                <Award className="w-4 h-4 text-[#2563EB] dark:text-sky-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold text-[#172033] dark:text-white">
                    Xếp hạng độc lập theo Khối
                  </p>
                  <p className="text-[#525E75] dark:text-slate-400 mt-0.5 leading-relaxed">
                    Học sinh Lớp 10, 11, 12 đua thứ hạng công bằng trong đúng khối lớp của mình và bảng vinh danh toàn trường.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Bottom Direct Entry CTA */}
          <div className="pt-3.5 border-t border-[#E8EDF4] dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <span className="text-xs text-[#525E75] dark:text-slate-400">
              Đăng nhập để nhận đề thi đúng khối lớp và ghi danh lên Bảng xếp hạng.
            </span>
            <button
              type="button"
              onClick={() => onOpenAuth('login')}
              className="group inline-flex items-center justify-center gap-2.5 px-5 py-2.5 rounded-full bg-[#2563EB] hover:bg-[#1746A2] text-white text-xs font-semibold shadow-[0_12px_24px_-8px_rgba(37,99,235,0.6)] transition-all duration-200 cursor-pointer shrink-0"
            >
              <span>Tham gia Thi &amp; Đua Top</span>
              <ArrowRight className="w-3.5 h-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};
