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
  Search,
  Shield,
  Sparkles,
  Trophy,
} from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { sendEmailVerification } from 'firebase/auth';
import type { QueryDocumentSnapshot } from 'firebase/firestore';
import { BRAND_CONFIG } from './config/brand';
import { AuthProvider, useAuth } from './context/AuthContext';
import { PrivacyBlurProvider } from './context/PrivacyBlurContext';
import { useUiMode } from './context/UiModeContext';
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
import { AccountMenu } from './components/LiquidGlass/AccountMenu';
import { AmbientCanvas } from './components/LiquidGlass/AmbientCanvas';
import { CommandPalette } from './components/LiquidGlass/CommandPalette';
import { FloatingDock } from './components/LiquidGlass/FloatingDock';
import { GlassSurface } from './components/LiquidGlass/GlassSurface';
import { MaintenanceBanner } from './components/LiquidGlass/MaintenanceBanner';
import { MobileBottomNav } from './components/LiquidGlass/MobileBottomNav';
import { HamburgerButton, NavigationDrawer } from './components/LiquidGlass/NavigationDrawer';
import { TabContentFade } from './components/LiquidGlass/SlidingTabs';
import { WaterRippleButton } from './components/LiquidGlass/WaterRippleButton';
import { useIsMobileViewport } from './hooks/useIsMobileViewport';
import { LandingPage } from './components/LandingPage';
import { AuthModal } from './components/AuthModal';
import { StudentDashboard } from './components/StudentDashboard';
import { EtherealStudentDashboard } from './components/EtherealStudentDashboard';
import { UploadWorkspace } from './components/UploadWorkspace';

function lazyWithRetry<T extends React.ComponentType<any>>(
  factory: () => Promise<{ default: T }>
): React.LazyExoticComponent<T> {
  return React.lazy(async () => {
    try {
      return await factory();
    } catch (err) {
      // Retry once after 600ms for transient 4G / Vite chunk load hiccups
      await new Promise((r) => setTimeout(r, 600));
      return await factory();
    }
  });
}

const AnalysisReportView = lazyWithRetry(() =>
  import('./components/AnalysisReportView').then((m) => ({ default: m.AnalysisReportView }))
);
const QuizWorkspace = lazyWithRetry(() =>
  import('./components/QuizWorkspace').then((m) => ({ default: m.QuizWorkspace }))
);
const PracticeBankView = lazyWithRetry(() =>
  import('./components/PracticeBankView').then((m) => ({ default: m.PracticeBankView }))
);
const LearningAnalyticsView = lazyWithRetry(() =>
  import('./components/LearningAnalyticsView').then((m) => ({ default: m.LearningAnalyticsView }))
);
const HistoryView = lazyWithRetry(() =>
  import('./components/HistoryView').then((m) => ({ default: m.HistoryView }))
);
const ExamCenterView = lazyWithRetry(() =>
  import('./components/ExamCenterView').then((m) => ({ default: m.ExamCenterView }))
);
const LeaderboardView = lazyWithRetry(() =>
  import('./components/LeaderboardView').then((m) => ({ default: m.LeaderboardView }))
);
const AdminControlCenter = lazyWithRetry(() =>
  import('./components/AdminControlCenter').then((m) => ({ default: m.AdminControlCenter }))
);

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
  const { isEthereal } = useUiMode();
  const isMobile = useIsMobileViewport();
  const prefersReduced = useReducedMotion();

  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<'login' | 'register'>('login');

  const [activeView, setActiveView] = useState<AppView>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const hamburgerBtnRef = useRef<HTMLButtonElement>(null);
  const motionAllowedRef = useRef(true);
  const mobileNavDrawerId = 'studycheck-navigation-drawer';

  // Global Ctrl+K / Cmd+K shortcut for Command Palette
  useEffect(() => {
    if (!user?.emailVerified) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandPaletteOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [user?.emailVerified]);

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
    if ((view === 'practice' || view === 'dashboard') && user?.emailVerified) {
      listPracticeItems(user.uid)
        .then((p) => setPracticeItems(p))
        .catch(() => undefined);
    }
    setActiveView(view);
  };

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center p-6">
        <GlassSurface className="rounded-3xl px-8 py-7 text-center">
          <div className="size-6 rounded-full border-2 border-sky-500 border-t-transparent animate-spin mx-auto mb-3" />
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
      <div className="min-h-dvh flex items-center justify-center p-6">
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

  const navItems: Array<{
    id: AppView;
    label: string;
    shortLabel: string;
    hint: string;
    icon: React.FC<{ className?: string }>;
  }> = [
    { id: 'dashboard', label: 'Tổng quan', shortLabel: 'Tổng quan', hint: 'Bảng điều khiển học tập', icon: LayoutDashboard },
    { id: 'upload', label: 'Kiểm định mới', shortLabel: 'Kiểm định', hint: 'Tải vở ghi, PDF hoặc DOCX', icon: FilePlus2 },
    { id: 'exams', label: 'Trung tâm Đề kiểm tra', shortLabel: 'Đề kiểm tra', hint: 'Thi thử chuẩn GDPT 2018', icon: ClipboardCheck },
    { id: 'leaderboard', label: 'Đua Top Khối & Trường', shortLabel: 'Đua Top', hint: 'Bảng xếp hạng theo khối', icon: Trophy },
    { id: 'practice', label: 'Ngân hàng luyện tập', shortLabel: 'Luyện tập', hint: 'Ôn câu sai & Flashcard', icon: Repeat },
    { id: 'quiz', label: 'Bài trắc nghiệm', shortLabel: 'Trắc nghiệm', hint: 'Đề thích ứng & nâng cao', icon: HelpCircle },
    { id: 'analytics', label: 'Thống kê kiến thức đã học', shortLabel: 'Thống kê', hint: 'Bản đồ chương & tiến bộ', icon: BarChart3 },
    { id: 'history', label: 'Lịch sử phân tích', shortLabel: 'Lịch sử', hint: 'Xem lại bài đã chấm', icon: History },
    ...(isSuperAdmin
      ? [{ id: 'admin' as AppView, label: 'Quản trị hệ thống', shortLabel: 'Quản trị', hint: 'Model Router, đề thi & nguồn', icon: Shield }]
      : []),
  ];

  const etherealTopTabs: AppView[] = ['dashboard', 'upload', 'practice', 'exams'];
  const nowIso = new Date().toISOString();
  const duePracticeCount = practiceItems.filter(
    (p) => !p.nextReviewAt || p.nextReviewAt <= nowIso
  ).length;

  const renderActiveWorkspaceView = () => (
    <React.Suspense
      fallback={
        <div className="py-12 flex items-center justify-center">
          <div className="inline-flex items-center gap-2.5 px-4 py-2.5 rounded-2xl bg-white/80 dark:bg-slate-900/80 border border-slate-200/80 dark:border-slate-800 text-xs font-medium text-slate-600 dark:text-slate-300">
            <span className="size-4 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
            <span>Đang tải không gian học tập...</span>
          </div>
        </div>
      }
    >
      <TabContentFade activeKey={activeView}>
      {activeView === 'dashboard' &&
        (isEthereal && !isMobile ? (
          <EtherealStudentDashboard
            analyses={analyses}
            practiceItems={practiceItems}
            loading={dataLoading}
            onNavigate={(view, id, subTab) => handleNavigate(view, id, subTab)}
          />
        ) : (
          <StudentDashboard
            analyses={analyses}
            practiceItems={practiceItems}
            loading={dataLoading}
            onNavigate={(view, id) => handleNavigate(view, id)}
          />
        ))}

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
          onStartNewUpload={() => handleNavigate('upload')}
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
      </TabContentFade>
    </React.Suspense>
  );

  const sharedDrawer = (
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
          <div className="pt-2 border-t border-sky-200/50 dark:border-slate-800/80 flex items-center justify-between px-2">
            <div>
              <p className="text-[10px] text-slate-500 dark:text-slate-400">Phát triển bởi</p>
              <p className="text-[11px] font-bold text-[#16243E] dark:text-[#E6EFFC]">
                {BRAND_CONFIG.authorName}
              </p>
            </div>
            <div className="h-8 w-24 overflow-hidden flex items-center justify-center rounded-lg">
              <img
                src={BRAND_CONFIG.signatureImageUrl}
                alt={`Chữ ký ${BRAND_CONFIG.authorName}`}
                data-no-privacy-blur="true"
                className="w-full h-full object-contain scale-[2.3] select-none pointer-events-none mix-blend-multiply dark:invert dark:mix-blend-screen"
              />
            </div>
          </div>
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
                    ? isEthereal
                      ? 'bg-indigo-500/15 dark:bg-indigo-400/20 text-[#171B3A] dark:text-white font-semibold border border-indigo-300/60 dark:border-indigo-400/30 shadow-xs'
                      : 'bg-sky-500/18 dark:bg-white/12 text-[#0F172A] dark:text-white font-semibold border border-sky-300/50 dark:border-white/15 shadow-xs'
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
                      ? isEthereal
                        ? 'bg-indigo-500/15 dark:bg-indigo-400/20 text-[#171B3A] dark:text-white font-semibold border border-indigo-300/60 dark:border-indigo-400/30 shadow-xs'
                        : 'bg-sky-500/18 dark:bg-white/12 text-[#0F172A] dark:text-white font-semibold border border-sky-300/50 dark:border-white/15 shadow-xs'
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
  );

  const sharedCommandPalette = (
    <CommandPalette
      open={commandPaletteOpen}
      onClose={() => setCommandPaletteOpen(false)}
      navItems={navItems.map((n) => ({
        id: n.id,
        label: n.label,
        hint: n.hint,
        icon: n.icon,
      }))}
      analyses={analyses}
      onSelectNav={(id) => handleNavigate(id as AppView)}
      onSelectAnalysis={(analysisId) => handleNavigate('history', analysisId)}
    />
  );

  // === DEDICATED ULTRA-LIGHTWEIGHT MOBILE NATIVE SHELL (< 768px) ===
  // Separate flat high-performance CSS & thumb-first Bottom Tab Bar (zero Liquid Glass lag)
  if (isMobile) {
    return (
      <div className="min-h-dvh flex flex-col bg-[#F8FAFC] dark:bg-[#0B1120]">
        <header className="sticky top-0 z-[45] no-print bg-white dark:bg-[#111827] border-b border-slate-200 dark:border-slate-800 h-[52px] px-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <HamburgerButton
              buttonRef={hamburgerBtnRef}
              open={mobileMenuOpen}
              controlsId={mobileNavDrawerId}
              onToggle={() => setMobileMenuOpen((v) => !v)}
            />
            <button
              type="button"
              onClick={() => handleNavigate('dashboard')}
              className="font-display text-[15px] font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap truncate cursor-pointer"
            >
              {BRAND_CONFIG.name}
            </button>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setCommandPaletteOpen(true)}
              aria-label="Tìm kiếm nhanh"
              title="Tìm kiếm nhanh"
              className="size-10 inline-flex items-center justify-center rounded-xl text-slate-600 dark:text-slate-300 active:bg-slate-100 dark:active:bg-slate-800 cursor-pointer"
            >
              <Search className="size-[18px]" />
            </button>
            <AccountMenu />
          </div>
        </header>

        <MaintenanceBanner config={systemStatus} />
        {sharedDrawer}
        {sharedCommandPalette}

        <main className="flex-1 min-w-0 w-full px-4 pt-4 pb-20">
          {renderActiveWorkspaceView()}
        </main>

        <MobileBottomNav
          activeId={activeView}
          duePracticeCount={duePracticeCount}
          onSelect={(id) => handleNavigate(id)}
        />
      </div>
    );
  }

  // === MODERN LIQUID GLASS & BENTO STUDIO SHELL (UI MODE 2 — TABLET & DESKTOP) ===
  if (isEthereal) {
    return (
      <div className="min-h-dvh flex flex-col">
        <MaintenanceBanner config={systemStatus} />
        {sharedDrawer}
        {sharedCommandPalette}

        <div className="flex-1 mx-auto w-full max-w-[1240px] px-4 sm:px-6 pt-4 sm:pt-6 pb-28">
          <div className="ethereal-studio-canvas rounded-[30px] sm:rounded-[34px] overflow-x-clip min-h-[calc(100dvh-8.5rem)] flex flex-col">
            {/* Site Header + Semantic Navigation Bar (3-Zone Zero-Overflow Contract) */}
            <header className="sticky top-0 z-[40] no-print bg-white/88 dark:bg-[#14193A]/88 backdrop-blur-xl border-b border-indigo-100/80 dark:border-indigo-400/15 px-5 lg:px-7 h-16 flex items-center justify-between gap-4 rounded-t-[30px] sm:rounded-t-[34px]">
              <div className="flex items-center gap-2.5 min-w-0 shrink-0">
                <HamburgerButton
                  buttonRef={hamburgerBtnRef}
                  open={mobileMenuOpen}
                  controlsId={mobileNavDrawerId}
                  onToggle={() => setMobileMenuOpen((v) => !v)}
                />
                <button
                  type="button"
                  onClick={() => handleNavigate('dashboard')}
                  className="inline-flex items-center gap-2 cursor-pointer shrink-0 group rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  <span className="size-8 rounded-xl bg-gradient-to-br from-[#4F46E5] via-[#6366F1] to-[#9333EA] text-white flex items-center justify-center shadow-[0_6px_16px_-4px_rgba(79,70,229,0.55)] group-hover:scale-105 transition-transform duration-150">
                    <Sparkles className="size-4" />
                  </span>
                  <span className="font-display text-base sm:text-lg font-bold tracking-tight text-[#4338CA] dark:text-[#C7D2FE] whitespace-nowrap">
                    {BRAND_CONFIG.name}
                  </span>
                </button>
              </div>

              {/* Centered Pill Navigation Bar (Desktop) */}
              <nav
                aria-label="Điều hướng chính"
                className="hidden lg:flex items-center gap-1"
              >
                {navItems
                  .filter((item) => etherealTopTabs.includes(item.id))
                  .map((item) => {
                    const active =
                      activeView === item.id ||
                      (activeView === 'report' && item.id === 'upload');
                    return (
                      <button
                        key={item.id}
                        type="button"
                        aria-current={active ? 'page' : undefined}
                        onClick={() => handleNavigate(item.id)}
                        className={`relative px-3.5 py-2 rounded-xl text-xs font-semibold transition-colors duration-150 cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                          active
                            ? 'text-[#312E81] dark:text-white'
                            : 'text-[#6B7499] dark:text-[#A5B1D8] hover:text-[#171B3A] dark:hover:text-white'
                        }`}
                      >
                        {active && (
                          <motion.span
                            layoutId="ethereal-top-nav-pill"
                            aria-hidden="true"
                            transition={
                              prefersReduced
                                ? { duration: 0 }
                                : { type: 'spring', stiffness: 520, damping: 38, mass: 0.65 }
                            }
                            className="absolute inset-0 rounded-xl bg-[#EEF0FF] dark:bg-indigo-500/25 border border-indigo-200/70 dark:border-indigo-400/30"
                          />
                        )}
                        <span className="relative z-10">{item.shortLabel}</span>
                      </button>
                    );
                  })}
              </nav>

              {/* Right Utility Cluster — Clean Search + Unified Account Avatar Popover */}
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setCommandPaletteOpen(true)}
                  aria-label="Tìm kiếm nhanh (Ctrl+K)"
                  title="Tìm kiếm nhanh (Ctrl+K)"
                  className="inline-flex items-center gap-1.5 min-h-[38px] px-2.5 sm:px-3 rounded-xl text-xs font-medium text-[#5A648C] dark:text-[#B4C0E8] hover:text-[#4338CA] dark:hover:text-white bg-indigo-50/70 dark:bg-white/8 hover:bg-indigo-100/80 dark:hover:bg-white/14 border border-indigo-200/60 dark:border-indigo-400/20 transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  <Search className="size-3.5 shrink-0" />
                  <span className="hidden xl:inline">Tìm nhanh</span>
                  <kbd className="hidden md:inline font-mono text-[10px] px-1.5 py-0.5 rounded bg-white/90 dark:bg-white/10 border border-indigo-200/70 dark:border-indigo-400/25 text-[#4338CA] dark:text-indigo-200">
                    Ctrl K
                  </kbd>
                </button>

                <AccountMenu />
              </div>
            </header>

            {/* Main Studio Content */}
            <main className="flex-1 min-w-0 px-6 lg:px-9 py-6 sm:py-8">
              {renderActiveWorkspaceView()}
            </main>
          </div>
        </div>

        {/* Floating macOS-inspired Liquid Glass Bottom Dock */}
        <FloatingDock
          items={navItems.map((item) => ({
            id: item.id,
            label: item.label,
            icon: item.icon,
            badge: item.id === 'practice' ? duePracticeCount : undefined,
          }))}
          activeId={activeView === 'report' ? 'upload' : activeView}
          onSelect={(id) => handleNavigate(id as AppView)}
          onOpenCommandPalette={() => setCommandPaletteOpen(true)}
        />
      </div>
    );
  }

  // === CLASSIC ACADEMIC UI SHELL (UI MODE 1 — TABLET & DESKTOP) ===
  return (
    <div className="min-h-dvh flex flex-col">
      {/* Authenticated Top Header */}
      <header className="sticky top-0 z-[45] glass-nav no-print">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 h-16 flex items-center justify-between gap-4 sm:gap-6">
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

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <button
              type="button"
              onClick={() => setCommandPaletteOpen(true)}
              aria-label="Tìm kiếm nhanh (Ctrl+K)"
              title="Tìm kiếm nhanh (Ctrl+K)"
              className="inline-flex items-center gap-1.5 min-h-[38px] px-3 rounded-xl text-xs font-medium glass-control cursor-pointer whitespace-nowrap shrink-0"
            >
              <Search className="size-3.5 shrink-0" />
              <span className="hidden lg:inline">Tìm nhanh</span>
              <kbd className="hidden sm:inline font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300">
                Ctrl K
              </kbd>
            </button>

            <AccountMenu showIdentityText />
          </div>
        </div>
      </header>

      <MaintenanceBanner config={systemStatus} />
      {sharedDrawer}
      {sharedCommandPalette}

      {/* Main Workspace Container */}
      <div className="flex-1 mx-auto w-full max-w-6xl px-4 sm:px-6 py-5 sm:py-6">
        <main className="min-w-0">{renderActiveWorkspaceView()}</main>
      </div>
    </div>
  );
};

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <PrivacyBlurProvider>
          <AmbientCanvas>
            <StudyCheckShell />
          </AmbientCanvas>
        </PrivacyBlurProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
