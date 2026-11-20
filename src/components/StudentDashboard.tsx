import React, { useRef, useState } from 'react';
import {
  ArrowRight,
  Award,
  BarChart3,
  BookOpen,
  FileCheck2,
  History,
  Repeat,
  Settings2,
  Trophy,
  Upload,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useUiMode } from '../context/UiModeContext';
import { SUBJECT_LABELS, type AnalysisRecord, type GradeLevel, type PracticeItem, type SubjectId } from '../core/types';
import { gsap, MOTION_ALLOWED_MEDIA, useGSAP } from '../lib/gsapSetup';
import { updateUserPreferences } from '../services/firestoreService';
import { useIsMobileViewport } from '../hooks/useIsMobileViewport';
import { GlassSurface } from './LiquidGlass/GlassSurface';
import { LiquidCard } from './LiquidGlass/LiquidCard';
import { ScoreRing } from './LiquidGlass/ScoreRing';
import { WaterRippleButton } from './LiquidGlass/WaterRippleButton';

interface StudentDashboardProps {
  analyses: AnalysisRecord[];
  practiceItems: PracticeItem[];
  loading: boolean;
  onNavigate: (
    view: 'upload' | 'history' | 'practice' | 'analytics' | 'exams' | 'leaderboard',
    analysisId?: string
  ) => void;
}

export const StudentDashboard: React.FC<StudentDashboardProps> = ({
  analyses,
  practiceItems,
  loading,
  onNavigate,
}) => {
  const { user, profile, refreshProfile } = useAuth();
  const { isEthereal } = useUiMode();
  const isMobile = useIsMobileViewport();
  const dashboardRef = useRef<HTMLDivElement>(null);
  const [editingProfile, setEditingProfile] = useState(false);
  const [displayName, setDisplayName] = useState(profile?.displayName || '');
  const [grade, setGrade] = useState<GradeLevel>(profile?.grade || '10');
  const [preferredSubjects, setPreferredSubjects] = useState<SubjectId[]>(
    profile?.preferredSubjects || ['toan', 'hoa_hoc']
  );
  const [savingProfile, setSavingProfile] = useState(false);

  const completed = analyses.filter((a) => a.analysisStatus === 'completed');
  const accValues = completed.map((a) => a.accuracyScore).filter((v): v is number => typeof v === 'number');
  const compValues = completed.map((a) => a.completenessScore).filter((v): v is number => typeof v === 'number');

  const avgAccuracy =
    accValues.length > 0 ? Math.round((accValues.reduce((s, v) => s + v, 0) / accValues.length) * 10) / 10 : null;
  const avgCompleteness =
    compValues.length > 0 ? Math.round((compValues.reduce((s, v) => s + v, 0) / compValues.length) * 10) / 10 : null;

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
      if (loading || !isEthereal || isMobile) return;
      const mm = gsap.matchMedia();
      mm.add(MOTION_ALLOWED_MEDIA, () => {
        gsap.from('.dashboard-card', {
          y: 14,
          autoAlpha: 0,
          duration: 0.36,
          stagger: 0.04,
          ease: 'power2.out',
          clearProps: 'transform,opacity,visibility',
        });
      });
    },
    { scope: dashboardRef, dependencies: [loading, isEthereal, isMobile, analyses.length === 0 && practiceItems.length === 0] }
  );

  useGSAP(
    () => {
      if (!editingProfile || !isEthereal || isMobile) return;
      const mm = gsap.matchMedia();
      mm.add(MOTION_ALLOWED_MEDIA, () => {
        gsap.from('.profile-editor-panel', {
          y: -8,
          autoAlpha: 0,
          duration: 0.28,
          ease: 'power2.out',
          clearProps: 'transform,opacity,visibility',
        });
      });
    },
    { scope: dashboardRef, dependencies: [editingProfile, isEthereal, isMobile] }
  );

  return (
    <div ref={dashboardRef} className="space-y-5 sm:space-y-7">
      {/* Greeting Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-[clamp(1.3rem,4vw,1.875rem)] font-bold text-[#16243E] dark:text-[#E6EFFC] leading-[1.25]">
            Xin chào, {profile?.displayName || user?.displayName || 'Học sinh'}
          </h1>
          <p className="text-sm text-[#475B78] dark:text-[#B4C7E2] mt-1 leading-[1.6]">
            Lớp {profile?.grade || '10'} ·{' '}
            {(profile?.preferredSubjects || [])
              .map((s) => SUBJECT_LABELS[s])
              .filter(Boolean)
              .join(' · ') || 'Chưa chọn môn quan tâm'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setDisplayName(profile?.displayName || user?.displayName || '');
              setGrade(profile?.grade || '10');
              setPreferredSubjects(profile?.preferredSubjects || ['toan', 'hoa_hoc']);
              setEditingProfile((v) => !v);
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium glass-control cursor-pointer whitespace-nowrap shrink-0"
          >
            <Settings2 className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
            Hồ sơ học tập
          </button>
          <WaterRippleButton onClick={() => onNavigate('upload')}>
            <Upload className="w-4 h-4" />
            Kiểm định tài liệu mới
          </WaterRippleButton>
        </div>
      </div>

      {/* Inline Profile Editor */}
      {editingProfile && (
        <GlassSurface className="profile-editor-panel rounded-3xl p-6">
          <h2 className="font-display text-base font-bold text-[#16243E] dark:text-[#E6EFFC] mb-4">
            Cập nhật hồ sơ cá nhân
          </h2>
          <form onSubmit={handleSaveProfile} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="prof-name" className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-1.5">
                  Tên hiển thị
                </label>
                <input
                  id="prof-name"
                  type="text"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl glass-control text-sm"
                />
              </div>
              <div>
                <label htmlFor="prof-grade" className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-1.5">
                  Khối lớp
                </label>
                <select
                  id="prof-grade"
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
              <p className="text-xs font-medium text-slate-700 dark:text-slate-200 mb-2">
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
                      className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-colors cursor-pointer ${
                        active
                          ? isEthereal
                            ? 'bg-gradient-to-b from-sky-500 to-blue-600 text-white shadow-xs'
                            : 'bg-sky-700 text-white border border-sky-700'
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
              <WaterRippleButton type="submit" size="sm" disabled={savingProfile}>
                {savingProfile ? 'Đang lưu...' : 'Lưu thay đổi'}
              </WaterRippleButton>
              <button
                type="button"
                onClick={() => setEditingProfile(false)}
                className="text-xs text-slate-600 dark:text-slate-300 hover:text-[#16243E] dark:hover:text-[#E6EFFC] cursor-pointer"
              >
                Hủy
              </button>
            </div>
          </form>
        </GlassSurface>
      )}

      {/* Quick Exam Center & Đua Top Shortcuts (compact 2-col on tablet/desktop, crisp rows on mobile) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-5">
        <LiquidCard
          enableRipple={!isMobile}
          enableTilt={false}
          onClick={() => onNavigate('exams')}
          className="dashboard-card rounded-2xl sm:rounded-3xl p-4 sm:p-6 cursor-pointer flex items-center justify-between gap-4 active:scale-[0.99] transition-transform duration-100"
        >
          <div className="space-y-1 min-w-0">
            <p className="text-xs font-semibold text-sky-700 dark:text-sky-400">
              Kiểm tra định kỳ · Lớp 10 / 11 / 12
            </p>
            <h2 className="font-display text-base sm:text-lg font-bold text-[#16243E] dark:text-[#E6EFFC]">
              Trung tâm Đề Kiểm Tra Giữa kỳ & Cuối kỳ
            </h2>
            <p className="text-xs text-[#475B78] dark:text-[#B4C7E2] leading-[1.55]">
              Thi thử đề chuẩn ABCD, Đúng/Sai, Trả lời ngắn và nhận điểm ngay.
            </p>
          </div>
          <Award className="w-7 h-7 sm:w-8 sm:h-8 text-sky-600 dark:text-sky-400 shrink-0" />
        </LiquidCard>

        <LiquidCard
          enableRipple={!isMobile}
          enableTilt={false}
          onClick={() => onNavigate('leaderboard')}
          className="dashboard-card rounded-2xl sm:rounded-3xl p-4 sm:p-6 cursor-pointer flex items-center justify-between gap-4 active:scale-[0.99] transition-transform duration-100"
        >
          <div className="space-y-1 min-w-0">
            <p className="text-xs font-semibold text-amber-600 dark:text-amber-400">
              Bảng xếp hạng thành tích
            </p>
            <h2 className="font-display text-base sm:text-lg font-bold text-[#16243E] dark:text-[#E6EFFC]">
              Đua Top theo Khối & Toàn trường
            </h2>
            <p className="text-xs text-[#475B78] dark:text-[#B4C7E2] leading-[1.55]">
              Xem thứ hạng của bạn trong Khối 10 / 11 / 12 và toàn trường theo điểm thi.
            </p>
          </div>
          <Trophy className="w-7 h-7 sm:w-8 sm:h-8 text-amber-500 shrink-0" />
        </LiquidCard>
      </div>

      {/* Summary Metrics */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="glass-surface rounded-3xl p-6 h-32 animate-pulse" />
          ))}
        </div>
      ) : analyses.length === 0 && practiceItems.length === 0 ? (
        <LiquidCard enableRipple enableTilt={false} className="dashboard-card rounded-3xl p-7 sm:p-10">
          <div className="max-w-2xl">
            <BookOpen className="w-8 h-8 text-sky-600 dark:text-sky-400 mb-4" />
            <h2 className="font-display text-xl sm:text-2xl font-bold text-[#16243E] dark:text-[#E6EFFC]">
              Bắt đầu lần kiểm định kiến thức đầu tiên
            </h2>
            <p className="text-sm sm:text-base text-[#475B78] dark:text-[#B4C7E2] mt-2 leading-[1.6] prose-measure">
              Tải lên bản ghi chép, đề cương ôn tập hoặc ảnh chụp trang vở của bạn. StudyCheck AI sẽ
              trích xuất văn bản để bạn kiểm tra OCR, sau đó đối chiếu với sách giáo khoa chuẩn để chỉ
              ra lỗi sai, phần kiến thức còn thiếu và tạo câu hỏi ôn tập phù hợp.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-4">
              <WaterRippleButton size="lg" onClick={() => onNavigate('upload')}>
                <Upload className="w-4 h-4" />
                Tải tài liệu đầu tiên
              </WaterRippleButton>
              <button
                type="button"
                onClick={() => onNavigate('analytics')}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-[#16243E] dark:text-[#E6EFFC] hover:text-sky-700 dark:hover:text-sky-400 cursor-pointer"
              >
                Xem thống kê kiến thức
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </LiquidCard>
      ) : (
        <>
          {/* Smooth horizontal swipeable stat strip on Mobile (<768px), 2/4-col grid on Tablet/Desktop */}
          <div className="flex overflow-x-auto snap-x snap-mandatory gap-3 -mx-4 px-4 pb-1 no-scrollbar md:mx-0 md:px-0 md:pb-0 md:grid md:grid-cols-2 xl:grid-cols-4 md:gap-5">
            <LiquidCard
              enableTilt={false}
              className="dashboard-card snap-start shrink-0 w-[78vw] max-w-[270px] md:w-auto md:max-w-none rounded-2xl sm:rounded-3xl p-4 sm:p-5 flex items-center justify-between"
            >
              <div>
                <p className="text-xs font-medium text-[#475B78] dark:text-[#B4C7E2]">
                  Tài liệu đã kiểm định
                </p>
                <p className="font-mono text-2xl font-bold text-[#16243E] dark:text-[#E6EFFC] tabular-nums mt-1">
                  {analyses.length}
                </p>
                <p className="text-xs text-[#475B78] dark:text-[#B4C7E2] mt-1">
                  {completed.length} bài đã hoàn tất
                </p>
              </div>
              <FileCheck2 className="w-7 h-7 text-sky-600 dark:text-sky-400 shrink-0" />
            </LiquidCard>

            <LiquidCard
              enableTilt={false}
              className="dashboard-card snap-start shrink-0 w-[78vw] max-w-[270px] md:w-auto md:max-w-none rounded-2xl sm:rounded-3xl p-4 sm:p-5"
            >
              <ScoreRing
                label="Độ chính xác trung bình"
                value={avgAccuracy}
                subtitle={accValues.length > 0 ? `Tính trên ${accValues.length} bài đã xác minh` : 'Chưa đủ dữ liệu'}
                color="sky"
                size={isMobile ? 64 : 76}
              />
            </LiquidCard>

            <LiquidCard
              enableTilt={false}
              className="dashboard-card snap-start shrink-0 w-[78vw] max-w-[270px] md:w-auto md:max-w-none rounded-2xl sm:rounded-3xl p-4 sm:p-5"
            >
              <ScoreRing
                label="Độ đầy đủ trung bình"
                value={avgCompleteness}
                subtitle={
                  compValues.length > 0
                    ? `Bao phủ khung kiến thức (${compValues.length} bài)`
                    : 'Cần chọn sách/chương tham chiếu'
                }
                color="sky"
                size={isMobile ? 64 : 76}
              />
            </LiquidCard>

            <LiquidCard
              enableRipple={!isMobile}
              enableTilt={false}
              onClick={() => onNavigate('practice')}
              className="dashboard-card snap-start shrink-0 w-[78vw] max-w-[270px] md:w-auto md:max-w-none rounded-2xl sm:rounded-3xl p-4 sm:p-5 flex items-center justify-between cursor-pointer active:scale-[0.99] transition-transform duration-100"
            >
              <div>
                <p className="text-xs font-medium text-[#475B78] dark:text-[#B4C7E2]">
                  Ngân hàng ôn tập (1/3/7d)
                </p>
                <p className="font-mono text-2xl font-bold text-[#16243E] dark:text-[#E6EFFC] tabular-nums mt-1">
                  {practiceItems.length}
                </p>
                <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                  {dueTodayCount} câu đến hạn ôn hôm nay
                </p>
              </div>
              <Repeat className="w-7 h-7 text-amber-600 dark:text-amber-400 shrink-0" />
            </LiquidCard>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <LiquidCard enableTilt={false} hoverLift={false} className="dashboard-card lg:col-span-8 rounded-3xl p-5 sm:p-6">
              <div className="flex items-center justify-between mb-5">
                <h2 className="font-display text-lg font-bold text-[#16243E] dark:text-[#E6EFFC]">
                  Phân tích gần đây
                </h2>
                <button
                  type="button"
                  onClick={() => onNavigate('history')}
                  className="inline-flex items-center gap-1 text-xs font-medium text-sky-700 dark:text-sky-400 hover:underline cursor-pointer"
                >
                  Xem toàn bộ lịch sử
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="divide-y divide-sky-200/50 dark:divide-slate-700/70">
                {analyses.slice(0, 5).map((item) => (
                  <button
                    key={item.analysisId}
                    type="button"
                    onClick={() => onNavigate('history', item.analysisId)}
                    className="w-full py-3.5 text-left flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-white/60 dark:hover:bg-slate-800/50 px-3 rounded-2xl transition-colors cursor-pointer"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#16243E] dark:text-[#E6EFFC] truncate">
                        {item.documentTitle}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        {SUBJECT_LABELS[item.subject]} · Lớp {item.grade} ·{' '}
                        {new Date(item.createdAt).toLocaleDateString('vi-VN')}
                      </p>
                    </div>
                    <div className="flex items-center gap-5 shrink-0 font-mono text-xs tabular-nums">
                      <span className="text-sky-700 dark:text-sky-400">
                        Chính xác: {item.accuracyScore !== null ? `${item.accuracyScore}%` : '—'}
                      </span>
                      <span className="text-sky-800 dark:text-sky-300">
                        Đầy đủ: {item.completenessScore !== null ? `${item.completenessScore}%` : '—'}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </LiquidCard>

            <div className="lg:col-span-4 space-y-4">
              <LiquidCard
                enableRipple
                onClick={() => onNavigate('analytics')}
                className="dashboard-card rounded-3xl p-5 sm:p-6 cursor-pointer"
              >
                <BarChart3 className="w-6 h-6 text-sky-600 dark:text-sky-400 mb-3" />
                <h3 className="font-display text-base font-bold text-[#16243E] dark:text-[#E6EFFC]">
                  Thống kê kiến thức đã học
                </h3>
                <p className="text-xs text-[#475B78] dark:text-[#B4C7E2] mt-1 leading-[1.6]">
                  Xem bản đồ chương học, các khái niệm hay nhầm lẫn và biểu đồ tiến bộ theo thời gian.
                </p>
              </LiquidCard>

              <LiquidCard
                enableRipple
                onClick={() => onNavigate('history')}
                className="dashboard-card rounded-3xl p-5 sm:p-6 cursor-pointer"
              >
                <History className="w-6 h-6 text-sky-600 dark:text-sky-400 mb-3" />
                <h3 className="font-display text-base font-bold text-[#16243E] dark:text-[#E6EFFC]">
                  Lịch sử ưu & nhược điểm
                </h3>
                <p className="text-xs text-[#475B78] dark:text-[#B4C7E2] mt-1 leading-[1.6]">
                  Mở lại toàn bộ file gốc, vùng đánh dấu lỗi, dẫn chứng sách và bộ câu hỏi đã lưu.
                </p>
              </LiquidCard>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
