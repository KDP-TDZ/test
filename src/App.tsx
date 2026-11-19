import React, { useCallback, useEffect, useState } from 'react';
import {
  BarChart3,
  ClipboardCheck,
  FilePlus2,
  HelpCircle,
  History,
  LayoutDashboard,
  LogOut,
  MailCheck,
  Menu,
  Repeat,
  Shield,
  Trophy,
  X,
} from 'lucide-react';
import { sendEmailVerification } from 'firebase/auth';
import type { QueryDocumentSnapshot } from 'firebase/firestore';
import { BRAND_CONFIG } from './config/brand';
import { AuthProvider, useAuth } from './context/AuthContext';
import type {
  AnalysisRecord,
  KnowledgeProgress,
  PracticeItem,
  QuizAttempt,
} from './core/types';
import {
  listPracticeItems,
  listUserAnalyses,
  listUserKnowledgeProgress,
  listUserQuizAttempts,
} from './services/firestoreService';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AmbientCanvas } from './components/LiquidGlass/AmbientCanvas';
import { GlassSurface } from './components/LiquidGlass/GlassSurface';
import { MaintenanceBanner } from './components/LiquidGlass/MaintenanceBanner';
import { ThemeToggle } from './components/LiquidGlass/ThemeToggle';
import { WaterRippleButton } from './components/LiquidGlass/WaterRippleButton';
import { LandingPage } from './components/LandingPage';
import { AuthModal } from './components/AuthModal';
import { StudentDashboard } from './components/StudentDashboard';
import { UploadWorkspace } from './components/UploadWorkspace';
import { AnalysisReportView } from './components/AnalysisReportView';
import { QuizWorkspace } from './components/QuizWorkspace';
import { PracticeBankView } from './components/PracticeBankView';
import { LearningAnalyticsView } from './components/LearningAnalyticsView';
import { HistoryView } from './components/HistoryView';
import { ExamCenterView } from './components/ExamCenterView';
import { LeaderboardView } from './components/LeaderboardView';
import { AdminControlCenter } from './components/AdminControlCenter';

type AppView =
  | 'dashboard'
  | 'upload'
  | 'report'
  | 'quiz'
  | 'practice'
  | 'exams'
  | 'leaderboard'
  | 'analytics'
  | 'history'
  | 'admin';

const StudyCheckShell: React.FC = () => {
  const { user, profile, isSuperAdmin, loading, systemStatus, logout, refreshProfile } = useAuth();

  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<'login' | 'register'>('login');

  const [activeView, setActiveView] = useState<AppView>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Student Workspace Data
  const [dataLoading, setDataLoading] = useState(false);
  const [analyses, setAnalyses] = useState<AnalysisRecord[]>([]);
  const [analysesCursor, setAnalysesCursor] = useState<QueryDocumentSnapshot | null>(null);
  const [analysesHasMore, setAnalysesHasMore] = useState(false);
  const [loadingMoreHistory, setLoadingMoreHistory] = useState(false);

  const [practiceItems, setPracticeItems] = useState<PracticeItem[]>([]);
  const [knowledgeProgress, setKnowledgeProgress] = useState<KnowledgeProgress[]>([]);
  const [quizAttempts, setQuizAttempts] = useState<QuizAttempt[]>([]);

  const [activeReport, setActiveReport] = useState<{
    record: AnalysisRecord;
    localFile: File | null;
  } | null>(null);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const [quizSourceAnalysis, setQuizSourceAnalysis] = useState<AnalysisRecord | null>(null);
  const [practiceInitialTab, setPracticeInitialTab] = useState<'bank' | 'sprint10' | 'flashcards'>('bank');
  const [verificationMsg, setVerificationMsg] = useState<string | null>(null);

  const loadStudentData = useCallback(async (uid: string) => {
    setDataLoading(true);
    try {
      const [anRes, prac, prog, attempts] = await Promise.all([
        listUserAnalyses(uid, 15),
        listPracticeItems(uid),
        listUserKnowledgeProgress(uid),
        listUserQuizAttempts(uid),
      ]);
      setAnalyses(anRes.items);
      setAnalysesCursor(anRes.lastDoc);
      setAnalysesHasMore(anRes.hasMore);
      setPracticeItems(prac);
      setKnowledgeProgress(prog);
      setQuizAttempts(attempts);
    } catch (err) {
      console.error('Failed to load student data:', err);
    } finally {
      setDataLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user && user.emailVerified) {
      loadStudentData(user.uid);
    } else {
      setAnalyses([]);
      setPracticeItems([]);
      setKnowledgeProgress([]);
      setQuizAttempts([]);
    }
  }, [user, loadStudentData]);

  const handleLoadMoreHistory = async () => {
    if (!user || !analysesCursor || !analysesHasMore) return;
    setLoadingMoreHistory(true);
    try {
      const next = await listUserAnalyses(user.uid, 15, analysesCursor);
      setAnalyses((prev) => [...prev, ...next.items]);
      setAnalysesCursor(next.lastDoc);
      setAnalysesHasMore(next.hasMore);
    } finally {
      setLoadingMoreHistory(false);
    }
  };

  const handleNavigate = (
    view: AppView,
    analysisId?: string,
    subTab?: 'bank' | 'sprint10' | 'flashcards'
  ) => {
    setMobileMenuOpen(false);
    if (view === 'history') {
      setSelectedHistoryId(analysisId || null);
    }
    if (view === 'practice') {
      setPracticeInitialTab(subTab || 'bank');
    }
    if (view === 'analytics' && user?.emailVerified) {
      Promise.all([
        listUserKnowledgeProgress(user.uid),
        listUserQuizAttempts(user.uid),
      ])
        .then(([prog, att]) => {
          setKnowledgeProgress(prog);
          setQuizAttempts(att);
        })
        .catch(() => undefined);
    }
    if (view === 'practice' && user?.emailVerified) {
      listPracticeItems(user.uid)
        .then((p) => setPracticeItems(p))
        .catch(() => undefined);
    }
    setActiveView(view);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <GlassSurface className="rounded-2xl px-8 py-6 text-center">
          <div className="h-6 w-6 rounded-full border-2 border-sky-600 border-t-transparent animate-spin mx-auto mb-3" />
          <p className="text-sm font-medium text-[#17243A] dark:text-[#E5EDF9]">
            Đang khởi tạo {BRAND_CONFIG.name}...
          </p>
        </GlassSurface>
      </div>
    );
  }

  // Unauthenticated Landing Experience
  if (!user) {
    return (
      <>
        <LandingPage
          onOpenAuth={(mode) => {
            setAuthModalMode(mode);
            setAuthModalOpen(true);
          }}
        />
        <AuthModal
          open={authModalOpen}
          initialMode={authModalMode}
          onClose={() => setAuthModalOpen(false)}
        />
      </>
    );
  }

  // Email Verification Gate (matches Firestore Rules email_verified == true requirement)
  if (!user.emailVerified) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <GlassSurface className="max-w-md w-full rounded-3xl p-8 text-center space-y-4">
          <MailCheck className="w-12 h-12 text-sky-600 dark:text-sky-400 mx-auto" />
          <h1 className="font-display text-xl font-bold text-[#17243A] dark:text-[#E5EDF9]">
            Xác minh địa chỉ email của bạn
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            Tài khoản <strong>{user.email}</strong> cần được xác minh email để bảo vệ dữ liệu học tập
            và tuân thủ quy tắc bảo mật hệ thống. Nếu đây là địa chỉ Gmail, bạn có thể bấm liên kết trong
            hộp thư hoặc đăng xuất rồi chọn <strong>Tiếp tục với Google</strong> để xác minh tự động.
          </p>
          {verificationMsg && (
            <p className="text-xs text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 rounded-xl p-3">
              {verificationMsg}
            </p>
          )}
          <div className="flex flex-col gap-2.5 pt-2">
            <WaterRippleButton
              onClick={async () => {
                await user.reload();
                await refreshProfile(user);
                if (!user.emailVerified) {
                  setVerificationMsg('Email vẫn chưa được xác minh. Vui lòng bấm vào liên kết trong hộp thư.');
                }
              }}
            >
              Tôi đã xác minh — Kiểm tra lại
            </WaterRippleButton>
            <WaterRippleButton
              variant="secondary"
              onClick={async () => {
                await sendEmailVerification(user);
                setVerificationMsg('Đã gửi lại email xác minh. Vui lòng kiểm tra hộp thư hoặc thư rác.');
              }}
            >
              Gửi lại email xác minh
            </WaterRippleButton>
            <button
              type="button"
              onClick={logout}
              className="text-xs text-slate-500 hover:text-slate-800 mt-1 cursor-pointer"
            >
              Đăng xuất
            </button>
          </div>
        </GlassSurface>
      </div>
    );
  }

  const navItems: Array<{ id: AppView; label: string; icon: React.FC<{ className?: string }> }> = [
    { id: 'dashboard', label: 'Tổng quan', icon: LayoutDashboard },
    { id: 'upload', label: 'Kiểm định mới', icon: FilePlus2 },
    { id: 'exams', label: 'Trung tâm Đề kiểm tra', icon: ClipboardCheck },
    { id: 'leaderboard', label: 'Đua Top Khối & Trường', icon: Trophy },
    { id: 'practice', label: 'Ngân hàng luyện tập', icon: Repeat },
    { id: 'quiz', label: 'Bài trắc nghiệm', icon: HelpCircle },
    { id: 'analytics', label: 'Thống kê kiến thức đã học', icon: BarChart3 },
    { id: 'history', label: 'Lịch sử phân tích', icon: History },
    ...(isSuperAdmin ? [{ id: 'admin' as AppView, label: 'Quản trị hệ thống', icon: Shield }] : []),
  ];

  return (
    <div className="min-h-screen flex flex-col">
      {/* Authenticated Top Header */}
      <header className="sticky top-0 z-40 glass-nav no-print">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              aria-label="Mở menu điều hướng"
              className="lg:hidden p-2 rounded-lg text-[#17243A] dark:text-[#E5EDF9] hover:bg-slate-900/5 dark:hover:bg-white/10 cursor-pointer"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
            <button
              type="button"
              onClick={() => handleNavigate('dashboard')}
              className="font-display text-lg font-bold tracking-tight text-[#17243A] dark:text-[#E5EDF9] whitespace-nowrap shrink-0 cursor-pointer"
            >
              {BRAND_CONFIG.name}
            </button>
          </div>

          <div className="flex items-center gap-3 sm:gap-4">
            <ThemeToggle />
            <div className="hidden sm:block text-right">
              <p className="text-xs font-semibold text-[#17243A] dark:text-[#E5EDF9]">
                {profile?.displayName || user.displayName || user.email}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {isSuperAdmin ? 'Super Admin' : `Học sinh · Lớp ${profile?.grade || '10'}`}
              </p>
            </div>
            <button
              type="button"
              onClick={logout}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-[#17243A] dark:text-[#E5EDF9] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Đăng xuất</span>
            </button>
          </div>
        </div>
      </header>

      <MaintenanceBanner config={systemStatus} />

      {/* Main Responsive Workspace Grid */}
      <div className="flex-1 mx-auto w-full max-w-7xl px-4 sm:px-6 py-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Sidebar Navigation (Desktop persistent, Mobile drawer) */}
        <aside
          className={`${
            mobileMenuOpen ? 'block' : 'hidden'
          } lg:block lg:col-span-3 lg:sticky lg:top-22 glass-surface rounded-2xl p-3 space-y-1 no-print`}
        >
          {navItems.map((item) => {
            const Icon = item.icon;
            const active =
              activeView === item.id || (activeView === 'report' && item.id === 'upload');
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNavigate(item.id)}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-medium transition-all text-left cursor-pointer ${
                  active
                    ? 'bg-sky-600 text-white shadow-xs'
                    : 'text-[#17243A] dark:text-[#E5EDF9] hover:bg-white/80 dark:hover:bg-slate-800/80'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </aside>

        {/* Active View Content */}
        <main className="lg:col-span-9 min-w-0">
          {activeView === 'dashboard' && (
            <StudentDashboard
              analyses={analyses}
              practiceItems={practiceItems}
              loading={dataLoading}
              onNavigate={(view, id) => handleNavigate(view, id)}
            />
          )}

          {activeView === 'upload' && (
            <UploadWorkspace
              onAnalysisCompleted={(record, localFile) => {
                setAnalyses((prev) => [record, ...prev]);
                setActiveReport({ record, localFile });
                setActiveView('report');
              }}
            />
          )}

          {activeView === 'report' && activeReport && (
            <AnalysisReportView
              analysis={activeReport.record}
              allAnalyses={analyses}
              localFile={activeReport.localFile}
              onStartQuiz={(an) => {
                setQuizSourceAnalysis(an);
                setActiveView('quiz');
              }}
              onOpenFlashcards={() => handleNavigate('practice', undefined, 'flashcards')}
              onBack={() => handleNavigate('history')}
            />
          )}

          {activeView === 'exams' && (
            <ExamCenterView onOpenLeaderboard={() => handleNavigate('leaderboard')} />
          )}

          {activeView === 'leaderboard' && (
            <LeaderboardView onOpenExams={() => handleNavigate('exams')} />
          )}

          {activeView === 'quiz' && (
            <QuizWorkspace
              sourceAnalysis={quizSourceAnalysis}
              onOpenPracticeBank={() => handleNavigate('practice')}
            />
          )}

          {activeView === 'practice' && (
            <PracticeBankView
              items={practiceItems}
              onItemsChange={setPracticeItems}
              initialSubTab={practiceInitialTab}
            />
          )}

          {activeView === 'analytics' && (
            <LearningAnalyticsView
              progressList={knowledgeProgress}
              quizAttempts={quizAttempts}
              analyses={analyses}
              onJumpToPractice={() => handleNavigate('practice')}
              onStartUpload={() => handleNavigate('upload')}
            />
          )}

          {activeView === 'history' && (
            <HistoryView
              analyses={analyses}
              selectedAnalysisId={selectedHistoryId}
              hasMore={analysesHasMore}
              loadingMore={loadingMoreHistory}
              onSelectAnalysis={setSelectedHistoryId}
              onLoadMore={handleLoadMoreHistory}
              onDeleted={(id) => {
                setAnalyses((prev) => prev.filter((a) => a.analysisId !== id));
                if (selectedHistoryId === id) setSelectedHistoryId(null);
              }}
              onStartQuiz={(an) => {
                setQuizSourceAnalysis(an);
                setActiveView('quiz');
              }}
              onOpenFlashcards={() => handleNavigate('practice', undefined, 'flashcards')}
            />
          )}

          {activeView === 'admin' && <AdminControlCenter />}
        </main>
      </div>
    </div>
  );
};

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <AmbientCanvas>
          <StudyCheckShell />
        </AmbientCanvas>
      </AuthProvider>
    </ErrorBoundary>
  );
}
