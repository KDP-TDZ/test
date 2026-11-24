import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Bookmark,
  BookOpenCheck,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Menu,
  X,
} from 'lucide-react';
import { BRAND_CONFIG } from '../config/brand';
import {
  computeProgressPercent,
  formatSlideNumber,
  getUpcomingIndices,
  stepSlideIndex,
  toggleBookmarkId,
} from '../core/landingCarousel';
import { NavigationDrawer } from './LiquidGlass/NavigationDrawer';
import { ThemeToggle } from './LiquidGlass/ThemeToggle';
import { UiModeSwitcher } from './LiquidGlass/UiModeSwitcher';

import heroSgkLibraryDesktop from '../assets/images/optimized/hero_sgk_library_1795494418542_desktop.webp';
import heroSgkLibraryMobile from '../assets/images/optimized/hero_sgk_library_1795494418542_mobile.webp';
import heroSgkLibraryThumb from '../assets/images/optimized/hero_sgk_library_1795494418542_thumb.webp';

import heroOcrNotebookDesktop from '../assets/images/optimized/hero_ocr_notebook_1795494420958_desktop.webp';
import heroOcrNotebookMobile from '../assets/images/optimized/hero_ocr_notebook_1795494420958_mobile.webp';
import heroOcrNotebookThumb from '../assets/images/optimized/hero_ocr_notebook_1795494420958_thumb.webp';

import heroExamStudioDesktop from '../assets/images/optimized/hero_exam_studio_1795494420382_desktop.webp';
import heroExamStudioMobile from '../assets/images/optimized/hero_exam_studio_1795494420382_mobile.webp';
import heroExamStudioThumb from '../assets/images/optimized/hero_exam_studio_1795494420382_thumb.webp';

import heroFlashcardDeckDesktop from '../assets/images/optimized/hero_flashcard_deck_1795494420543_desktop.webp';
import heroFlashcardDeckMobile from '../assets/images/optimized/hero_flashcard_deck_1795494420543_mobile.webp';
import heroFlashcardDeckThumb from '../assets/images/optimized/hero_flashcard_deck_1795494420543_thumb.webp';

import heroProgressPavilionDesktop from '../assets/images/optimized/hero_progress_pavilion_1795494421110_desktop.webp';
import heroProgressPavilionMobile from '../assets/images/optimized/hero_progress_pavilion_1795494421110_mobile.webp';
import heroProgressPavilionThumb from '../assets/images/optimized/hero_progress_pavilion_1795494421110_thumb.webp';

export interface HeroSlideItem {
  id: string;
  kicker: string;
  cardKicker: string;
  titleLines: [string, string];
  shortDescription: string;
  image: string;
  imageMobile: string;
  imageThumb: string;
  imageAlt: string;
  targetSectionId: 'specimen' | 'workspace-preview' | 'faq';
  targetSectionLabel: string;
  expandedDetail: {
    summary: string;
    proofLabel: string;
    proofValue: string;
    highlights: { title: string; desc: string }[];
    workflowSteps: string[];
  };
}

export const HERO_SLIDES: readonly HeroSlideItem[] = [
  {
    id: 'sgk-verify',
    kicker: 'GDPT 2018 · Đối chiếu 4 lớp',
    cardKicker: 'Học liệu chuẩn SGK',
    titleLines: ['KIỂM ĐỊNH', 'CHUẨN SGK'],
    shortDescription:
      'Tải ảnh chụp vở viết tay, PDF hoặc DOCX để đối chiếu trực tiếp kho sách giáo khoa chuẩn, tách bạch lỗi sai bản chất khỏi ý còn thiếu.',
    image: heroSgkLibraryDesktop,
    imageMobile: heroSgkLibraryMobile,
    imageThumb: heroSgkLibraryThumb,
    imageAlt: 'Không gian thư viện đại học tràn ánh nắng giờ vàng với sách giáo khoa mở trên bàn gỗ',
    targetSectionId: 'specimen',
    targetSectionLabel: 'Xem mẫu đối chiếu SGK',
    expandedDetail: {
      summary:
        'StudyCheck AI không chấm chung chung theo cảm tính. Hệ thống tách tài liệu của bạn thành từng mệnh đề học thuật độc lập và đối chiếu trực tiếp theo 4 lớp: Khái niệm cốt lõi, Công thức & Đơn vị SI, Điều kiện áp dụng và Trích dẫn số trang SGK GDPT 2018.',
      proofLabel: 'Cơ chế đánh giá minh bạch',
      proofValue: 'Tách biệt 2 chỉ số độc lập: Độ chính xác (Accuracy) & Độ đầy đủ (Completeness)',
      highlights: [
        {
          title: 'Không đánh đồng viết thiếu với viết sai',
          desc: 'Độ chính xác chỉ chấm trên phần kiến thức bạn đã viết; Độ đầy đủ đo mức độ bao phủ mục tiêu của chương học.',
        },
        {
          title: 'Trích dẫn chính xác số trang SGK',
          desc: 'Mỗi nhận định sai hoặc cần bổ sung đều kèm trích dẫn chương, bài và trang sách giáo khoa chuẩn để bạn kiểm chứng lại.',
        },
        {
          title: 'Gợi ý chỉnh sửa trực tiếp vào vở',
          desc: 'Chỉ rõ cụm từ cần thay thế hoặc điều kiện cần bổ sung để câu trả lời đạt chuẩn chấm thi THPT.',
        },
      ],
      workflowSteps: [
        'Tải lên ảnh chụp trang vở, tệp PDF hoặc tài liệu DOCX theo khối 10–12.',
        'Hệ thống tự nhận diện môn học, tách mệnh đề và đối chiếu kho SGK chuẩn.',
        'Nhận báo cáo khoanh vùng lỗi Đỏ / Cam / Xanh cùng gợi ý sửa chi tiết.',
      ],
    },
  },
  {
    id: 'ocr-review',
    kicker: 'Nhận diện chữ viết · Duyệt trước chấm',
    cardKicker: 'Ảnh chụp vở ghi',
    titleLines: ['DUYỆT OCR', 'VỞ VIẾT TAY'],
    shortDescription:
      'Quét chính xác chữ viết tay, phương trình hóa học và công thức vật lý. Tự động mở bước rà soát khi ảnh mờ để tránh chấm oan.',
    image: heroOcrNotebookDesktop,
    imageMobile: heroOcrNotebookMobile,
    imageThumb: heroOcrNotebookThumb,
    imageAlt: 'Bàn học gỗ bên cửa sổ núi lúc chạng vạng với vở viết tay sơ đồ hình học dưới ánh đèn đồng',
    targetSectionId: 'specimen',
    targetSectionLabel: 'Xem kết quả sau khi duyệt OCR',
    expandedDetail: {
      summary:
        'Nhiều công cụ AI chấm sai chỉ vì đọc nhầm chữ viết tay hoặc ký hiệu chỉ số dưới. StudyCheck AI tích hợp màn hình Duyệt OCR trung gian hiển thị song song trang vở gốc và văn bản nhận diện trước khi bước vào chấm kiến thức.',
      proofLabel: 'Định dạng đầu vào hỗ trợ',
      proofValue: 'Ảnh chụp điện thoại (JPG, PNG, WEBP, HEIC), PDF nhiều trang & DOCX tối đa 25 trang',
      highlights: [
        {
          title: 'Cảnh báo vùng ảnh mờ tự động',
          desc: 'Các đoạn có độ tin cậy OCR thấp được đánh dấu rõ ràng để bạn chỉnh sửa ngay trong vài giây.',
        },
        {
          title: 'Bảo toàn ký hiệu khoa học',
          desc: 'Hỗ trợ chuẩn các công thức H₂SO₄, đơn vị SI, chỉ số mũ và biểu thức toán học phổ thông.',
        },
        {
          title: 'Tuyệt đối không chấm oan lỗi quét chữ',
          desc: 'Điểm kiểm định chỉ được tính trên phiên bản nội dung bạn đã xác nhận chính xác.',
        },
      ],
      workflowSteps: [
        'Chụp trang vở bằng điện thoại hoặc chọn nhiều ảnh cùng lúc trong Workspace.',
        'Rà soát nhanh những dòng chữ được đánh dấu cần kiểm tra trên màn hình chia đôi.',
        'Xác nhận văn bản chuẩn và bấm chạy phân tích đối chiếu SGK.',
      ],
    },
  },
  {
    id: 'exam-2025',
    kicker: 'Cấu trúc THPT 2025 · 3 phần chuẩn',
    cardKicker: 'Phòng thi mô phỏng',
    titleLines: ['ĐỀ THI THỬ', 'CHUẨN 2025'],
    shortDescription:
      'Luyện đề đủ 3 dạng thức mới: Trắc nghiệm ABCD, Đúng/Sai tính điểm lũy tiến và Trả lời ngắn kèm đồng hồ bấm giờ phòng thi.',
    image: heroExamStudioDesktop,
    imageMobile: heroExamStudioMobile,
    imageThumb: heroExamStudioThumb,
    imageAlt: 'Phòng học kiến trúc hiện đại lúc hoàng hôn với đèn bàn vàng ấm và tập đề thi ngăn nắp',
    targetSectionId: 'workspace-preview',
    targetSectionLabel: 'Thử ngay câu Đúng/Sai 2025',
    expandedDetail: {
      summary:
        'Trung tâm Đề thi chuẩn 2025 mô phỏng trọn vẹn cấu trúc kỳ thi tốt nghiệp THPT mới, giúp học sinh làm quen áp lực thời gian và cơ chế tính điểm lũy tiến khắt khe ở Phần II (Đúng/Sai 4 ý).',
      proofLabel: 'Thang điểm Phần II chuẩn Bộ GD&ĐT',
      proofValue: 'Đúng 1 ý: 0,10đ · Đúng 2 ý: 0,25đ · Đúng 3 ý: 0,50đ · Đúng 4 ý: 1,00đ',
      highlights: [
        {
          title: 'Đầy đủ 3 phần thi chuẩn 2025',
          desc: 'Hỗ trợ Phần I (Nhiều lựa chọn), Phần II (Đúng/Sai 4 mệnh đề con) và Phần III (Điền đáp án ngắn).',
        },
        {
          title: 'Giải thích chi tiết từng mệnh đề',
          desc: 'Sau khi nộp bài, từng ý a, b, c, d đều hiển thị giải thích chuẩn SGK để bạn hiểu gốc rễ lỗi sai.',
        },
        {
          title: 'Hỗ trợ thao tác phím tắt nhanh',
          desc: 'Chọn nhanh đáp án bằng bàn phím, đánh dấu câu cần xem lại và theo dõi tiến độ làm bài trực quan.',
        },
      ],
      workflowSteps: [
        'Chọn khối lớp (10, 11, 12) và đề thi theo môn hoặc tải đề riêng lên luyện tập.',
        'Hoàn thành 3 phần thi dưới đồng hồ đếm ngược thời gian thực.',
        'Xem điểm chi tiết từng phần, lời giải chuẩn và tự động lưu lỗi sai vào ngân hàng ôn.',
      ],
    },
  },
  {
    id: 'flashcard-3d',
    kicker: 'Lặp lại ngắt quãng · Chu kỳ 1-3-7-14',
    cardKicker: 'Ghi nhớ chủ động',
    titleLines: ['FLASHCARD 3D', 'ÔN NGẮT QUÃNG'],
    shortDescription:
      'Mỗi lỗi sai sau khi kiểm định tự động chuyển thành bộ thẻ lật 3D cá nhân hóa, nhắc ôn đúng thời điểm vàng trước khi bạn quên.',
    image: heroFlashcardDeckDesktop,
    imageMobile: heroFlashcardDeckMobile,
    imageThumb: heroFlashcardDeckThumb,
    imageAlt: 'Bộ thẻ ghi nhớ bằng giấy kem xếp ngay ngắn trên bàn gỗ óc chó dưới ánh nắng chiều qua cửa sổ',
    targetSectionId: 'workspace-preview',
    targetSectionLabel: 'Xem trước không gian luyện tập',
    expandedDetail: {
      summary:
        'Thay vì ghi lỗi sai vào sổ rồi bỏ quên, StudyCheck AI biến chính những nhận định bạn làm sai hoặc thiếu điều kiện thành thẻ Flashcard 3D lật hai mặt theo thuật toán lặp lại ngắt quãng 1 – 3 – 7 – 14 ngày.',
      proofLabel: 'Chu kỳ củng cố trí nhớ dài hạn',
      proofValue: 'Nhắc ôn tự động sau 1 ngày · 3 ngày · 7 ngày · 14 ngày theo mức độ thành thạo',
      highlights: [
        {
          title: 'Cá nhân hóa từ chính lỗ hổng của bạn',
          desc: 'Chỉ tập trung vào khái niệm bạn từng nhầm lẫn, không mất thời gian ôn lan man phần đã thuộc.',
        },
        {
          title: 'Phiên ôn nhanh 10 phút mỗi ngày',
          desc: 'Chế độ Sprint 10 câu kết hợp Flashcard 3D giúp duy trì thói quen ôn tập nhẹ nhàng ngay trên điện thoại.',
        },
        {
          title: 'Tự chấm mức độ nhớ tức thì',
          desc: 'Đánh dấu Quên / Khó / Thành thạo sau mỗi thẻ để hệ thống tự điều chỉnh lịch nhắc ôn tiếp theo.',
        },
      ],
      workflowSteps: [
        'Lưu lỗi sai trực tiếp từ báo cáo kiểm định tài liệu hoặc kết quả thi thử.',
        'Lật thẻ Flashcard 3D để tự kiểm tra khái niệm, công thức và điều kiện áp dụng.',
        'Đánh giá mức độ ghi nhớ để kích hoạt lịch nhắc ôn ngắt quãng tối ưu.',
      ],
    },
  },
  {
    id: 'analytics-top',
    kicker: 'Khối 10 · 11 · 12 · Bảng xếp hạng',
    cardKicker: 'Tiến độ & Đua Top',
    titleLines: ['ĐUA TOP &', 'PHÂN TÍCH LỖI'],
    shortDescription:
      'Theo dõi biểu đồ tiến độ theo từng chương học, gom nhóm lỗ hổng kiến thức trọng tâm và thi đua minh bạch theo từng khối lớp.',
    image: heroProgressPavilionDesktop,
    imageMobile: heroProgressPavilionMobile,
    imageThumb: heroProgressPavilionThumb,
    imageAlt: 'Thư viện gỗ kính trên đồi lúc hoàng hôn với đèn học ấm áp nhìn ra rặng núi xanh thẫm',
    targetSectionId: 'workspace-preview',
    targetSectionLabel: 'Xem bảng xếp hạng theo khối',
    expandedDetail: {
      summary:
        'Không gian Phân tích & Bảng xếp hạng giúp bạn nhìn rõ bức tranh học tập qua từng tuần: chương nào đang đạt chuẩn cao, lỗi sai nào lặp lại nhiều nhất, và vị trí của bạn trên bảng thi đua theo khối lớp.',
      proofLabel: 'Phạm vi xếp hạng công bằng',
      proofValue: 'Tách riêng Khối 10, Khối 11, Khối 12 & Toàn trường dựa trên điểm thi thực tế',
      highlights: [
        {
          title: 'Bản đồ lỗ hổng theo từng chương',
          desc: 'Nhóm các lỗi sai lặp lại theo chuyên đề để bạn ưu tiên ôn đúng phần dễ mất điểm nhất.',
        },
        {
          title: 'Bảng xếp hạng minh bạch theo khối',
          desc: 'So sánh điểm trung bình, số đề đã hoàn thành và chuỗi thành tích cao cùng bạn bè đồng trang lứa.',
        },
        {
          title: 'Xuất báo cáo tổng kết dễ dàng',
          desc: 'Hỗ trợ xuất báo cáo tiến độ và lỗi sai trọng tâm để trao đổi cùng giáo viên hoặc tự ôn trước kỳ thi.',
        },
      ],
      workflowSteps: [
        'Hoàn thành bài kiểm định tài liệu hoặc đề thi chuẩn 2025 trong Workspace.',
        'Mở mục Phân tích để xem xu hướng độ chính xác và các chương cần bổ sung.',
        'Theo dõi thứ hạng trên Bảng xếp hạng khối và duy trì chuỗi phong độ ổn định.',
      ],
    },
  },
];

interface LandingHeroCarouselProps {
  activeSection: string;
  onScrollToSection: (sectionId: string) => void;
  onOpenAuth: (mode: 'login' | 'register') => void;
}

const AUTO_ADVANCE_MS = 7500;

export const LandingHeroCarousel: React.FC<LandingHeroCarouselProps> = ({
  activeSection,
  onScrollToSection,
  onOpenAuth,
}) => {
  const [prefersReduced, setPrefersReduced] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false
  );
  const [activeIndex, setActiveIndex] = useState(0);
  const [prevIndex, setPrevIndex] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [hasInteracted, setHasInteracted] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (e: MediaQueryListEvent) => setPrefersReduced(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  const [isHoverPaused, setIsHoverPaused] = useState(false);
  const [bookmarkedIds, setBookmarkedIds] = useState<string[]>(['sgk-verify']);
  const [detailSlideId, setDetailSlideId] = useState<string | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});

  const hamburgerBtnRef = useRef<HTMLButtonElement>(null);
  const closeModalBtnRef = useRef<HTMLButtonElement>(null);
  const touchStartXRef = useRef<number | null>(null);
  const landingDrawerId = 'landing-cinematic-drawer';

  const totalSlides = HERO_SLIDES.length;
  const activeSlide = HERO_SLIDES[activeIndex];
  const previousSlide = HERO_SLIDES[prevIndex];
  const upcomingIndices = getUpcomingIndices(activeIndex, totalSlides);
  const progressPercent = computeProgressPercent(activeIndex, totalSlides);
  const formattedIndex = formatSlideNumber(activeIndex, totalSlides);
  const isCurrentBookmarked = bookmarkedIds.includes(activeSlide.id);
  const detailSlide = detailSlideId
    ? HERO_SLIDES.find((s) => s.id === detailSlideId) ?? null
    : null;

  // Defer preloading only the next upcoming slide after LCP settles so bandwidth stays focused on slide 0
  useEffect(() => {
    const nextIdx = stepSlideIndex(activeIndex, totalSlides, 1);
    const nextSlide = HERO_SLIDES[nextIdx];
    if (!nextSlide) return;

    const preloadNext = () => {
      const img = new Image();
      img.decoding = 'async';
      img.src = window.innerWidth < 768 ? nextSlide.imageMobile : nextSlide.image;
    };

    const delayMs = activeIndex === 0 ? 2200 : 250;
    const timer = window.setTimeout(preloadNext, delayMs);
    return () => window.clearTimeout(timer);
  }, [activeIndex, totalSlides]);

  const navigateToIndex = useCallback(
    (nextIndex: number, dir: 1 | -1) => {
      setActiveIndex((current) => {
        if (current === nextIndex) return current;
        setHasInteracted(true);
        setPrevIndex(current);
        setDirection(dir);
        return nextIndex;
      });
    },
    []
  );

  const handleNext = useCallback(() => {
    setActiveIndex((current) => {
      const next = stepSlideIndex(current, totalSlides, 1);
      setHasInteracted(true);
      setPrevIndex(current);
      setDirection(1);
      return next;
    });
  }, [totalSlides]);

  const handlePrev = useCallback(() => {
    setActiveIndex((current) => {
      const next = stepSlideIndex(current, totalSlides, -1);
      setHasInteracted(true);
      setPrevIndex(current);
      setDirection(-1);
      return next;
    });
  }, [totalSlides]);

  // Auto-advance timer (pauses on hover, modal open, or reduced motion)
  useEffect(() => {
    if (prefersReduced || isHoverPaused || detailSlideId || mobileNavOpen) {
      return;
    }
    const timer = window.setInterval(handleNext, AUTO_ADVANCE_MS);
    return () => window.clearInterval(timer);
  }, [prefersReduced, isHoverPaused, detailSlideId, mobileNavOpen, handleNext]);

  // Keyboard navigation: Left/Right arrows switch slides; Escape closes detail modal
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (detailSlideId) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setDetailSlideId(null);
        }
        return;
      }
      if (mobileNavOpen) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === 'ArrowRight') {
        handleNext();
      } else if (e.key === 'ArrowLeft') {
        handlePrev();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [detailSlideId, mobileNavOpen, handleNext, handlePrev]);

  // Lock body scroll and focus close button when Detail Modal is open
  useEffect(() => {
    if (!detailSlideId) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const raf = window.requestAnimationFrame(() => {
      closeModalBtnRef.current?.focus();
    });
    return () => {
      document.body.style.overflow = prevOverflow;
      window.cancelAnimationFrame(raf);
    };
  }, [detailSlideId]);

  // Close mobile drawer when expanding to desktop
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const handleChange = (e: MediaQueryListEvent) => {
      if (e.matches) setMobileNavOpen(false);
    };
    mq.addEventListener('change', handleChange);
    return () => mq.removeEventListener('change', handleChange);
  }, []);

  const navItems = [
    { id: 'top', label: 'Trang chủ' },
    { id: 'specimen', label: 'Kiểm chứng' },
    { id: 'workspace-preview', label: 'Đề thi 2025' },
    { id: 'faq', label: 'Hỏi đáp' },
  ] as const;

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartXRef.current = e.touches[0]?.clientX ?? null;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartXRef.current === null) return;
    const endX = e.changedTouches[0]?.clientX ?? touchStartXRef.current;
    const deltaX = endX - touchStartXRef.current;
    touchStartXRef.current = null;
    if (Math.abs(deltaX) > 48) {
      if (deltaX < 0) {
        handleNext();
      } else {
        handlePrev();
      }
    }
  };

  const markImageFailed = (id: string) => {
    setFailedImages((prev) => ({ ...prev, [id]: true }));
  };

  return (
    <section
      id="top"
      aria-label="Giới thiệu nổi bật StudyCheck AI"
      onMouseEnter={() => setIsHoverPaused(true)}
      onMouseLeave={() => setIsHoverPaused(false)}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      className="relative w-full min-h-[100dvh] lg:h-[100dvh] lg:min-h-[700px] lg:max-h-[960px] overflow-hidden bg-[#0A0F1A] text-white flex flex-col justify-between select-none"
    >
      {/* =====================================================================
          1. FULL-BLEED ANIMATED BACKDROP LAYER (Smooth Expanding Card -> Stage)
         ===================================================================== */}
      <div aria-hidden="true" className="absolute inset-0 z-0 overflow-hidden bg-[#0A0F1A]">
        {/* Persistent previous backdrop only rendered during/after transitions (avoids duplicate initial LCP decode) */}
        {prevIndex !== activeIndex &&
          (!failedImages[previousSlide.id] ? (
            <img
              src={previousSlide.image}
              srcSet={`${previousSlide.imageMobile} 720w, ${previousSlide.image} 1280w`}
              sizes="100vw"
              width={1280}
              height={714}
              alt=""
              decoding="async"
              referrerPolicy="no-referrer"
              data-no-privacy-blur="true"
              className="absolute inset-0 w-full h-full object-cover object-center scale-[1.02]"
            />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-[#0F1A2E] via-[#1B2A4A] to-[#090E18]" />
          ))}

        {/* Incoming active slide smoothly glides & scales on slide change (no initial fade delay for fast LCP!) */}
        <div
          key={activeSlide.id}
          className={`absolute inset-0 will-change-transform ${
            hasInteracted && !prefersReduced
              ? direction === 1
                ? 'landing-slide-enter-next'
                : 'landing-slide-enter-prev'
              : ''
          }`}
        >
          {!failedImages[activeSlide.id] ? (
            <img
              src={activeSlide.image}
              srcSet={`${activeSlide.imageMobile} 720w, ${activeSlide.image} 1280w`}
              sizes="100vw"
              width={1280}
              height={714}
              alt={activeSlide.imageAlt}
              loading="eager"
              decoding={activeIndex === 0 ? 'sync' : 'async'}
              fetchPriority={activeIndex === 0 ? 'high' : 'auto'}
              referrerPolicy="no-referrer"
              data-no-privacy-blur="true"
              onError={() => markImageFailed(activeSlide.id)}
              className="w-full h-full object-cover object-center"
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-[#16233D] via-[#1E293B] to-[#0A0F1A]" />
          )}
        </div>

        {/* Measured Cinematic Contrast Scrims: luminous upper-center architecture + rich left & bottom legibility */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#070B14]/56 via-transparent to-[#070B14]/72" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[#070B14]/82 via-[#070B14]/30 to-transparent" />
      </div>

      {/* =====================================================================
          2. TRANSPARENT OVERLAY TOP BAR (Strict 3-Zone Top Bar Contract)
         ===================================================================== */}
      <header className="relative z-30 w-full">
        <div className="mx-auto max-w-[1440px] px-4 sm:px-10 lg:px-14 h-16 sm:h-20 flex items-center justify-between gap-2.5 sm:gap-6 lg:gap-8">
          {/* Zone 1: Single-line Brand Wordmark */}
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              onScrollToSection('top');
            }}
            className="inline-flex items-center gap-2 sm:gap-2.5 text-white whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F5A623] rounded-lg"
          >
            <BookOpenCheck className="w-5 h-5 text-[#F5A623] shrink-0" />
            <span className="font-display text-[13px] sm:text-[15px] font-bold tracking-[0.12em] sm:tracking-[0.14em] uppercase whitespace-nowrap shrink-0">
              {BRAND_CONFIG.name}
            </span>
          </a>

          {/* Zone 2: Clean Single-Line Nav Links aligned right to keep center architecture open */}
          <nav
            aria-label="Điều hướng chính trang chủ"
            className="hidden lg:flex items-center gap-7 ml-auto text-[12px] font-semibold tracking-[0.12em] uppercase text-white/85"
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
                    onScrollToSection(item.id);
                  }}
                  className={`relative py-2 whitespace-nowrap shrink-0 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F5A623] rounded-sm ${
                    isActive ? 'text-white' : 'hover:text-white'
                  }`}
                >
                  <span>{item.label}</span>
                  <span
                    aria-hidden="true"
                    className={`absolute left-0 right-0 -bottom-0.5 h-[2.5px] rounded-full bg-[#F5A623] transition-opacity duration-200 ${
                      isActive ? 'opacity-100' : 'opacity-0'
                    }`}
                  />
                </a>
              );
            })}
            <button
              type="button"
              onClick={() => setDetailSlideId(activeSlide.id)}
              className="relative py-2 whitespace-nowrap shrink-0 hover:text-white transition-colors duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F5A623] rounded-sm uppercase"
            >
              Chi tiết
            </button>
          </nav>

          {/* Zone 3: 1 Primary Action + Mobile Drawer Trigger */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <button
              type="button"
              onClick={() => onOpenAuth('login')}
              className="inline-flex items-center justify-center h-9 sm:h-10 px-3.5 sm:px-5 rounded-full bg-white/14 hover:bg-[#F5A623] text-white hover:text-[#0A0F1A] border border-white/30 hover:border-[#F5A623] backdrop-blur-md text-[11px] sm:text-xs font-bold tracking-[0.08em] sm:tracking-[0.1em] uppercase whitespace-nowrap shrink-0 transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F5A623]"
            >
              Đăng nhập
            </button>

            <button
              ref={hamburgerBtnRef}
              type="button"
              aria-label="Mở menu điều hướng"
              aria-expanded={mobileNavOpen}
              aria-controls={landingDrawerId}
              onClick={() => setMobileNavOpen((v) => !v)}
              className="lg:hidden w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-white/14 hover:bg-white/25 border border-white/30 backdrop-blur-md flex items-center justify-center text-white shrink-0 transition-colors cursor-pointer"
            >
              <Menu className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Slide-out Mobile Navigation Drawer */}
      <NavigationDrawer
        id={landingDrawerId}
        open={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        triggerRef={hamburgerBtnRef}
        ariaLabel="Điều hướng StudyCheck AI"
        footer={
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between gap-2 px-1">
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Giao diện Workspace
              </span>
              <UiModeSwitcher />
            </div>
            <div className="flex items-center justify-between gap-2 px-1">
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Chế độ Sáng / Tối
              </span>
              <ThemeToggle />
            </div>
            <button
              type="button"
              onClick={() => {
                setMobileNavOpen(false);
                onOpenAuth('login');
              }}
              className="w-full min-h-[44px] rounded-full bg-[#F5A623] hover:bg-[#E09212] text-[#0A0F1A] text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer"
            >
              Đăng nhập vào Workspace
            </button>
            <button
              type="button"
              onClick={() => {
                setMobileNavOpen(false);
                onOpenAuth('register');
              }}
              className="w-full min-h-[42px] rounded-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold text-slate-900 dark:text-white hover:border-[#F5A623] transition-colors cursor-pointer"
            >
              Tạo tài khoản mới
            </button>
          </div>
        }
      >
        <p className="px-3 pb-2 text-[11px] font-semibold tracking-wide text-slate-500 dark:text-slate-400">
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
                onScrollToSection(item.id);
              }}
              className={`w-full min-h-[44px] flex items-center px-3.5 py-2 rounded-xl text-sm font-medium transition-colors ${
                activeSection === item.id
                  ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 font-semibold'
                  : 'text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/70'
              }`}
            >
              {item.label}
            </a>
          ))}
        </div>
      </NavigationDrawer>

      {/* =====================================================================
          3. MAIN HERO STAGE: LEFT EDITORIAL COPY + RIGHT EXPANDING CARD DECK
         ===================================================================== */}
      <div className="relative z-20 flex-1 flex items-end w-full mx-auto max-w-[1440px] px-5 sm:px-10 lg:px-14 pt-6 pb-8 sm:pb-12 lg:pb-14">
        <div className="w-full grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-6 items-end">
          {/* LEFT COLUMN: Short Rule + Kicker + Condensed Headline + Concise Copy + Bookmark & "Xem thêm" */}
          <div className="lg:col-span-5 xl:col-span-5 flex flex-col justify-end lg:pb-10 select-text">
            <div
              key={activeSlide.id}
              className={hasInteracted && !prefersReduced ? 'landing-fade-up' : ''}
            >
                {/* Signature Short Horizontal White Bar */}
                <div
                  aria-hidden="true"
                  className="w-7 h-[2.5px] bg-white rounded-full mb-3.5"
                />

                {/* Kicker */}
                <p className="text-sm sm:text-base font-medium text-white/95 tracking-wide">
                  {activeSlide.kicker}
                </p>

                {/* Tall Bold Condensed Headline with generous Vietnamese diacritic clearance */}
                <h1
                  style={{ fontFamily: 'var(--font-condensed)' }}
                  className="mt-3.5 text-[clamp(2.85rem,5.2vw,4.95rem)] font-extrabold uppercase tracking-[-0.01em] leading-[1.12] text-white text-balance drop-shadow-[0_6px_24px_rgba(0,0,0,0.45)]"
                >
                  <span className="block">{activeSlide.titleLines[0]}</span>
                  <span className="block">{activeSlide.titleLines[1]}</span>
                </h1>

                {/* Concise 2-3 Line Description (never crammed) */}
                <p className="mt-4 text-sm sm:text-[15px] text-white/88 leading-[1.65] max-w-[44ch] drop-shadow-[0_2px_10px_rgba(0,0,0,0.4)]">
                  {activeSlide.shortDescription}
                </p>

                {/* CTA Row: Golden Circular Bookmark + Outlined Pill "XEM THÊM" + Direct Start */}
                <div className="mt-6 sm:mt-7 flex flex-wrap items-center gap-3.5">
                  <button
                    type="button"
                    aria-label={
                      isCurrentBookmarked
                        ? `Bỏ lưu mục ${activeSlide.titleLines.join(' ')}`
                        : `Lưu mục ${activeSlide.titleLines.join(' ')}`
                    }
                    aria-pressed={isCurrentBookmarked}
                    onClick={() =>
                      setBookmarkedIds((prev) => toggleBookmarkId(prev, activeSlide.id))
                    }
                    className="w-11 h-11 rounded-full bg-[#F5A623] hover:bg-[#E09212] text-[#0A0F1A] shadow-[0_12px_28px_-6px_rgba(245,166,35,0.65)] flex items-center justify-center shrink-0 transition-transform duration-200 hover:scale-105 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  >
                    <Bookmark
                      className={`w-4 h-4 transition-transform ${
                        isCurrentBookmarked ? 'fill-current scale-110' : ''
                      }`}
                    />
                  </button>

                  <button
                    type="button"
                    onClick={() => setDetailSlideId(activeSlide.id)}
                    className="h-11 px-6 rounded-full border border-white/80 hover:border-white hover:bg-white/15 backdrop-blur-sm text-xs font-bold tracking-[0.14em] uppercase text-white whitespace-nowrap shrink-0 transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F5A623]"
                  >
                    Xem thêm
                  </button>

                  <button
                    type="button"
                    onClick={() => onOpenAuth('login')}
                    className="h-11 px-4 rounded-full text-xs font-semibold tracking-wide text-amber-300 hover:text-amber-200 hover:bg-white/10 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F5A623]"
                  >
                    <span>Bắt đầu ngay</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
            </div>
          </div>

          {/* RIGHT COLUMN: Overlapping Vertical Poster Cards + Bottom Nav/Progress/Counter Rail */}
          <div className="lg:col-span-7 xl:col-span-7 flex flex-col justify-end lg:pl-6 xl:pl-10">
            {/* Horizontal Strip of Upcoming Cards (4th card peeks past right edge on desktop like reference) */}
            <div
              role="region"
              aria-label="Danh sách trụ cột tiếp theo"
              className="flex items-end gap-3.5 sm:gap-5 overflow-x-auto lg:overflow-visible no-scrollbar pb-2 -mx-5 px-5 sm:-mx-10 sm:px-10 lg:mx-0 lg:px-0 lg:-mr-24 xl:-mr-36"
            >
              {upcomingIndices.map((slideIdx, position) => {
                const card = HERO_SLIDES[slideIdx];
                const isNextUp = position === 0;
                return (
                  <button
                    key={card.id}
                    type="button"
                    onClick={() => navigateToIndex(slideIdx, 1)}
                    aria-label={`Chuyển sang ${card.titleLines.join(' ')}`}
                    className={`group relative shrink-0 w-[160px] h-[228px] sm:w-[192px] sm:h-[274px] xl:w-[214px] xl:h-[304px] rounded-2xl overflow-hidden text-left shadow-[0_24px_54px_-16px_rgba(0,0,0,0.72)] border transition-[transform,border-color] duration-300 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F5A623] ${
                      isNextUp
                        ? 'border-white/35 hover:border-[#F5A623] hover:-translate-y-2'
                        : 'border-white/15 hover:border-white/45 hover:-translate-y-1.5'
                    }`}
                  >
                    {!failedImages[card.id] ? (
                      <img
                        src={card.imageThumb}
                        alt={card.imageAlt}
                        width={214}
                        height={304}
                        loading="lazy"
                        decoding="async"
                        fetchPriority="low"
                        referrerPolicy="no-referrer"
                        data-no-privacy-blur="true"
                        onError={() => markImageFailed(card.id)}
                        className="absolute inset-0 w-full h-full object-cover object-center transition-transform duration-500 group-hover:scale-105"
                      />
                    ) : (
                      <div className="absolute inset-0 bg-gradient-to-b from-slate-700 to-slate-950" />
                    )}

                    {/* Clean bottom scrim for crisp card typography */}
                    <div
                      aria-hidden="true"
                      className="absolute inset-0 bg-gradient-to-t from-[#070B14]/92 via-[#070B14]/25 to-transparent"
                    />

                    {/* Strictly minimal card copy: short white dash + 1-line label + 2-line title with crisp Vietnamese clearance */}
                    <div className="relative z-10 h-full flex flex-col justify-end p-3.5 sm:p-4">
                      <span
                        aria-hidden="true"
                        className="w-4 h-[2px] bg-white/90 rounded-full mb-2"
                      />
                      <span className="text-[11px] font-medium text-white/85 truncate">
                        {card.cardKicker}
                      </span>
                      <span
                        style={{ fontFamily: 'var(--font-condensed)' }}
                        className="mt-1.5 font-bold uppercase text-lg sm:text-[21px] leading-[1.14] text-white tracking-tight"
                      >
                        <span className="block">{card.titleLines[0]}</span>
                        <span className="block">{card.titleLines[1]}</span>
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Bottom Control Rail directly under cards: <  >  [=======]  01 */}
            <div className="mt-5 sm:mt-6 flex items-center gap-3.5 sm:gap-5 max-w-[700px]">
              <div className="flex items-center gap-2.5 shrink-0">
                <button
                  type="button"
                  onClick={handlePrev}
                  aria-label="Chuyển về mục trước"
                  className="w-11 h-11 rounded-full border border-white/40 hover:border-white hover:bg-white/15 text-white flex items-center justify-center transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F5A623]"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  onClick={handleNext}
                  aria-label="Chuyển sang mục tiếp theo"
                  className="w-11 h-11 rounded-full border border-white/40 hover:border-white hover:bg-white/15 text-white flex items-center justify-center transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F5A623]"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>

              {/* Sleek Horizontal Progress Track with GPU-composited scaleX fill */}
              <div
                aria-hidden="true"
                className="flex-1 h-[2.5px] bg-white/25 rounded-full overflow-hidden"
              >
                <div
                  className="h-full w-full origin-left bg-[#F5A623] rounded-full will-change-transform transition-transform duration-500 ease-out motion-reduce:duration-150"
                  style={{ transform: `scaleX(${progressPercent / 100})` }}
                />
              </div>

              {/* Crisp Large Tabular Slide Counter (matches reference bottom-right digit) */}
              <div
                aria-live="polite"
                aria-atomic="true"
                style={{ fontFamily: 'var(--font-condensed)' }}
                className="font-bold text-3xl sm:text-4xl text-white tabular-nums tracking-tight shrink-0 min-w-[2.1ch] text-right leading-none"
              >
                {formattedIndex}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* =====================================================================
          4. "XEM THÊM" FEATURE DETAIL MODAL (Anti-Cramming Disclosure)
         ===================================================================== */}
      {detailSlide && (
        <div
          onClick={() => setDetailSlideId(null)}
          className="landing-backdrop-enter fixed inset-0 z-50 bg-[#050811]/80 backdrop-blur-md flex items-center justify-center p-4 sm:p-6 select-text"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="slide-detail-modal-title"
            onClick={(e) => e.stopPropagation()}
            className="landing-modal-enter w-full max-w-2xl rounded-3xl bg-[#0F172A] border border-white/15 text-white shadow-[0_32px_90px_-20px_rgba(0,0,0,0.85)] overflow-hidden flex flex-col max-h-[88dvh]"
          >
              {/* Modal Banner Header */}
              <div className="relative h-44 sm:h-52 shrink-0 overflow-hidden bg-slate-900">
                {!failedImages[detailSlide.id] && (
                  <img
                    src={detailSlide.imageMobile}
                    alt={detailSlide.imageAlt}
                    width={720}
                    height={402}
                    decoding="async"
                    referrerPolicy="no-referrer"
                    data-no-privacy-blur="true"
                    className="w-full h-full object-cover object-center"
                  />
                )}
                <div
                  aria-hidden="true"
                  className="absolute inset-0 bg-gradient-to-t from-[#0F172A] via-[#0F172A]/60 to-[#070B14]/35"
                />

                <button
                  ref={closeModalBtnRef}
                  type="button"
                  aria-label="Đóng bảng chi tiết"
                  onClick={() => setDetailSlideId(null)}
                  className="absolute top-4 right-4 w-10 h-10 rounded-full bg-black/50 hover:bg-black/75 border border-white/25 text-white flex items-center justify-center transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F5A623]"
                >
                  <X className="w-4 h-4" />
                </button>

                <div className="absolute inset-x-6 bottom-5">
                  <p className="text-xs font-medium text-amber-300 tracking-wide">
                    {detailSlide.kicker}
                  </p>
                  <h2
                    id="slide-detail-modal-title"
                    style={{ fontFamily: 'var(--font-condensed)' }}
                    className="mt-1 text-3xl sm:text-4xl font-extrabold uppercase tracking-tight text-white leading-none"
                  >
                    {detailSlide.titleLines.join(' ')}
                  </h2>
                </div>
              </div>

              {/* Modal Scrollable Detail Body */}
              <div className="flex-1 overflow-y-auto px-6 sm:px-8 py-6 space-y-6">
                <p className="text-sm sm:text-[15px] text-slate-200 leading-[1.7] prose-measure">
                  {detailSlide.expandedDetail.summary}
                </p>

                {/* Concrete Proof Strip */}
                <div className="rounded-2xl bg-white/[0.04] border border-white/10 p-4">
                  <p className="text-xs font-semibold text-amber-300">
                    {detailSlide.expandedDetail.proofLabel}
                  </p>
                  <p className="mt-1 text-sm font-medium text-white">
                    {detailSlide.expandedDetail.proofValue}
                  </p>
                </div>

                {/* Highlights */}
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400 mb-3">
                    Điểm nổi bật chính
                  </h3>
                  <div className="space-y-3">
                    {detailSlide.expandedDetail.highlights.map((hl) => (
                      <div
                        key={hl.title}
                        className="flex items-start gap-3 rounded-2xl bg-white/[0.03] border border-white/10 p-3.5"
                      >
                        <CheckCircle2 className="w-4 h-4 text-[#F5A623] shrink-0 mt-0.5" />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-white">{hl.title}</p>
                          <p className="mt-0.5 text-xs sm:text-[13px] text-slate-300 leading-[1.6]">
                            {hl.desc}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Numbered Workflow Steps */}
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400 mb-3">
                    Quy trình thực tế trong Workspace
                  </h3>
                  <ol className="space-y-2.5">
                    {detailSlide.expandedDetail.workflowSteps.map((step, i) => (
                      <li key={step} className="flex items-start gap-3 text-sm text-slate-200">
                        <span className="font-mono text-xs font-bold text-[#F5A623] tabular-nums mt-0.5 shrink-0">
                          0{i + 1}.
                        </span>
                        <span className="leading-[1.6]">{step}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              </div>

              {/* Modal Sticky Footer */}
              <div className="shrink-0 px-6 sm:px-8 py-4 border-t border-white/10 bg-[#0B1221] flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => {
                    const target = detailSlide.targetSectionId;
                    setDetailSlideId(null);
                    window.setTimeout(() => onScrollToSection(target), 80);
                  }}
                  className="text-xs sm:text-sm font-semibold text-slate-300 hover:text-white transition-colors cursor-pointer"
                >
                  {detailSlide.targetSectionLabel} ↓
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setDetailSlideId(null);
                    onOpenAuth('login');
                  }}
                  className="inline-flex items-center gap-2 h-10 px-5 rounded-full bg-[#F5A623] hover:bg-[#E09212] text-[#0A0F1A] text-xs font-bold uppercase tracking-wider whitespace-nowrap shrink-0 transition-colors cursor-pointer"
                >
                  <span>Mở Workspace</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
      )}
    </section>
  );
};
