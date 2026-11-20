import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BookMarked,
  BookOpenCheck,
  CheckCircle2,
  ChevronRight,
  FileSearch,
  Layers,
  Repeat,
  ShieldCheck,
  Trophy,
  Upload,
  XCircle,
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { BRAND_CONFIG } from '../config/brand';
import { usePrivacyBlur } from '../context/PrivacyBlurContext';
import { useUiMode } from '../context/UiModeContext';
import { useIsMobileViewport } from '../hooks/useIsMobileViewport';
import { gsap, MOTION_ALLOWED_MEDIA, useGSAP } from '../lib/gsapSetup';
import heroPrismImage from '../assets/images/hero_liquid_prism_1795012421683.jpg';
import { Carousel } from './LiquidGlass/Carousel';
import { GlassSurface } from './LiquidGlass/GlassSurface';
import { HamburgerButton, NavigationDrawer } from './LiquidGlass/NavigationDrawer';
import { PrivacyBlurToggle } from './LiquidGlass/PrivacyBlurToggle';
import { SmoothAccordion } from './LiquidGlass/SmoothAccordion';
import { ThemeToggle } from './LiquidGlass/ThemeToggle';
import { TypewriterText } from './LiquidGlass/TypewriterText';
import { UiModeSwitcher } from './LiquidGlass/UiModeSwitcher';
import { WaterRippleButton } from './LiquidGlass/WaterRippleButton';

interface LandingPageProps {
  onOpenAuth: (mode: 'login' | 'register') => void;
}

interface SpecimenAnnotation {
  id: string;
  orderLabel: string;
  color: 'red' | 'orange' | 'green';
  statusTag: string;
  label: string;
  studentExcerpt: string;
  correctKnowledge: string;
  reason: string;
  actionTip: string;
  source: string;
  sourceBook: string;
  sourceExcerpt: string;
  verificationRule: string;
}

const SPECIMEN_ANNOTATIONS: SpecimenAnnotation[] = [
  {
    id: 'err-1',
    orderLabel: 'Nhận định 1 / 3',
    color: 'red',
    statusTag: 'Sai kiến thức',
    label: 'Sai bản chất kiến thức',
    studentExcerpt: 'Liên kết hydrogen chỉ hình thành giữa nguyên tử H và nguyên tử C hoặc N.',
    correctKnowledge:
      'Liên kết hydrogen hình thành giữa nguyên tử H (đã liên kết với nguyên tử có độ âm điện lớn như F, O, N) với nguyên tử khác có độ âm điện lớn (F, O, N) và còn cặp electron hóa trị chưa liên kết.',
    reason:
      'Nguyên tử Carbon (C) có độ âm điện nhỏ (2,55), không đủ phân cực liên kết C–H để tạo liên kết hydrogen điển hình.',
    actionTip:
      'Thay cụm "nguyên tử C hoặc N" bằng "các nguyên tử có độ âm điện lớn như F, O, N còn cặp electron chưa liên kết".',
    source: 'SGK Hóa học 10 · Chương 3 · Trang 54',
    sourceBook: 'Hóa học 10 (GDPT 2018) · Bài 11: Liên kết hydrogen và tương tác van der Waals',
    sourceExcerpt:
      '“Liên kết hydrogen là một loại liên kết yếu được hình thành giữa nguyên tử H (đã liên kết với một nguyên tử có độ âm điện lớn, thường là F, O, N) với một nguyên tử khác có độ âm điện lớn (thường là F, O, N) còn cặp electron hóa trị chưa liên kết.”',
    verificationRule:
      'Đối chiếu trực tiếp khái niệm cốt lõi (trọng số 3) với kho sách giáo khoa chuẩn. Mệnh đề sai bản chất sẽ trừ vào chỉ số Độ chính xác.',
  },
  {
    id: 'part-1',
    orderLabel: 'Nhận định 2 / 3',
    color: 'orange',
    statusTag: 'Cần bổ sung',
    label: 'Đúng hướng nhưng thiếu điều kiện',
    studentExcerpt: 'Nước có nhiệt độ sôi cao hơn H₂S vì phân tử nước có liên kết hydrogen.',
    correctKnowledge:
      'Nhận định đúng về xu hướng nhưng cần nêu rõ: liên kết hydrogen liên phân tử làm tăng năng lượng cần thiết để tách các phân tử nước khi chuyển pha.',
    reason:
      'Cần phân biệt liên kết hydrogen liên phân tử (làm tăng nhiệt độ sôi) với liên kết hydrogen nội phân tử.',
    actionTip:
      'Bổ sung cụm "liên kết hydrogen liên phân tử" và nêu ngắn gọn tác động làm tăng năng lượng tách phân tử khi sôi.',
    source: 'SGK Hóa học 10 · Chương 3 · Trang 55',
    sourceBook: 'Hóa học 10 (GDPT 2018) · Mục II: Ảnh hưởng của liên kết hydrogen đến tính chất vật lý',
    sourceExcerpt:
      '“Các chất có liên kết hydrogen liên phân tử thường có nhiệt độ nóng chảy và nhiệt độ sôi cao hơn so với các chất có khối lượng phân tử tương đương nhưng không tạo được liên kết hydrogen liên phân tử.”',
    verificationRule:
      'Mệnh đề đúng hướng nhưng thiếu điều kiện/phạm vi áp dụng được tính hệ số 0,5 thay vì chấm sai hoàn toàn.',
  },
  {
    id: 'ok-1',
    orderLabel: 'Nhận định 3 / 3',
    color: 'green',
    statusTag: 'Đúng chuẩn',
    label: 'Đã xác minh đúng chuẩn SGK',
    studentExcerpt:
      'Liên kết hydrogen yếu hơn liên kết cộng hóa trị nhưng mạnh hơn tương tác van der Waals.',
    correctKnowledge: 'Thứ tự độ bền liên kết được trình bày chính xác theo chuẩn chương trình.',
    reason:
      'Năng lượng liên kết hydrogen thường từ 10–40 kJ/mol, nhỏ hơn liên kết cộng hóa trị nhưng lớn hơn tương tác van der Waals.',
    actionTip:
      'Giữ nguyên ý này trong đề cương ôn tập; có thể ghi chú thêm khoảng năng lượng 10–40 kJ/mol để nhớ lâu hơn.',
    source: 'SGK Hóa học 10 · Bài 11 · Trang 56',
    sourceBook: 'Hóa học 10 (GDPT 2018) · So sánh bản chất và độ bền các loại liên kết yếu',
    sourceExcerpt:
      '“Liên kết hydrogen có bản chất tĩnh điện, yếu hơn liên kết ion và liên kết cộng hóa trị nhưng mạnh hơn tương tác van der Waals.”',
    verificationRule:
      'Mệnh đề đúng về nghĩa học thuật (không yêu cầu chép nguyên văn) và khớp nguồn chuẩn được tính hệ số tối đa 1,0.',
  },
];

const WORKFLOW_STEPS = [
  {
    stage: 'Giai đoạn chuẩn bị',
    icon: Upload,
    title: 'Tải lên & Kiểm tra OCR',
    desc: 'Hỗ trợ ảnh chụp vở viết tay, PDF scan, PDF văn bản và DOCX. Cho phép rà soát và sửa chữ nhận diện trước khi chấm.',
  },
  {
    stage: 'Đối chiếu nguồn chuẩn',
    icon: FileSearch,
    title: 'Kiểm chứng theo sách giáo khoa',
    desc: 'Tách thành từng mệnh đề kiến thức, tra cứu đúng bộ sách giáo khoa đã chọn và tìm nguồn học thuật chuẩn khi cần.',
  },
  {
    stage: 'Chấm hai chỉ số',
    icon: Layers,
    title: 'Tách biệt Chính xác & Đầy đủ',
    desc: 'Đo riêng tỷ lệ chính xác trên phần đã viết và độ bao phủ so với khung kiến thức chương, khoanh vùng trực tiếp trên tài liệu.',
  },
  {
    stage: 'Luyện tập ngắt quãng',
    icon: Repeat,
    title: 'Trắc nghiệm & Thẻ ghi nhớ',
    desc: 'Sinh đề thích ứng, bổ sung câu nâng cao 1–6, Flashcard ôn tập và Ngân hàng luyện tập theo chu kỳ 1 / 3 / 7 ngày.',
  },
];

const FAQS = [
  {
    q: 'StudyCheck AI có đánh đồng việc viết thiếu ý với việc viết sai kiến thức không?',
    a: 'Không. Hệ thống tách biệt hoàn toàn hai chỉ số độc lập: Độ chính xác (Accuracy) chỉ chấm trên những kiến thức bạn đã viết và đã được xác minh, còn Độ đầy đủ (Completeness) đo mức độ bao phủ mục tiêu học tập của chương đã chọn.',
  },
  {
    q: 'Tài liệu viết tay hoặc ảnh chụp bảng có được kiểm tra OCR trước khi chấm không?',
    a: 'Có. Bước OCR Review luôn hiển thị văn bản nhận diện cùng độ tin cậy theo từng đoạn. Những đoạn chữ mờ hoặc độ tin cậy thấp được đánh dấu để bạn chỉnh sửa trước, tuyệt đối không bị chấm là lỗi sai kiến thức.',
  },
  {
    q: 'Trung tâm đề kiểm tra Giữa kỳ / Cuối kỳ và Đua Top hoạt động như thế nào?',
    a: 'Giáo viên/Admin thiết lập ma trận đề chuẩn GDPT 2018 (ABCD, Đúng/Sai, Trả lời ngắn). Khi làm đề kiểm tra chính thức, điểm số của bạn được quy đổi vào Bảng xếp hạng Đua Top theo từng khối (10/11/12) và toàn trường.',
  },
  {
    q: 'Hệ thống lấy nguồn kiến thức từ đâu để kiểm chứng?',
    a: 'Ưu tiên hàng đầu là bộ sách giáo khoa chuẩn và kho học liệu do quản trị viên lập chỉ mục theo từng lớp và bộ sách. Với kiến thức nâng cao ngoài sách, hệ thống sử dụng Google Search Grounding kèm đường dẫn trích dẫn thực tế.',
  },
];

const STATUS_META = {
  red: {
    icon: XCircle,
    textClass: 'text-rose-700 dark:text-rose-300',
    iconClass: 'text-rose-600 dark:text-rose-400',
    activeItemClass:
      'bg-rose-50/95 dark:bg-rose-950/55 border-rose-300 dark:border-rose-600/80 ring-2 ring-rose-200/80 dark:ring-rose-900/70 shadow-[0_8px_22px_-12px_rgba(225,29,72,0.35)]',
    idleItemClass:
      'bg-rose-50/45 dark:bg-rose-950/20 border-rose-200/70 dark:border-rose-900/60 hover:bg-rose-50/85 dark:hover:bg-rose-950/38 hover:border-rose-300/90 dark:hover:border-rose-700/80',
    resultHeaderBg:
      'bg-rose-50/75 dark:bg-rose-950/40 border-rose-200/80 dark:border-rose-800/60',
  },
  orange: {
    icon: AlertTriangle,
    textClass: 'text-amber-700 dark:text-amber-300',
    iconClass: 'text-amber-600 dark:text-amber-400',
    activeItemClass:
      'bg-amber-50/95 dark:bg-amber-950/55 border-amber-300 dark:border-amber-600/80 ring-2 ring-amber-200/80 dark:ring-amber-900/70 shadow-[0_8px_22px_-12px_rgba(217,119,6,0.32)]',
    idleItemClass:
      'bg-amber-50/45 dark:bg-amber-950/20 border-amber-200/70 dark:border-amber-900/60 hover:bg-amber-50/85 dark:hover:bg-amber-950/38 hover:border-amber-300/90 dark:hover:border-amber-700/80',
    resultHeaderBg:
      'bg-amber-50/75 dark:bg-amber-950/40 border-amber-200/80 dark:border-amber-800/60',
  },
  green: {
    icon: CheckCircle2,
    textClass: 'text-emerald-700 dark:text-emerald-300',
    iconClass: 'text-emerald-600 dark:text-emerald-400',
    activeItemClass:
      'bg-emerald-50/95 dark:bg-emerald-950/55 border-emerald-300 dark:border-emerald-600/80 ring-2 ring-emerald-200/80 dark:ring-emerald-900/70 shadow-[0_8px_22px_-12px_rgba(5,150,105,0.32)]',
    idleItemClass:
      'bg-emerald-50/45 dark:bg-emerald-950/20 border-emerald-200/70 dark:border-emerald-900/60 hover:bg-emerald-50/85 dark:hover:bg-emerald-950/38 hover:border-emerald-300/90 dark:hover:border-emerald-700/80',
    resultHeaderBg:
      'bg-emerald-50/75 dark:bg-emerald-950/40 border-emerald-200/80 dark:border-emerald-800/60',
  },
} as const;

export const LandingPage: React.FC<LandingPageProps> = ({ onOpenAuth }) => {
  const { isEthereal } = useUiMode();
  const { privacyBlur } = usePrivacyBlur();
  const isMobile = useIsMobileViewport();
  const useDesktopEthereal = isEthereal && !isMobile;
  const pageRef = useRef<HTMLDivElement>(null);
  const hamburgerBtnRef = useRef<HTMLButtonElement>(null);
  const prefersReduced = useReducedMotion();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [selectedSpecimenId, setSelectedSpecimenId] = useState<string>('err-1');
  const [sourceAccordionOpen, setSourceAccordionOpen] = useState<boolean>(true);
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(0);
  const [heroImgError, setHeroImgError] = useState(false);
  const [activeSection, setActiveSection] = useState<string>('top');
  const landingDrawerId = 'landing-navigation-drawer';

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const handleChange = (e: MediaQueryListEvent) => {
      if (e.matches) setMobileNavOpen(false);
    };
    mq.addEventListener('change', handleChange);
    return () => mq.removeEventListener('change', handleChange);
  }, []);

  // Track active landing section via IntersectionObserver (never raw scrollY)
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const sectionIds = ['top', 'workflow', 'specimen', 'practice', 'faq'];
    const elements = sectionIds
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => Boolean(el));
    if (elements.length === 0) return;

    const visibleRatios = new Map<string, number>();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.target.id) {
            if (entry.isIntersecting) {
              visibleRatios.set(entry.target.id, entry.intersectionRatio);
            } else {
              visibleRatios.delete(entry.target.id);
            }
          }
        }

        let bestId: string | null = null;
        let bestRatio = -1;
        for (const id of sectionIds) {
          const ratio = visibleRatios.get(id);
          if (ratio !== undefined && ratio > bestRatio) {
            bestRatio = ratio;
            bestId = id;
          }
        }
        if (bestId) {
          setActiveSection(bestId);
        }
      },
      { rootMargin: '-12% 0px -40% 0px', threshold: [0.05, 0.2, 0.4] }
    );

    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  const activeSpecimen =
    SPECIMEN_ANNOTATIONS.find((s) => s.id === selectedSpecimenId) || SPECIMEN_ANNOTATIONS[0];
  const activeMeta = STATUS_META[activeSpecimen.color];
  const ActiveStatusIcon = activeMeta.icon;

  useGSAP(
    () => {
      if (!useDesktopEthereal) return;
      const mm = gsap.matchMedia();
      mm.add(MOTION_ALLOWED_MEDIA, () => {
        const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
        tl.from('.hero-stagger', {
          y: 18,
          autoAlpha: 0,
          duration: 0.46,
          stagger: 0.075,
          clearProps: 'transform,opacity,visibility',
        })
          .from(
            '.hero-visual',
            {
              scale: 0.975,
              y: 14,
              autoAlpha: 0,
              duration: 0.52,
              clearProps: 'transform,opacity,visibility',
            },
            '-=0.34'
          )
          .from(
            '.hero-overlay-card',
            {
              y: 14,
              autoAlpha: 0,
              duration: 0.42,
              stagger: 0.08,
              clearProps: 'transform,opacity,visibility',
            },
            '-=0.26'
          );
      });
    },
    { scope: pageRef, dependencies: [useDesktopEthereal] }
  );

  const handleSelectSpecimen = (id: string) => {
    setSelectedSpecimenId(id);
  };

  const navLinks = [
    { id: 'workflow', href: '#workflow', label: 'Quy trình' },
    { id: 'specimen', href: '#specimen', label: 'Kiểm chứng' },
    { id: 'practice', href: '#practice', label: 'Thi & Đua Top' },
    { id: 'faq', href: '#faq', label: 'Hỏi đáp' },
  ] as const;

  return (
    <div ref={pageRef} className="flex flex-col min-h-dvh">
      {/* Site Header + Semantic Navigation Bar (Compact 52px on Mobile, Zero-Overflow on Tablet/Desktop) */}
      <header className="sticky top-0 z-[45] glass-nav">
        <div className="mx-auto max-w-7xl px-3.5 sm:px-6 h-[52px] md:h-16 flex items-center justify-between gap-3 sm:gap-6">
          <div className="flex items-center gap-2 shrink-0 min-w-0">
            <HamburgerButton
              buttonRef={hamburgerBtnRef}
              open={mobileNavOpen}
              controlsId={landingDrawerId}
              onToggle={() => setMobileNavOpen((v) => !v)}
              className="lg:hidden"
            />
            <a
              href="#top"
              onClick={() => setActiveSection('top')}
              className="font-display text-[15px] sm:text-lg font-bold tracking-tight text-[#16243E] dark:text-[#E6EFFC] whitespace-nowrap shrink-0 transition-opacity duration-150 hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-lg px-1 -mx-1"
            >
              {BRAND_CONFIG.name}
            </a>
          </div>

          <nav
            aria-label="Điều hướng chính trang chủ"
            className="hidden lg:flex items-center gap-1 xl:gap-2 text-sm font-medium text-[#475B78] dark:text-[#B4C7E2]"
          >
            {navLinks.map((link) => {
              const isCurrent = activeSection === link.id;
              return (
                <a
                  key={link.id}
                  href={link.href}
                  aria-current={isCurrent ? 'page' : undefined}
                  onClick={() => setActiveSection(link.id)}
                  className={`relative px-3 py-2 rounded-xl whitespace-nowrap shrink-0 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 ${
                    isEthereal ? 'focus-visible:ring-indigo-500' : 'focus-visible:ring-sky-500'
                  } ${
                    isCurrent
                      ? isEthereal
                        ? 'text-[#312E81] dark:text-white font-semibold'
                        : 'text-sky-700 dark:text-sky-300 font-semibold'
                      : 'hover:text-[#16243E] dark:hover:text-white'
                  } ${!isEthereal ? 'nav-link-underline' : ''}`}
                >
                  {useDesktopEthereal && isCurrent && (
                    <motion.span
                      layoutId="landing-navbar-active-pill"
                      aria-hidden="true"
                      transition={
                        prefersReduced
                          ? { duration: 0 }
                          : { type: 'spring', stiffness: 520, damping: 38, mass: 0.65 }
                      }
                      className="absolute inset-0 rounded-xl bg-[#EEF0FF] dark:bg-indigo-500/25 border border-indigo-200/75 dark:border-indigo-400/30"
                    />
                  )}
                  <span className="relative z-10">{link.label}</span>
                </a>
              );
            })}
          </nav>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <div className="hidden lg:block">
              <UiModeSwitcher />
            </div>
            <div className={privacyBlur ? 'block' : 'hidden md:block'}>
              <PrivacyBlurToggle />
            </div>
            <div className="hidden md:block">
              <ThemeToggle />
            </div>
            <WaterRippleButton
              size="sm"
              onClick={() => onOpenAuth('login')}
              className={
                useDesktopEthereal
                  ? '!bg-gradient-to-r !from-[#4338CA] !via-[#4F46E5] !to-[#6366F1]'
                  : ''
              }
            >
              Đăng nhập
            </WaterRippleButton>
          </div>
        </div>
      </header>

      <NavigationDrawer
        id={landingDrawerId}
        open={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        triggerRef={hamburgerBtnRef}
        ariaLabel="Điều hướng trang chủ"
        footer={
          <div className="flex flex-col gap-2.5">
            <div className="flex flex-col gap-1.5 px-1 lg:hidden">
              <span className="text-[11px] font-medium text-[#475B78] dark:text-[#B4C7E2]">
                Giao diện máy tính (điện thoại dùng bản nhẹ)
              </span>
              <div className="w-fit">
                <UiModeSwitcher />
              </div>
            </div>
            <div className="flex items-center justify-between gap-2 px-1 md:hidden">
              <span className="text-[11px] font-medium text-[#475B78] dark:text-[#B4C7E2]">
                Màu hiển thị
              </span>
              <ThemeToggle />
            </div>
            <div className="flex items-center justify-between gap-2 px-1 md:hidden">
              <span className="text-[11px] font-medium text-[#475B78] dark:text-[#B4C7E2]">
                Chế độ khoe CSS
              </span>
              <PrivacyBlurToggle showLabelOnMobile />
            </div>
            <WaterRippleButton
              size="md"
              className={`w-full ${
                useDesktopEthereal
                  ? '!bg-gradient-to-r !from-[#4338CA] !via-[#4F46E5] !to-[#6366F1]'
                  : ''
              }`}
              onClick={() => {
                setMobileNavOpen(false);
                onOpenAuth('login');
              }}
            >
              Đăng nhập
            </WaterRippleButton>
            <button
              type="button"
              onClick={() => {
                setMobileNavOpen(false);
                onOpenAuth('register');
              }}
              className="w-full min-h-[42px] rounded-xl text-xs font-semibold glass-control cursor-pointer"
            >
              Tạo tài khoản mới
            </button>
          </div>
        }
      >
        <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#64748B] dark:text-[#94A3B8]">
          Khám phá
        </p>
        <div className="space-y-1">
          {[
            { id: 'workflow', href: '#workflow', label: 'Quy trình kiểm chứng' },
            { id: 'specimen', href: '#specimen', label: 'Mẫu đối chiếu SGK' },
            { id: 'practice', href: '#practice', label: 'Thi thử & Đua Top' },
            { id: 'faq', href: '#faq', label: 'Câu hỏi thường gặp' },
          ].map((link) => (
            <a
              key={link.href}
              href={link.href}
              aria-current={activeSection === link.id ? 'page' : undefined}
              onClick={() => {
                setActiveSection(link.id);
                setMobileNavOpen(false);
              }}
              className={`w-full min-h-[42px] flex items-center px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
                activeSection === link.id
                  ? 'bg-indigo-500/12 dark:bg-white/12 text-[#16243E] dark:text-white font-semibold'
                  : 'text-[#334155] dark:text-[#CBD5E1] hover:bg-sky-50/80 dark:hover:bg-white/10'
              }`}
            >
              {link.label}
            </a>
          ))}
        </div>
      </NavigationDrawer>

      {/* Hero Section */}
      <main id="top" className="flex-1">
        <section className="mx-auto max-w-7xl px-4 sm:px-6 pt-6 pb-10 sm:pt-12 sm:pb-20 lg:pt-16 lg:pb-24">
          <div
            className={`grid grid-cols-1 lg:grid-cols-12 gap-7 sm:gap-10 lg:gap-12 items-stretch ${
              useDesktopEthereal
                ? 'ethereal-studio-canvas rounded-[30px] sm:rounded-[36px] p-6 sm:p-8 lg:p-10'
                : ''
            }`}
          >
            {/* Left Column: Editorial Hierarchy & Primary CTA */}
            <div className="lg:col-span-6 flex flex-col justify-center">
              <p
                className={`hero-stagger text-xs sm:text-[13px] font-semibold tracking-wide mb-3 sm:mb-4 ${
                  useDesktopEthereal
                    ? 'text-indigo-600 dark:text-indigo-300'
                    : 'text-sky-700 dark:text-sky-400'
                }`}
              >
                {useDesktopEthereal ? (
                  <TypewriterText
                    text="Nền tảng kiểm chứng học tập THPT · Lớp 10 · 11 · 12"
                    charIntervalMs={28}
                    startDelayMs={160}
                    caretClassName="bg-indigo-600 dark:bg-indigo-300"
                  />
                ) : (
                  'Nền tảng kiểm chứng học tập THPT · Lớp 10 · 11 · 12'
                )}
              </p>

              <h1 className="hero-stagger font-display text-[clamp(1.9rem,4.5vw,3.15rem)] font-bold tracking-[-0.025em] text-[#16243E] dark:text-[#E6EFFC] leading-[1.14] text-balance">
                Đừng chỉ học thuộc.{' '}
                <span
                  className={
                    isEthereal
                      ? 'bg-gradient-to-r from-[#4338CA] via-[#6366F1] to-[#9333EA] dark:from-indigo-300 dark:via-violet-300 dark:to-fuchsia-300 bg-clip-text text-transparent'
                      : 'text-sky-700 dark:text-sky-400'
                  }
                >
                  Hãy kiểm chứng
                </span>{' '}
                những gì bạn học.
              </h1>

              <p className="hero-stagger mt-5 text-sm sm:text-base text-[#475B78] dark:text-[#B4C7E2] leading-[1.65] prose-measure text-pretty">
                Tải tài liệu ghi chép, ảnh chụp vở hoặc PDF lên để đối chiếu trực tiếp với sách giáo khoa chuẩn — tách rõ lỗi sai, bổ sung ý thiếu và luyện tập có mục tiêu.
              </p>

              <div className="hero-stagger mt-7 sm:mt-9 flex flex-wrap items-center gap-3 sm:gap-3.5">
                <WaterRippleButton
                  size="lg"
                  onClick={() => onOpenAuth('login')}
                  className={`min-h-[48px] px-6 sm:px-7 text-sm font-semibold ${
                    useDesktopEthereal
                      ? '!bg-gradient-to-r !from-[#4338CA] !via-[#4F46E5] !to-[#6366F1] !shadow-[0_14px_30px_-10px_rgba(79,70,229,0.62)]'
                      : ''
                  }`}
                >
                  <Upload className="w-4 h-4" />
                  Tải tài liệu lên
                </WaterRippleButton>

                <button
                  type="button"
                  onClick={() => onOpenAuth('register')}
                  className="group glass-control inline-flex items-center gap-2 min-h-[48px] px-5 py-2.5 rounded-2xl text-sm font-semibold text-[#16243E] dark:text-[#E6EFFC] whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <span>Tạo tài khoản mới</span>
                  <ArrowRight
                    className={`w-4 h-4 transition-transform duration-200 ease-out group-hover:translate-x-0.5 ${
                      isEthereal
                        ? 'text-indigo-600 dark:text-indigo-300'
                        : 'text-sky-600 dark:text-sky-400'
                    }`}
                  />
                </button>
              </div>

              <div className="hero-stagger mt-8 pt-6 border-t border-sky-200/75 dark:border-slate-800/90 grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 text-xs">
                <div>
                  <p className="font-semibold text-[#16243E] dark:text-[#E6EFFC]">Đa định dạng OCR</p>
                  <p className="mt-0.5 text-[#475B78] dark:text-[#B4C7E2]">
                    PDF, DOCX và ảnh chụp vở viết tay
                  </p>
                </div>
                <div>
                  <p className="font-semibold text-[#16243E] dark:text-[#E6EFFC]">Tách biệt hai chỉ số</p>
                  <p className="mt-0.5 text-[#475B78] dark:text-[#B4C7E2]">
                    Độ chính xác độc lập với độ đầy đủ
                  </p>
                </div>
                <div>
                  <p className="font-semibold text-[#16243E] dark:text-[#E6EFFC]">Thi thử & Đua Top</p>
                  <p className="mt-0.5 text-[#475B78] dark:text-[#B4C7E2]">
                    Đề chuẩn GDPT 2018 theo khối 10–12
                  </p>
                </div>
              </div>
            </div>

            {/* Right Column: Hero Prism Illustration (Clean flat card in Classic, Glass + Overlay Cards in Modern) */}
            <div className="hero-visual lg:col-span-6">
              {isEthereal ? (
                <GlassSurface
                  enableRipple
                  hoverLift={false}
                  className="h-full rounded-3xl p-2.5 sm:p-3 flex flex-col"
                >
                  <div className="relative w-full h-full min-h-[320px] sm:min-h-[410px] lg:min-h-[440px] rounded-2xl overflow-hidden bg-gradient-to-br from-sky-50 via-white to-sky-100/70 dark:from-slate-900 dark:via-[#111C2E] dark:to-slate-900">
                    {!heroImgError ? (
                      <img
                        src={heroPrismImage}
                        alt="Minh họa lăng kính quang học Liquid Glass tượng trưng cho sự đối chiếu kiến thức trong sáng và chính xác"
                        referrerPolicy="no-referrer"
                        onError={() => setHeroImgError(true)}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center p-8 text-center">
                        <div>
                          <BookOpenCheck className="w-12 h-12 text-sky-600 dark:text-sky-400 mx-auto mb-3" />
                          <p className="text-sm font-medium text-[#16243E] dark:text-[#E6EFFC]">
                            StudyCheck AI Optical Verification
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Measured scrim for crisp WCAG contrast of the React/CSS overlay cards */}
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#09111E]/78 via-[#09111E]/22 to-transparent"
                    />

                    {/* Top subtle CSS verification scope strip */}
                    <div className="hero-overlay-card absolute top-3.5 left-3.5 right-3.5 sm:top-4 sm:left-4 sm:right-4 flex items-center justify-between gap-2 px-3.5 py-2 rounded-xl bg-white/86 dark:bg-[#0D182B]/86 backdrop-blur-md border border-white/80 dark:border-sky-200/15 shadow-sm text-xs">
                      <span className="font-medium text-[#16243E] dark:text-[#E6EFFC] truncate">
                        Đối chiếu trực tiếp · Đề cương Hóa học 10
                      </span>
                      <span className="font-mono text-[11px] font-semibold text-sky-700 dark:text-sky-300 shrink-0 tabular-nums">
                        SGK Chương 3
                      </span>
                    </div>

                    {/* Bottom interactive React/CSS verification preview card */}
                    <div className="hero-overlay-card hero-float-slow absolute bottom-3.5 left-3.5 right-3.5 sm:bottom-4 sm:left-4 sm:right-4 rounded-2xl bg-white/92 dark:bg-[#0E1B31]/92 backdrop-blur-xl border border-white/85 dark:border-sky-200/20 p-3.5 sm:p-4 shadow-[0_18px_38px_-14px_rgba(9,17,30,0.45)]">
                      <div className="grid grid-cols-2 gap-3 pb-3 border-b border-sky-200/60 dark:border-slate-700/70">
                        <div>
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-[11px] font-medium text-[#475B78] dark:text-[#B4C7E2]">
                              Độ chính xác
                            </span>
                            <span className="font-display text-base sm:text-lg font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                              84%
                            </span>
                          </div>
                          <div className="mt-1.5 h-1.5 w-full rounded-full bg-slate-200/80 dark:bg-slate-800 overflow-hidden">
                            <div className="h-full w-[84%] rounded-full bg-emerald-500" />
                          </div>
                        </div>

                        <div>
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-[11px] font-medium text-[#475B78] dark:text-[#B4C7E2]">
                              Độ đầy đủ chương
                            </span>
                            <span className="font-display text-base sm:text-lg font-bold text-sky-700 dark:text-sky-400 tabular-nums">
                              76%
                            </span>
                          </div>
                          <div className="mt-1.5 h-1.5 w-full rounded-full bg-slate-200/80 dark:bg-slate-800 overflow-hidden">
                            <div className="h-full w-[76%] rounded-full bg-sky-500" />
                          </div>
                        </div>
                      </div>

                      <a
                        href="#specimen"
                        className="group mt-3 flex items-center justify-between gap-3 rounded-xl px-2.5 py-2 -mx-1 hover:bg-sky-50/90 dark:hover:bg-white/5 transition-colors duration-180"
                      >
                        <div className="min-w-0 flex items-start gap-2">
                          <XCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-[#16243E] dark:text-[#E6EFFC] truncate">
                              Phát hiện 1 nhận định sai · Liên kết hydrogen với C
                            </p>
                            <p className="text-[11px] text-[#475B78] dark:text-[#B4C7E2] truncate">
                              Dẫn chứng: SGK Hóa học 10 · Trang 54 — Xem mẫu tương tác
                            </p>
                          </div>
                        </div>
                        <ChevronRight className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0 transition-transform duration-180 group-hover:translate-x-0.5" />
                      </a>
                    </div>
                  </div>
                </GlassSurface>
              ) : (
                <div className="h-full rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111C2E] overflow-hidden flex flex-col">
                  <div className="relative flex-1 min-h-[260px] sm:min-h-[330px] bg-slate-100 dark:bg-slate-900 overflow-hidden">
                    {!heroImgError ? (
                      <img
                        src={heroPrismImage}
                        alt="Minh họa đối chiếu kiến thức học tập THPT với sách giáo khoa chuẩn"
                        referrerPolicy="no-referrer"
                        onError={() => setHeroImgError(true)}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center p-8 text-center">
                        <BookOpenCheck className="w-12 h-12 text-sky-700 dark:text-sky-400" />
                      </div>
                    )}
                  </div>
                  <div className="px-4 py-3.5 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                        Đối chiếu trực tiếp đề cương với SGK chuẩn
                      </p>
                      <p className="text-[11px] text-slate-600 dark:text-slate-400 truncate mt-0.5">
                        Độ chính xác 84% · Độ đầy đủ 76% · Dẫn chứng theo trang SGK
                      </p>
                    </div>
                    <a
                      href="#specimen"
                      className="text-xs font-semibold text-sky-700 dark:text-sky-400 hover:underline shrink-0"
                    >
                      Xem mẫu
                    </a>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Workflow Section: Accessible Carousel in Modern Mode, Classic 12-col Grid in Classic Mode */}
        <section id="workflow" className="mx-auto max-w-7xl px-4 sm:px-6 py-10 sm:py-16 border-t border-sky-200/50 dark:border-slate-800/80">
          {isEthereal ? (
            <Carousel
              ariaLabel="Chu trình kiểm chứng kiến thức 4 bước"
              slideClassName="w-[88%] sm:w-[62%] lg:w-[46%]"
              headerLeft={
                <div className="max-w-2xl">
                  <h2 className="font-display text-[clamp(1.35rem,3.6vw,1.875rem)] font-bold text-[#171B3A] dark:text-[#EEF1FF] leading-[1.25] text-balance">
                    Chu trình học tập khép kín từ tài liệu ghi chép đến nắm vững kiến thức
                  </h2>
                  <p className="mt-2.5 text-sm sm:text-base text-[#5E678E] dark:text-[#A8B4DB] leading-[1.6] prose-measure text-pretty">
                    Lướt qua 4 bước kiểm chứng có dẫn chứng sách giáo khoa và ôn luyện có mục tiêu.
                  </p>
                </div>
              }
              slides={WORKFLOW_STEPS.map((step, idx) => {
                const Icon = step.icon;
                const accents = [
                  'from-[#EEF0FF] via-[#E4E8FF] to-[#D7DCFF] dark:from-[#262C63] dark:to-[#1D2250]',
                  'from-[#F5EDFF] via-[#ECE0FF] to-[#E2D2FF] dark:from-[#30245E] dark:to-[#221A48]',
                  'from-[#EBF6FF] via-[#DFF0FF] to-[#D1E8FF] dark:from-[#1B3357] dark:to-[#162744]',
                  'from-[#FFF0F4] via-[#FFE4EC] to-[#FBD6E2] dark:from-[#4C2239] dark:to-[#3A192B]',
                ];
                return {
                  id: step.stage,
                  label: step.title,
                  content: (
                    <GlassSurface
                      enableRipple
                      className="h-full rounded-[28px] p-5 sm:p-7 flex flex-col justify-between gap-5"
                    >
                      <div className="space-y-4">
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-mono text-xs font-bold text-indigo-600 dark:text-indigo-300 tabular-nums">
                            0{idx + 1} · {step.stage}
                          </span>
                          <span
                            className={`size-11 rounded-2xl bg-gradient-to-br ${accents[idx % accents.length]} flex items-center justify-center shrink-0 border border-white/80 dark:border-white/10`}
                          >
                            <Icon className="size-5 text-indigo-700 dark:text-indigo-200" />
                          </span>
                        </div>
                        <h3 className="font-display text-lg font-bold text-[#171B3A] dark:text-[#EEF1FF] text-balance">
                          {step.title}
                        </h3>
                        <p className="text-sm text-[#586289] dark:text-[#B4C0E5] leading-[1.65] text-pretty">
                          {step.desc}
                        </p>
                      </div>

                      <div className="pt-3 border-t border-indigo-100/80 dark:border-indigo-400/15 flex items-center justify-between text-xs">
                        <a
                          href="#specimen"
                          className="font-semibold text-indigo-600 dark:text-indigo-300 hover:underline inline-flex items-center gap-1"
                        >
                          Xem mẫu đối chiếu
                          <ArrowRight className="size-3.5" />
                        </a>
                        <button
                          type="button"
                          onClick={() => onOpenAuth('login')}
                          className="font-medium text-[#586289] dark:text-[#A5B1D8] hover:text-[#171B3A] dark:hover:text-white cursor-pointer"
                        >
                          Dùng ngay
                        </button>
                      </div>
                    </GlassSurface>
                  ),
                };
              })}
            />
          ) : (
            <>
              <div className="max-w-2xl mt-2 mb-6 sm:mb-10">
                <h2 className="font-display text-[clamp(1.35rem,3.6vw,1.875rem)] font-bold text-[#16243E] dark:text-[#E6EFFC] leading-[1.25] text-balance">
                  Chu trình học tập khép kín từ tài liệu ghi chép đến nắm vững kiến thức
                </h2>
                <p className="mt-3 text-sm sm:text-base text-[#475B78] dark:text-[#B4C7E2] leading-[1.6] prose-measure text-pretty">
                  Không chỉ chấm điểm, StudyCheck AI đồng hành qua từng bước kiểm chứng có dẫn chứng và ôn luyện có mục tiêu.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-12 gap-4 sm:gap-6">
                {WORKFLOW_STEPS.map((step, idx) => {
                  const Icon = step.icon;
                  const colSpanClass =
                    idx === 0 || idx === 3 ? 'md:col-span-7' : 'md:col-span-5';
                  return (
                    <GlassSurface
                      key={step.stage}
                      enableRipple
                      className={`${colSpanClass} rounded-3xl p-5 sm:p-6 flex flex-col justify-between`}
                    >
                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-xs font-semibold text-sky-700 dark:text-sky-400">
                            {step.stage}
                          </span>
                          <Icon className="size-5 text-sky-600 dark:text-sky-400 shrink-0" />
                        </div>
                        <h3 className="font-display text-base font-bold text-[#16243E] dark:text-[#E6EFFC] mt-1 mb-2">
                          {step.title}
                        </h3>
                        <p className="text-sm text-[#475B78] dark:text-[#B4C7E2] leading-[1.6] prose-measure text-pretty">
                          {step.desc}
                        </p>
                      </div>
                    </GlassSurface>
                  );
                })}
              </div>
            </>
          )}
        </section>

        {/* Section 2C: Interactive Sample Analysis (Upgraded) */}
        <section id="specimen" className="mx-auto max-w-7xl px-4 sm:px-6 py-12 sm:py-18 border-t border-sky-200/50 dark:border-slate-800">
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 mt-2 mb-7 sm:mb-10">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold text-sky-700 dark:text-sky-400 mb-2">
                Mẫu đối chiếu hai cột tương tác · Sample Analysis
              </p>
              <h2 className="font-display text-[clamp(1.35rem,3.6vw,1.95rem)] font-bold text-[#16243E] dark:text-[#E6EFFC] leading-[1.24] [text-wrap:balance]">
                Nhấn trực tiếp vào từng nhận định để xem phân tích và dẫn chứng sách giáo khoa
              </h2>
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#475B78] dark:text-[#B4C7E2] tabular-nums">
              <span className="font-medium text-[#16243E] dark:text-[#E6EFFC]">3 nhận định mẫu</span>
              <span aria-hidden="true">·</span>
              <span className="text-rose-700 dark:text-rose-300 font-medium">1 sai</span>
              <span aria-hidden="true">·</span>
              <span className="text-amber-700 dark:text-amber-300 font-medium">1 cần bổ sung</span>
              <span aria-hidden="true">·</span>
              <span className="text-emerald-700 dark:text-emerald-300 font-medium">1 đúng chuẩn</span>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-6 items-stretch">
            {/* Left: Simulated Student Document (Solid Reading Surface) */}
            <div className="lg:col-span-7 document-paper rounded-3xl p-5 sm:p-8 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between pb-3.5 mb-5 border-b border-slate-200/80 dark:border-slate-800 text-xs text-[#475B78] dark:text-[#B4C7E2]">
                  <span>Tài liệu học sinh · Đề cương Hóa học 10</span>
                  <span className="font-mono tabular-nums">Trang 1 / 1</span>
                </div>

                <h3 className="font-display text-base sm:text-lg font-bold text-[#16243E] dark:text-[#E6EFFC] mb-4">
                  Bài 11: Liên kết hydrogen và tương tác van der Waals
                </h3>

                <div className="space-y-3" role="listbox" aria-label="Danh sách nhận định mẫu">
                  {SPECIMEN_ANNOTATIONS.map((item, idx) => {
                    const isSelected = selectedSpecimenId === item.id;
                    const meta = STATUS_META[item.color];
                    const StatusIcon = meta.icon;

                    return (
                      <button
                        key={item.id}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        onClick={() => handleSelectSpecimen(item.id)}
                        className={`group relative w-full min-h-[52px] text-left px-4 py-3.5 rounded-2xl border cursor-pointer select-none transition-[transform,background-color,border-color,box-shadow] duration-200 ease-out hover:-translate-y-[2px] active:scale-[0.992] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
                          isSelected ? meta.activeItemClass : meta.idleItemClass
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1 space-y-1.5">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                              <span className={`inline-flex items-center gap-1.5 font-semibold ${meta.textClass}`}>
                                <StatusIcon className={`w-3.5 h-3.5 shrink-0 ${meta.iconClass}`} />
                                <span>{item.statusTag}</span>
                              </span>
                              <span aria-hidden="true" className="text-slate-400 dark:text-slate-600">
                                ·
                              </span>
                              <span className="font-mono text-[11px] text-[#475B78] dark:text-[#B4C7E2] tabular-nums">
                                Ý {idx + 1}
                              </span>
                            </div>
                            <p className="text-sm leading-[1.6] text-[#16243E] dark:text-slate-100">
                              {item.studentExcerpt}
                            </p>
                          </div>

                          <ChevronRight
                            aria-hidden="true"
                            className={`w-4 h-4 shrink-0 mt-1 transition-all duration-200 ease-out ${
                              isSelected
                                ? `${meta.iconClass} translate-x-0.5 opacity-100`
                                : 'text-slate-400 dark:text-slate-500 opacity-50 group-hover:opacity-90 group-hover:translate-x-0.5'
                            }`}
                          />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mt-6 pt-4 border-t border-slate-200/80 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs text-[#475B78] dark:text-[#B4C7E2]">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                  <span className="inline-flex items-center gap-1.5 text-rose-700 dark:text-rose-300 font-medium">
                    <XCircle className="w-3.5 h-3.5" />
                    Sai kiến thức
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-amber-700 dark:text-amber-300 font-medium">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Cần bổ sung
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300 font-medium">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Đúng chuẩn
                  </span>
                </div>
                <span className="text-[11px]">Chọn từng ý để xem đối chiếu</span>
              </div>
            </div>

            {/* Right: Verification Result Panel with Smooth Crossfade & Source Accordion */}
            <div className="lg:col-span-5">
              <GlassSurface
                hoverLift={false}
                className="h-full rounded-3xl p-5 sm:p-7 flex flex-col justify-between"
              >
                <div className="flex-1">
                  <div className="flex items-center justify-between gap-2 pb-3.5 mb-4 border-b border-sky-200/60 dark:border-slate-700/70 text-xs">
                    <span className="font-semibold text-[#16243E] dark:text-[#E6EFFC]">
                      Kết quả kiểm chứng
                    </span>
                    <span className="font-mono text-[#475B78] dark:text-[#B4C7E2] tabular-nums">
                      {activeSpecimen.orderLabel}
                    </span>
                  </div>

                  <AnimatePresence mode="wait" initial={false}>
                    <motion.div
                      key={activeSpecimen.id}
                      initial={prefersReduced ? { opacity: 1 } : { opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={prefersReduced ? { opacity: 0 } : { opacity: 0, y: -5 }}
                      transition={{
                        duration: prefersReduced ? 0 : 0.2,
                        ease: [0.16, 1, 0.3, 1],
                      }}
                      className="space-y-4"
                    >
                      {/* Dual-coded Semantic Status Summary */}
                      <div
                        className={`rounded-2xl border px-3.5 py-3 flex items-start gap-2.5 ${activeMeta.resultHeaderBg}`}
                      >
                        <ActiveStatusIcon className={`w-4 h-4 shrink-0 mt-0.5 ${activeMeta.iconClass}`} />
                        <div className="min-w-0">
                          <p className={`text-xs font-bold ${activeMeta.textClass}`}>
                            {activeSpecimen.statusTag}
                          </p>
                          <p className="text-xs text-[#475B78] dark:text-[#B4C7E2] mt-0.5">
                            {activeSpecimen.label}
                          </p>
                        </div>
                      </div>

                      {/* Correct Standard Knowledge */}
                      <div>
                        <p className="text-xs font-semibold text-[#475B78] dark:text-[#B4C7E2] mb-1.5">
                          Kiến thức chuẩn theo tài liệu
                        </p>
                        <p className="text-sm text-[#16243E] dark:text-[#E6EFFC] leading-[1.6] font-medium bg-emerald-50/75 dark:bg-emerald-950/35 border border-emerald-200/80 dark:border-emerald-800/60 rounded-2xl p-3.5 prose-measure">
                          {activeSpecimen.correctKnowledge}
                        </p>
                      </div>

                      {/* Detailed Explanation */}
                      <div>
                        <p className="text-xs font-semibold text-[#475B78] dark:text-[#B4C7E2] mb-1">
                          Giải thích chi tiết
                        </p>
                        <p className="text-sm text-[#16243E] dark:text-slate-200 leading-[1.6] prose-measure">
                          {activeSpecimen.reason}
                        </p>
                      </div>

                      {/* Actionable Fix / Note */}
                      <div className="rounded-2xl bg-sky-50/70 dark:bg-slate-900/60 border border-sky-200/70 dark:border-slate-700/70 p-3.5">
                        <p className="text-xs font-semibold text-sky-800 dark:text-sky-300 mb-1">
                          {activeSpecimen.color === 'green' ? 'Gợi ý ghi nhớ' : 'Gợi ý chỉnh sửa nhanh'}
                        </p>
                        <p className="text-xs text-[#16243E] dark:text-slate-200 leading-[1.6]">
                          {activeSpecimen.actionTip}
                        </p>
                      </div>

                      {/* Collapsible Reference Source Accordion */}
                      <SmoothAccordion
                        open={sourceAccordionOpen}
                        onToggle={setSourceAccordionOpen}
                        icon={<BookMarked className="w-4 h-4 text-sky-600 dark:text-sky-400" />}
                        title={<span className="text-xs font-semibold">Nguồn tham chiếu & trích dẫn</span>}
                        subtitle={<span className="font-mono text-[11px]">{activeSpecimen.source}</span>}
                        className="border border-sky-200/75 dark:border-slate-700/75 bg-white/65 dark:bg-slate-900/50"
                        triggerClassName="px-3.5 py-2.5 hover:bg-sky-50/60 dark:hover:bg-white/5"
                        contentClassName="px-3.5 pb-3.5 pt-2.5 border-t border-sky-200/60 dark:border-slate-700/60 space-y-2 text-xs text-[#475B78] dark:text-[#B4C7E2] leading-[1.6]"
                      >
                        <p className="font-semibold text-[#16243E] dark:text-[#E6EFFC]">
                          {activeSpecimen.sourceBook}
                        </p>
                        <blockquote className="italic text-[#16243E] dark:text-slate-200 bg-white/75 dark:bg-slate-950/50 border border-sky-100 dark:border-slate-800 rounded-xl p-2.5">
                          {activeSpecimen.sourceExcerpt}
                        </blockquote>
                        <p className="text-[11px]">{activeSpecimen.verificationRule}</p>
                      </SmoothAccordion>
                    </motion.div>
                  </AnimatePresence>
                </div>

                <div className="mt-5 pt-4 border-t border-sky-200/60 dark:border-slate-700/70 flex items-center justify-between gap-3 text-xs text-[#475B78] dark:text-[#B4C7E2]">
                  <span>Nhấp nhận định bên trái để đối chiếu</span>
                  <button
                    type="button"
                    onClick={() => onOpenAuth('login')}
                    className="group font-semibold text-sky-700 dark:text-sky-400 hover:text-sky-800 dark:hover:text-sky-300 cursor-pointer min-h-[36px] inline-flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors"
                  >
                    <span>Thử với tài liệu của bạn</span>
                    <ArrowRight className="w-3.5 h-3.5 transition-transform duration-180 group-hover:translate-x-0.5" />
                  </button>
                </div>
              </GlassSurface>
            </div>
          </div>
        </section>

        {/* Exam Center & Practice Highlights (Preserved) */}
        <section id="practice" className="mx-auto max-w-7xl px-4 sm:px-6 py-10 sm:py-16 border-t border-sky-200/50 dark:border-slate-800">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
            <GlassSurface enableRipple className="rounded-3xl p-5 sm:p-6">
              <ShieldCheck className="w-6 h-6 text-sky-600 dark:text-sky-400 mb-3" />
              <h3 className="font-display text-lg font-bold text-[#16243E] dark:text-[#E6EFFC] mb-2">
                Ngân hàng câu sai & Flashcard
              </h3>
              <p className="text-sm text-[#475B78] dark:text-[#B4C7E2] leading-[1.6] prose-measure">
                Lưu vĩnh viễn câu sai và nhắc ôn lặp lại ngắt quãng 1 / 3 / 7 ngày cùng thẻ Flashcard ghi nhớ nhanh.
              </p>
            </GlassSurface>

            <GlassSurface enableRipple className="rounded-3xl p-5 sm:p-6">
              <CheckCircle2 className="w-6 h-6 text-sky-600 dark:text-sky-400 mb-3" />
              <h3 className="font-display text-lg font-bold text-[#16243E] dark:text-[#E6EFFC] mb-2">
                Trung tâm đề kiểm tra GDPT 2018
              </h3>
              <p className="text-sm text-[#475B78] dark:text-[#B4C7E2] leading-[1.6] prose-measure">
                Đề Giữa kỳ & Cuối kỳ chuẩn ma trận theo từng bộ sách với 3 dạng: ABCD, Đúng/Sai và Trả lời ngắn có đồng hồ bấm giờ.
              </p>
            </GlassSurface>

            <GlassSurface enableRipple className="rounded-3xl p-5 sm:p-6">
              <Trophy className="w-6 h-6 text-sky-600 dark:text-sky-400 mb-3" />
              <h3 className="font-display text-lg font-bold text-[#16243E] dark:text-[#E6EFFC] mb-2">
                Đua Top khối & Toàn trường
              </h3>
              <p className="text-sm text-[#475B78] dark:text-[#B4C7E2] leading-[1.6] prose-measure">
                Cộng điểm tích lũy công bằng từ kết quả thi Giữa kỳ / Cuối kỳ để xếp hạng theo từng Khối 10, 11, 12 và Toàn trường.
              </p>
            </GlassSurface>
          </div>
        </section>

        {/* FAQ with Smooth Accordion */}
        <section id="faq" className="mx-auto max-w-4xl px-4 sm:px-6 py-10 sm:py-16 border-t border-sky-200/50 dark:border-slate-800">
          <h2 className="font-display text-[clamp(1.35rem,3.6vw,1.875rem)] font-bold text-[#16243E] dark:text-[#E6EFFC] mt-2 mb-6 sm:mb-8 text-center">
            Câu hỏi thường gặp
          </h2>
          <div className="space-y-3">
            {FAQS.map((item, idx) => {
              const isOpen = openFaqIndex === idx;
              return (
                <SmoothAccordion
                  key={item.q}
                  open={isOpen}
                  onToggle={(next) => setOpenFaqIndex(next ? idx : null)}
                  title={<span className="text-sm sm:text-base font-medium">{item.q}</span>}
                  className="glass-surface rounded-3xl"
                  triggerClassName="min-h-[52px] px-4 sm:px-6 py-3.5 sm:py-4 hover:bg-white/40 dark:hover:bg-white/5"
                  contentClassName="px-4 sm:px-6 pb-4 sm:pb-5 text-sm text-[#475B78] dark:text-[#B4C7E2] leading-[1.6] prose-measure border-t border-sky-200/50 dark:border-slate-700/60 pt-3"
                >
                  {item.a}
                </SmoothAccordion>
              );
            })}
          </div>
        </section>
      </main>

      <footer className="border-t border-sky-200/60 dark:border-slate-800 bg-white/55 dark:bg-slate-900/55 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-6 sm:py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[#475B78] dark:text-[#B4C7E2]">
          <p>© {new Date().getFullYear()} {BRAND_CONFIG.name}. Nền tảng kiểm chứng học tập THPT.</p>
          <div className="flex items-center gap-4">
            <a href="#workflow" className="hover:text-[#16243E] dark:hover:text-white transition-colors">Quy trình</a>
            <span aria-hidden="true">·</span>
            <a href="#specimen" className="hover:text-[#16243E] dark:hover:text-white transition-colors">Minh họa</a>
            <span aria-hidden="true">·</span>
            <a href="#faq" className="hover:text-[#16243E] dark:hover:text-white transition-colors">Hỏi đáp</a>
          </div>
        </div>
      </footer>
    </div>
  );
};
