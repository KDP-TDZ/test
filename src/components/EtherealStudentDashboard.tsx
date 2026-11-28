import React, { useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  FileCheck2,
  HelpCircle,
  History,
  Play,
  Plus,
  Repeat,
  Settings2,
  Trophy,
  Upload,
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useAuth } from '../context/AuthContext';
import {
  SUBJECT_LABELS,
  type AnalysisRecord,
  type GradeLevel,
  type PracticeItem,
  type SubjectId,
} from '../core/types';
import { gsap, MOTION_ALLOWED_MEDIA, useGSAP } from '../lib/gsapSetup';
import { updateUserPreferences } from '../services/firestoreService';
import { Carousel } from './LiquidGlass/Carousel';
import { WaterRippleButton } from './LiquidGlass/WaterRippleButton';

interface EtherealStudentDashboardProps {
  analyses: AnalysisRecord[];
  practiceItems: PracticeItem[];
  loading: boolean;
  onNavigate: (
    view: 'upload' | 'history' | 'practice' | 'analytics' | 'exams' | 'leaderboard' | 'quiz',
    analysisId?: string,
    subTab?: 'bank' | 'sprint10' | 'flashcards'
  ) => void;
}

/**
 * Unified Luxury Editorial Academic Dashboard for all viewports (Desktop, Tablet & Mobile).
 * Matches the Landing Page palette: Crisp Snow/Navy surfaces, Cobalt #2563EB primary,
 * Warm Gold #F5A623 highlight, Emerald #059669, Rose #E11D48 — zero purple/violet.
 */
export const EtherealStudentDashboard: React.FC<EtherealStudentDashboardProps> = ({
  analyses,
  practiceItems,
  loading,
  onNavigate,
}) => {
  const { user, profile, refreshProfile } = useAuth();
  const rootRef = useRef<HTMLDivElement>(null);
  const prefersReduced = useReducedMotion();

  const [editingProfile, setEditingProfile] = useState(false);
  const [displayName, setDisplayName] = useState(profile?.displayName || '');
  const [grade, setGrade] = useState<GradeLevel>(profile?.grade || '10');
  const [preferredSubjects, setPreferredSubjects] = useState<SubjectId[]>(
    profile?.preferredSubjects || ['toan', 'hoa_hoc']
  );
  const [savingProfile, setSavingProfile] = useState(false);

  const completed = analyses.filter((a) => a.analysisStatus === 'completed');
  const compValues = completed
    .map((a) => a.completenessScore)
    .filter((v): v is number => typeof v === 'number');

  const totalVerifiedClaims = completed.reduce((sum, a) => sum + (a.claims?.length || 0), 0);
  const totalCorrectClaims = completed.reduce(
    (sum, a) => sum + (a.claims?.filter((c) => c.evaluationStatus === 'CORRECT').length || 0),
    0
  );
  const avgCompleteness =
    compValues.length > 0
      ? Math.round((compValues.reduce((s, v) => s + v, 0) / compValues.length) * 10) / 10
      : null;

  const nowIso = new Date().toISOString();
  const dueTodayCount = practiceItems.filter(
    (p) => !p.nextReviewAt || p.nextReviewAt <= nowIso
  ).length;

  // Build inline SVG sparkline points from the latest up to 7 completed analyses (claim volume)
  const sparklinePoints = useMemo(() => {
    const recent = completed.slice(0, 7).reverse();
    if (recent.length === 0) return [];
    const width = 180;
    const height = 44;
    const padX = 6;
    const padY = 6;
    const maxClaims = Math.max(5, ...recent.map((item) => item.claims.length));
    return recent.map((item, idx) => {
      const count = item.claims.length;
      const x =
        recent.length === 1
          ? width / 2
          : padX + (idx / (recent.length - 1)) * (width - padX * 2);
      const y = height - padY - (count / maxClaims) * (height - padY * 2);
      return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, count };
    });
  }, [completed]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSavingProfile(true);
    try {
      await updateUserPreferences(user.uid, {
        displayName: displayName.trim() || profile?.displayName,
        grade,
        preferredSubjects,
      });
      await refreshProfile();
      setEditingProfile(false);
    } finally {
      setSavingProfile(false);
    }
  };

  const togglePreferredSubject = (sub: SubjectId) => {
    setPreferredSubjects((prev) =>
      prev.includes(sub) ? prev.filter((s) => s !== sub) : [...prev, sub].slice(0, 6)
    );
  };

  const firstName = profile?.displayName || user?.displayName || 'Học sinh';

  const quickDirectory = [
    {
      id: 'leaderboard' as const,
      title: 'Đua Top Khối & Trường',
      meta: `Khối ${profile?.grade || '10'} · Xếp hạng thực`,
      icon: Trophy,
      accent: 'text-[#F5A623]',
      iconBg: 'bg-amber-50 dark:bg-amber-500/15 border-amber-200/70 dark:border-amber-500/25',
    },
    {
      id: 'analytics' as const,
      title: 'Thống kê kiến thức đã học',
      meta: avgCompleteness !== null ? `Độ đầy đủ TB ${avgCompleteness}%` : 'Bản đồ chương học',
      icon: BarChart3,
      accent: 'text-[#2563EB] dark:text-[#60A5FA]',
      iconBg: 'bg-[#EAF2FF] dark:bg-[#2563EB]/15 border-[#BFDBFE] dark:border-[#3B82F6]/30',
    },
    {
      id: 'quiz' as const,
      title: 'Luyện trắc nghiệm thích ứng',
      meta: 'Tạo đề từ điểm yếu & nâng cao',
      icon: HelpCircle,
      accent: 'text-[#059669] dark:text-emerald-400',
      iconBg: 'bg-emerald-50 dark:bg-emerald-500/15 border-emerald-200/70 dark:border-emerald-500/25',
    },
    {
      id: 'history' as const,
      title: 'Kho lịch sử & Ưu nhược điểm',
      meta: `${analyses.length} tài liệu đã lưu`,
      icon: History,
      accent: 'text-[#525E75] dark:text-[#94A3B8]',
      iconBg: 'bg-[#F1F5FA] dark:bg-[#0D1628] border-[#E6ECF5] dark:border-[#1E293B]',
    },
  ];

  const guideCards = [
    {
      id: 'guide-upload',
      label: 'Kiểm định vở viết tay hoặc PDF',
      title: 'Chụp vở viết tay hoặc tải PDF để đối chiếu trực tiếp với SGK',
      actionLabel: 'Bắt đầu kiểm định',
      colorClass: 'bg-[#EAF2FF] text-[#2563EB] dark:bg-[#2563EB]/20 dark:text-[#60A5FA]',
      onClick: () => onNavigate('upload'),
    },
    {
      id: 'guide-flashcards',
      label: 'Flashcard và bộ 10 câu sai',
      title: 'Ôn nhanh bằng Flashcard & bộ 10 câu sai (không tốn lượt AI)',
      actionLabel: 'Mở Flashcard',
      colorClass: 'bg-amber-50 text-[#D97706] dark:bg-amber-500/20 dark:text-[#F5A623]',
      onClick: () => onNavigate('practice', undefined, 'flashcards'),
    },
    {
      id: 'guide-exams',
      label: 'Thi thử đề GDPT 2018',
      title: 'Thi thử đề Giữa kỳ / Cuối kỳ GDPT 2018 và lên bảng Đua Top',
      actionLabel: 'Vào phòng thi',
      colorClass: 'bg-emerald-50 text-[#059669] dark:bg-emerald-500/20 dark:text-emerald-300',
      onClick: () => onNavigate('exams'),
    },
    {
      id: 'guide-analytics',
      label: 'Thống kê bản đồ kiến thức',
      title: 'Theo dõi bản đồ chương học, lỗ hổng kiến thức và biểu đồ tiến bộ',
      actionLabel: 'Xem thống kê',
      colorClass: 'bg-rose-50 text-[#E11D48] dark:bg-rose-500/20 dark:text-rose-300',
      onClick: () => onNavigate('analytics'),
    },
  ];

  return (
    <div ref={rootRef} className="space-y-6 sm:space-y-8">
      {/* Greeting Header + Action Pair */}
      <div className="sc-dash-stagger flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-1 border-b border-[#E6ECF5] dark:border-[#1E293B]">
        <div className="pb-3 sm:pb-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#2563EB] dark:text-[#60A5FA] mb-1">
            Học bạ số · Chương trình GDPT 2018
          </p>
          <h1 className="font-display text-[clamp(1.45rem,3.4vw,2.1rem)] font-bold tracking-[-0.02em] text-[#172033] dark:text-[#E6EFFC] leading-[1.18]">
            Xin chào, {firstName}
          </h1>
          <p className="text-xs sm:text-sm text-[#525E75] dark:text-[#94A3B8] mt-1 leading-[1.6]">
            Khối Lớp {profile?.grade || '10'} ·{' '}
            {(profile?.preferredSubjects || [])
              .map((s) => SUBJECT_LABELS[s])
              .filter(Boolean)
              .join(' · ') || 'Chưa chọn môn quan tâm'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 pb-3 sm:pb-4">
          <button
            type="button"
            onClick={() => {
              setDisplayName(profile?.displayName || user?.displayName || '');
              setGrade(profile?.grade || '10');
              setPreferredSubjects(profile?.preferredSubjects || ['toan', 'hoa_hoc']);
              setEditingProfile((v) => !v);
            }}
            className="inline-flex items-center gap-2 min-h-[42px] px-4 py-2 rounded-xl text-xs font-semibold bg-white dark:bg-[#111B30] text-[#172033] dark:text-[#E6EFFC] border border-[#E6ECF5] dark:border-[#1E293B] hover:border-[#BFDBFE] dark:hover:border-[#3B82F6]/45 hover:bg-[#F1F5FA] dark:hover:bg-[#1E293B]/70 transition-colors duration-150 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Settings2 className="w-3.5 h-3.5 text-[#2563EB] dark:text-[#60A5FA]" />
            <span>Hồ sơ · Lớp {profile?.grade || '10'}</span>
            <ChevronDown
              className={`w-3.5 h-3.5 opacity-70 transition-transform duration-200 ${
                editingProfile ? 'rotate-180' : ''
              }`}
            />
          </button>

          <button
            type="button"
            onClick={() => onNavigate('upload')}
            className="inline-flex items-center justify-center gap-2 min-h-[42px] px-4 py-2 rounded-xl text-xs font-semibold bg-[#2563EB] hover:bg-[#1746A2] text-white shadow-[0_8px_20px_-6px_rgba(37,99,235,0.5)] transition-colors duration-150 cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] focus-visible:ring-offset-2"
          >
            <Upload className="w-4 h-4" />
            <span>Kiểm định ngay</span>
          </button>
        </div>
      </div>

      {/* Collapsible Inline Profile Editor */}
      <AnimatePresence initial={false}>
        {editingProfile && (
          <motion.div
            key="sc-profile-editor"
            initial={prefersReduced ? { opacity: 1 } : { opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={prefersReduced ? { opacity: 0 } : { opacity: 0, y: -6 }}
            transition={{ duration: prefersReduced ? 0 : 0.18, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="sc-card p-5 sm:p-6">
              <h2 className="font-display text-base font-bold text-[#172033] dark:text-[#E6EFFC] mb-4">
                Cập nhật hồ sơ học tập
              </h2>
              <form onSubmit={handleSaveProfile} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label
                      htmlFor="sc-prof-name"
                      className="block text-xs font-semibold text-[#172033] dark:text-[#E6EFFC] mb-1.5"
                    >
                      Tên hiển thị
                    </label>
                    <input
                      id="sc-prof-name"
                      type="text"
                      required
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      className="w-full min-h-[42px] px-3.5 py-2 rounded-xl glass-control text-sm"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="sc-prof-grade"
                      className="block text-xs font-semibold text-[#172033] dark:text-[#E6EFFC] mb-1.5"
                    >
                      Khối lớp
                    </label>
                    <select
                      id="sc-prof-grade"
                      value={grade}
                      onChange={(e) => setGrade(e.target.value as GradeLevel)}
                      className="w-full min-h-[42px] px-3.5 py-2 rounded-xl glass-control text-sm"
                    >
                      <option value="10">Lớp 10</option>
                      <option value="11">Lớp 11</option>
                      <option value="12">Lớp 12</option>
                    </select>
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold text-[#172033] dark:text-[#E6EFFC] mb-2">
                    Môn học quan tâm (tối đa 6)
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {(Object.keys(SUBJECT_LABELS) as SubjectId[]).map((sub) => {
                      const active = preferredSubjects.includes(sub);
                      return (
                        <button
                          key={sub}
                          type="button"
                          onClick={() => togglePreferredSubject(sub)}
                          className={`min-h-[36px] px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
                            active
                              ? 'bg-[#2563EB] text-white shadow-xs'
                              : 'glass-control hover:border-[#BFDBFE]'
                          }`}
                        >
                          {SUBJECT_LABELS[sub]}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="flex items-center gap-3 pt-1">
                  <WaterRippleButton type="submit" size="sm" disabled={savingProfile}>
                    {savingProfile ? 'Đang lưu...' : 'Lưu thay đổi'}
                  </WaterRippleButton>
                  <button
                    type="button"
                    onClick={() => setEditingProfile(false)}
                    className="min-h-[36px] px-3 text-xs font-medium text-[#525E75] dark:text-[#94A3B8] hover:text-[#172033] dark:hover:text-[#E6EFFC] cursor-pointer"
                  >
                    Hủy
                  </button>
                </div>
              </form>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Section 1: 4 Editorial Academic Studio Cards */}
      <section className="sc-dash-stagger space-y-3.5">
        <div className="flex items-center justify-between gap-4">
          <h2 className="font-display text-base sm:text-lg font-bold text-[#172033] dark:text-[#E6EFFC]">
            Không gian học tập của tôi
          </h2>
          <button
            type="button"
            onClick={() => onNavigate('analytics')}
            className="inline-flex items-center gap-1 text-xs font-semibold text-[#2563EB] dark:text-[#60A5FA] hover:text-[#1746A2] dark:hover:text-[#93C5FD] transition-colors cursor-pointer"
          >
            Xem toàn bộ tiến độ
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="sc-card sc-skeleton h-[200px]"
              />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
            {/* Card 1: Document Analyses + Inline SVG Claim Volume Sparkline */}
            <button
              type="button"
              onClick={() => onNavigate('history')}
              className="group text-left rounded-2xl overflow-hidden bg-white dark:bg-[#111B30] border border-[#E6ECF5] dark:border-[#1E293B] shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-16px_rgba(15,23,42,0.08)] hover:-translate-y-0.5 hover:border-[#BFDBFE] dark:hover:border-[#3B82F6]/45 transition-all duration-200 cursor-pointer flex flex-col focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
            >
              <div className="relative h-[126px] w-full bg-[#F1F5FA] dark:bg-[#0D1628] border-b border-[#E6ECF5] dark:border-[#1E293B] p-4 flex flex-col justify-between">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="font-mono text-2xl font-bold text-[#172033] dark:text-[#E6EFFC] tabular-nums leading-none">
                      {analyses.length}
                    </span>
                    <p className="text-[11px] font-semibold text-[#2563EB] dark:text-[#60A5FA] mt-1 font-mono tabular-nums">
                      {totalVerifiedClaims > 0
                        ? `${totalCorrectClaims}/${totalVerifiedClaims} mệnh đề đúng chuẩn`
                        : `${completed.length} hoàn tất`}
                    </p>
                  </div>
                  <span className="size-9 rounded-xl bg-[#EAF2FF] dark:bg-[#2563EB]/20 border border-[#BFDBFE] dark:border-[#3B82F6]/30 flex items-center justify-center shrink-0">
                    <FileCheck2 className="w-4 h-4 text-[#2563EB] dark:text-[#60A5FA]" />
                  </span>
                </div>

                {/* Crisp Inline SVG Claim Volume Sparkline */}
                <svg
                  viewBox="0 0 180 44"
                  className="w-full h-10 overflow-visible"
                  aria-hidden="true"
                >
                  <line
                    x1="6"
                    y1="38"
                    x2="174"
                    y2="38"
                    stroke="currentColor"
                    className="text-slate-300/70 dark:text-slate-700"
                    strokeWidth="1"
                    strokeDasharray="3 3"
                  />
                  {sparklinePoints.length > 1 ? (
                    <>
                      <polyline
                        fill="none"
                        stroke="#2563EB"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        points={sparklinePoints.map((p) => `${p.x},${p.y}`).join(' ')}
                      />
                      {sparklinePoints.map((p, i) => (
                        <circle
                          key={i}
                          cx={p.x}
                          cy={p.y}
                          r={i === sparklinePoints.length - 1 ? 3.5 : 2.3}
                          fill={i === sparklinePoints.length - 1 ? '#2563EB' : '#93C5FD'}
                        />
                      ))}
                    </>
                  ) : (
                    <path
                      d="M 8 30 Q 48 26, 90 18 T 172 12"
                      fill="none"
                      stroke="#93C5FD"
                      strokeWidth="2"
                      strokeDasharray="4 4"
                      strokeLinecap="round"
                    />
                  )}
                </svg>
              </div>
              <div className="px-4 py-3.5 flex-1 flex flex-col justify-center">
                <p className="inline-flex items-center gap-1 text-[11px] font-medium text-[#525E75] dark:text-[#94A3B8]">
                  <span>{completed.length} bài đã đối chiếu SGK</span>
                  <ChevronRight className="w-3 h-3 transition-transform duration-200 group-hover:translate-x-0.5" />
                </p>
                <p className="font-display text-sm font-bold text-[#172033] dark:text-[#E6EFFC] mt-0.5">
                  Tài liệu kiểm định
                </p>
              </div>
            </button>

            {/* Card 2: Deep Academic Navy Exam Center */}
            <button
              type="button"
              onClick={() => onNavigate('exams')}
              className="group text-left rounded-2xl overflow-hidden bg-white dark:bg-[#111B30] border border-[#E6ECF5] dark:border-[#1E293B] shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-16px_rgba(15,23,42,0.08)] hover:-translate-y-0.5 hover:border-[#BFDBFE] dark:hover:border-[#3B82F6]/45 transition-all duration-200 cursor-pointer flex flex-col focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
            >
              <div className="relative h-[126px] w-full bg-gradient-to-br from-[#0F2447] via-[#132C56] to-[#0B182E] p-4 overflow-hidden flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="size-8 rounded-xl bg-white/12 border border-white/18 flex items-center justify-center">
                    <ClipboardCheck className="w-4 h-4 text-[#93C5FD]" />
                  </span>
                  <span className="font-mono text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-md bg-[#F5A623]/20 text-[#FCD34D] border border-[#F5A623]/30">
                    GDPT 2018
                  </span>
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="h-1.5 w-16 rounded-full bg-[#3B82F6]" />
                    <span className="h-1.5 w-10 rounded-full bg-[#F5A623]" />
                    <span className="h-1.5 w-8 rounded-full bg-[#10B981]" />
                  </div>
                  <p className="text-[11px] font-medium text-slate-200">
                    ABCD · Đúng/Sai · Trả lời ngắn
                  </p>
                </div>
              </div>
              <div className="px-4 py-3.5 flex-1 flex flex-col justify-center">
                <p className="inline-flex items-center gap-1 text-[11px] font-medium text-[#525E75] dark:text-[#94A3B8]">
                  <span>Thi thử chuẩn Lớp 10–12</span>
                  <ChevronRight className="w-3 h-3 transition-transform duration-200 group-hover:translate-x-0.5" />
                </p>
                <p className="font-display text-sm font-bold text-[#172033] dark:text-[#E6EFFC] mt-0.5">
                  Trung tâm Đề Kiểm Tra
                </p>
              </div>
            </button>

            {/* Card 3: Spaced Repetition Practice Bank & Flashcards */}
            <button
              type="button"
              onClick={() => onNavigate('practice')}
              className="group text-left rounded-2xl overflow-hidden bg-white dark:bg-[#111B30] border border-[#E6ECF5] dark:border-[#1E293B] shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-16px_rgba(15,23,42,0.08)] hover:-translate-y-0.5 hover:border-amber-300 dark:hover:border-amber-500/45 transition-all duration-200 cursor-pointer flex flex-col focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
            >
              <div className="relative h-[126px] w-full bg-[#FEF9EC] dark:bg-[#1E1A12] border-b border-amber-200/70 dark:border-amber-500/20 p-4 flex items-center justify-between gap-3">
                <div className="space-y-1.5 min-w-0">
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-[#B45309] dark:text-[#F5A623]">
                    Spaced Repetition
                  </span>
                  <p className="font-mono text-2xl font-bold text-[#172033] dark:text-[#E6EFFC] tabular-nums leading-none">
                    {dueTodayCount}
                  </p>
                  <p className="text-[11px] font-medium text-[#525E75] dark:text-[#94A3B8] font-mono tabular-nums">
                    đến hạn / {practiceItems.length} câu lưu
                  </p>
                </div>
                <div className="size-14 rounded-2xl bg-white dark:bg-[#111B30] border border-amber-200/80 dark:border-amber-500/30 flex flex-col items-center justify-center shrink-0 shadow-xs">
                  <Repeat className="w-5 h-5 text-[#F5A623]" />
                  <span className="font-mono text-[10px] font-bold text-[#172033] dark:text-[#E6EFFC] mt-0.5">
                    1·3·7d
                  </span>
                </div>
              </div>
              <div className="px-4 py-3.5 flex-1 flex flex-col justify-center">
                <p className="inline-flex items-center gap-1 text-[11px] font-medium text-[#525E75] dark:text-[#94A3B8]">
                  <span>Ôn câu sai & Thẻ Flashcard</span>
                  <ChevronRight className="w-3 h-3 transition-transform duration-200 group-hover:translate-x-0.5" />
                </p>
                <p className="font-display text-sm font-bold text-[#172033] dark:text-[#E6EFFC] mt-0.5">
                  Ngân hàng ôn tập
                </p>
              </div>
            </button>

            {/* Card 4: Cobalt Primary Action Spotlight "+ Kiểm định mới" */}
            <button
              type="button"
              onClick={() => onNavigate('upload')}
              className="group relative text-left rounded-2xl overflow-hidden bg-gradient-to-br from-[#2563EB] via-[#1D4ED8] to-[#1746A2] p-5 text-white shadow-[0_14px_30px_-12px_rgba(37,99,235,0.55)] hover:-translate-y-0.5 hover:shadow-[0_18px_36px_-12px_rgba(37,99,235,0.68)] transition-all duration-200 cursor-pointer flex flex-col justify-between min-h-[200px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] focus-visible:ring-offset-2"
            >
              {/* Subtle geometric architectural SVG accent */}
              <svg
                aria-hidden="true"
                viewBox="0 0 120 120"
                className="pointer-events-none absolute -right-6 -bottom-6 size-32 text-white/10"
              >
                <circle cx="60" cy="60" r="48" fill="none" stroke="currentColor" strokeWidth="10" />
                <circle cx="60" cy="60" r="28" fill="none" stroke="currentColor" strokeWidth="4" />
              </svg>

              <div className="relative z-10 flex items-center justify-between gap-2">
                <span className="inline-flex items-center justify-center size-9 rounded-xl bg-white/15 border border-white/25">
                  <Upload className="w-4 h-4 text-white" />
                </span>
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white text-[#1746A2] text-xs font-bold shadow-xs group-hover:scale-[1.02] transition-transform duration-150">
                  <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                  Kiểm định mới
                </span>
              </div>

              <div className="relative z-10 mt-6">
                <p className="font-display text-base font-bold leading-snug">
                  Tải vở ghi, PDF hoặc DOCX
                </p>
                <p className="text-[11px] text-blue-100 mt-1 leading-relaxed">
                  OCR tự động & đối chiếu từng nhận định theo sách giáo khoa chuẩn.
                </p>
              </div>
            </button>
          </div>
        )}
      </section>

      {/* Section 2: 2-Column Editorial Split (Recent Analyses Table + Quick Directory) */}
      <section className="sc-dash-stagger grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-6">
        {/* Left: Recent Analyses Table Card (7 cols) */}
        <div className="lg:col-span-7 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-base sm:text-lg font-bold text-[#172033] dark:text-[#E6EFFC]">
              Phân tích gần đây
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('history')}
              className="inline-flex items-center gap-1 text-xs font-semibold text-[#2563EB] dark:text-[#60A5FA] hover:text-[#1746A2] transition-colors cursor-pointer"
            >
              Xem tất cả
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex-1 sc-card p-4 sm:p-5">
            {analyses.length === 0 ? (
              <div className="py-7 px-4 text-center space-y-3">
                {/* Crisp Inline SVG Academic Notebook Empty State */}
                <svg
                  viewBox="0 0 80 64"
                  className="w-16 h-14 mx-auto text-[#2563EB] dark:text-[#60A5FA]"
                  fill="none"
                  aria-hidden="true"
                >
                  <rect
                    x="14"
                    y="6"
                    width="52"
                    height="52"
                    rx="10"
                    className="fill-[#EAF2FF] dark:fill-[#2563EB]/15 stroke-[#BFDBFE] dark:stroke-[#3B82F6]/40"
                    strokeWidth="2"
                  />
                  <line x1="25" y1="22" x2="55" y2="22" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                  <line x1="25" y1="32" x2="48" y2="32" stroke="currentColor" strokeOpacity="0.55" strokeWidth="2.2" strokeLinecap="round" />
                  <circle cx="54" cy="44" r="9" className="fill-[#2563EB]" />
                  <path d="M50.5 44l2.3 2.3 4.7-4.8" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <p className="font-display text-sm font-bold text-[#172033] dark:text-[#E6EFFC]">
                  Chưa có tài liệu nào được kiểm định
                </p>
                <p className="text-xs text-[#525E75] dark:text-[#94A3B8] max-w-sm mx-auto leading-relaxed">
                  Tải lên trang vở chụp, đề cương hoặc PDF đầu tiên để đối chiếu từng mệnh đề & dẫn chứng theo SGK.
                </p>
                <WaterRippleButton size="sm" onClick={() => onNavigate('upload')}>
                  <Upload className="w-3.5 h-3.5" />
                  Tải tài liệu đầu tiên
                </WaterRippleButton>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <div className="min-w-[420px]">
                  <div className="grid grid-cols-12 gap-2 px-3 pb-2.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-[#525E75] dark:text-[#94A3B8]">
                    <span className="col-span-5">Tài liệu</span>
                    <span className="col-span-3">Môn & Ngày</span>
                    <span className="col-span-2 text-center">Đúng chuẩn</span>
                    <span className="col-span-2 text-right">Cần sửa</span>
                  </div>
                  <div className="divide-y divide-[#E6ECF5] dark:divide-[#1E293B]">
                    {analyses.slice(0, 5).map((item) => {
                      const correctCount = item.claims.filter(
                        (c) => c.evaluationStatus === 'CORRECT'
                      ).length;
                      const issueCount = item.claims.filter(
                        (c) =>
                          c.evaluationStatus === 'INCORRECT' ||
                          c.evaluationStatus === 'PARTIALLY_CORRECT' ||
                          c.evaluationStatus === 'MISSING'
                      ).length;
                      return (
                        <button
                          key={item.analysisId}
                          type="button"
                          onClick={() => onNavigate('history', item.analysisId)}
                          className="w-full grid grid-cols-12 items-center gap-2 px-3 py-3 rounded-xl text-left hover:bg-[#F1F5FA] dark:hover:bg-[#0D1628] transition-colors duration-150 cursor-pointer"
                        >
                          <span className="col-span-5 text-xs sm:text-[13px] font-semibold text-[#1746A2] dark:text-[#93C5FD] truncate">
                            {item.documentTitle}
                          </span>
                          <span className="col-span-3 text-[11px] text-[#525E75] dark:text-[#94A3B8] truncate">
                            {SUBJECT_LABELS[item.subject]} ·{' '}
                            {new Date(item.createdAt).toLocaleDateString('vi-VN')}
                          </span>
                          <span className="col-span-2 text-center font-mono text-xs font-semibold tabular-nums text-[#059669] dark:text-emerald-400">
                            {correctCount}/{item.claims.length}
                          </span>
                          <span
                            className={`col-span-2 text-right font-mono text-xs font-semibold tabular-nums ${
                              issueCount === 0
                                ? 'text-[#059669] dark:text-emerald-400'
                                : 'text-amber-700 dark:text-[#F5A623]'
                            }`}
                          >
                            {issueCount === 0 ? 'Đạt chuẩn' : `${issueCount} mục`}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right: Quick Directory & Ranking Links (5 cols) */}
        <div className="lg:col-span-5 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-base sm:text-lg font-bold text-[#172033] dark:text-[#E6EFFC]">
              Lối tắt & Xếp hạng
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('leaderboard')}
              className="inline-flex items-center gap-1 text-xs font-semibold text-[#2563EB] dark:text-[#60A5FA] hover:text-[#1746A2] transition-colors cursor-pointer"
            >
              Đua Top
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex-1 sc-card p-4 sm:p-5 flex flex-col justify-between">
            <div className="grid grid-cols-12 px-2.5 pb-2 text-[11px] font-semibold uppercase tracking-[0.04em] text-[#525E75] dark:text-[#94A3B8]">
              <span className="col-span-7">Khu vực</span>
              <span className="col-span-5 text-right">Trạng thái</span>
            </div>
            <div className="divide-y divide-[#E6ECF5] dark:divide-[#1E293B]">
              {quickDirectory.map((row) => {
                const Icon = row.icon;
                return (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => onNavigate(row.id)}
                    className="group w-full flex items-center justify-between gap-3 px-2.5 py-3 rounded-xl text-left hover:bg-[#F1F5FA] dark:hover:bg-[#0D1628] transition-colors duration-150 cursor-pointer"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        className={`size-8 rounded-lg border flex items-center justify-center shrink-0 ${row.iconBg}`}
                      >
                        <Icon className={`w-4 h-4 shrink-0 ${row.accent}`} />
                      </span>
                      <span className="text-xs sm:text-[13px] font-semibold text-[#172033] dark:text-[#E6EFFC] truncate">
                        {row.title}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-[11px] text-[#525E75] dark:text-[#94A3B8] hidden sm:inline">
                        {row.meta}
                      </span>
                      <ChevronRight className="w-3.5 h-3.5 text-[#525E75] dark:text-[#94A3B8] group-hover:text-[#2563EB] dark:group-hover:text-[#60A5FA] group-hover:translate-x-0.5 transition-all" />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* Section 3: Accessible Quick Guides & Workflow Carousel */}
      <section className="sc-dash-stagger">
        <Carousel
          ariaLabel="Gợi ý và lối tắt học hiệu quả"
          slideClassName="w-[86%] sm:w-[48%] lg:w-[32.2%]"
          headerLeft={
            <div>
              <h2 className="font-display text-base sm:text-lg font-bold text-[#172033] dark:text-[#E6EFFC] text-balance">
                Gợi ý & Lối tắt học hiệu quả
              </h2>
              <p className="text-xs text-[#525E75] dark:text-[#94A3B8] mt-0.5 text-pretty">
                Lướt ngang hoặc nhấn Ctrl + K để tìm nhanh mọi chức năng
              </p>
            </div>
          }
          slides={guideCards.map((card) => ({
            id: card.id,
            label: card.label,
            content: (
              <button
                type="button"
                onClick={card.onClick}
                className="group w-full h-full text-left rounded-2xl bg-white dark:bg-[#111B30] border border-[#E6ECF5] dark:border-[#1E293B] px-4 py-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:-translate-y-0.5 hover:border-[#BFDBFE] dark:hover:border-[#3B82F6]/45 transition-[transform,border-color] duration-180 ease-out cursor-pointer flex items-center gap-3.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
              >
                <span
                  className={`size-10 rounded-xl flex items-center justify-center shrink-0 transition-transform duration-180 group-hover:scale-105 ${card.colorClass}`}
                >
                  <Play className="size-4 fill-current" />
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-[#172033] dark:text-[#E6EFFC] leading-snug text-pretty">
                    {card.title}
                  </p>
                  <p className="text-[11px] font-semibold text-[#2563EB] dark:text-[#60A5FA] mt-1">
                    {card.actionLabel} →
                  </p>
                </div>
              </button>
            ),
          }))}
        />
      </section>
    </div>
  );
};
