import React, { useRef, useState } from 'react';
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
  Sparkles,
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
 * Ethereal Youthful Bento & Liquid Glass Dashboard (UI Mode 2).
 * Modeled after the dreamy floating studio layout: greeting + quick actions,
 * 4 rounded colorful preview/spotlight cards, 2-column rounded data table &
 * shortcuts split, and 3 quick guide cards — wired 100% to live StudyCheck AI data.
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
  const accValues = completed
    .map((a) => a.accuracyScore)
    .filter((v): v is number => typeof v === 'number');
  const compValues = completed
    .map((a) => a.completenessScore)
    .filter((v): v is number => typeof v === 'number');

  const avgAccuracy =
    accValues.length > 0
      ? Math.round((accValues.reduce((s, v) => s + v, 0) / accValues.length) * 10) / 10
      : null;
  const avgCompleteness =
    compValues.length > 0
      ? Math.round((compValues.reduce((s, v) => s + v, 0) / compValues.length) * 10) / 10
      : null;

  const nowIso = new Date().toISOString();
  const dueTodayCount = practiceItems.filter(
    (p) => !p.nextReviewAt || p.nextReviewAt <= nowIso
  ).length;

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

  useGSAP(
    () => {
      if (loading) return;
      const mm = gsap.matchMedia();
      mm.add(MOTION_ALLOWED_MEDIA, () => {
        gsap.from('.ethereal-stagger', {
          y: 14,
          autoAlpha: 0,
          duration: 0.36,
          stagger: 0.045,
          ease: 'power2.out',
          clearProps: 'transform,opacity,visibility',
        });
      });
    },
    { scope: rootRef, dependencies: [loading] }
  );

  const firstName =
    profile?.displayName || user?.displayName || 'Học sinh';

  const quickDirectory = [
    {
      id: 'leaderboard' as const,
      title: 'Đua Top Khối & Trường',
      meta: `Khối ${profile?.grade || '10'} · Xếp hạng thực`,
      icon: Trophy,
      accent: 'text-amber-500',
    },
    {
      id: 'analytics' as const,
      title: 'Thống kê kiến thức đã học',
      meta: avgCompleteness !== null ? `Độ đầy đủ TB ${avgCompleteness}%` : 'Bản đồ chương học',
      icon: BarChart3,
      accent: 'text-indigo-500',
    },
    {
      id: 'quiz' as const,
      title: 'Luyện trắc nghiệm thích ứng',
      meta: 'Tạo đề từ điểm yếu & nâng cao',
      icon: HelpCircle,
      accent: 'text-violet-500',
    },
    {
      id: 'history' as const,
      title: 'Kho lịch sử & Ưu nhược điểm',
      meta: `${analyses.length} tài liệu đã lưu`,
      icon: History,
      accent: 'text-sky-500',
    },
  ];

  const guideCards = [
    {
      id: 'guide-upload',
      label: 'Kiểm định vở viết tay hoặc PDF',
      title: 'Chụp vở viết tay hoặc tải PDF để đối chiếu trực tiếp với SGK',
      actionLabel: 'Bắt đầu kiểm định',
      colorClass: 'bg-rose-500/15 text-rose-500 dark:bg-rose-500/20 dark:text-rose-300',
      onClick: () => onNavigate('upload'),
    },
    {
      id: 'guide-flashcards',
      label: 'Flashcard và bộ 10 câu sai',
      title: 'Ôn nhanh bằng Flashcard & bộ 10 câu sai (không tốn lượt AI)',
      actionLabel: 'Mở Flashcard',
      colorClass: 'bg-indigo-500/15 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-300',
      onClick: () => onNavigate('practice', undefined, 'flashcards'),
    },
    {
      id: 'guide-exams',
      label: 'Thi thử đề GDPT 2018',
      title: 'Thi thử đề Giữa kỳ / Cuối kỳ GDPT 2018 và lên bảng Đua Top',
      actionLabel: 'Vào phòng thi',
      colorClass: 'bg-violet-500/15 text-violet-600 dark:bg-violet-500/20 dark:text-violet-300',
      onClick: () => onNavigate('exams'),
    },
    {
      id: 'guide-analytics',
      label: 'Thống kê bản đồ kiến thức',
      title: 'Theo dõi bản đồ chương học, lỗ hổng kiến thức và biểu đồ tiến bộ',
      actionLabel: 'Xem thống kê',
      colorClass: 'bg-sky-500/15 text-sky-600 dark:bg-sky-500/20 dark:text-sky-300',
      onClick: () => onNavigate('analytics'),
    },
  ];

  return (
    <div ref={rootRef} className="space-y-6 sm:space-y-8">
      {/* Greeting Header + Action Pair (mirrors reference top band) */}
      <div className="ethereal-stagger flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-[clamp(1.55rem,3.6vw,2.15rem)] font-bold tracking-[-0.02em] text-[#171B3A] dark:text-[#EEF1FF] leading-[1.18]">
            Xin chào, {firstName}!
          </h1>
          <p className="text-xs sm:text-sm text-[#6B7499] dark:text-[#A5B1D8] mt-1 leading-[1.6]">
            Chào mừng đến không gian học tập Lớp {profile?.grade || '10'} ·{' '}
            {(profile?.preferredSubjects || [])
              .map((s) => SUBJECT_LABELS[s])
              .filter(Boolean)
              .join(' · ') || 'Chưa chọn môn quan tâm'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
          <button
            type="button"
            onClick={() => {
              setDisplayName(profile?.displayName || user?.displayName || '');
              setGrade(profile?.grade || '10');
              setPreferredSubjects(profile?.preferredSubjects || ['toan', 'hoa_hoc']);
              setEditingProfile((v) => !v);
            }}
            className="inline-flex items-center gap-2 min-h-[42px] px-4 py-2 rounded-2xl text-xs font-semibold bg-white/90 dark:bg-[#1B2148]/90 text-[#2E365E] dark:text-[#D9E0FF] border border-indigo-100/90 dark:border-indigo-400/20 shadow-[0_8px_22px_-12px_rgba(79,70,229,0.28)] hover:-translate-y-0.5 hover:border-indigo-300 dark:hover:border-indigo-400/45 transition-all duration-200 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Settings2 className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-300" />
            <span>Hồ sơ · Lớp {profile?.grade || '10'}</span>
            <ChevronDown
              className={`w-3.5 h-3.5 opacity-70 transition-transform duration-200 ${
                editingProfile ? 'rotate-180' : ''
              }`}
            />
          </button>

          <WaterRippleButton
            onClick={() => onNavigate('upload')}
            className="!rounded-2xl !bg-gradient-to-r !from-[#4338CA] !via-[#4F46E5] !to-[#6366F1] !shadow-[0_12px_28px_-8px_rgba(79,70,229,0.62),inset_0_1px_0_rgba(255,255,255,0.35)]"
          >
            <Upload className="w-4 h-4" />
            Kiểm định ngay
          </WaterRippleButton>
        </div>
      </div>

      {/* Smooth Collapsible Inline Profile Editor (compositor-only opacity + y) */}
      <AnimatePresence initial={false}>
        {editingProfile && (
          <motion.div
            key="ethereal-profile-editor"
            initial={prefersReduced ? { opacity: 1 } : { opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={prefersReduced ? { opacity: 0 } : { opacity: 0, y: -6 }}
            transition={{ duration: prefersReduced ? 0 : 0.18, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="glass-surface rounded-3xl p-5 sm:p-6">
              <h2 className="font-display text-base font-bold text-[#171B3A] dark:text-[#EEF1FF] mb-4">
                Cập nhật hồ sơ học tập
              </h2>
              <form onSubmit={handleSaveProfile} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label
                      htmlFor="eth-prof-name"
                      className="block text-xs font-medium text-[#37406B] dark:text-[#C5CEEE] mb-1.5"
                    >
                      Tên hiển thị
                    </label>
                    <input
                      id="eth-prof-name"
                      type="text"
                      required
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl glass-control text-sm"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="eth-prof-grade"
                      className="block text-xs font-medium text-[#37406B] dark:text-[#C5CEEE] mb-1.5"
                    >
                      Khối lớp
                    </label>
                    <select
                      id="eth-prof-grade"
                      value={grade}
                      onChange={(e) => setGrade(e.target.value as GradeLevel)}
                      className="w-full px-3.5 py-2.5 rounded-xl glass-control text-sm"
                    >
                      <option value="10">Lớp 10</option>
                      <option value="11">Lớp 11</option>
                      <option value="12">Lớp 12</option>
                    </select>
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium text-[#37406B] dark:text-[#C5CEEE] mb-2">
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
                          className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all cursor-pointer ${
                            active
                              ? 'bg-gradient-to-r from-[#4F46E5] to-[#7C3AED] text-white shadow-xs'
                              : 'glass-control'
                          }`}
                        >
                          {SUBJECT_LABELS[sub]}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <WaterRippleButton
                    type="submit"
                    size="sm"
                    disabled={savingProfile}
                    className="!bg-gradient-to-r !from-[#4F46E5] !to-[#6366F1]"
                  >
                    {savingProfile ? 'Đang lưu...' : 'Lưu thay đổi'}
                  </WaterRippleButton>
                  <button
                    type="button"
                    onClick={() => setEditingProfile(false)}
                    className="text-xs text-[#6B7499] dark:text-[#A5B1D8] hover:text-[#171B3A] dark:hover:text-white cursor-pointer"
                  >
                    Hủy
                  </button>
                </div>
              </form>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Section 1: 4 Colorful Rounded Studio Cards (mirrors "My Products" row) */}
      <section className="ethereal-stagger space-y-3.5">
        <div className="flex items-center justify-between gap-4">
          <h2 className="font-display text-base sm:text-lg font-bold text-[#171B3A] dark:text-[#EEF1FF]">
            Không gian học tập của tôi
          </h2>
          <button
            type="button"
            onClick={() => onNavigate('analytics')}
            className="inline-flex items-center gap-1 text-xs font-medium text-[#6B7499] dark:text-[#A5B1D8] hover:text-[#4F46E5] dark:hover:text-indigo-300 transition-colors cursor-pointer"
          >
            Xem toàn bộ tiến độ
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="glass-surface rounded-[26px] h-[206px] animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
            {/* Card 1: Soft Lavender Periwinkle Wireframe -> Document Analyses */}
            <button
              type="button"
              onClick={() => onNavigate('history')}
              className="group text-left rounded-[26px] overflow-hidden bg-white/95 dark:bg-[#191E43]/90 border border-white/95 dark:border-indigo-400/20 shadow-[0_16px_38px_-18px_rgba(79,70,229,0.22)] hover:-translate-y-1 hover:shadow-[0_22px_44px_-16px_rgba(79,70,229,0.30)] hover:border-indigo-300/80 dark:hover:border-indigo-400/45 transition-all duration-200 cursor-pointer flex flex-col"
            >
              <div className="relative h-32 w-full bg-gradient-to-br from-[#DCE0FF] via-[#CED4FF] to-[#BFC6FF] dark:from-[#2C316B] dark:via-[#262B60] dark:to-[#202454] p-4 overflow-hidden">
                {/* Mini wireframe dots */}
                <div className="flex items-center justify-center gap-1.5 mb-3">
                  <span className="w-2 h-2 rounded-full bg-white/80" />
                  <span className="w-2 h-2 rounded-full bg-white/60" />
                  <span className="w-2 h-2 rounded-full bg-white/60" />
                  <span className="w-2 h-2 rounded-full bg-white/80" />
                </div>
                {/* Mini bento blocks */}
                <div className="grid grid-cols-12 gap-2 h-20">
                  <div className="col-span-8 rounded-xl bg-indigo-400/28 dark:bg-indigo-300/20 p-2.5 flex flex-col justify-between">
                    <span className="font-mono text-lg font-bold text-[#2D3572] dark:text-white tabular-nums leading-none">
                      {analyses.length}
                    </span>
                    <span className="text-[10px] font-semibold text-[#474F8E] dark:text-indigo-200">
                      {avgAccuracy !== null ? `Chính xác ${avgAccuracy}%` : `${completed.length} hoàn tất`}
                    </span>
                  </div>
                  <div className="col-span-4 flex flex-col gap-1.5">
                    <div className="flex-1 rounded-lg bg-white/55 dark:bg-white/15 flex items-center justify-center">
                      <FileCheck2 className="w-4 h-4 text-indigo-600 dark:text-indigo-300" />
                    </div>
                    <div className="h-5 rounded-lg bg-white/45 dark:bg-white/10" />
                  </div>
                </div>
              </div>
              <div className="px-4 py-3.5 flex-1 flex flex-col justify-center">
                <p className="inline-flex items-center gap-1 text-[11px] font-medium text-[#7B84A8] dark:text-[#9AA5CC]">
                  <span>{completed.length} bài đã đối chiếu SGK</span>
                  <ChevronRight className="w-3 h-3 transition-transform duration-200 group-hover:translate-x-0.5" />
                </p>
                <p className="font-display text-sm font-bold text-[#171B3A] dark:text-white mt-0.5">
                  Tài liệu kiểm định
                </p>
              </div>
            </button>

            {/* Card 2: Deep Midnight Indigo Wireframe -> Exam Center */}
            <button
              type="button"
              onClick={() => onNavigate('exams')}
              className="group text-left rounded-[26px] overflow-hidden bg-white/95 dark:bg-[#191E43]/90 border border-white/95 dark:border-indigo-400/20 shadow-[0_16px_38px_-18px_rgba(30,27,75,0.28)] hover:-translate-y-1 hover:shadow-[0_22px_44px_-16px_rgba(79,70,229,0.32)] hover:border-indigo-300/80 dark:hover:border-indigo-400/45 transition-all duration-200 cursor-pointer flex flex-col"
            >
              <div className="relative h-32 w-full bg-gradient-to-br from-[#373B75] via-[#222658] to-[#12163D] p-4 overflow-hidden">
                <div className="flex items-center justify-between mb-4">
                  <span className="w-5 h-5 rounded-full bg-white/25 flex items-center justify-center">
                    <ClipboardCheck className="w-3 h-3 text-indigo-100" />
                  </span>
                  <div className="flex items-center gap-1.5">
                    <span className="w-5 h-1.5 rounded-full bg-indigo-200/40" />
                    <span className="w-3.5 h-1.5 rounded-full bg-indigo-200/25" />
                    <span className="w-3.5 h-1.5 rounded-full bg-indigo-200/25" />
                  </div>
                </div>
                <div className="space-y-2 mt-3">
                  <div className="h-2.5 w-3/4 rounded-full bg-white/30" />
                  <div className="h-2.5 w-1/2 rounded-full bg-indigo-300/25" />
                  <p className="pt-1 text-[10px] font-semibold tracking-wide text-indigo-200/90">
                    ABCD · Đúng/Sai · Trả lời ngắn
                  </p>
                </div>
              </div>
              <div className="px-4 py-3.5 flex-1 flex flex-col justify-center">
                <p className="inline-flex items-center gap-1 text-[11px] font-medium text-[#7B84A8] dark:text-[#9AA5CC]">
                  <span>Chuẩn GDPT 2018 · Lớp 10–12</span>
                  <ChevronRight className="w-3 h-3 transition-transform duration-200 group-hover:translate-x-0.5" />
                </p>
                <p className="font-display text-sm font-bold text-[#171B3A] dark:text-white mt-0.5">
                  Trung tâm Đề Kiểm Tra
                </p>
              </div>
            </button>

            {/* Card 3: Soft Rose Coral Wireframe -> Practice Bank & Flashcards */}
            <button
              type="button"
              onClick={() => onNavigate('practice')}
              className="group text-left rounded-[26px] overflow-hidden bg-white/95 dark:bg-[#191E43]/90 border border-white/95 dark:border-indigo-400/20 shadow-[0_16px_38px_-18px_rgba(244,63,94,0.22)] hover:-translate-y-1 hover:shadow-[0_22px_44px_-16px_rgba(244,63,94,0.28)] hover:border-rose-300/80 dark:hover:border-rose-400/45 transition-all duration-200 cursor-pointer flex flex-col"
            >
              <div className="relative h-32 w-full bg-gradient-to-br from-[#F7B2C4] via-[#EE93AE] to-[#E3759B] dark:from-[#6A2844] dark:via-[#58213A] dark:to-[#451A2E] p-4 overflow-hidden">
                <div className="grid grid-cols-12 gap-2.5 items-center h-full">
                  <div className="col-span-6 space-y-2">
                    <div className="h-2.5 w-full rounded-full bg-white/55" />
                    <div className="h-2.5 w-4/5 rounded-full bg-white/40" />
                    <span className="inline-block font-mono text-[11px] font-bold text-white/95 pt-1 tabular-nums">
                      {practiceItems.length} câu lưu
                    </span>
                  </div>
                  <div className="col-span-6 h-20 rounded-2xl bg-white/30 dark:bg-white/15 backdrop-blur-xs flex flex-col items-center justify-center p-2">
                    <Repeat className="w-5 h-5 text-white mb-1" />
                    <span className="font-mono text-xs font-bold text-white tabular-nums">
                      {dueTodayCount} đến hạn
                    </span>
                  </div>
                </div>
              </div>
              <div className="px-4 py-3.5 flex-1 flex flex-col justify-center">
                <p className="inline-flex items-center gap-1 text-[11px] font-medium text-[#7B84A8] dark:text-[#9AA5CC]">
                  <span>Lịch ôn 1 / 3 / 7 ngày & Flashcard</span>
                  <ChevronRight className="w-3 h-3 transition-transform duration-200 group-hover:translate-x-0.5" />
                </p>
                <p className="font-display text-sm font-bold text-[#171B3A] dark:text-white mt-0.5">
                  Ngân hàng ôn tập
                </p>
              </div>
            </button>

            {/* Card 4: Electric Indigo Spotlight "+ Kiểm định mới" Card */}
            <button
              type="button"
              onClick={() => onNavigate('upload')}
              className="group relative text-left rounded-[26px] overflow-hidden bg-gradient-to-br from-[#5B52F8] via-[#4F46E5] to-[#4338CA] p-5 text-white shadow-[0_18px_42px_-14px_rgba(79,70,229,0.62)] hover:-translate-y-1 hover:shadow-[0_24px_50px_-14px_rgba(79,70,229,0.72)] transition-all duration-200 cursor-pointer flex flex-col justify-between min-h-[206px]"
            >
              {/* Luminous floating CSS crystal rings inside card */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -bottom-10 -left-8 w-36 h-36 rounded-full bg-gradient-to-tr from-fuchsia-400/50 via-violet-300/35 to-cyan-300/30 blur-lg"
              />
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -top-8 -right-8 w-32 h-32 rounded-full border-[10px] border-white/15"
              />

              <div className="relative z-10 flex items-center justify-between gap-2">
                <span className="inline-flex items-center justify-center w-9 h-9 rounded-2xl bg-white/18 border border-white/25 backdrop-blur-sm">
                  <Sparkles className="w-4 h-4 text-white" />
                </span>
                <span className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white text-[#4338CA] text-xs font-bold shadow-[0_8px_20px_-6px_rgba(15,23,42,0.35)] group-hover:scale-[1.03] transition-transform duration-180">
                  <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                  Kiểm định mới
                </span>
              </div>

              <div className="relative z-10 mt-6">
                <p className="font-display text-base font-bold leading-snug">
                  Tải vở ghi, PDF hoặc DOCX
                </p>
                <p className="text-[11px] text-indigo-100/90 mt-1 leading-relaxed">
                  OCR tự động & đối chiếu từng nhận định theo sách giáo khoa chuẩn.
                </p>
              </div>
            </button>
          </div>
        )}
      </section>

      {/* Section 2: 2-Column Rounded Split (mirrors "Invoicing" + "Websites") */}
      <section className="ethereal-stagger grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-6">
        {/* Left: Recent Analyses Table Card (7 cols) */}
        <div className="lg:col-span-7 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-base sm:text-lg font-bold text-[#171B3A] dark:text-[#EEF1FF]">
              Phân tích gần đây
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('history')}
              className="inline-flex items-center gap-1 text-xs font-medium text-[#6B7499] dark:text-[#A5B1D8] hover:text-[#4F46E5] dark:hover:text-indigo-300 transition-colors cursor-pointer"
            >
              Xem tất cả
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex-1 rounded-[26px] bg-white/95 dark:bg-[#191E43]/90 border border-white/95 dark:border-indigo-400/20 shadow-[0_16px_38px_-18px_rgba(79,70,229,0.16)] p-4 sm:p-5">
            {analyses.length === 0 ? (
              <div className="py-8 px-4 text-center space-y-3">
                <p className="font-display text-sm font-bold text-[#171B3A] dark:text-white">
                  Chưa có tài liệu nào được kiểm định
                </p>
                <p className="text-xs text-[#6B7499] dark:text-[#A5B1D8] max-w-sm mx-auto leading-relaxed">
                  Tải lên trang vở chụp, đề cương hoặc PDF đầu tiên để nhận điểm Chính xác & Đầy đủ theo SGK.
                </p>
                <WaterRippleButton
                  size="sm"
                  onClick={() => onNavigate('upload')}
                  className="!rounded-xl !bg-gradient-to-r !from-[#4F46E5] !to-[#6366F1]"
                >
                  <Upload className="w-3.5 h-3.5" />
                  Tải tài liệu đầu tiên
                </WaterRippleButton>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <div className="min-w-[420px]">
                  <div className="grid grid-cols-12 gap-2 px-3 pb-2.5 text-[11px] font-semibold text-[#8992B5] dark:text-[#8E98C2]">
                    <span className="col-span-5">Tài liệu</span>
                    <span className="col-span-3">Môn & Ngày</span>
                    <span className="col-span-2 text-center">Chính xác</span>
                    <span className="col-span-2 text-right">Đầy đủ</span>
                  </div>
                  <div className="divide-y divide-indigo-100/75 dark:divide-indigo-400/12">
                    {analyses.slice(0, 5).map((item) => {
                      const acc = item.accuracyScore;
                      const accStyle =
                        acc === null
                          ? 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-300'
                          : acc >= 80
                          ? 'bg-emerald-100/85 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                          : acc >= 60
                          ? 'bg-amber-100/85 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300'
                          : 'bg-rose-100/85 dark:bg-rose-500/20 text-rose-700 dark:text-rose-300';
                      return (
                        <button
                          key={item.analysisId}
                          type="button"
                          onClick={() => onNavigate('history', item.analysisId)}
                          className="w-full grid grid-cols-12 items-center gap-2 px-3 py-3 rounded-2xl text-left hover:bg-indigo-50/70 dark:hover:bg-white/6 transition-colors duration-150 cursor-pointer"
                        >
                          <span className="col-span-5 text-xs sm:text-[13px] font-semibold text-[#4338CA] dark:text-indigo-300 truncate">
                            {item.documentTitle}
                          </span>
                          <span className="col-span-3 text-[11px] text-[#5B6488] dark:text-[#A5B1D8] truncate">
                            {SUBJECT_LABELS[item.subject]} ·{' '}
                            {new Date(item.createdAt).toLocaleDateString('vi-VN')}
                          </span>
                          <span className="col-span-2 flex justify-center">
                            <span
                              className={`font-mono text-[11px] font-semibold px-2.5 py-0.5 rounded-full tabular-nums ${accStyle}`}
                            >
                              {acc !== null ? `${acc}%` : '—'}
                            </span>
                          </span>
                          <span className="col-span-2 text-right font-mono text-xs font-semibold text-[#171B3A] dark:text-[#EEF1FF] tabular-nums">
                            {item.completenessScore !== null ? `${item.completenessScore}%` : '—'}
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
            <h2 className="font-display text-base sm:text-lg font-bold text-[#171B3A] dark:text-[#EEF1FF]">
              Lối tắt & Xếp hạng
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('leaderboard')}
              className="inline-flex items-center gap-1 text-xs font-medium text-[#6B7499] dark:text-[#A5B1D8] hover:text-[#4F46E5] dark:hover:text-indigo-300 transition-colors cursor-pointer"
            >
              Đua Top
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex-1 rounded-[26px] bg-white/95 dark:bg-[#191E43]/90 border border-white/95 dark:border-indigo-400/20 shadow-[0_16px_38px_-18px_rgba(79,70,229,0.16)] p-4 sm:p-5 flex flex-col justify-between">
            <div className="grid grid-cols-12 px-2.5 pb-2 text-[11px] font-semibold text-[#8992B5] dark:text-[#8E98C2]">
              <span className="col-span-7">Khu vực</span>
              <span className="col-span-5 text-right">Trạng thái</span>
            </div>
            <div className="divide-y divide-indigo-100/75 dark:divide-indigo-400/12">
              {quickDirectory.map((row) => {
                const Icon = row.icon;
                return (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => onNavigate(row.id)}
                    className="group w-full flex items-center justify-between gap-3 px-2.5 py-3 rounded-2xl text-left hover:bg-indigo-50/70 dark:hover:bg-white/6 transition-colors duration-150 cursor-pointer"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Icon className={`w-4 h-4 shrink-0 ${row.accent}`} />
                      <span className="text-xs sm:text-[13px] font-semibold text-[#171B3A] dark:text-[#EEF1FF] truncate">
                        {row.title}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-[11px] text-[#6B7499] dark:text-[#A5B1D8] hidden sm:inline">
                        {row.meta}
                      </span>
                      <ChevronRight className="w-3.5 h-3.5 text-[#9AA5CC] group-hover:text-[#4F46E5] dark:group-hover:text-indigo-300 group-hover:translate-x-0.5 transition-all" />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* Section 3: Accessible Quick Guides & Workflow Carousel */}
      <section className="ethereal-stagger">
        <Carousel
          ariaLabel="Gợi ý và lối tắt học hiệu quả"
          slideClassName="w-[86%] sm:w-[48%] lg:w-[32.2%]"
          headerLeft={
            <div>
              <h2 className="font-display text-base sm:text-lg font-bold text-[#171B3A] dark:text-[#EEF1FF] text-balance">
                Gợi ý & Lối tắt học hiệu quả
              </h2>
              <p className="text-xs text-[#6B7499] dark:text-[#A5B1D8] mt-0.5 text-pretty">
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
                className="group w-full h-full text-left rounded-[22px] bg-white/95 dark:bg-[#191E43]/90 border border-white/95 dark:border-indigo-400/20 px-4 py-4 shadow-[0_12px_30px_-16px_rgba(79,70,229,0.18)] hover:-translate-y-0.5 hover:border-indigo-300/80 dark:hover:border-indigo-400/45 hover:shadow-[0_18px_36px_-14px_rgba(79,70,229,0.26)] transition-[transform,border-color,box-shadow] duration-180 ease-out cursor-pointer flex items-center gap-3.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                <span
                  className={`size-10 rounded-xl flex items-center justify-center shrink-0 transition-transform duration-180 group-hover:scale-105 ${card.colorClass}`}
                >
                  <Play className="size-4 fill-current" />
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-[#171B3A] dark:text-[#EEF1FF] leading-snug text-pretty">
                    {card.title}
                  </p>
                  <p className="text-[11px] font-medium text-[#4F46E5] dark:text-indigo-300 mt-1">
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
