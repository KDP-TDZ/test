import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  BarChart3,
  ChevronDown,
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
  Trophy,
} from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { sendEmailVerification } from 'firebase/auth';
import type { QueryDocumentSnapshot } from 'firebase/firestore';
import '../styles/authenticated-polish.css';
import { BRAND_CONFIG } from '../config/brand';
import { useAuth } from '../context/AuthContext';
import { gsap, MOTION_ALLOWED_MEDIA, REDUCED_MOTION_MEDIA, useGSAP } from '../lib/gsapSetup';
import type {
  AnalysisRecord,
  KnowledgeProgress,
  PracticeItem,
  QuizAttempt,
} from '../core/types';
import {
  listPracticeItems,
  listUserAnalyses,
  listUserKnowledgeProgress,
  listUserQuizAttempts,
} from '../services/firestoreService';
import { AccountMenu } from './LiquidGlass/AccountMenu';
import { CommandPalette } from './LiquidGlass/CommandPalette';
import { GlassSurface } from './LiquidGlass/GlassSurface';
import { MaintenanceBanner } from './LiquidGlass/MaintenanceBanner';
import { MobileBottomNav } from './LiquidGlass/MobileBottomNav';
import { HamburgerButton, NavigationDrawer } from './LiquidGlass/NavigationDrawer';
import { TabContentFade } from './LiquidGlass/SlidingTabs';
import { WaterRippleButton } from './LiquidGlass/WaterRippleButton';

function lazyWithRetry<T extends React.ComponentType<any>>(
  factory: () => Promise<{ default: T }>
): React.LazyExoticComponent<T> {
  return React.lazy(async () => {
    try {
      return await factory();
    } catch {
      await new Promise((r) => setTimeout(r, 600));
      return await factory();
    }
  });
}

const EtherealStudentDashboard = lazyWithRetry(() =>
  import('./EtherealStudentDashboard').then((m) => ({ default: m.EtherealStudentDashboard }))
);
const UploadWorkspace = lazyWithRetry(() =>
  import('./UploadWorkspace').then((m) => ({ default: m.UploadWorkspace }))
);
const AnalysisReportView = lazyWithRetry(() =>
  import('./AnalysisReportView').then((m) => ({ default: m.AnalysisReportView }))
);
const QuizWorkspace = lazyWithRetry(() =>
  import('./QuizWorkspace').then((m) => ({ default: m.QuizWorkspace }))
);
const PracticeBankView = lazyWithRetry(() =>
  import('./PracticeBankView').then((m) => ({ default: m.PracticeBankView }))
);
const LearningAnalyticsView = lazyWithRetry(() =>
  import('./LearningAnalyticsView').then((m) => ({ default: m.LearningAnalyticsView }))
);
const HistoryView = lazyWithRetry(() =>
  import('./HistoryView').then((m) => ({ default: m.HistoryView }))
);
const ExamCenterView = lazyWithRetry(() =>
  import('./ExamCenterView').then((m) => ({ default: m.ExamCenterView }))
);
const LeaderboardView = lazyWithRetry(() =>
  import('./LeaderboardView').then((m) => ({ default: m.LeaderboardView }))
);
const AdminControlCenter = lazyWithRetry(() =>
  import('./AdminControlCenter').then((m) => ({ default: m.AdminControlCenter }))
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

const PRIMARY_HEADER_TABS: AppView[] = ['dashboard', 'upload', 'exams', 'practice', 'quiz'];
const OVERFLOW_HEADER_TABS: AppView[] = ['leaderboard', 'analytics', 'history', 'admin'];

export const AuthenticatedShell: React.FC = () => {
  const { user, profile, isSuperAdmin, systemStatus, logout, refreshProfile } = useAuth();
  const prefersReduced = useReducedMotion();

  const [activeView, setActiveView] = useState<AppView>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  const navRef = useRef<HTMLElement>(null);
  const hamburgerBtnRef = useRef<HTMLButtonElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
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

  // Close desktop "Thêm" overflow menu on outside click or Escape
  useEffect(() => {
    if (!moreMenuOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setMoreMenuOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMoreMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [moreMenuOpen]);

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
            duration: 0.25,
            stagger: 0.025,
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

  const handleNavItemClick = contextSafe((target: HTMLButtonElement, view: AppView) => {
    gsap.set(target, { clearProps: 'transform,backgroundColor' });
    handleNavigate(view);
  });

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
    setMoreMenuOpen(false);
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

  if (!user) return null;

  // Email Verification Gate (matches Firestore Rules email_verified == true requirement)
  if (!user.emailVerified) {
    return (
      <div className="sc-auth-shell min-h-dvh flex items-center justify-center p-6">
        <GlassSurface className="max-w-md w-full rounded-2xl p-8 text-center space-y-4">
          <div className="mx-auto size-12 rounded-2xl bg-[#EAF2FF] dark:bg-[#2563EB]/15 border border-[#BFDBFE] dark:border-[#3B82F6]/30 flex items-center justify-center">
            <MailCheck className="w-6 h-6 text-[#2563EB] dark:text-[#60A5FA]" />
          </div>
          <h1 className="font-display text-[clamp(1.25rem,3.2vw,1.5rem)] font-bold text-[#172033] dark:text-[#E6EFFC]">
            Xác minh địa chỉ email của bạn
          </h1>
          <p className="text-xs sm:text-sm text-[#525E75] dark:text-[#94A3B8] leading-[1.6] prose-measure mx-auto">
            Tài khoản <strong className="text-[#172033] dark:text-[#E6EFFC]">{user.email}</strong> cần được xác minh email để bảo vệ dữ liệu học tập
            và tuân thủ quy tắc bảo mật hệ thống. Nếu đây là địa chỉ Gmail, bạn có thể bấm liên kết trong
            hộp thư hoặc đăng xuất rồi chọn <strong>Tiếp tục với Google</strong> để xác minh tự động.
          </p>
          {verificationMsg && (
            <p className="text-xs text-emerald-700 dark:text-emerald-300 bg-emerald-50/90 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 rounded-xl p-3">
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
              className="text-xs text-[#525E75] dark:text-[#94A3B8] hover:text-[#172033] dark:hover:text-[#E6EFFC] mt-1 cursor-pointer"
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
    { id: 'practice', label: 'Ngân hàng luyện tập', shortLabel: 'Luyện tập', hint: 'Ôn câu sai & Flashcard', icon: Repeat },
    { id: 'quiz', label: 'Bài trắc nghiệm', shortLabel: 'Trắc nghiệm', hint: 'Đề thích ứng & nâng cao', icon: HelpCircle },
    { id: 'leaderboard', label: 'Đua Top Khối & Trường', shortLabel: 'Đua Top', hint: 'Bảng xếp hạng theo khối', icon: Trophy },
    { id: 'analytics', label: 'Thống kê kiến thức đã học', shortLabel: 'Thống kê', hint: 'Bản đồ chương & tiến bộ', icon: BarChart3 },
    { id: 'history', label: 'Lịch sử phân tích', shortLabel: 'Lịch sử', hint: 'Xem lại bài đã chấm', icon: History },
    ...(isSuperAdmin
      ? [{ id: 'admin' as AppView, label: 'Quản trị hệ thống', shortLabel: 'Quản trị', hint: 'Model Router, đề thi & nguồn', icon: Shield }]
      : []),
  ];

  const primaryNavItems = navItems.filter((item) => PRIMARY_HEADER_TABS.includes(item.id));
  const overflowNavItems = navItems.filter((item) => OVERFLOW_HEADER_TABS.includes(item.id));
  const activeOverflowItem = overflowNavItems.find((item) => item.id === activeView);

  const nowIso = new Date().toISOString();
  const duePracticeCount = practiceItems.filter(
    (p) => !p.nextReviewAt || p.nextReviewAt <= nowIso
  ).length;

  const renderActiveWorkspaceView = () => (
    <React.Suspense
      fallback={
        <div className="py-12 flex items-center justify-center">
          <div className="inline-flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-white dark:bg-[#111B30] border border-[#E6ECF5] dark:border-[#1E293B] text-xs font-medium text-[#525E75] dark:text-[#94A3B8] shadow-xs">
            <span className="size-4 rounded-full border-2 border-[#2563EB] border-t-transparent animate-spin" />
            <span>Đang tải không gian học tập...</span>
          </div>
        </div>
      }
    >
      <TabContentFade activeKey={activeView}>
        {activeView === 'dashboard' && (
          <EtherealStudentDashboard
            analyses={analyses}
            practiceItems={practiceItems}
            loading={dataLoading}
            onNavigate={(view, id, subTab) => handleNavigate(view, id, subTab)}
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

  return (
    <div className="sc-auth-shell min-h-dvh flex flex-col">
      {/* Unified Sticky Editorial Academic Header */}
      <header className="sticky top-0 z-[45] no-print glass-nav">
        <div className="mx-auto w-full max-w-[1320px] px-3.5 sm:px-6 h-[60px] md:h-16 flex items-center justify-between gap-3">
          {/* Brand + Mobile/Tablet Drawer Trigger */}
          <div className="flex items-center gap-2 min-w-0 shrink-0">
            <div className="lg:hidden">
              <HamburgerButton
                buttonRef={hamburgerBtnRef}
                open={mobileMenuOpen}
                controlsId={mobileNavDrawerId}
                onToggle={() => setMobileMenuOpen((v) => !v)}
              />
            </div>

            <button
              type="button"
              onClick={() => handleNavigate('dashboard')}
              className="inline-flex items-center gap-2.5 cursor-pointer shrink-0 group rounded-xl py-1 pr-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
            >
              <span
                aria-hidden="true"
                className="size-8 rounded-xl bg-[#2563EB] text-white flex items-center justify-center shadow-[0_6px_14px_-4px_rgba(37,99,235,0.45)] group-hover:bg-[#1746A2] transition-colors duration-150"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  className="size-[18px]"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
                  <path d="m9 10 2 2 4-4" />
                </svg>
              </span>
              <span className="font-display text-[15px] sm:text-[17px] font-bold tracking-tight text-[#172033] dark:text-[#E6EFFC] whitespace-nowrap">
                {BRAND_CONFIG.name}
              </span>
            </button>
          </div>

          {/* Primary Desktop Navigation + Overflow Menu */}
          <nav
            aria-label="Điều hướng chính"
            className="hidden lg:flex items-center gap-1 min-w-0"
          >
            {primaryNavItems.map((item) => {
              const active =
                activeView === item.id ||
                (activeView === 'report' && item.id === 'upload');
              const showBadge = item.id === 'practice' && duePracticeCount > 0;

              return (
                <button
                  key={item.id}
                  type="button"
                  aria-current={active ? 'page' : undefined}
                  onClick={() => handleNavigate(item.id)}
                  className={`relative inline-flex items-center gap-1.5 min-h-[38px] px-3.5 py-2 rounded-xl text-[13px] font-semibold transition-colors duration-150 cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] ${
                    active
                      ? 'text-[#1746A2] dark:text-[#93C5FD]'
                      : 'text-[#525E75] dark:text-[#94A3B8] hover:text-[#172033] dark:hover:text-[#E6EFFC] hover:bg-[#F1F5FA] dark:hover:bg-[#111B30]'
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="sc-header-active-tab"
                      aria-hidden="true"
                      transition={
                        prefersReduced
                          ? { duration: 0 }
                          : { type: 'spring', stiffness: 520, damping: 38, mass: 0.65 }
                      }
                      className="absolute inset-0 rounded-xl bg-[#EAF2FF] dark:bg-[#2563EB]/20 border border-[#BFDBFE] dark:border-[#3B82F6]/35"
                    />
                  )}
                  <span className="relative z-10">{item.shortLabel}</span>
                  {showBadge && (
                    <span
                      aria-label={`${duePracticeCount} câu cần ôn`}
                      className="relative z-10 min-w-[18px] h-[18px] px-1 rounded-full bg-[#E11D48] text-white text-[10px] font-bold font-mono tabular-nums inline-flex items-center justify-center"
                    >
                      {duePracticeCount > 99 ? '99+' : duePracticeCount}
                    </span>
                  )}
                </button>
              );
            })}

            {/* Overflow Menu ("Thêm") holding Leaderboard, Analytics, History, and Admin */}
            <div ref={moreMenuRef} className="relative">
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={moreMenuOpen}
                onClick={() => setMoreMenuOpen((v) => !v)}
                className={`inline-flex items-center gap-1 min-h-[38px] px-3 py-2 rounded-xl text-[13px] font-semibold transition-colors duration-150 cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] ${
                  activeOverflowItem
                    ? 'bg-[#EAF2FF] dark:bg-[#2563EB]/20 text-[#1746A2] dark:text-[#93C5FD] border border-[#BFDBFE] dark:border-[#3B82F6]/35'
                    : 'text-[#525E75] dark:text-[#94A3B8] hover:text-[#172033] dark:hover:text-[#E6EFFC] hover:bg-[#F1F5FA] dark:hover:bg-[#111B30] border border-transparent'
                }`}
              >
                <span>{activeOverflowItem ? activeOverflowItem.shortLabel : 'Thêm'}</span>
                <ChevronDown
                  className={`size-3.5 transition-transform duration-150 ${
                    moreMenuOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>

              {moreMenuOpen && (
                <div
                  role="menu"
                  aria-label="Tính năng bổ sung"
                  className="absolute right-0 top-[calc(100%+8px)] z-[60] w-64 rounded-2xl bg-white dark:bg-[#111B30] border border-[#E6ECF5] dark:border-[#1E293B] shadow-xl shadow-slate-900/10 dark:shadow-black/50 p-1.5 space-y-0.5"
                >
                  {overflowNavItems.map((item) => {
                    const Icon = item.icon;
                    const active = activeView === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        role="menuitem"
                        aria-current={active ? 'page' : undefined}
                        onClick={() => handleNavigate(item.id)}
                        className={`w-full min-h-[42px] flex items-center gap-3 px-3 py-2 rounded-xl text-left cursor-pointer transition-colors duration-150 ${
                          active
                            ? 'bg-[#EAF2FF] dark:bg-[#2563EB]/20 text-[#1746A2] dark:text-[#93C5FD] font-semibold'
                            : 'text-[#172033] dark:text-[#E6EFFC] hover:bg-[#F1F5FA] dark:hover:bg-[#0D1628]'
                        }`}
                      >
                        <span
                          className={`size-8 rounded-lg flex items-center justify-center shrink-0 ${
                            active
                              ? 'bg-[#2563EB] text-white'
                              : 'bg-[#F1F5FA] dark:bg-[#0D1628] text-[#525E75] dark:text-[#94A3B8]'
                          }`}
                        >
                          <Icon className="size-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-xs font-semibold truncate">{item.label}</span>
                          <span className="block text-[11px] text-[#525E75] dark:text-[#94A3B8] truncate">
                            {item.hint}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </nav>

          {/* Right Utility Cluster: Quick Command Palette + Account Menu */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setCommandPaletteOpen(true)}
              aria-label="Tìm kiếm nhanh (Ctrl+K)"
              title="Tìm kiếm nhanh (Ctrl+K)"
              className="inline-flex items-center justify-center gap-1.5 min-h-[40px] min-w-[40px] md:min-w-0 px-2.5 sm:px-3 rounded-xl text-xs font-medium text-[#525E75] dark:text-[#94A3B8] hover:text-[#172033] dark:hover:text-[#E6EFFC] bg-[#F1F5FA] dark:bg-[#111B30] hover:bg-[#EAF2FF] dark:hover:bg-[#1E293B] border border-[#E6ECF5] dark:border-[#1E293B] transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
            >
              <Search className="size-4 sm:size-3.5 shrink-0" />
              <span className="hidden xl:inline">Tìm nhanh</span>
              <kbd className="hidden md:inline font-mono text-[10px] px-1.5 py-0.5 rounded-md bg-white dark:bg-[#0D1628] border border-[#E6ECF5] dark:border-[#334155] text-[#525E75] dark:text-[#94A3B8]">
                Ctrl K
              </kbd>
            </button>

            <AccountMenu showIdentityText />
          </div>
        </div>
      </header>

      <MaintenanceBanner config={systemStatus} />

      {/* Mobile & Tablet Navigation Drawer (All Routes Preserved) */}
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
              <p className="text-xs font-semibold text-[#172033] dark:text-[#E6EFFC] truncate">
                {profile?.displayName || user.displayName || user.email}
              </p>
              <p className="text-[11px] text-[#525E75] dark:text-[#94A3B8]">
                {isSuperAdmin ? 'Super Admin' : `Học sinh · Lớp ${profile?.grade || '10'}`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setMobileMenuOpen(false);
                logout();
              }}
              className="w-full min-h-[42px] flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold text-[#E11D48] dark:text-rose-400 bg-rose-50 dark:bg-rose-950/35 hover:bg-rose-100 dark:hover:bg-rose-950/55 border border-rose-200/70 dark:border-rose-900/60 transition-colors cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Đăng xuất</span>
            </button>
            <div className="pt-2 border-t border-[#E6ECF5] dark:border-[#1E293B] flex items-center justify-between px-2">
              <div>
                <p className="text-[10px] text-[#525E75] dark:text-[#94A3B8]">Phát triển bởi</p>
                <p className="text-[11px] font-bold text-[#172033] dark:text-[#E6EFFC]">
                  {BRAND_CONFIG.authorName}
                </p>
              </div>
              <div className="h-8 w-24 overflow-hidden flex items-center justify-center rounded-lg">
                <img
                  src={BRAND_CONFIG.signatureImageUrl}
                  alt={`Chữ ký ${BRAND_CONFIG.authorName}`}
                  width={96}
                  height={32}
                  loading="lazy"
                  decoding="async"
                  data-no-privacy-blur="true"
                  className="w-full h-full object-contain scale-[2.3] select-none pointer-events-none mix-blend-multiply dark:invert dark:mix-blend-screen"
                />
              </div>
            </div>
          </div>
        }
      >
        <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#525E75] dark:text-[#94A3B8]">
          Điều hướng
        </p>
        <div className="space-y-1">
          {navItems
            .filter((item) => item.id !== 'admin')
            .map((item) => {
              const Icon = item.icon;
              const active =
                activeView === item.id || (activeView === 'report' && item.id === 'upload');
              const showBadge = item.id === 'practice' && duePracticeCount > 0;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-current={active ? 'page' : undefined}
                  onClick={(e) => handleNavItemClick(e.currentTarget, item.id)}
                  className={`nav-item w-full min-h-[44px] flex items-center justify-between gap-3 px-3 py-2 rounded-xl text-sm text-left transition-colors duration-150 cursor-pointer ${
                    active
                      ? 'bg-[#EAF2FF] dark:bg-[#2563EB]/20 text-[#1746A2] dark:text-[#93C5FD] font-semibold border border-[#BFDBFE] dark:border-[#3B82F6]/35'
                      : 'text-[#172033] dark:text-[#CBD5E1] hover:bg-[#F1F5FA] dark:hover:bg-[#111B30] font-medium border border-transparent'
                  }`}
                >
                  <span className="flex items-center gap-3 min-w-0">
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </span>
                  {showBadge && (
                    <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-[#E11D48] text-white text-[10px] font-bold font-mono tabular-nums inline-flex items-center justify-center shrink-0">
                      {duePracticeCount > 99 ? '99+' : duePracticeCount}
                    </span>
                  )}
                </button>
              );
            })}
        </div>

        {isSuperAdmin && (
          <div className="mt-5 pt-4 border-t border-[#E6ECF5] dark:border-[#1E293B]">
            <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#525E75] dark:text-[#94A3B8]">
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
                    className={`nav-item w-full min-h-[44px] flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-left transition-colors duration-150 cursor-pointer ${
                      active
                        ? 'bg-[#EAF2FF] dark:bg-[#2563EB]/20 text-[#1746A2] dark:text-[#93C5FD] font-semibold border border-[#BFDBFE] dark:border-[#3B82F6]/35'
                        : 'text-[#172033] dark:text-[#CBD5E1] hover:bg-[#F1F5FA] dark:hover:bg-[#111B30] font-medium border border-transparent'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
          </div>
        )}
      </NavigationDrawer>

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

      {/* Unified Editorial Main Workspace */}
      <main className="flex-1 min-w-0 w-full mx-auto max-w-[1320px] px-4 sm:px-6 lg:px-8 pt-5 sm:pt-7 pb-24 md:pb-12">
        {renderActiveWorkspaceView()}
      </main>

      {/* Mobile Fixed Bottom Bar (< 768px) */}
      <MobileBottomNav
        activeId={activeView}
        duePracticeCount={duePracticeCount}
        onSelect={(id) => handleNavigate(id)}
      />
    </div>
  );
};
