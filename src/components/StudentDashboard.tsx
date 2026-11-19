import React, { useState } from 'react';
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
import { SUBJECT_LABELS, type AnalysisRecord, type GradeLevel, type PracticeItem, type SubjectId } from '../core/types';
import { updateUserPreferences } from '../services/firestoreService';
import { GlassSurface } from './LiquidGlass/GlassSurface';
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

  return (
    <div className="space-y-8">
      {/* Greeting Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#17243A] dark:text-[#E5EDF9]">
            Xin chào, {profile?.displayName || user?.displayName || 'Học sinh'}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">
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
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium text-slate-700 dark:text-slate-200 bg-white/85 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-800 cursor-pointer"
          >
            <Settings2 className="w-3.5 h-3.5" />
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
        <GlassSurface className="rounded-2xl p-6">
          <h2 className="font-display text-base font-bold text-[#17243A] dark:text-[#E5EDF9] mb-4">
            Cập nhật hồ sơ cá nhân
          </h2>
          <form onSubmit={handleSaveProfile} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="prof-name" className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-1">
                  Tên hiển thị
                </label>
                <input
                  id="prof-name"
                  type="text"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm text-[#17243A] dark:text-[#E5EDF9]"
                />
              </div>
              <div>
                <label htmlFor="prof-grade" className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-1">
                  Khối lớp
                </label>
                <select
                  id="prof-grade"
                  value={grade}
                  onChange={(e) => setGrade(e.target.value as GradeLevel)}
                  className="w-full px-3.5 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm text-[#17243A] dark:text-[#E5EDF9]"
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
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                        active
                          ? 'bg-blue-600 text-white'
                          : 'bg-white/80 dark:bg-slate-900 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-800'
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
                className="text-xs text-slate-600 dark:text-slate-300 hover:text-[#17243A] dark:hover:text-[#E5EDF9] cursor-pointer"
              >
                Hủy
              </button>
            </div>
          </form>
        </GlassSurface>
      )}

      {/* Quick Exam Center & Đua Top Shortcuts (always available) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <GlassSurface
          enableRipple
          onClick={() => onNavigate('exams')}
          className="rounded-2xl p-6 cursor-pointer hover:border-blue-400 transition-colors flex items-center justify-between gap-4"
        >
          <div className="space-y-1">
            <p className="text-xs font-semibold text-blue-700 dark:text-blue-400">
              KIỂM TRA ĐỊNH KỲ · LỚP 10 / 11 / 12
            </p>
            <h2 className="font-display text-lg font-bold text-[#17243A] dark:text-[#E5EDF9]">
              Trung tâm Đề Kiểm Tra Giữa kỳ & Cuối kỳ
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-300">
              Thi thử đề chuẩn ABCD, Đúng/Sai, Trả lời ngắn và nhận điểm ngay.
            </p>
          </div>
          <Award className="w-8 h-8 text-blue-600 dark:text-blue-400 shrink-0" />
        </GlassSurface>

        <GlassSurface
          enableRipple
          onClick={() => onNavigate('leaderboard')}
          className="rounded-2xl p-6 cursor-pointer hover:border-amber-400 transition-colors flex items-center justify-between gap-4"
        >
          <div className="space-y-1">
            <p className="text-xs font-semibold text-amber-600 dark:text-amber-400">
              BẢNG XẾP HẠNG THÀNH TÍCH
            </p>
            <h2 className="font-display text-lg font-bold text-[#17243A] dark:text-[#E5EDF9]">
              Đua Top theo Khối & Toàn trường
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-300">
              Xem thứ hạng của bạn trong Khối 10 / 11 / 12 và toàn trường theo điểm thi.
            </p>
          </div>
          <Trophy className="w-8 h-8 text-amber-500 shrink-0" />
        </GlassSurface>
      </div>

      {/* Summary Metrics */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="glass-surface rounded-2xl p-6 h-32 animate-pulse" />
          ))}
        </div>
      ) : analyses.length === 0 && practiceItems.length === 0 ? (
        <GlassSurface enableRipple className="rounded-3xl p-8 sm:p-10">
          <div className="max-w-2xl">
            <BookOpen className="w-8 h-8 text-blue-600 dark:text-blue-400 mb-4" />
            <h2 className="font-display text-xl sm:text-2xl font-bold text-[#17243A] dark:text-[#E5EDF9]">
              Bắt đầu lần kiểm định kiến thức đầu tiên
            </h2>
            <p className="text-sm sm:text-base text-slate-600 dark:text-slate-300 mt-2 leading-relaxed">
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
                className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:text-blue-600 dark:hover:text-blue-400 cursor-pointer"
              >
                Xem thống kê kiến thức
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </GlassSurface>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5">
            <GlassSurface className="rounded-2xl p-5 flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  Tài liệu đã kiểm định
                </p>
                <p className="font-mono text-2xl font-bold text-[#17243A] dark:text-[#E5EDF9] tabular-nums mt-1">
                  {analyses.length}
                </p>
                <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
                  {completed.length} bài đã hoàn tất
                </p>
              </div>
              <FileCheck2 className="w-7 h-7 text-blue-600 dark:text-blue-400" />
            </GlassSurface>

            <GlassSurface className="rounded-2xl p-5">
              <ScoreRing
                label="Độ chính xác trung bình"
                value={avgAccuracy}
                subtitle={accValues.length > 0 ? `Tính trên ${accValues.length} bài đã xác minh` : 'Chưa đủ dữ liệu'}
                color="sky"
                size={76}
              />
            </GlassSurface>

            <GlassSurface className="rounded-2xl p-5">
              <ScoreRing
                label="Độ đầy đủ trung bình"
                value={avgCompleteness}
                subtitle={
                  compValues.length > 0
                    ? `Bao phủ khung kiến thức (${compValues.length} bài)`
                    : 'Cần chọn sách/chương tham chiếu'
                }
                color="indigo"
                size={76}
              />
            </GlassSurface>

            <GlassSurface
              enableRipple
              onClick={() => onNavigate('practice')}
              className="rounded-2xl p-5 flex items-center justify-between cursor-pointer hover:border-blue-400 transition-colors"
            >
              <div>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  Ngân hàng ôn tập (1/3/7d)
                </p>
                <p className="font-mono text-2xl font-bold text-[#17243A] dark:text-[#E5EDF9] tabular-nums mt-1">
                  {practiceItems.length}
                </p>
                <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                  {dueTodayCount} câu đến hạn ôn hôm nay
                </p>
              </div>
              <Repeat className="w-7 h-7 text-amber-600 dark:text-amber-400" />
            </GlassSurface>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-8 glass-surface rounded-2xl p-6">
              <div className="flex items-center justify-between mb-5">
                <h2 className="font-display text-lg font-bold text-[#17243A] dark:text-[#E5EDF9]">
                  Phân tích gần đây
                </h2>
                <button
                  type="button"
                  onClick={() => onNavigate('history')}
                  className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 dark:text-blue-400 hover:underline cursor-pointer"
                >
                  Xem toàn bộ lịch sử
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="divide-y divide-slate-200/70 dark:divide-slate-700/70">
                {analyses.slice(0, 5).map((item) => (
                  <button
                    key={item.analysisId}
                    type="button"
                    onClick={() => onNavigate('history', item.analysisId)}
                    className="w-full py-3.5 text-left flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-white/60 dark:hover:bg-slate-800/50 px-2 rounded-xl transition-colors cursor-pointer"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#17243A] dark:text-[#E5EDF9] truncate">
                        {item.documentTitle}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        {SUBJECT_LABELS[item.subject]} · Lớp {item.grade} ·{' '}
                        {new Date(item.createdAt).toLocaleDateString('vi-VN')}
                      </p>
                    </div>
                    <div className="flex items-center gap-5 shrink-0 font-mono text-xs tabular-nums">
                      <span className="text-blue-700 dark:text-blue-400">
                        Chính xác: {item.accuracyScore !== null ? `${item.accuracyScore}%` : '—'}
                      </span>
                      <span className="text-indigo-700 dark:text-indigo-400">
                        Đầy đủ: {item.completenessScore !== null ? `${item.completenessScore}%` : '—'}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="lg:col-span-4 space-y-4">
              <GlassSurface
                enableRipple
                onClick={() => onNavigate('analytics')}
                className="rounded-2xl p-6 cursor-pointer hover:border-blue-400 transition-colors"
              >
                <BarChart3 className="w-6 h-6 text-indigo-600 dark:text-indigo-400 mb-3" />
                <h3 className="font-display text-base font-bold text-[#17243A] dark:text-[#E5EDF9]">
                  Thống kê kiến thức đã học
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">
                  Xem bản đồ chương học, các khái niệm hay nhầm lẫn và biểu đồ tiến bộ theo thời gian.
                </p>
              </GlassSurface>

              <GlassSurface
                enableRipple
                onClick={() => onNavigate('history')}
                className="rounded-2xl p-6 cursor-pointer hover:border-blue-400 transition-colors"
              >
                <History className="w-6 h-6 text-blue-600 dark:text-blue-400 mb-3" />
                <h3 className="font-display text-base font-bold text-[#17243A] dark:text-[#E5EDF9]">
                  Lịch sử ưu & nhược điểm
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">
                  Mở lại toàn bộ file gốc, vùng đánh dấu lỗi, dẫn chứng sách và bộ câu hỏi đã lưu.
                </p>
              </GlassSurface>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
