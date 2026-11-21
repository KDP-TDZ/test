import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Award,
  BookOpen,
  BookOpenCheck,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Compass,
  FileSearch,
  Globe,
  Heart,
  Layers,
  Menu,
  Play,
  Repeat,
  Search,
  ShieldCheck,
  Star,
  Trophy,
  XCircle,
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { BRAND_CONFIG } from '../config/brand';
import { useUiMode } from '../context/UiModeContext';
import { gsap, MOTION_ALLOWED_MEDIA, useGSAP } from '../lib/gsapSetup';
import { NavigationDrawer } from './LiquidGlass/NavigationDrawer';
import { SmoothAccordion } from './LiquidGlass/SmoothAccordion';
import { ThemeToggle } from './LiquidGlass/ThemeToggle';
import { UiModeSwitcher } from './LiquidGlass/UiModeSwitcher';
import { LandingWorkspacePreview } from './LandingWorkspacePreview';

import heroSanctuaryImg from '../assets/images/landing_hero_academic_sanctuary_1795230675957.jpg';
import promoVerifyImg from '../assets/images/landing_promo_verify_banner_1795230676034.jpg';
import cardOcrImg from '../assets/images/landing_card_ocr_verify_1795230676449.jpg';
import cardExamImg from '../assets/images/landing_card_exam_arena_1795230675471.jpg';
import cardFlashcardImg from '../assets/images/landing_card_flashcard_deck_1795230675394.jpg';
import cardAnalyticsImg from '../assets/images/landing_card_analytics_library_1795230675326.jpg';

interface LandingPageProps {
  onOpenAuth: (mode: 'login' | 'register') => void;
}

interface FeaturedFeatureCard {
  id: string;
  title: string;
  subtitle: string;
  rating: string;
  category: string;
  image: string;
  targetSectionId: string;
  actionMode?: 'login' | 'register' | 'scroll';
}

const FEATURED_CARDS: FeaturedFeatureCard[] = [
  {
    id: 'ocr-verify',
    title: 'Kiểm định OCR',
    subtitle: '4 lớp chuẩn SGK',
    rating: '4.9',
    category: 'Cốt lõi',
    image: cardOcrImg,
    targetSectionId: 'specimen',
    actionMode: 'scroll',
  },
  {
    id: 'exam-arena',
    title: 'Đề thi 2025',
    subtitle: 'ABCD & Đúng/Sai',
    rating: '4.9',
    category: 'Thi thử',
    image: cardExamImg,
    targetSectionId: 'workspace-preview',
    actionMode: 'scroll',
  },
  {
    id: 'flashcard-3d',
    title: 'Flashcard 3D',
    subtitle: 'Ôn 1·3·7·14 ngày',
    rating: '4.8',
    category: 'Ghi nhớ',
    image: cardFlashcardImg,
    targetSectionId: 'workspace-preview',
    actionMode: 'scroll',
  },
  {
    id: 'analytics-library',
    title: 'Kho SGK chuẩn',
    subtitle: 'Trích dẫn số trang',
    rating: '5.0',
    category: 'Học liệu',
    image: cardAnalyticsImg,
    targetSectionId: 'workspace-preview',
    actionMode: 'login',
  },
];

const GRADE_OPTIONS = [
  { id: '10', label: 'Khối 10 · GDPT 2018', sub: 'Hóa · Lý · Toán 10' },
  { id: '11', label: 'Khối 11 · GDPT 2018', sub: 'Dao động · Điện · Toán' },
  { id: '12', label: 'Khối 12 · THPT 2025', sub: 'Giải tích · Lý · Hóa 12' },
] as const;

const SUBJECT_OPTIONS = [
  { id: 'hoa', label: 'Môn Hóa học', sub: 'SGK Hóa học chuẩn' },
  { id: 'ly', label: 'Môn Vật lý', sub: 'Đơn vị SI & Công thức' },
  { id: 'toan', label: 'Môn Toán học', sub: 'Giải tích & Hình học' },
] as const;

const DOC_OPTIONS = [
  { id: 'ocr', label: 'Ảnh vở viết tay', sub: 'Duyệt OCR trước chấm' },
  { id: 'pdf', label: 'Tài liệu PDF', sub: 'Khoanh vùng lỗi sai' },
  { id: 'docx', label: 'Tài liệu DOCX', sub: 'Tách mệnh đề tự động' },
] as const;

const GOAL_OPTIONS = [
  { id: 'verify', label: 'Chấm 2 chỉ số', sub: 'Chính xác · Đầy đủ' },
  { id: 'exam', label: 'Thi thử 2025', sub: 'Đếm ngược · Đua Top' },
  { id: 'practice', label: 'Ôn ngắt quãng', sub: 'Chu kỳ 1·3·7·14 ngày' },
] as const;

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

const FAQS = [
  {
    q: 'StudyCheck AI có đánh đồng việc viết thiếu ý với việc viết sai kiến thức không?',
    a: 'Không. Hệ thống tách biệt hoàn toàn hai chỉ số độc lập: Độ chính xác (Accuracy) chỉ chấm trên những kiến thức bạn đã viết và đã được xác minh, còn Độ đầy đủ (Completeness) đo mức độ bao phủ mục tiêu học tập của chương đã chọn.',
  },
  {
    q: 'Ảnh chụp vở viết tay hoặc ảnh bảng có được sửa lỗi OCR trước khi chấm không?',
    a: 'Có. Bước Duyệt OCR hiển thị văn bản nhận diện cùng độ tin cậy từng đoạn và tự động bật khi ảnh mờ để bạn rà soát lại trước khi chấm, tuyệt đối không chấm oan lỗi nhận diện chữ.',
  },
  {
    q: 'Sau khi đăng nhập, khu vực nội dung chính có những tính năng nào?',
    a: 'Bạn sẽ vào thẳng Workspace gồm: Kiểm định vở & Duyệt OCR, Trắc nghiệm thích ứng, Ngân hàng luyện tập ngắt quãng & Flashcard 3D, Trung tâm Đề thi chuẩn 2025, Bảng xếp hạng Đua Top, Phân tích tiến độ và Lịch sử bài làm.',
  },
  {
    q: 'Hệ thống lấy nguồn kiến thức từ đâu để kiểm chứng?',
    a: 'Ưu tiên hàng đầu là kho sách giáo khoa chuẩn GDPT 2018 do quản trị viên lập chỉ mục theo khối lớp. Với kiến thức nâng cao ngoài sách, hệ thống đối chiếu bổ sung qua nguồn học thuật có trích dẫn cụ thể.',
  },
];

const STATUS_META = {
  red: {
    icon: XCircle,
    textClass: 'text-rose-700 dark:text-rose-300',
    iconClass: 'text-rose-600 dark:text-rose-400',
    activeItemClass:
      'bg-rose-50/95 dark:bg-rose-950/55 border-rose-300 dark:border-rose-600/80 ring-2 ring-rose-200/80 dark:ring-rose-900/70',
    idleItemClass:
      'bg-rose-50/40 dark:bg-rose-950/20 border-rose-200/70 dark:border-rose-900/60 hover:bg-rose-50/85 dark:hover:bg-rose-950/38',
    resultHeaderBg:
      'bg-rose-50/75 dark:bg-rose-950/40 border-rose-200/80 dark:border-rose-800/60',
  },
  orange: {
    icon: AlertTriangle,
    textClass: 'text-amber-700 dark:text-amber-300',
    iconClass: 'text-amber-600 dark:text-amber-400',
    activeItemClass:
      'bg-amber-50/95 dark:bg-amber-950/55 border-amber-300 dark:border-amber-600/80 ring-2 ring-amber-200/80 dark:ring-amber-900/70',
    idleItemClass:
      'bg-amber-50/40 dark:bg-amber-950/20 border-amber-200/70 dark:border-amber-900/60 hover:bg-amber-50/85 dark:hover:bg-amber-950/38',
    resultHeaderBg:
      'bg-amber-50/75 dark:bg-amber-950/40 border-amber-200/80 dark:border-amber-800/60',
  },
  green: {
    icon: CheckCircle2,
    textClass: 'text-emerald-700 dark:text-emerald-300',
    iconClass: 'text-emerald-600 dark:text-emerald-400',
    activeItemClass:
      'bg-emerald-50/95 dark:bg-emerald-950/55 border-emerald-300 dark:border-emerald-600/80 ring-2 ring-emerald-200/80 dark:ring-emerald-900/70',
    idleItemClass:
      'bg-emerald-50/40 dark:bg-emerald-950/20 border-emerald-200/70 dark:border-emerald-900/60 hover:bg-emerald-50/85 dark:hover:bg-emerald-950/38',
    resultHeaderBg:
      'bg-emerald-50/75 dark:bg-emerald-950/40 border-emerald-200/80 dark:border-emerald-800/60',
  },
} as const;

export const LandingPage: React.FC<LandingPageProps> = ({ onOpenAuth }) => {
  const { isEthereal } = useUiMode();
  const pageRef = useRef<HTMLDivElement>(null);
  const hamburgerBtnRef = useRef<HTMLButtonElement>(null);
  const carouselTrackRef = useRef<HTMLDivElement>(null);
  const prefersReduced = useReducedMotion();

  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<string>('top');
  const [gradeIdx, setGradeIdx] = useState(0);
  const [subjectIdx, setSubjectIdx] = useState(0);
  const [docIdx, setDocIdx] = useState(0);
  const [goalIdx, setGoalIdx] = useState(0);
  const [bookmarkedIds, setBookmarkedIds] = useState<Record<string, boolean>>({
    'ocr-verify': true,
  });
  const [selectedSpecimenId, setSelectedSpecimenId] = useState<string>('err-1');
  const [sourceAccordionOpen, setSourceAccordionOpen] = useState<boolean>(true);
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(0);
  const [heroImgFailed, setHeroImgFailed] = useState(false);
  const [promoImgFailed, setPromoImgFailed] = useState(false);
  const [cardImgFailed, setCardImgFailed] = useState<Record<string, boolean>>({});

  const landingDrawerId = 'landing-navigation-drawer';

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const handleChange = (e: MediaQueryListEvent) => {
      if (e.matches) setMobileNavOpen(false);
    };
    mq.addEventListener('change', handleChange);
    return () => mq.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const sectionIds = ['top', 'featured', 'specimen', 'workspace-preview', 'faq'];
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
      { rootMargin: '-10% 0px -45% 0px', threshold: [0.05, 0.2, 0.4] }
    );

    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_ALLOWED_MEDIA, () => {
        const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
        tl.from('.travorra-hero-fade', {
          y: 18,
          autoAlpha: 0,
          duration: 0.48,
          stagger: 0.075,
          clearProps: 'transform,opacity,visibility',
        })
          .from(
            '.travorra-hero-media',
            {
              scale: 0.985,
              autoAlpha: 0,
              duration: 0.54,
              clearProps: 'transform,opacity,visibility',
            },
            '-=0.36'
          )
          .from(
            '.travorra-action-bar',
            {
              y: 20,
              autoAlpha: 0,
              duration: 0.45,
              clearProps: 'transform,opacity,visibility',
            },
            '-=0.28'
          );
      });
    },
    { scope: pageRef }
  );

  const scrollToSection = (sectionId: string) => {
    setActiveSection(sectionId);
    const el = document.getElementById(sectionId);
    if (el) {
      el.scrollIntoView({ behavior: prefersReduced ? 'auto' : 'smooth', block: 'start' });
    }
  };

  const handleScrollCarousel = (dir: 'prev' | 'next') => {
    const track = carouselTrackRef.current;
    if (!track) return;
    const step = 250;
    track.scrollBy({
      left: dir === 'next' ? step : -step,
      behavior: prefersReduced ? 'auto' : 'smooth',
    });
  };

  const toggleBookmark = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setBookmarkedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const activeGrade = GRADE_OPTIONS[gradeIdx];
  const activeSubject = SUBJECT_OPTIONS[subjectIdx];
  const activeDoc = DOC_OPTIONS[docIdx];
  const activeGoal = GOAL_OPTIONS[goalIdx];

  const activeSpecimen =
    SPECIMEN_ANNOTATIONS.find((s) => s.id === selectedSpecimenId) || SPECIMEN_ANNOTATIONS[0];
  const activeMeta = STATUS_META[activeSpecimen.color];
  const ActiveStatusIcon = activeMeta.icon;

  const navItems = [
    { id: 'top', label: 'Khám phá' },
    { id: 'featured', label: 'Tính năng' },
    { id: 'specimen', label: 'Kiểm chứng' },
    { id: 'workspace-preview', label: 'Thi & Đua Top' },
    { id: 'faq', label: 'Hỏi đáp' },
  ] as const;

  return (
    <div
      ref={pageRef}
      className="flex flex-col min-h-dvh bg-[#F8FAFC] dark:bg-[#09111E] text-[#172033] dark:text-[#E6EFFC] selection:bg-[#2563EB]/15 selection:text-[#2563EB]"
    >
      {/* =====================================================================
          A. HEADER / NAVIGATION (Matches Reference Top Bar Architecture)
         ===================================================================== */}
      <header className="sticky top-0 z-[45] bg-[#F8FAFC]/88 dark:bg-[#09111E]/88 backdrop-blur-xl border-b border-[#E8EDF4]/80 dark:border-slate-800/80 transition-colors">
        <div className="mx-auto max-w-[1380px] px-4 sm:px-8 h-16 md:h-20 flex items-center justify-between gap-6">
          {/* Left: Brand Logo with Circular Blue Mark + Title & Tagline */}
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              scrollToSection('top');
            }}
            className="flex items-center gap-3 shrink-0 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] rounded-xl"
          >
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#2563EB] to-[#1746A2] flex items-center justify-center text-white shadow-[0_8px_20px_-6px_rgba(37,99,235,0.55)] transition-transform duration-200 group-hover:scale-105">
              <BookOpenCheck className="w-5 h-5" />
            </div>
            <div className="leading-tight">
              <span className="block font-display text-base sm:text-[17px] font-bold tracking-tight text-[#172033] dark:text-white">
                {BRAND_CONFIG.name}
              </span>
              <span className="block text-[11px] font-medium text-[#778196] dark:text-slate-400">
                Kiểm chứng tri thức THPT
              </span>
            </div>
          </a>

          {/* Center: Clean Editorial Navigation with Active Indicator */}
          <nav
            aria-label="Điều hướng chính trang chủ"
            className="hidden lg:flex items-center gap-8 text-[13px] font-medium text-[#778196] dark:text-slate-300"
          >
            {navItems.map((item) => {
              const isActive = activeSection === item.id;
              return (
                <a
                  key={item.id}
                  href={`#${item.id}`}
                  aria-current={isActive ? 'page' : undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    scrollToSection(item.id);
                  }}
                  className={`relative py-2 whitespace-nowrap transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] rounded-md ${
                    isActive
                      ? 'text-[#172033] dark:text-white font-semibold'
                      : 'hover:text-[#2563EB] dark:hover:text-sky-400'
                  }`}
                >
                  <span>{item.label}</span>
                  <span
                    aria-hidden="true"
                    className={`absolute left-1/2 -translate-x-1/2 -bottom-0.5 h-1.5 rounded-full bg-[#2563EB] transition-all duration-200 ${
                      isActive ? 'w-1.5 opacity-100' : 'w-0 opacity-0'
                    }`}
                  />
                </a>
              );
            })}
          </nav>

          {/* Right: Language / Account Trigger + Theme + Circular Menu Button */}
          <div className="flex items-center gap-2.5 sm:gap-3.5 shrink-0">
            <button
              type="button"
              onClick={() => onOpenAuth('login')}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold text-[#172033] dark:text-slate-200 hover:text-[#2563EB] dark:hover:text-sky-400 transition-colors cursor-pointer"
            >
              <Globe className="w-3.5 h-3.5 text-[#2563EB] dark:text-sky-400" />
              <span>VN · Đăng nhập</span>
              <ChevronDown className="w-3.5 h-3.5 opacity-70" />
            </button>

            <div className="hidden md:block">
              <ThemeToggle />
            </div>

            <button
              ref={hamburgerBtnRef}
              type="button"
              aria-label="Mở bảng điều hướng và tài khoản"
              aria-expanded={mobileNavOpen}
              aria-controls={landingDrawerId}
              onClick={() => setMobileNavOpen((v) => !v)}
              className="w-10 h-10 rounded-full bg-white dark:bg-slate-800 border border-[#E8EDF4] dark:border-slate-700 shadow-[0_6px_18px_-6px_rgba(23,32,51,0.12)] flex items-center justify-center text-[#172033] dark:text-white hover:border-[#2563EB] hover:text-[#2563EB] transition-all duration-200 cursor-pointer"
            >
              <Menu className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Slide-out Navigation & Account Drawer */}
      <NavigationDrawer
        id={landingDrawerId}
        open={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        triggerRef={hamburgerBtnRef}
        ariaLabel="Điều hướng trang chủ StudyCheck AI"
        footer={
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between gap-2 px-1">
              <span className="text-[11px] font-medium text-[#778196] dark:text-slate-400">
                Chế độ giao diện Workspace
              </span>
              <UiModeSwitcher />
            </div>
            <div className="flex items-center justify-between gap-2 px-1 md:hidden">
              <span className="text-[11px] font-medium text-[#778196] dark:text-slate-400">
                Giao diện Sáng / Tối
              </span>
              <ThemeToggle />
            </div>
            <button
              type="button"
              onClick={() => {
                setMobileNavOpen(false);
                onOpenAuth('login');
              }}
              className="w-full min-h-[44px] rounded-full bg-[#2563EB] hover:bg-[#1746A2] text-white text-xs font-semibold shadow-[0_10px_24px_-8px_rgba(37,99,235,0.65)] transition-colors cursor-pointer"
            >
              Đăng nhập vào Workspace
            </button>
            <button
              type="button"
              onClick={() => {
                setMobileNavOpen(false);
                onOpenAuth('register');
              }}
              className="w-full min-h-[42px] rounded-full border border-[#E8EDF4] dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold text-[#172033] dark:text-white hover:border-[#2563EB] transition-colors cursor-pointer"
            >
              Tạo tài khoản học tập mới
            </button>
          </div>
        }
      >
        <p className="px-3 pb-2 text-[11px] font-semibold tracking-wide text-[#778196] dark:text-slate-400">
          Danh mục trang chủ
        </p>
        <div className="space-y-1">
          {navItems.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              onClick={(e) => {
                e.preventDefault();
                setMobileNavOpen(false);
                scrollToSection(item.id);
              }}
              className={`w-full min-h-[42px] flex items-center px-3.5 py-2 rounded-xl text-sm font-medium transition-colors ${
                activeSection === item.id
                  ? 'bg-[#EAF2FF] dark:bg-blue-950/60 text-[#2563EB] dark:text-sky-300 font-semibold'
                  : 'text-[#172033] dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/70'
              }`}
            >
              {item.label}
            </a>
          ))}
        </div>
      </NavigationDrawer>

      <main id="top" className="flex-1">
        {/* =====================================================================
            B. HERO SECTION + C. FLOATING SEARCH / ACTION BAR
            (Asymmetric Organic S-Curve Hero + Boundary Play Button + Floating Stats Card + Overlapping Action Pill Bar)
           ===================================================================== */}
        <section className="relative mx-auto max-w-[1380px] px-4 sm:px-8 pt-4 pb-12 lg:pt-6 lg:pb-16">
          <div className="relative rounded-[34px] sm:rounded-[44px] bg-white dark:bg-[#0E1729] border border-[#E8EDF4] dark:border-slate-800/90 shadow-[0_28px_70px_-28px_rgba(23,32,51,0.09)] overflow-hidden">
            <div className="relative grid grid-cols-1 lg:grid-cols-12 items-center min-h-[540px] lg:min-h-[590px]">
              {/* Left Region: Editorial Serif Headline + Dashed Decorative Trail + Pill CTA */}
              <div className="relative z-20 lg:col-span-5 px-6 sm:px-10 lg:pl-14 lg:pr-4 pt-9 pb-7 lg:py-12">
                {/* Eyebrow with dashed flight-path curve ornament */}
                <div className="travorra-hero-fade flex items-center gap-2.5 mb-3.5">
                  <span className="text-[11px] sm:text-xs font-bold tracking-[0.16em] text-[#2563EB] dark:text-sky-400 whitespace-nowrap">
                    ĐỐI CHIẾU. KIỂM CHỨNG. BỨT PHÁ.
                  </span>
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 84 20"
                    className="w-14 sm:w-20 h-4 text-[#2563EB] dark:text-sky-400 shrink-0"
                    fill="none"
                  >
                    <path
                      d="M2 15C20 15 34 5 64 7"
                      stroke="currentColor"
                      strokeWidth="1.4"
                      strokeDasharray="3 3"
                      strokeLinecap="round"
                    />
                    <path
                      d="M78 6L66 2L69 7L65 12L78 6Z"
                      fill="currentColor"
                    />
                  </svg>
                </div>

                {/* Large Contrast Serif Headline with Blue Italic Accent */}
                <h1
                  style={{ fontFamily: 'var(--font-serif)' }}
                  className="travorra-hero-fade text-[clamp(2.55rem,4.8vw,4.3rem)] font-bold tracking-[-0.02em] text-[#172033] dark:text-white leading-[1.06] text-balance"
                >
                  Tri thức chuẩn
                  <span className="block italic font-semibold text-[#2563EB] dark:text-sky-400 mt-1">
                    trong tầm tay.
                  </span>
                </h1>

                {/* Concise 2-3 line description */}
                <p className="travorra-hero-fade mt-5 text-sm sm:text-[15px] text-[#778196] dark:text-slate-300 leading-[1.68] max-w-[40ch]">
                  Tải ảnh chụp vở viết tay, PDF hoặc DOCX để đối chiếu trực tiếp với kho sách giáo khoa chuẩn GDPT 2018, phát hiện lỗi sai và luyện đề cấu trúc 2025.
                </p>

                {/* Primary Pill CTA Button with Circular White Arrow */}
                <div className="travorra-hero-fade mt-7 flex flex-wrap items-center gap-4">
                  <button
                    type="button"
                    onClick={() => onOpenAuth('login')}
                    className="group inline-flex items-center gap-3.5 pl-6 pr-2.5 py-2.5 rounded-full bg-gradient-to-r from-[#2563EB] to-[#1D4ED8] hover:from-[#1D4ED8] hover:to-[#1746A2] text-white text-sm font-semibold shadow-[0_16px_32px_-10px_rgba(37,99,235,0.62)] hover:shadow-[0_20px_38px_-10px_rgba(37,99,235,0.75)] hover:-translate-y-0.5 transition-all duration-200 cursor-pointer"
                  >
                    <span>Bắt đầu kiểm chứng</span>
                    <span className="w-8 h-8 rounded-full bg-white text-[#2563EB] flex items-center justify-center transition-transform duration-200 group-hover:translate-x-0.5">
                      <ArrowRight className="w-4 h-4" />
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onOpenAuth('register')}
                    className="text-xs sm:text-sm font-semibold text-[#172033] dark:text-slate-200 hover:text-[#2563EB] dark:hover:text-sky-400 transition-colors px-2 py-2 cursor-pointer"
                  >
                    Tạo tài khoản mới →
                  </button>
                </div>

                {/* Subtle Author Signature Mark at the Base of Hero Left Column */}
                <div className="travorra-hero-fade mt-7 pt-4 border-t border-[#E8EDF4] dark:border-slate-800/80 flex items-center gap-3">
                  <div className="text-[11px] text-[#778196] dark:text-slate-400">
                    <span>Thiết kế &amp; Phát triển bởi </span>
                    <strong className="font-semibold text-[#172033] dark:text-white">
                      {BRAND_CONFIG.authorName}
                    </strong>
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

              {/* Right Region: Large Organic Curved Hero Image + Boundary Play Button + Floating Stat Card */}
              <div className="travorra-hero-media relative lg:col-span-7 h-[350px] sm:h-[430px] lg:h-[590px] w-full">
                {/* Main Hero Visual Container */}
                <div className="relative w-full h-full overflow-hidden">
                  {!heroImgFailed ? (
                    <img
                      src={heroSanctuaryImg}
                      alt="Không gian học thuật StudyCheck AI với sách giáo khoa và lăng kính quang học hướng biển lúc bình minh"
                      referrerPolicy="no-referrer"
                      data-no-privacy-blur="true"
                      onError={() => setHeroImgFailed(true)}
                      className="w-full h-full object-cover object-center scale-[1.01] transition-transform duration-700 hover:scale-[1.03]"
                    />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-[#EAF2FF] via-sky-100 to-indigo-100 dark:from-slate-800 dark:to-slate-900 flex items-center justify-center">
                      <BookOpenCheck className="w-16 h-16 text-[#2563EB]" />
                    </div>
                  )}

                  {/* Soft atmospheric vignette for floating card contrast */}
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-[#172033]/18 via-transparent to-[#172033]/14"
                  />

                  {/* Desktop Organic S-Curve SVG Mask seamlessly blending left white canvas into the photo */}
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 260 600"
                    preserveAspectRatio="none"
                    className="hidden lg:block pointer-events-none absolute -left-[2px] top-0 h-full w-56 xl:w-64 z-10"
                  >
                    {/* Soft translucent blue wave accent along the lower curve */}
                    <path
                      d="M0,0 L248,0 C175,95 62,165 68,318 C74,442 172,510 245,600 L0,600 Z"
                      className="fill-[#2563EB]/14 dark:fill-sky-400/15"
                    />
                    {/* Solid surface organic curve matching left column background */}
                    <path
                      d="M0,0 L225,0 C152,95 36,172 44,322 C50,446 140,515 210,600 L0,600 Z"
                      className="fill-white dark:fill-[#0E1729]"
                    />
                  </svg>

                  {/* Mobile Top Soft Curve Blend */}
                  <div
                    aria-hidden="true"
                    className="lg:hidden pointer-events-none absolute inset-x-0 top-0 h-14 bg-gradient-to-b from-white dark:from-[#0E1729] to-transparent z-10"
                  />
                </div>

                {/* Circular Play / Demo Trigger Button placed right on the organic curve boundary */}
                <div className="hidden sm:flex flex-col items-center absolute left-4 lg:left-7 top-[56%] -translate-y-1/2 z-20">
                  <span className="mb-1.5 px-2.5 py-0.5 rounded-full bg-white/90 dark:bg-slate-900/90 backdrop-blur-md text-[10px] font-semibold tracking-wide text-[#778196] dark:text-slate-300 shadow-xs">
                    Xem mẫu đối chiếu
                  </span>
                  <div className="p-3.5 rounded-full bg-[#EAF2FF]/80 dark:bg-slate-800/80 backdrop-blur-md shadow-[0_12px_28px_-10px_rgba(37,99,235,0.28)]">
                    <button
                      type="button"
                      aria-label="Cuộn xem mẫu đối chiếu sách giáo khoa tương tác"
                      onClick={() => scrollToSection('specimen')}
                      className="group w-14 h-14 rounded-full bg-white dark:bg-slate-900 text-[#172033] dark:text-white shadow-[0_14px_30px_-8px_rgba(23,32,51,0.28)] flex items-center justify-center hover:scale-105 hover:text-[#2563EB] transition-all duration-200 cursor-pointer"
                    >
                      <Play className="w-5 h-5 fill-current ml-0.5 transition-transform duration-200 group-hover:scale-110" />
                    </button>
                  </div>
                </div>

                {/* Floating Glass Information Card on Right of Hero Image (Matches Reference Top-Right Card) */}
                <div className="hero-float-slow absolute top-5 right-5 sm:top-8 sm:right-8 z-20 w-44 sm:w-48 rounded-[26px] bg-white/92 dark:bg-slate-900/92 backdrop-blur-xl border border-white/90 dark:border-slate-700/80 p-4 shadow-[0_22px_45px_-16px_rgba(23,32,51,0.32)]">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex -space-x-2">
                      <span className="w-8 h-8 rounded-full bg-[#EAF2FF] text-[#2563EB] font-bold text-xs flex items-center justify-center ring-2 ring-white dark:ring-slate-900">
                        10
                      </span>
                      <span className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 font-bold text-xs flex items-center justify-center ring-2 ring-white dark:ring-slate-900">
                        11
                      </span>
                      <span className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-700 font-bold text-xs flex items-center justify-center ring-2 ring-white dark:ring-slate-900">
                        12
                      </span>
                    </div>
                    <span className="px-2.5 py-1 rounded-full bg-[#2563EB] text-white font-mono text-[11px] font-bold tabular-nums shadow-xs">
                      4 Lớp
                    </span>
                  </div>

                  <div className="mt-3">
                    <p className="text-xs font-bold text-[#172033] dark:text-white">
                      Chuẩn GDPT 2018
                    </p>
                    <p className="text-[11px] text-[#778196] dark:text-slate-400 mt-0.5">
                      Định nghĩa · Công thức · SI
                    </p>
                  </div>

                  <div className="mt-3 pt-2.5 border-t border-[#E8EDF4] dark:border-slate-800 flex items-center justify-between text-[11px]">
                    <span className="text-[#778196] dark:text-slate-400">Độ chính xác mẫu</span>
                    <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                      94.2%
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* =====================================================================
              C. FLOATING SEARCH / ACTION BAR (Overlapping Bottom of Hero)
              Uses 100% Real StudyCheck AI Controls: Khối lớp | Môn học | Định dạng | Mục tiêu | Nút tròn xanh
             ===================================================================== */}
          <div className="travorra-action-bar relative z-30 mx-auto max-w-5xl -mt-8 sm:-mt-11 px-2 sm:px-6">
            <div className="rounded-[28px] lg:rounded-full bg-white dark:bg-[#131E35] border border-[#E8EDF4] dark:border-slate-700/80 shadow-[0_24px_60px_-20px_rgba(23,32,51,0.16)] p-3 sm:p-3.5 lg:px-6 lg:py-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 items-center gap-2 sm:gap-3 lg:gap-0">
                {/* Group 1: Khối lớp */}
                <button
                  type="button"
                  onClick={() => setGradeIdx((i) => (i + 1) % GRADE_OPTIONS.length)}
                  className="lg:col-span-3 flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-2xl hover:bg-[#F8FAFC] dark:hover:bg-slate-800/70 transition-colors text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-[#EAF2FF] dark:bg-blue-950/80 text-[#2563EB] dark:text-sky-400 flex items-center justify-center shrink-0">
                      <Compass className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-[#172033] dark:text-white truncate">
                        {activeGrade.label}
                      </p>
                      <p className="text-[11px] text-[#778196] dark:text-slate-400 truncate">
                        {activeGrade.sub}
                      </p>
                    </div>
                  </div>
                  <ChevronDown className="w-3.5 h-3.5 text-[#778196] shrink-0" />
                </button>

                {/* Group 2: Môn học & SGK */}
                <button
                  type="button"
                  onClick={() => setSubjectIdx((i) => (i + 1) % SUBJECT_OPTIONS.length)}
                  className="lg:col-span-3 lg:border-l lg:border-[#E8EDF4] dark:lg:border-slate-700/80 flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-2xl hover:bg-[#F8FAFC] dark:hover:bg-slate-800/70 transition-colors text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-[#EAF2FF] dark:bg-blue-950/80 text-[#2563EB] dark:text-sky-400 flex items-center justify-center shrink-0">
                      <BookOpen className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-[#172033] dark:text-white truncate">
                        {activeSubject.label}
                      </p>
                      <p className="text-[11px] text-[#778196] dark:text-slate-400 truncate">
                        {activeSubject.sub}
                      </p>
                    </div>
                  </div>
                  <ChevronDown className="w-3.5 h-3.5 text-[#778196] shrink-0" />
                </button>

                {/* Group 3: Định dạng tài liệu */}
                <button
                  type="button"
                  onClick={() => setDocIdx((i) => (i + 1) % DOC_OPTIONS.length)}
                  className="lg:col-span-3 lg:border-l lg:border-[#E8EDF4] dark:lg:border-slate-700/80 flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-2xl hover:bg-[#F8FAFC] dark:hover:bg-slate-800/70 transition-colors text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-[#EAF2FF] dark:bg-blue-950/80 text-[#2563EB] dark:text-sky-400 flex items-center justify-center shrink-0">
                      <FileSearch className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-[#172033] dark:text-white truncate">
                        {activeDoc.label}
                      </p>
                      <p className="text-[11px] text-[#778196] dark:text-slate-400 truncate">
                        {activeDoc.sub}
                      </p>
                    </div>
                  </div>
                  <ChevronDown className="w-3.5 h-3.5 text-[#778196] shrink-0" />
                </button>

                {/* Group 4: Mục tiêu + Circular Blue Action Button */}
                <div className="lg:col-span-3 lg:border-l lg:border-[#E8EDF4] dark:lg:border-slate-700/80 flex items-center justify-between gap-2 pl-3.5 pr-1 py-1">
                  <button
                    type="button"
                    onClick={() => setGoalIdx((i) => (i + 1) % GOAL_OPTIONS.length)}
                    className="flex items-center justify-between gap-2 min-w-0 flex-1 py-1.5 rounded-xl hover:bg-[#F8FAFC] dark:hover:bg-slate-800/70 transition-colors text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-9 h-9 rounded-full bg-[#EAF2FF] dark:bg-blue-950/80 text-[#2563EB] dark:text-sky-400 flex items-center justify-center shrink-0">
                        <Layers className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-[#172033] dark:text-white truncate">
                          {activeGoal.label}
                        </p>
                        <p className="text-[11px] text-[#778196] dark:text-slate-400 truncate">
                          {activeGoal.sub}
                        </p>
                      </div>
                    </div>
                    <ChevronDown className="w-3.5 h-3.5 text-[#778196] shrink-0" />
                  </button>

                  <button
                    type="button"
                    aria-label="Mở trình kiểm chứng với cấu hình đã chọn"
                    onClick={() => onOpenAuth('login')}
                    className="w-12 h-12 rounded-full bg-[#2563EB] hover:bg-[#1746A2] text-white shadow-[0_12px_26px_-6px_rgba(37,99,235,0.65)] hover:scale-105 transition-all duration-200 flex items-center justify-center shrink-0 cursor-pointer"
                  >
                    <Search className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* =====================================================================
            D. FEATURED CONTENT SECTION (2-Column Reference Architecture)
            Left: Promotional Image Card with Highlighted Title + 3-Metric Strip Below
            Right: Heading + View All + 4 Vertical Image Cards with Heart, Gradient Bottom, Rating & Carousel Nav
           ===================================================================== */}
        <section
          id="featured"
          className="scroll-mt-20 mx-auto max-w-[1380px] px-4 sm:px-8 pt-4 pb-14 lg:pb-20"
        >
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
            {/* LEFT COLUMN: Promotional Banner Card + 3-Metric Strip */}
            <div className="lg:col-span-5 flex flex-col justify-between gap-5">
              {/* Large Promotional Card with Image Background & Dark Gradient Overlay */}
              <div className="group relative rounded-[30px] overflow-hidden min-h-[250px] sm:min-h-[270px] flex flex-col justify-between p-6 sm:p-7 shadow-[0_20px_48px_-20px_rgba(23,32,51,0.22)]">
                {!promoImgFailed ? (
                  <img
                    src={promoVerifyImg}
                    alt="Học sinh THPT ôn tập và đối chiếu vở ghi cùng StudyCheck AI"
                    referrerPolicy="no-referrer"
                    data-no-privacy-blur="true"
                    onError={() => setPromoImgFailed(true)}
                    className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                ) : (
                  <div className="absolute inset-0 bg-gradient-to-br from-[#1746A2] to-[#0F172A]" />
                )}

                {/* Measured Dark Blue Scrim */}
                <div
                  aria-hidden="true"
                  className="absolute inset-0 bg-gradient-to-r from-[#0D1F4B]/92 via-[#1746A2]/75 to-[#0D1F4B]/35"
                />

                <div className="relative z-10">
                  <span className="inline-block px-3 py-1 rounded-full bg-white/18 backdrop-blur-md text-[10px] font-bold tracking-[0.14em] text-white uppercase">
                    CHUẨN HÓA ÔN TẬP THPT 2025
                  </span>

                  <h2
                    style={{ fontFamily: 'var(--font-serif)' }}
                    className="mt-3.5 text-2xl sm:text-[28px] font-bold text-white leading-[1.2]"
                  >
                    Tách bạch{' '}
                    <span className="text-amber-300 italic">100% lỗi sai</span>
                    <span className="block text-base sm:text-lg font-sans font-medium text-blue-100 mt-1">
                      khỏi các ý viết thiếu trong vở ghi của bạn
                    </span>
                  </h2>
                </div>

                <div className="relative z-10 mt-5">
                  <button
                    type="button"
                    onClick={() => onOpenAuth('login')}
                    className="group/btn inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-white text-[#172033] hover:bg-[#EAF2FF] hover:text-[#2563EB] text-xs font-bold shadow-md transition-all duration-200 cursor-pointer"
                  >
                    <span>Trải nghiệm ngay</span>
                    <ArrowRight className="w-3.5 h-3.5 transition-transform duration-200 group-hover/btn:translate-x-0.5" />
                  </button>
                </div>
              </div>

              {/* 3-Metric Statistics Row Card Below Promo Banner */}
              <div className="rounded-[26px] bg-white dark:bg-[#111B30] border border-[#E8EDF4] dark:border-slate-800 px-4 py-4 sm:px-6 sm:py-5 shadow-[0_14px_34px_-18px_rgba(23,32,51,0.08)] grid grid-cols-3 gap-3">
                <div className="flex items-center gap-2.5 sm:gap-3">
                  <div className="w-10 h-10 rounded-full bg-[#EAF2FF] dark:bg-blue-950/70 text-[#2563EB] dark:text-sky-400 flex items-center justify-center shrink-0">
                    <ShieldCheck className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-display text-base sm:text-lg font-bold text-[#172033] dark:text-white tabular-nums">
                      4 Lớp
                    </p>
                    <p className="text-[11px] text-[#778196] dark:text-slate-400 truncate">
                      Đối chiếu SGK
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2.5 sm:gap-3 border-l border-[#E8EDF4] dark:border-slate-800 pl-3">
                  <div className="w-10 h-10 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                    <Repeat className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-display text-base sm:text-lg font-bold text-[#172033] dark:text-white tabular-nums">
                      1-3-7-14
                    </p>
                    <p className="text-[11px] text-[#778196] dark:text-slate-400 truncate">
                      Chu kỳ ôn tập
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2.5 sm:gap-3 border-l border-[#E8EDF4] dark:border-slate-800 pl-3">
                  <div className="w-10 h-10 rounded-full bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                    <Award className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-display text-base sm:text-lg font-bold text-[#172033] dark:text-white tabular-nums whitespace-nowrap">
                      10–12
                    </p>
                    <p className="text-[11px] text-[#778196] dark:text-slate-400 truncate">
                      Đề chuẩn 2025
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* RIGHT COLUMN: Heading + View All + 4 Vertical Featured Cards with Carousel Nav */}
            <div className="lg:col-span-7 flex flex-col justify-between">
              <div className="flex items-center justify-between gap-4 mb-4">
                <h2 className="font-display text-lg sm:text-xl font-bold text-[#172033] dark:text-white">
                  Không gian học tập nổi bật
                </h2>
                <button
                  type="button"
                  onClick={() => scrollToSection('workspace-preview')}
                  className="inline-flex items-center gap-1 text-xs font-bold text-[#2563EB] dark:text-sky-400 hover:text-[#1746A2] transition-colors cursor-pointer"
                >
                  <span>Xem chi tiết</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Cards Row with Left / Right Floating Circular Buttons */}
              <div className="relative">
                <button
                  type="button"
                  aria-label="Trượt sang trái"
                  onClick={() => handleScrollCarousel('prev')}
                  className="hidden sm:flex absolute -left-4 top-1/2 -translate-y-1/2 z-20 w-9 h-9 rounded-full bg-white dark:bg-slate-800 border border-[#E8EDF4] dark:border-slate-700 text-[#172033] dark:text-white shadow-md items-center justify-center hover:border-[#2563EB] hover:text-[#2563EB] transition-all duration-200 cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>

                <div
                  ref={carouselTrackRef}
                  className="grid grid-flow-col auto-cols-[78%] sm:auto-cols-[46%] xl:grid-cols-4 gap-4 overflow-x-auto no-scrollbar snap-x snap-mandatory py-1"
                >
                  {FEATURED_CARDS.map((card) => {
                    const isLiked = Boolean(bookmarkedIds[card.id]);
                    const imgFailed = Boolean(cardImgFailed[card.id]);
                    return (
                      <div
                        key={card.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          if (card.actionMode === 'login') {
                            onOpenAuth('login');
                          } else {
                            scrollToSection(card.targetSectionId);
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            if (card.actionMode === 'login') {
                              onOpenAuth('login');
                            } else {
                              scrollToSection(card.targetSectionId);
                            }
                          }
                        }}
                        className="group relative snap-start rounded-[24px] overflow-hidden h-[290px] sm:h-[310px] flex flex-col justify-between p-3.5 border border-[#E8EDF4] dark:border-slate-800 shadow-[0_14px_32px_-16px_rgba(23,32,51,0.18)] hover:-translate-y-1.5 hover:shadow-[0_22px_42px_-16px_rgba(37,99,235,0.28)] transition-all duration-300 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
                      >
                        {!imgFailed ? (
                          <img
                            src={card.image}
                            alt={card.title}
                            referrerPolicy="no-referrer"
                            data-no-privacy-blur="true"
                            onError={() =>
                              setCardImgFailed((prev) => ({ ...prev, [card.id]: true }))
                            }
                            className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                          />
                        ) : (
                          <div className="absolute inset-0 bg-gradient-to-b from-slate-700 to-slate-900" />
                        )}

                        {/* Bottom contrast gradient overlay */}
                        <div
                          aria-hidden="true"
                          className="absolute inset-0 bg-gradient-to-t from-[#0B1325]/92 via-[#0B1325]/35 to-transparent"
                        />

                        {/* Top Bar: Category Label + Favorite Heart Button */}
                        <div className="relative z-10 flex items-center justify-between gap-2">
                          <span className="px-2.5 py-1 rounded-full bg-black/35 backdrop-blur-md text-[10px] font-semibold text-white">
                            {card.category}
                          </span>
                          <button
                            type="button"
                            aria-label={`Đánh dấu yêu thích ${card.title}`}
                            aria-pressed={isLiked}
                            onClick={(e) => toggleBookmark(card.id, e)}
                            className={`w-8 h-8 rounded-full backdrop-blur-md flex items-center justify-center transition-colors cursor-pointer ${
                              isLiked
                                ? 'bg-rose-500 text-white'
                                : 'bg-white/25 text-white hover:bg-white/40'
                            }`}
                          >
                            <Heart className={`w-3.5 h-3.5 ${isLiked ? 'fill-current' : ''}`} />
                          </button>
                        </div>

                        {/* Bottom Bar: Title, Subtitle & White Rating Pill */}
                        <div className="relative z-10 flex items-end justify-between gap-1.5 pt-4">
                          <div className="min-w-0">
                            <h3 className="font-display text-[13.5px] font-bold text-white leading-snug">
                              {card.title}
                            </h3>
                            <p className="text-[11px] text-slate-200/90 mt-0.5">
                              {card.subtitle}
                            </p>
                          </div>

                          <div className="px-2 py-0.5 rounded-full bg-white text-[#172033] flex items-center gap-1 text-[11px] font-bold tabular-nums shrink-0 shadow-xs">
                            <Star className="w-2.5 h-2.5 text-amber-400 fill-amber-400" />
                            <span>{card.rating}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <button
                  type="button"
                  aria-label="Trượt sang phải"
                  onClick={() => handleScrollCarousel('next')}
                  className="hidden sm:flex absolute -right-4 top-1/2 -translate-y-1/2 z-20 w-9 h-9 rounded-full bg-white dark:bg-slate-800 border border-[#E8EDF4] dark:border-slate-700 text-[#172033] dark:text-white shadow-md items-center justify-center hover:border-[#2563EB] hover:text-[#2563EB] transition-all duration-200 cursor-pointer"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* =====================================================================
            E. INTERACTIVE TEXTBOOK VERIFICATION SPECIMEN (Kiểm chứng)
           ===================================================================== */}
        <section
          id="specimen"
          className="scroll-mt-20 mx-auto max-w-[1380px] px-4 sm:px-8 py-12 sm:py-20 border-t border-[#E8EDF4] dark:border-slate-800/80"
        >
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 mb-8 sm:mb-10">
            <div className="max-w-2xl">
              <p className="text-xs font-bold tracking-[0.14em] uppercase text-[#2563EB] dark:text-sky-400">
                MẪU KIỂM CHỨNG TƯƠNG TÁC · ĐỐI CHIẾU TỪNG MỆNH ĐỀ
              </p>
              <h2
                style={{ fontFamily: 'var(--font-serif)' }}
                className="text-[clamp(1.6rem,3.4vw,2.35rem)] font-bold tracking-tight text-[#172033] dark:text-white mt-1.5 text-balance"
              >
                Nhấp vào từng câu ghi chép để xem cách chấm theo SGK
              </h2>
            </div>
            <p className="text-sm text-[#778196] dark:text-slate-300 max-w-md leading-[1.6]">
              Mỗi nhận định trong vở được đối chiếu riêng biệt và trích dẫn chính xác số trang sách giáo khoa GDPT 2018.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
            {/* Left Zone: Annotated Student Notebook Page */}
            <div className="lg:col-span-6 rounded-[28px] bg-white dark:bg-[#111B30] border border-[#E8EDF4] dark:border-slate-800 shadow-[0_18px_45px_-22px_rgba(23,32,51,0.08)] p-5 sm:p-7 flex flex-col justify-between">
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-[#E8EDF4] dark:border-slate-800 text-xs">
                  <span className="font-bold text-[#172033] dark:text-white">
                    Trang vở mẫu · Hóa học 10 · Chương 3
                  </span>
                  <span className="text-[#778196] dark:text-slate-400">
                    3 nhận định đã tách
                  </span>
                </div>

                <div className="mt-4 space-y-3">
                  {SPECIMEN_ANNOTATIONS.map((item) => {
                    const meta = STATUS_META[item.color];
                    const Icon = meta.icon;
                    const isSelected = item.id === selectedSpecimenId;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setSelectedSpecimenId(item.id)}
                        aria-pressed={isSelected}
                        className={`w-full text-left rounded-2xl border p-4 transition-all duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] ${
                          isSelected ? meta.activeItemClass : meta.idleItemClass
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 text-xs mb-1.5">
                          <span className={`inline-flex items-center gap-1.5 font-semibold ${meta.textClass}`}>
                            <Icon className={`w-4 h-4 shrink-0 ${meta.iconClass}`} />
                            {item.statusTag}
                          </span>
                          <span className="text-[11px] text-[#778196] dark:text-slate-400 tabular-nums">
                            {item.orderLabel}
                          </span>
                        </div>
                        <p className="text-sm text-[#172033] dark:text-white leading-[1.6]">
                          “{item.studentExcerpt}”
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mt-5 pt-4 border-t border-[#E8EDF4] dark:border-slate-800 flex items-center justify-between gap-3 text-xs text-[#778196] dark:text-slate-400">
                <span>Tài liệu của bạn được phân tích tương tự trong Workspace.</span>
                <button
                  type="button"
                  onClick={() => onOpenAuth('login')}
                  className="font-bold text-[#2563EB] dark:text-sky-400 hover:underline whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Thử với vở của bạn →
                </button>
              </div>
            </div>

            {/* Right Zone: Academic Verification Breakdown */}
            <div className="lg:col-span-6 rounded-[28px] bg-white dark:bg-[#111B30] border border-[#E8EDF4] dark:border-slate-800 shadow-[0_18px_45px_-22px_rgba(23,32,51,0.08)] p-5 sm:p-7 flex flex-col justify-between">
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeSpecimen.id}
                  initial={prefersReduced ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={prefersReduced ? { opacity: 0 } : { opacity: 0, y: -4 }}
                  transition={{ duration: 0.18 }}
                  className="space-y-4"
                >
                  <div className={`rounded-2xl border p-4 ${activeMeta.resultHeaderBg}`}>
                    <div className="flex items-center gap-2">
                      <ActiveStatusIcon className={`w-4 h-4 shrink-0 ${activeMeta.iconClass}`} />
                      <span className={`text-xs font-bold ${activeMeta.textClass}`}>
                        {activeSpecimen.label}
                      </span>
                    </div>
                    <p className="mt-1.5 text-xs text-[#778196] dark:text-slate-300">
                      {activeSpecimen.source}
                    </p>
                  </div>

                  <div className="space-y-3 text-sm">
                    <div>
                      <p className="text-xs font-semibold text-[#778196] dark:text-slate-400 mb-1">
                        Kiến thức chuẩn cần nắm
                      </p>
                      <p className="text-[#172033] dark:text-white leading-[1.6]">
                        {activeSpecimen.correctKnowledge}
                      </p>
                    </div>

                    <div>
                      <p className="text-xs font-semibold text-[#778196] dark:text-slate-400 mb-1">
                        Lý giải học thuật
                      </p>
                      <p className="text-[#778196] dark:text-slate-300 leading-[1.6]">
                        {activeSpecimen.reason}
                      </p>
                    </div>

                    <div className="rounded-2xl bg-[#F8FAFC] dark:bg-slate-900/70 border border-[#E8EDF4] dark:border-slate-800 p-3.5">
                      <p className="text-xs font-bold text-[#172033] dark:text-white mb-1">
                        Gợi ý chỉnh sửa trực tiếp vào vở
                      </p>
                      <p className="text-xs sm:text-[13px] text-[#778196] dark:text-slate-300 leading-[1.55]">
                        {activeSpecimen.actionTip}
                      </p>
                    </div>
                  </div>

                  <SmoothAccordion
                    open={sourceAccordionOpen}
                    onToggle={setSourceAccordionOpen}
                    title={
                      <span className="text-xs font-bold text-[#172033] dark:text-white">
                        Trích dẫn nguyên văn SGK · {activeSpecimen.sourceBook}
                      </span>
                    }
                    className="rounded-2xl border border-[#E8EDF4] dark:border-slate-800 bg-[#F8FAFC]/70 dark:bg-slate-900/50"
                    triggerClassName="px-4 py-3 text-left"
                    contentClassName="px-4 pb-3.5 pt-2 border-t border-[#E8EDF4] dark:border-slate-800 space-y-2 text-xs text-[#778196] dark:text-slate-300 leading-[1.6]"
                  >
                    <p className="italic text-[#172033] dark:text-white">
                      {activeSpecimen.sourceExcerpt}
                    </p>
                    <p>{activeSpecimen.verificationRule}</p>
                  </SmoothAccordion>
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </section>

        {/* =====================================================================
            F. INTERACTIVE 2025 EXAM ARENA & GRADE LEADERBOARD (Thi & Đua Top)
           ===================================================================== */}
        <LandingWorkspacePreview onOpenAuth={onOpenAuth} />

        {/* =====================================================================
            G. FAQ + CONVERSION BAND
           ===================================================================== */}
        <section
          id="faq"
          className="scroll-mt-20 mx-auto max-w-4xl px-4 sm:px-8 py-12 sm:py-16 border-t border-[#E8EDF4] dark:border-slate-800/80"
        >
          <div className="text-center mb-8">
            <p className="text-xs font-bold tracking-[0.16em] uppercase text-[#2563EB] dark:text-sky-400">
              GIẢI ĐÁP NHANH
            </p>
            <h2
              style={{ fontFamily: 'var(--font-serif)' }}
              className="text-[clamp(1.5rem,3.4vw,2.15rem)] font-bold text-[#172033] dark:text-white mt-1.5"
            >
              Câu hỏi thường gặp
            </h2>
          </div>

          <div className="space-y-3">
            {FAQS.map((item, idx) => {
              const isOpen = openFaqIndex === idx;
              return (
                <SmoothAccordion
                  key={item.q}
                  open={isOpen}
                  onToggle={(next) => setOpenFaqIndex(next ? idx : null)}
                  title={<span className="text-sm sm:text-base font-semibold">{item.q}</span>}
                  className="rounded-2xl sm:rounded-3xl bg-white dark:bg-[#111B30] border border-[#E8EDF4] dark:border-slate-800 shadow-[0_10px_28px_-16px_rgba(23,32,51,0.08)]"
                  triggerClassName="min-h-[54px] px-5 sm:px-6 py-3.5 sm:py-4 hover:bg-[#F8FAFC] dark:hover:bg-white/5"
                  contentClassName="px-5 sm:px-6 pb-4 sm:pb-5 text-sm text-[#778196] dark:text-slate-300 leading-[1.65] prose-measure border-t border-[#E8EDF4] dark:border-slate-800 pt-3"
                >
                  {item.a}
                </SmoothAccordion>
              );
            })}
          </div>

          {/* Focused Transition Band to Part 2 Workspace */}
          <div className="mt-10 sm:mt-14 rounded-[30px] bg-white dark:bg-[#111B30] border border-[#E8EDF4] dark:border-slate-800 shadow-[0_20px_50px_-22px_rgba(37,99,235,0.16)] p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5">
            <div className="max-w-lg">
              <h3
                style={{ fontFamily: 'var(--font-serif)' }}
                className="text-xl sm:text-2xl font-bold text-[#172033] dark:text-white"
              >
                Sẵn sàng bước vào Workspace học tập chính?
              </h3>
              <p className="mt-1.5 text-sm text-[#778196] dark:text-slate-300 leading-[1.6]">
                Đăng nhập để sử dụng toàn bộ công cụ kiểm định vở ghi, đề thi chuẩn 2025, luyện tập ngắt quãng và lưu tiến độ cá nhân.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onOpenAuth('login')}
              className="group inline-flex items-center gap-3 pl-6 pr-2.5 py-2.5 rounded-full bg-[#2563EB] hover:bg-[#1746A2] text-white text-sm font-semibold shadow-[0_14px_28px_-8px_rgba(37,99,235,0.6)] transition-all duration-200 shrink-0 cursor-pointer"
            >
              <span>Đăng nhập ngay</span>
              <span className="w-8 h-8 rounded-full bg-white text-[#2563EB] flex items-center justify-center transition-transform duration-200 group-hover:translate-x-0.5">
                <ArrowRight className="w-4 h-4" />
              </span>
            </button>
          </div>
        </section>
      </main>

      {/* =====================================================================
          H. FOOTER WITH TUẤN KHANG SIGNATURE
         ===================================================================== */}
      <footer className="border-t border-[#E8EDF4] dark:border-slate-800 bg-white dark:bg-[#0C1424]">
        <div className="mx-auto max-w-[1380px] px-4 sm:px-8 py-6 sm:py-8 flex flex-col md:flex-row items-center justify-between gap-5 text-xs text-[#778196] dark:text-slate-400">
          <div className="space-y-1.5 text-center md:text-left">
            <p className="font-semibold text-[#172033] dark:text-white">
              © {new Date().getFullYear()} {BRAND_CONFIG.name}. Nền tảng kiểm chứng học tập THPT.
            </p>
            <div className="flex items-center justify-center md:justify-start gap-3">
              <a
                href="#featured"
                onClick={(e) => {
                  e.preventDefault();
                  scrollToSection('featured');
                }}
                className="hover:text-[#2563EB] dark:hover:text-white transition-colors"
              >
                Tính năng
              </a>
              <span aria-hidden="true">·</span>
              <a
                href="#specimen"
                onClick={(e) => {
                  e.preventDefault();
                  scrollToSection('specimen');
                }}
                className="hover:text-[#2563EB] dark:hover:text-white transition-colors"
              >
                Kiểm chứng
              </a>
              <span aria-hidden="true">·</span>
              <a
                href="#workspace-preview"
                onClick={(e) => {
                  e.preventDefault();
                  scrollToSection('workspace-preview');
                }}
                className="hover:text-[#2563EB] dark:hover:text-white transition-colors"
              >
                Thi &amp; Đua Top
              </a>
              <span aria-hidden="true">·</span>
              <a
                href="#faq"
                onClick={(e) => {
                  e.preventDefault();
                  scrollToSection('faq');
                }}
                className="hover:text-[#2563EB] dark:hover:text-white transition-colors"
              >
                Hỏi đáp
              </a>
            </div>
          </div>

          <div className="flex items-center gap-3.5 px-4 py-2 rounded-2xl bg-[#F8FAFC] dark:bg-slate-900/70 border border-[#E8EDF4] dark:border-slate-800">
            <div className="text-right">
              <p className="text-[11px] font-medium text-[#778196] dark:text-slate-400">
                Thiết kế &amp; Phát triển
              </p>
              <p className="text-xs font-bold text-[#172033] dark:text-white">
                {BRAND_CONFIG.authorName}
              </p>
            </div>
            <div className="h-11 w-32 sm:w-36 overflow-hidden flex items-center justify-center rounded-xl bg-white dark:bg-slate-900/50">
              <img
                src={BRAND_CONFIG.signatureImageUrl}
                alt={`Chữ ký ${BRAND_CONFIG.authorName}`}
                data-no-privacy-blur="true"
                className="w-full h-full object-contain scale-[2.3] select-none pointer-events-none mix-blend-multiply dark:invert dark:mix-blend-screen"
              />
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};
