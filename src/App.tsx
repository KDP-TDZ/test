import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  BarChart3,
  ClipboardCheck,
  FilePlus2,
  HelpCircle,
  History,
  LayoutDashboard,
  LogOut,
  MailCheck,
  Repeat,
  Shield,
  Trophy,
} from 'lucide-react';
import { sendEmailVerification } from 'firebase/auth';
import type { QueryDocumentSnapshot } from 'firebase/firestore';
import { BRAND_CONFIG } from './config/brand';
import { AuthProvider, useAuth } from './context/AuthContext';
import { gsap, MOTION_ALLOWED_MEDIA, REDUCED_MOTION_MEDIA, useGSAP } from './lib/gsapSetup';
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
import { HamburgerButton, NavigationDrawer } from './components/LiquidGlass/NavigationDrawer';
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
  const navRef = useRef<HTMLElement>(null);
  const hamburgerBtnRef = useRef<HTMLButtonElement>(null);
  const motionAllowedRef = useRef(true);
  const mobileNavDrawerId = 'studycheck-navigation-drawer';

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

  const { contextSafe } = useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_ALLOWED_MEDIA, () => {
        motionAllowedRef.current = true;
        if (mobileMenuOpen && user?.emailVerified && navRef.current) {
          gsap.from('.nav-item', {
            y: 10,
            autoAlpha: 0,
            duration: 0.28,
            stagger: 0.03,
            ease: 'power2.out',
            clearProps: 'transform,opacity,visibility',
          });
        }
        return () => {
          motionAllowedRef.current = false;
        };
      });
      mm.add(REDUCED_MOTION_MEDIA, () => {
        motionAllowedRef.current = false;
      });
    },
    { scope: navRef, dependencies: [mobileMenuOpen, user?.uid, Boolean(user?.emailVerified)] }
  );

  const handleNavMouseEnter = contextSafe(
    (target: HTMLButtonElement, isActive: boolean) => {
      const isDark = document.documentElement.classList.contains('dark');
      const hoverBg = isDark ? 'rgba(56, 189, 248, 0.16)' : 'rgba(224, 242, 254, 0.78)';

      if (!motionAllowedRef.current) {
        if (!isActive) {
          gsap.set(target, { backgroundColor: hoverBg });
        }
        return;
      }

      gsap.to(target, {
        scale: 1.02,
        ...(isActive ? {} : { backgroundColor: hoverBg }),
        duration: 0.22,
        ease: 'power2.out',
        overwrite: 'auto',
      });
    }
  );

  const handleNavMouseLeave = contextSafe(
    (target: HTMLButtonElement, isActive: boolean) => {
      const isDark = document.documentElement.classList.contains('dark');
      const restBg = isDark ? 'rgba(56, 189, 248, 0)' : 'rgba(224, 242, 254, 0)';

      if (!motionAllowedRef.current) {
        gsap.set(target, { clearProps: 'transform,backgroundColor' });
        return;
      }

      gsap.to(target, {
        scale: 1,
        ...(isActive ? {} : { backgroundColor: restBg }),
        duration: 0.2,
        ease: 'power2.out',
        overwrite: 'auto',
        clearProps: isActive ? 'transform' : 'transform,backgroundColor',
      });
    }
  );

  const handleNavItemClick = contextSafe(
    (target: HTMLButtonElement, view: AppView) => {
      gsap.set(target, { clearProps: 'backgroundColor' });
      if (motionAllowedRef.current) {
        gsap.to(target, {
          scale: 1,
          duration: 0.15,
          ease: 'power2.out',
          overwrite: 'auto',
          clearProps: 'transform',
        });
      }
      handleNavigate(view);
    }
  );

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
        <GlassSurface className="rounded-3xl px-8 py-7 text-center">
          <div className="h-6 w-6 rounded-full border-2 border-sky-500 border-t-transparent animate-spin mx-auto mb-3" />
          <p className="text-sm font-medium text-[#16243E] dark:text-[#E6EFFC]">
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
          <h1 className="font-display text-[clamp(1.25rem,3.2vw,1.5rem)] font-bold text-[#16243E] dark:text-[#E6EFFC]">
            Xác minh địa chỉ email của bạn
          </h1>
          <p className="text-xs sm:text-sm text-[#475B78] dark:text-[#B4C7E2] leading-[1.6] prose-measure mx-auto">
            Tài khoản <strong>{user.email}</strong> cần được xác minh email để bảo vệ dữ liệu học tập
            và tuân thủ quy tắc bảo mật hệ thống. Nếu đây là địa chỉ Gmail, bạn có thể bấm liên kết trong
            hộp thư hoặc đăng xuất rồi chọn <strong>Tiếp tục với Google</strong> để xác minh tự động.
          </p>
          {verificationMsg && (
            <p className="text-xs text-emerald-700 dark:text-emerald-300 bg-emerald-50/90 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 rounded-2xl p-3">
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
              className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 mt-1 cursor-pointer"
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
      <header className="sticky top-0 z-[45] glass-nav no-print">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 h-16 flex items-center justify-between gap-6">
          <div className="flex items-center gap-2.5 sm:gap-3">
            <HamburgerButton
              buttonRef={hamburgerBtnRef}
              open={mobileMenuOpen}
              controlsId={mobileNavDrawerId}
              onToggle={() => setMobileMenuOpen((v) => !v)}
            />
            <button
              type="button"
              onClick={() => handleNavigate('dashboard')}
              className="font-display text-base sm:text-lg font-bold tracking-tight text-[#16243E] dark:text-[#E6EFFC] whitespace-nowrap shrink-0 cursor-pointer"
            >
              {BRAND_CONFIG.name}
            </button>
          </div>

          <div className="flex items-center gap-2.5 sm:gap-4 shrink-0">
            <ThemeToggle />
            <div className="hidden sm:block text-right">
              <p className="text-xs font-semibold text-[#16243E] dark:text-[#E6EFFC] truncate max-w-[180px]">
                {profile?.displayName || user.displayName || user.email}
              </p>
              <p className="text-[11px] text-[#475B78] dark:text-[#B4C7E2]">
                {isSuperAdmin ? 'Super Admin' : `Học sinh · Lớp ${profile?.grade || '10'}`}
              </p>
            </div>
            <button
              type="button"
              onClick={logout}
              className="inline-flex items-center justify-center gap-1.5 min-h-[40px] px-3 sm:px-3.5 py-2 rounded-xl text-xs font-medium glass-control whitespace-nowrap shrink-0 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Đăng xuất</span>
            </button>
          </div>
        </div>
      </header>

      <MaintenanceBanner config={systemStatus} />

      {/* Off-canvas Navigation Drawer */}
      <NavigationDrawer
        id={mobileNavDrawerId}
        open={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        triggerRef={hamburgerBtnRef}
        panelRef={navRef}
        ariaLabel="Điều hướng chính"
        footer={
          <div className="space-y-2.5">
            <div className="px-2">
              <p className="text-xs font-semibold text-[#16243E] dark:text-[#E6EFFC] truncate">
                {profile?.displayName || user.displayName || user.email}
              </p>
              <p className="text-[11px] text-[#475B78] dark:text-[#B4C7E2]">
                {isSuperAdmin ? 'Super Admin' : `Học sinh · Lớp ${profile?.grade || '10'}`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setMobileMenuOpen(false);
                logout();
              }}
              className="w-full min-h-[40px] flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold glass-control cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Đăng xuất</span>
            </button>
          </div>
        }
      >
        <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#64748B] dark:text-[#94A3B8]">
          Điều hướng
        </p>
        <div className="space-y-1">
          {navItems
            .filter((item) => item.id !== 'admin')
            .map((item) => {
              const Icon = item.icon;
              const active =
                activeView === item.id || (activeView === 'report' && item.id === 'upload');
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-current={active ? 'page' : undefined}
                  onClick={(e) => handleNavItemClick(e.currentTarget, item.id)}
                  onMouseEnter={(e) => handleNavMouseEnter(e.currentTarget, active)}
                  onMouseLeave={(e) => handleNavMouseLeave(e.currentTarget, active)}
                  className={`nav-item w-full min-h-[42px] flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-left cursor-pointer ${
                    active
                      ? 'bg-sky-500/18 dark:bg-white/12 text-[#0F172A] dark:text-white font-semibold border border-sky-300/50 dark:border-white/15 shadow-xs'
                      : 'text-[#334155] dark:text-[#CBD5E1] font-medium'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0 opacity-85" />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
        </div>

        {isSuperAdmin && (
          <div className="mt-5 pt-4 border-t border-sky-200/60 dark:border-slate-800/80">
            <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#64748B] dark:text-[#94A3B8]">
              Quản trị
            </p>
            {navItems
              .filter((item) => item.id === 'admin')
              .map((item) => {
                const Icon = item.icon;
                const active = activeView === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-current={active ? 'page' : undefined}
                    onClick={(e) => handleNavItemClick(e.currentTarget, item.id)}
                    onMouseEnter={(e) => handleNavMouseEnter(e.currentTarget, active)}
                    onMouseLeave={(e) => handleNavMouseLeave(e.currentTarget, active)}
                    className={`nav-item w-full min-h-[42px] flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-left cursor-pointer ${
                      active
                        ? 'bg-sky-500/18 dark:bg-white/12 text-[#0F172A] dark:text-white font-semibold border border-sky-300/50 dark:border-white/15 shadow-xs'
                        : 'text-[#334155] dark:text-[#CBD5E1] font-medium'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0 opacity-85" />
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
          </div>
        )}
      </NavigationDrawer>

      {/* Main Workspace Container */}
      <div className="flex-1 mx-auto w-full max-w-6xl px-3.5 sm:px-6 py-4 sm:py-6">
        {/* Active View Content */}
        <main className="min-w-0">
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
