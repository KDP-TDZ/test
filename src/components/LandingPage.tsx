import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  BookOpenCheck,
  CheckCircle2,
  ChevronDown,
  FileSearch,
  Layers,
  Repeat,
  ShieldCheck,
  Trophy,
  Upload,
} from 'lucide-react';
import { BRAND_CONFIG } from '../config/brand';
import { gsap, MOTION_ALLOWED_MEDIA, useGSAP } from '../lib/gsapSetup';
import heroPrismImage from '../assets/images/hero_liquid_prism_1795012421683.jpg';
import { GlassSurface } from './LiquidGlass/GlassSurface';
import { HamburgerButton, NavigationDrawer } from './LiquidGlass/NavigationDrawer';
import { ThemeToggle } from './LiquidGlass/ThemeToggle';
import { WaterRippleButton } from './LiquidGlass/WaterRippleButton';

interface LandingPageProps {
  onOpenAuth: (mode: 'login' | 'register') => void;
}

const SPECIMEN_ANNOTATIONS = [
  {
    id: 'err-1',
    color: 'red' as const,
    label: 'Sai kiến thức',
    studentExcerpt: 'Liên kết hydrogen chỉ hình thành giữa nguyên tử H và nguyên tử C hoặc N.',
    correctKnowledge:
      'Liên kết hydrogen hình thành giữa nguyên tử H (đã liên kết với nguyên tử có độ âm điện lớn như F, O, N) với nguyên tử khác có độ âm điện lớn (F, O, N) và còn cặp electron hóa trị chưa liên kết.',
    reason: 'Nguyên tử Carbon (C) có độ âm điện nhỏ (2,55), không đủ phân cực liên kết C–H để tạo liên kết hydrogen điển hình.',
    source: 'SGK Hóa học 10 · Chương 3 · Trang 54',
  },
  {
    id: 'part-1',
    color: 'orange' as const,
    label: 'Thiếu điều kiện',
    studentExcerpt: 'Nước có nhiệt độ sôi cao hơn H₂S vì phân tử nước có liên kết hydrogen.',
    correctKnowledge:
      'Nhận định đúng về xu hướng nhưng cần nêu rõ: liên kết hydrogen liên phân tử làm tăng năng lượng cần thiết để tách các phân tử nước khi chuyển pha.',
    reason: 'Cần phân biệt liên kết hydrogen liên phân tử (tăng nhiệt độ sôi) với liên kết nội phân tử.',
    source: 'SGK Hóa học 10 · Chương 3 · Trang 55',
  },
  {
    id: 'ok-1',
    color: 'green' as const,
    label: 'Đúng chuẩn',
    studentExcerpt: 'Liên kết hydrogen yếu hơn liên kết cộng hóa trị nhưng mạnh hơn tương tác van der Waals.',
    correctKnowledge: 'Thứ tự độ bền liên kết được trình bày chính xác theo chuẩn chương trình.',
    reason: 'Năng lượng liên kết hydrogen thường từ 10–40 kJ/mol, nhỏ hơn liên kết cộng hóa trị nhưng lớn hơn tương tác van der Waals.',
    source: 'SGK Hóa học 10 · Bài 11 · Trang 56',
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

export const LandingPage: React.FC<LandingPageProps> = ({ onOpenAuth }) => {
  const pageRef = useRef<HTMLDivElement>(null);
  const hamburgerBtnRef = useRef<HTMLButtonElement>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [selectedSpecimenId, setSelectedSpecimenId] = useState<string>('err-1');
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(0);
  const [heroImgError, setHeroImgError] = useState(false);
  const landingDrawerId = 'landing-navigation-drawer';

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const handleChange = (e: MediaQueryListEvent) => {
      if (e.matches) setMobileNavOpen(false);
    };
    mq.addEventListener('change', handleChange);
    return () => mq.removeEventListener('change', handleChange);
  }, []);

  const activeSpecimen =
    SPECIMEN_ANNOTATIONS.find((s) => s.id === selectedSpecimenId) || SPECIMEN_ANNOTATIONS[0];

  const { contextSafe } = useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_ALLOWED_MEDIA, () => {
        const tl = gsap.timeline({ defaults: { ease: 'power2.out' } });
        tl.from('.hero-stagger', {
          y: 16,
          autoAlpha: 0,
          duration: 0.42,
          stagger: 0.08,
          clearProps: 'transform,opacity,visibility',
        }).from(
          '.hero-visual',
          {
            scale: 0.97,
            y: 12,
            autoAlpha: 0,
            duration: 0.48,
            clearProps: 'transform,opacity,visibility',
          },
          '-=0.28'
        );
      });
    },
    { scope: pageRef }
  );

  const handleSelectSpecimen = contextSafe((id: string) => {
    setSelectedSpecimenId(id);
    const mm = gsap.matchMedia();
    mm.add(MOTION_ALLOWED_MEDIA, () => {
      gsap.fromTo(
        '.specimen-detail',
        { y: 6, autoAlpha: 0.45 },
        {
          y: 0,
          autoAlpha: 1,
          duration: 0.24,
          ease: 'power2.out',
          clearProps: 'transform,opacity,visibility',
        }
      );
    });
  });

  return (
    <div ref={pageRef} className="flex flex-col min-h-screen">
      {/* Top Bar */}
      <header className="sticky top-0 z-[45] glass-nav">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 h-16 flex items-center justify-between gap-4 sm:gap-8">
          <div className="flex items-center gap-2.5">
            <HamburgerButton
              buttonRef={hamburgerBtnRef}
              open={mobileNavOpen}
              controlsId={landingDrawerId}
              onToggle={() => setMobileNavOpen((v) => !v)}
              className="md:hidden"
            />
            <a
              href="#top"
              className="font-display text-base sm:text-lg font-bold tracking-tight text-[#16243E] dark:text-[#E6EFFC] whitespace-nowrap shrink-0"
            >
              {BRAND_CONFIG.name}
            </a>
          </div>

          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-[#475B78] dark:text-[#B4C7E2]">
            <a href="#workflow" className="hover:text-[#16243E] dark:hover:text-white transition-colors whitespace-nowrap shrink-0">
              Quy trình
            </a>
            <a href="#specimen" className="hover:text-[#16243E] dark:hover:text-white transition-colors whitespace-nowrap shrink-0">
              Kiểm chứng
            </a>
            <a href="#practice" className="hover:text-[#16243E] dark:hover:text-white transition-colors whitespace-nowrap shrink-0">
              Thi & Đua Top
            </a>
            <a href="#faq" className="hover:text-[#16243E] dark:hover:text-white transition-colors whitespace-nowrap shrink-0">
              Hỏi đáp
            </a>
          </nav>

          <div className="flex items-center gap-2.5 shrink-0">
            <ThemeToggle />
            <WaterRippleButton size="sm" onClick={() => onOpenAuth('login')}>
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
          <div className="flex flex-col gap-2">
            <WaterRippleButton
              size="md"
              className="w-full"
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
            { href: '#workflow', label: 'Quy trình kiểm chứng' },
            { href: '#specimen', label: 'Mẫu đối chiếu SGK' },
            { href: '#practice', label: 'Thi thử & Đua Top' },
            { href: '#faq', label: 'Câu hỏi thường gặp' },
          ].map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={() => setMobileNavOpen(false)}
              className="w-full min-h-[42px] flex items-center px-3 py-2 rounded-xl text-sm font-medium text-[#334155] dark:text-[#CBD5E1] hover:bg-sky-50/80 dark:hover:bg-white/10 transition-colors"
            >
              {link.label}
            </a>
          ))}
        </div>
      </NavigationDrawer>

      {/* Hero Section */}
      <main id="top" className="flex-1">
        <section className="mx-auto max-w-7xl px-4 sm:px-6 pt-8 pb-10 sm:pt-12 sm:pb-16 lg:pt-20 lg:pb-24">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-7 sm:gap-10 lg:gap-12 items-stretch">
            <div className="lg:col-span-6 flex flex-col justify-center">
              <p className="hero-stagger text-xs font-semibold text-sky-700 dark:text-sky-400 tracking-wide mb-2.5 sm:mb-3">
                Nền tảng kiểm chứng học tập THPT · Lớp 10 · 11 · 12
              </p>
              <h1 className="hero-stagger font-display text-[clamp(1.65rem,5vw,2.75rem)] font-bold tracking-tight text-[#16243E] dark:text-[#E6EFFC] leading-[1.2] [text-wrap:balance]">
                Đừng chỉ học thuộc. Hãy kiểm chứng những gì bạn học.
              </h1>
              <p className="hero-stagger mt-4 sm:mt-5 text-sm sm:text-base text-[#475B78] dark:text-[#B4C7E2] leading-[1.6] prose-measure">
                Tải tài liệu học tập lên, đối chiếu với sách giáo khoa chuẩn, phát hiện chỗ sai, bổ sung kiến thức thiếu và thi thử đua top theo khối.
              </p>

              <div className="hero-stagger mt-6 sm:mt-8 flex flex-wrap items-center gap-3 sm:gap-4">
                <WaterRippleButton size="lg" onClick={() => onOpenAuth('login')}>
                  <Upload className="w-4 h-4" />
                  Tải tài liệu lên
                </WaterRippleButton>
                <button
                  type="button"
                  onClick={() => onOpenAuth('register')}
                  className="inline-flex items-center gap-1.5 min-h-[44px] px-4 py-2.5 rounded-2xl text-sm font-medium text-[#16243E] dark:text-[#E6EFFC] hover:text-sky-700 dark:hover:text-sky-400 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Tạo tài khoản mới
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>

              <div className="hero-stagger mt-6 sm:mt-8 pt-5 border-t border-sky-200/70 dark:border-slate-800 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-[#475B78] dark:text-[#B4C7E2]">
                <span>Nhận diện PDF, DOCX & chữ viết tay</span>
                <span aria-hidden="true">·</span>
                <span>Đối chiếu sách giáo khoa theo bộ</span>
                <span aria-hidden="true">·</span>
                <span>Thi giữa kỳ/cuối kỳ & Đua Top</span>
              </div>
            </div>

            <div className="hero-visual lg:col-span-6">
              <GlassSurface enableRipple className="h-full rounded-3xl p-2 sm:p-2.5 flex flex-col">
                <div className="relative w-full h-full min-h-[220px] sm:min-h-[340px] rounded-2xl overflow-hidden bg-gradient-to-br from-sky-50 via-white to-sky-100/70 dark:from-slate-900 dark:via-[#111C2E] dark:to-slate-900">
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
                </div>
              </GlassSurface>
            </div>
          </div>
        </section>

        {/* Workflow Section (Asymmetric 12-col editorial flow, not repetitive identical card grid) */}
        <section id="workflow" className="mx-auto max-w-7xl px-4 sm:px-6 py-10 sm:py-16 border-t border-sky-200/50 dark:border-slate-800/80">
          <div className="max-w-2xl mt-2 mb-6 sm:mb-10">
            <h2 className="font-display text-[clamp(1.35rem,3.6vw,1.875rem)] font-bold text-[#16243E] dark:text-[#E6EFFC] leading-[1.25] [text-wrap:balance]">
              Chu trình học tập khép kín từ tài liệu ghi chép đến nắm vững kiến thức
            </h2>
            <p className="mt-3 text-sm sm:text-base text-[#475B78] dark:text-[#B4C7E2] leading-[1.6] prose-measure">
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
                      <Icon className="w-5 h-5 text-sky-600 dark:text-sky-400 shrink-0" />
                    </div>
                    <h3 className="font-display text-base font-bold text-[#16243E] dark:text-[#E6EFFC] mt-1 mb-2">
                      {step.title}
                    </h3>
                    <p className="text-sm text-[#475B78] dark:text-[#B4C7E2] leading-[1.6] prose-measure">
                      {step.desc}
                    </p>
                  </div>
                </GlassSurface>
              );
            })}
          </div>
        </section>

        {/* Interactive Document Annotation Specimen */}
        <section id="specimen" className="mx-auto max-w-7xl px-4 sm:px-6 py-10 sm:py-16 border-t border-sky-200/50 dark:border-slate-800">
          <div className="max-w-2xl mt-2 mb-6 sm:mb-10">
            <p className="text-xs font-semibold text-sky-700 dark:text-sky-400 mb-2">
              Ví dụ minh họa không gian đối chiếu hai cột
            </p>
            <h2 className="font-display text-[clamp(1.35rem,3.6vw,1.875rem)] font-bold text-[#16243E] dark:text-[#E6EFFC] leading-[1.25] [text-wrap:balance]">
              Nhấn trực tiếp vào từng vùng đánh dấu để xem lý do và dẫn chứng sách giáo khoa
            </h2>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6 items-stretch">
            {/* Left: Simulated Student Document (Solid Reading Surface) */}
            <div className="lg:col-span-7 document-paper rounded-3xl p-4 sm:p-8 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between pb-3 sm:pb-4 mb-4 sm:mb-5 border-b border-slate-100 dark:border-slate-800 text-xs text-[#475B78] dark:text-[#B4C7E2]">
                  <span>Tài liệu học sinh · Đề cương Hóa học 10</span>
                  <span className="font-mono">Trang 1 / 1</span>
                </div>

                <h3 className="font-display text-base sm:text-lg font-bold text-[#16243E] dark:text-[#E6EFFC] mb-3 sm:mb-4">
                  Bài 11: Liên kết hydrogen và tương tác van der Waals
                </h3>

                <div className="space-y-3 sm:space-y-4 text-sm leading-[1.6] text-[#16243E] dark:text-slate-200">
                  <button
                    type="button"
                    onClick={() => handleSelectSpecimen('err-1')}
                    className={`w-full min-h-[44px] text-left px-3.5 py-2.5 rounded-xl transition-colors cursor-pointer border ${
                      selectedSpecimenId === 'err-1'
                        ? 'bg-rose-50 dark:bg-rose-950/50 border-rose-300 dark:border-rose-700 ring-2 ring-rose-200 dark:ring-rose-900'
                        : 'bg-rose-50/60 dark:bg-rose-950/30 border-rose-200/70 dark:border-rose-800/60 hover:bg-rose-50 dark:hover:bg-rose-950/40'
                    }`}
                  >
                    <span className="font-semibold text-rose-700 dark:text-rose-300 mr-2">[Sai]</span>
                    {SPECIMEN_ANNOTATIONS[0].studentExcerpt}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleSelectSpecimen('part-1')}
                    className={`w-full min-h-[44px] text-left px-3.5 py-2.5 rounded-xl transition-colors cursor-pointer border ${
                      selectedSpecimenId === 'part-1'
                        ? 'bg-amber-50 dark:bg-amber-950/50 border-amber-300 dark:border-amber-700 ring-2 ring-amber-200 dark:ring-amber-900'
                        : 'bg-amber-50/60 dark:bg-amber-950/30 border-amber-200/70 dark:border-amber-800/60 hover:bg-amber-50 dark:hover:bg-amber-950/40'
                    }`}
                  >
                    <span className="font-semibold text-amber-700 dark:text-amber-300 mr-2">[Thiếu điều kiện]</span>
                    {SPECIMEN_ANNOTATIONS[1].studentExcerpt}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleSelectSpecimen('ok-1')}
                    className={`w-full min-h-[44px] text-left px-3.5 py-2.5 rounded-xl transition-colors cursor-pointer border ${
                      selectedSpecimenId === 'ok-1'
                        ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-300 dark:border-emerald-700 ring-2 ring-emerald-200 dark:ring-emerald-900'
                        : 'bg-emerald-50/60 dark:bg-emerald-950/30 border-emerald-200/70 dark:border-emerald-800/60 hover:bg-emerald-50 dark:hover:bg-emerald-950/40'
                    }`}
                  >
                    <span className="font-semibold text-emerald-700 dark:text-emerald-300 mr-2">[Đúng]</span>
                    {SPECIMEN_ANNOTATIONS[2].studentExcerpt}
                  </button>
                </div>
              </div>

              <div className="mt-5 sm:mt-6 pt-4 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-[#475B78] dark:text-[#B4C7E2]">
                <span className="inline-flex items-center gap-1.5 text-rose-700 dark:text-rose-300 font-medium">
                  <span className="h-2 w-2 rounded-full bg-rose-600" aria-hidden="true" />
                  Đỏ: Lỗi kiến thức
                </span>
                <span className="inline-flex items-center gap-1.5 text-amber-700 dark:text-amber-300 font-medium">
                  <span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden="true" />
                  Cam: Thiếu điều kiện
                </span>
                <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300 font-medium">
                  <span className="h-2 w-2 rounded-full bg-emerald-600" aria-hidden="true" />
                  Xanh lá: Đã kiểm chứng
                </span>
              </div>
            </div>

            {/* Right: Reference & Explanation Panel */}
            <div className="lg:col-span-5">
              <GlassSurface className="h-full rounded-3xl p-5 sm:p-7 flex flex-col justify-between">
                <div className="specimen-detail">
                  <div className="flex items-center justify-between mb-4 text-xs">
                    <span
                      className={`font-semibold ${
                        activeSpecimen.color === 'red'
                          ? 'text-rose-700 dark:text-rose-300'
                          : activeSpecimen.color === 'orange'
                          ? 'text-amber-700 dark:text-amber-300'
                          : 'text-emerald-700 dark:text-emerald-300'
                      }`}
                    >
                      {activeSpecimen.label}
                    </span>
                    <span className="font-mono text-[#475B78] dark:text-[#B4C7E2]">{activeSpecimen.source}</span>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <p className="text-xs font-medium text-[#475B78] dark:text-[#B4C7E2] mb-1">
                        Kiến thức chuẩn theo tài liệu
                      </p>
                      <p className="text-sm text-[#16243E] dark:text-[#E6EFFC] leading-[1.6] font-medium bg-emerald-50/80 dark:bg-emerald-950/40 border border-emerald-200/80 dark:border-emerald-800/60 rounded-2xl p-3.5 prose-measure">
                        {activeSpecimen.correctKnowledge}
                      </p>
                    </div>

                    <div>
                      <p className="text-xs font-medium text-[#475B78] dark:text-[#B4C7E2] mb-1">
                        Phân tích chi tiết
                      </p>
                      <p className="text-sm text-[#16243E] dark:text-slate-200 leading-[1.6] prose-measure">
                        {activeSpecimen.reason}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-6 pt-4 border-t border-sky-200/60 dark:border-slate-700/70 flex items-center justify-between text-xs text-[#475B78] dark:text-[#B4C7E2]">
                  <span>Nhấp các đoạn bên trái để đối chiếu</span>
                  <button
                    type="button"
                    onClick={() => onOpenAuth('login')}
                    className="font-semibold text-sky-700 dark:text-sky-400 hover:underline cursor-pointer min-h-[36px] inline-flex items-center"
                  >
                    Thử với tài liệu của bạn →
                  </button>
                </div>
              </GlassSurface>
            </div>
          </div>
        </section>

        {/* Exam Center & Practice Highlights (Single Sky Accent + semantic icons) */}
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

        {/* FAQ */}
        <section id="faq" className="mx-auto max-w-4xl px-4 sm:px-6 py-10 sm:py-16 border-t border-sky-200/50 dark:border-slate-800">
          <h2 className="font-display text-[clamp(1.35rem,3.6vw,1.875rem)] font-bold text-[#16243E] dark:text-[#E6EFFC] mt-2 mb-6 sm:mb-8 text-center">
            Câu hỏi thường gặp
          </h2>
          <div className="space-y-3">
            {FAQS.map((item, idx) => {
              const isOpen = openFaqIndex === idx;
              return (
                <div key={item.q} className="glass-surface rounded-3xl overflow-hidden">
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setOpenFaqIndex(isOpen ? null : idx)}
                    className="w-full min-h-[48px] px-4 sm:px-6 py-3.5 sm:py-4 text-left flex items-center justify-between gap-4 font-medium text-sm sm:text-base text-[#16243E] dark:text-[#E6EFFC] cursor-pointer"
                  >
                    <span>{item.q}</span>
                    <ChevronDown
                      className={`w-4 h-4 text-[#475B78] dark:text-[#B4C7E2] shrink-0 transition-transform duration-200 ${
                        isOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </button>
                  {isOpen && (
                    <div className="px-4 sm:px-6 pb-4 sm:pb-5 text-sm text-[#475B78] dark:text-[#B4C7E2] leading-[1.6] prose-measure border-t border-sky-200/50 dark:border-slate-700/60 pt-3">
                      {item.a}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </main>

      <footer className="border-t border-sky-200/60 dark:border-slate-800 bg-white/55 dark:bg-slate-900/55 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-6 sm:py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[#475B78] dark:text-[#B4C7E2]">
          <p>© {new Date().getFullYear()} {BRAND_CONFIG.name}. Nền tảng kiểm chứng học tập THPT.</p>
          <div className="flex items-center gap-4">
            <a href="#workflow" className="hover:text-[#16243E] dark:hover:text-white">Quy trình</a>
            <span aria-hidden="true">·</span>
            <a href="#specimen" className="hover:text-[#16243E] dark:hover:text-white">Minh họa</a>
            <span aria-hidden="true">·</span>
            <a href="#faq" className="hover:text-[#16243E] dark:hover:text-white">Hỏi đáp</a>
          </div>
        </div>
      </footer>
    </div>
  );
};
