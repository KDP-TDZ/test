import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  XCircle,
} from 'lucide-react';
import { BRAND_CONFIG } from '../config/brand';
import { LandingHeroCarousel } from './LandingHeroCarousel';
import { LandingWorkspacePreview } from './LandingWorkspacePreview';
import { LandingExperienceStats } from './LandingExperienceStats';
import { SmoothAccordion } from './LiquidGlass/SmoothAccordion';
import { ThemeToggle } from './LiquidGlass/ThemeToggle';
import type { ExperienceRatingRecord } from '../core/experienceRatings';

interface LandingPageProps {
  onOpenAuth: (mode: 'login' | 'register') => void;
  experienceRatingEnabled?: boolean;
  hasUserRated?: boolean;
  onOpenRatingModal?: (initialStars?: 1 | 2 | 3 | 4 | 5) => void;
  latestSubmittedRating?: ExperienceRatingRecord | null;
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

export const LandingPage: React.FC<LandingPageProps> = ({
  onOpenAuth,
  experienceRatingEnabled = true,
  hasUserRated = false,
  onOpenRatingModal,
  latestSubmittedRating = null,
}) => {
  const prefersReduced =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [activeSection, setActiveSection] = useState<string>('top');
  const [selectedSpecimenId, setSelectedSpecimenId] = useState<string>('err-1');
  // Collapsed by default so specimen cards stay clean & concise (anti-cramming rule)
  const [specimenDetailsExpanded, setSpecimenDetailsExpanded] = useState<boolean>(false);
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(0);

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const sectionIds = ['top', 'specimen', 'workspace-preview', 'experience-stats', 'faq'];
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
      { rootMargin: '-12% 0px -48% 0px', threshold: [0.05, 0.2, 0.4] }
    );

    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  const scrollToSection = (sectionId: string) => {
    setActiveSection(sectionId);
    const el = document.getElementById(sectionId);
    if (el) {
      el.scrollIntoView({ behavior: prefersReduced ? 'auto' : 'smooth', block: 'start' });
    }
  };

  const activeSpecimen =
    SPECIMEN_ANNOTATIONS.find((s) => s.id === selectedSpecimenId) || SPECIMEN_ANNOTATIONS[0];
  const activeMeta = STATUS_META[activeSpecimen.color];
  const ActiveStatusIcon = activeMeta.icon;

  return (
    <div className="flex flex-col min-h-dvh bg-[#F8FAFC] dark:bg-[#09111E] text-[#172033] dark:text-[#E6EFFC] selection:bg-[#F5A623]/25 selection:text-[#172033] dark:selection:text-white">
      <main className="flex-1">
        {/* =====================================================================
            A. CINEMATIC FULLSCREEN EXPANDING CARDS HERO + OVERLAY TOP BAR
           ===================================================================== */}
        <LandingHeroCarousel
          activeSection={activeSection}
          onScrollToSection={scrollToSection}
          onOpenAuth={onOpenAuth}
        />

        {/* =====================================================================
            B. INTERACTIVE TEXTBOOK VERIFICATION SPECIMEN (With "Xem thêm" Disclosure)
           ===================================================================== */}
        <section
          id="specimen"
          className="scroll-mt-8 mx-auto max-w-[1380px] px-4 sm:px-8 py-14 sm:py-20"
        >
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 mb-8 sm:mb-10">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold tracking-wide text-amber-700 dark:text-amber-400">
                Mẫu kiểm chứng tương tác · Đối chiếu từng mệnh đề
              </p>
              <h2
                style={{ fontFamily: 'var(--font-condensed)' }}
                className="text-[clamp(2rem,3.8vw,3rem)] font-bold uppercase tracking-tight text-[#172033] dark:text-white mt-1 leading-[1.04] text-balance"
              >
                Nhấp vào từng câu ghi chép để xem cách chấm theo SGK
              </h2>
            </div>
            <div className="flex items-center gap-4">
              <p className="text-sm text-[#5A677D] dark:text-slate-300 max-w-md leading-[1.6]">
                Mỗi nhận định trong vở được đối chiếu riêng biệt và trích dẫn chính xác số trang sách giáo khoa GDPT 2018.
              </p>
              <div className="hidden md:block shrink-0">
                <ThemeToggle />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
            {/* Left Zone: Annotated Student Notebook Page */}
            <div className="lg:col-span-6 rounded-3xl bg-white dark:bg-[#111B30] border border-[#E6ECF5] dark:border-slate-800 p-5 sm:p-7 flex flex-col justify-between">
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-[#E6ECF5] dark:border-slate-800 text-xs">
                  <span className="font-bold text-[#172033] dark:text-white">
                    Trang vở mẫu · Hóa học 10 · Chương 3
                  </span>
                  <span className="text-[#5A677D] dark:text-slate-400 tabular-nums">
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
                        onClick={() => {
                          setSelectedSpecimenId(item.id);
                          setSpecimenDetailsExpanded(false);
                        }}
                        aria-pressed={isSelected}
                        className={`w-full text-left rounded-2xl border p-4 transition-all duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F5A623] ${
                          isSelected ? meta.activeItemClass : meta.idleItemClass
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 text-xs mb-1.5">
                          <span
                            className={`inline-flex items-center gap-1.5 font-semibold ${meta.textClass}`}
                          >
                            <Icon className={`w-4 h-4 shrink-0 ${meta.iconClass}`} />
                            {item.statusTag}
                          </span>
                          <span className="text-[11px] text-[#5A677D] dark:text-slate-400 tabular-nums">
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

              <div className="mt-5 pt-4 border-t border-[#E6ECF5] dark:border-slate-800 flex items-center justify-between gap-3 text-xs text-[#5A677D] dark:text-slate-400">
                <span>Tài liệu của bạn được phân tích tương tự trong Workspace.</span>
                <button
                  type="button"
                  onClick={() => onOpenAuth('login')}
                  className="font-bold text-amber-700 dark:text-amber-400 hover:underline whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Thử với vở của bạn →
                </button>
              </div>
            </div>

            {/* Right Zone: Concise Verification Card + "Xem thêm trích dẫn SGK" Toggle */}
            <div className="lg:col-span-6 rounded-3xl bg-white dark:bg-[#111B30] border border-[#E6ECF5] dark:border-slate-800 p-5 sm:p-7 flex flex-col justify-between">
              <div key={activeSpecimen.id} className="landing-fade-up space-y-4">
                  <div className={`rounded-2xl border p-4 ${activeMeta.resultHeaderBg}`}>
                    <div className="flex items-center gap-2">
                      <ActiveStatusIcon className={`w-4 h-4 shrink-0 ${activeMeta.iconClass}`} />
                      <span className={`text-xs font-bold ${activeMeta.textClass}`}>
                        {activeSpecimen.label}
                      </span>
                    </div>
                    <p className="mt-1.5 text-xs text-[#5A677D] dark:text-slate-300">
                      {activeSpecimen.source}
                    </p>
                  </div>

                  <div className="space-y-3.5 text-sm">
                    <div>
                      <p className="text-xs font-semibold text-[#5A677D] dark:text-slate-400 mb-1">
                        Kiến thức chuẩn cần nắm
                      </p>
                      <p className="text-[#172033] dark:text-white leading-[1.6]">
                        {activeSpecimen.correctKnowledge}
                      </p>
                    </div>

                    <div className="rounded-2xl bg-[#F8FAFC] dark:bg-slate-900/70 border border-[#E6ECF5] dark:border-slate-800 p-4">
                      <p className="text-xs font-bold text-[#172033] dark:text-white mb-1">
                        Gợi ý chỉnh sửa trực tiếp vào vở
                      </p>
                      <p className="text-xs sm:text-[13px] text-[#5A677D] dark:text-slate-300 leading-[1.6]">
                        {activeSpecimen.actionTip}
                      </p>
                    </div>
                  </div>

                  {/* Anti-cramming "Xem thêm" disclosure for deeper academic rationale & textbook excerpt */}
                  <div className="pt-1">
                    <button
                      type="button"
                      aria-expanded={specimenDetailsExpanded}
                      onClick={() => setSpecimenDetailsExpanded((v) => !v)}
                      className="inline-flex items-center gap-2 text-xs font-bold text-amber-700 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-300 transition-colors cursor-pointer py-1.5"
                    >
                      <span>
                        {specimenDetailsExpanded
                          ? 'Thu gọn lý giải & trích dẫn SGK'
                          : 'Xem thêm lý giải & trích dẫn nguyên văn SGK'}
                      </span>
                      <ChevronDown
                        className={`w-4 h-4 transition-transform duration-200 ${
                          specimenDetailsExpanded ? 'rotate-180' : ''
                        }`}
                      />
                    </button>

                    {specimenDetailsExpanded && (
                      <div className="landing-fade-up">
                        <div className="mt-2.5 rounded-2xl border border-[#E6ECF5] dark:border-slate-800 bg-[#F8FAFC] dark:bg-slate-900/60 p-4 space-y-2.5 text-xs text-[#5A677D] dark:text-slate-300 leading-[1.65]">
                          <div>
                            <span className="font-semibold text-[#172033] dark:text-white">
                              Lý giải học thuật:{' '}
                            </span>
                            <span>{activeSpecimen.reason}</span>
                          </div>
                          <div className="pt-2 border-t border-[#E6ECF5] dark:border-slate-800">
                            <p className="font-semibold text-[#172033] dark:text-white mb-1">
                              {activeSpecimen.sourceBook}
                            </p>
                            <p className="italic text-[#172033] dark:text-slate-100">
                              {activeSpecimen.sourceExcerpt}
                            </p>
                            <p className="mt-1.5">{activeSpecimen.verificationRule}</p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
            </div>
          </div>
        </section>

        {/* =====================================================================
            C. INTERACTIVE 2025 EXAM ARENA & GRADE LEADERBOARD
           ===================================================================== */}
        <LandingWorkspacePreview onOpenAuth={onOpenAuth} />

        {/* =====================================================================
            C2. REAL-TIME USER EXPERIENCE STATISTICS (Live Firestore / SSE)
           ===================================================================== */}
        {experienceRatingEnabled && (
          <LandingExperienceStats
            hasUserRated={hasUserRated}
            onOpenRatingModal={(initialStars) => onOpenRatingModal?.(initialStars)}
            latestSubmittedRating={latestSubmittedRating}
          />
        )}

        {/* =====================================================================
            D. FAQ ACCORDION & CLEAN CONVERSION BAND
           ===================================================================== */}
        <section
          id="faq"
          className="scroll-mt-8 mx-auto max-w-4xl px-4 sm:px-8 py-14 sm:py-16 border-t border-[#E6ECF5] dark:border-slate-800/80"
        >
          <div className="text-center mb-8">
            <p className="text-xs font-semibold tracking-wide text-amber-700 dark:text-amber-400">
              Giải đáp nhanh
            </p>
            <h2
              style={{ fontFamily: 'var(--font-condensed)' }}
              className="text-[clamp(1.9rem,3.6vw,2.75rem)] font-bold uppercase tracking-tight text-[#172033] dark:text-white mt-1"
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
                  className="rounded-2xl bg-white dark:bg-[#111B30] border border-[#E6ECF5] dark:border-slate-800"
                  triggerClassName="min-h-[54px] px-5 sm:px-6 py-3.5 sm:py-4 hover:bg-[#F8FAFC] dark:hover:bg-white/5"
                  contentClassName="px-5 sm:px-6 pb-4 sm:pb-5 text-sm text-[#5A677D] dark:text-slate-300 leading-[1.65] prose-measure border-t border-[#E6ECF5] dark:border-slate-800 pt-3"
                >
                  {item.a}
                </SmoothAccordion>
              );
            })}
          </div>

          {/* Focused Transition Band to Workspace */}
          <div className="mt-12 rounded-3xl bg-[#0B101B] text-white border border-slate-800 p-6 sm:p-9 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
            <div className="max-w-lg">
              <h3
                style={{ fontFamily: 'var(--font-condensed)' }}
                className="text-2xl sm:text-3xl font-bold uppercase tracking-tight text-white"
              >
                Sẵn sàng kiểm chứng tài liệu của riêng bạn?
              </h3>
              <p className="mt-1.5 text-sm text-slate-300 leading-[1.6]">
                Đăng nhập để dùng đầy đủ công cụ kiểm định chuẩn SGK, duyệt OCR vở viết tay, luyện đề 2025 và ôn tập ngắt quãng.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onOpenAuth('login')}
              className="group inline-flex items-center gap-3 pl-6 pr-2.5 py-2.5 rounded-full bg-[#F5A623] hover:bg-[#E09212] text-[#0A0F1A] text-sm font-bold transition-all duration-200 shrink-0 cursor-pointer whitespace-nowrap"
            >
              <span>Đăng nhập ngay</span>
              <span className="w-8 h-8 rounded-full bg-[#0A0F1A] text-[#F5A623] flex items-center justify-center transition-transform duration-200 group-hover:translate-x-0.5">
                <ArrowRight className="w-4 h-4" />
              </span>
            </button>
          </div>
        </section>
      </main>

      {/* =====================================================================
          E. QUIET FOOTER WITH AUTHOR SIGNATURE
         ===================================================================== */}
      <footer className="border-t border-[#E6ECF5] dark:border-slate-800 bg-white dark:bg-[#0C1424]">
        <div className="mx-auto max-w-[1380px] px-4 sm:px-8 py-6 sm:py-8 flex flex-col md:flex-row items-center justify-between gap-5 text-xs text-[#5A677D] dark:text-slate-400">
          <div className="space-y-1.5 text-center md:text-left">
            <p className="font-semibold text-[#172033] dark:text-white">
              © {new Date().getFullYear()} {BRAND_CONFIG.name}. Nền tảng kiểm chứng học tập THPT.
            </p>
            <div className="flex items-center justify-center md:justify-start gap-3">
              <a
                href="#top"
                onClick={(e) => {
                  e.preventDefault();
                  scrollToSection('top');
                }}
                className="hover:text-amber-700 dark:hover:text-white transition-colors"
              >
                Trang chủ
              </a>
              <span aria-hidden="true">·</span>
              <a
                href="#specimen"
                onClick={(e) => {
                  e.preventDefault();
                  scrollToSection('specimen');
                }}
                className="hover:text-amber-700 dark:hover:text-white transition-colors"
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
                className="hover:text-amber-700 dark:hover:text-white transition-colors"
              >
                Đề thi 2025
              </a>
              {experienceRatingEnabled && (
                <>
                  <span aria-hidden="true">·</span>
                  <a
                    href="#experience-stats"
                    onClick={(e) => {
                      e.preventDefault();
                      scrollToSection('experience-stats');
                    }}
                    className="hover:text-amber-700 dark:hover:text-white transition-colors"
                  >
                    Trải nghiệm
                  </a>
                </>
              )}
              <span aria-hidden="true">·</span>
              <a
                href="#faq"
                onClick={(e) => {
                  e.preventDefault();
                  scrollToSection('faq');
                }}
                className="hover:text-amber-700 dark:hover:text-white transition-colors"
              >
                Hỏi đáp
              </a>
            </div>
          </div>

          <div className="flex items-center gap-3.5 px-4 py-2 rounded-2xl bg-[#F8FAFC] dark:bg-slate-900/70 border border-[#E6ECF5] dark:border-slate-800">
            <div className="text-right">
              <p className="text-[11px] font-medium text-[#5A677D] dark:text-slate-400">
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
                width={144}
                height={44}
                loading="lazy"
                decoding="async"
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
