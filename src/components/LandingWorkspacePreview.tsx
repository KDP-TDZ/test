import React, { useState } from 'react';
import {
  ArrowRight,
  BarChart3,
  BookMarked,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  FileSearch,
  Layers,
  Repeat,
  RotateCw,
  ShieldCheck,
  Trophy,
  XCircle,
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useUiMode } from '../context/UiModeContext';
import { WaterRippleButton } from './LiquidGlass/WaterRippleButton';

interface LandingWorkspacePreviewProps {
  onOpenAuth: (mode: 'login' | 'register') => void;
}

type PreviewModuleId = 'verify-ocr' | 'exam-2025' | 'practice-flashcards' | 'analytics-admin';

interface PreviewModule {
  id: PreviewModuleId;
  index: string;
  title: string;
  shortLabel: string;
  summary: string;
  workspaceTab: string;
  highlights: string[];
  icon: React.ComponentType<{ className?: string }>;
}

const PREVIEW_MODULES: PreviewModule[] = [
  {
    id: 'verify-ocr',
    index: '01.',
    title: 'Kiểm định vở & Duyệt OCR',
    shortLabel: 'Kiểm định & OCR',
    summary:
      'Tải ảnh chụp vở viết tay, PDF hoặc DOCX, rà soát lại đoạn chữ mờ trước khi AI đối chiếu 4 lớp với sách giáo khoa chuẩn.',
    workspaceTab: 'Kiểm định tài liệu · Duyệt OCR trước khi chấm',
    highlights: [
      'Nén ảnh đa tầng giữ rõ công thức và ký hiệu hóa học',
      'Đánh dấu đoạn OCR độ tin cậy thấp để sửa tay trước khi chấm',
      'Khoanh vùng lỗi trực tiếp trên trang tài liệu gốc & xuất phiếu in',
    ],
    icon: FileSearch,
  },
  {
    id: 'exam-2025',
    index: '02.',
    title: 'Trung tâm Đề thi 2025 & Đua Top',
    shortLabel: 'Đề thi & Đua Top',
    summary:
      'Thi thử đúng cấu trúc GDPT 2018 (trắc nghiệm ABCD, Đúng/Sai nhiều ý) với đồng hồ tự nộp và Bảng xếp hạng minh bạch theo khối.',
    workspaceTab: 'Trung tâm Đề thi · Ma trận chuẩn GDPT 2018',
    highlights: [
      'Chấm điểm Đúng/Sai chuẩn từng ý (0,1 · 0,25 · 0,5 · 1,0 điểm)',
      'Tự động nộp bài khi hết giờ 00:00 và khóa in đáp án trước lượt đầu',
      'Cộng điểm Đua Top công bằng theo Khối 10, 11, 12 và Toàn trường',
    ],
    icon: ClipboardCheck,
  },
  {
    id: 'practice-flashcards',
    index: '03.',
    title: 'Luyện tập ngắt quãng & Flashcard 3D',
    shortLabel: 'Luyện tập & Thẻ 3D',
    summary:
      'Mọi câu làm sai hoặc gắn cờ tự động gom vào Ngân hàng luyện tập theo chu kỳ 1–3–7–14 ngày, kèm Sprint 10 phút và thẻ lật 3D.',
    workspaceTab: 'Ngân hàng luyện tập · Lặp lại ngắt quãng',
    highlights: [
      'Phím tắt A/B/C/D làm bài nhanh trên máy tính',
      'Sprint 10 phút tự ghi nhận tiến độ ôn tập vào thống kê chung',
      'Flashcard 3D tự sinh từ chính lỗ hổng kiến thức trong vở của bạn',
    ],
    icon: Repeat,
  },
  {
    id: 'analytics-admin',
    index: '04.',
    title: 'Phân tích tiến độ & Kho SGK chuẩn',
    shortLabel: 'Tiến độ & Kho SGK',
    summary:
      'Theo dõi độ chính xác theo từng chương môn học, lưu lịch sử kiểm định và quản trị kho SGK, đề thi cho nhóm học tập.',
    workspaceTab: 'Phân tích học tập · Quản trị nguồn chuẩn',
    highlights: [
      'Biểu đồ nắm vững kiến thức theo từng chương Toán, Lý, Hóa',
      'Kho SGK lập chỉ mục theo khối lớp để đối chiếu chính xác nguồn trang',
      'Chế độ làm mờ bảo mật (Ctrl+H) khi trình chiếu hoặc chấm bài',
    ],
    icon: BarChart3,
  },
];

export const LandingWorkspacePreview: React.FC<LandingWorkspacePreviewProps> = ({
  onOpenAuth,
}) => {
  const { isEthereal } = useUiMode();
  const prefersReduced = useReducedMotion();
  const [activeId, setActiveId] = useState<PreviewModuleId>('verify-ocr');
  const [flashcardFlipped, setFlashcardFlipped] = useState(false);

  const activeModule =
    PREVIEW_MODULES.find((item) => item.id === activeId) || PREVIEW_MODULES[0];

  const handleSelectModule = (id: PreviewModuleId) => {
    setActiveId(id);
    if (id !== 'practice-flashcards') {
      setFlashcardFlipped(false);
    }
  };

  return (
    <section
      id="workspace-preview"
      className="scroll-mt-20 mx-auto max-w-7xl px-4 sm:px-6 py-12 sm:py-20 border-t border-sky-200/55 dark:border-slate-800/80"
    >
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 mb-8 sm:mb-10">
        <div className="max-w-2xl">
          <p
            className={`text-xs font-semibold tracking-wide ${
              isEthereal
                ? 'text-indigo-600 dark:text-indigo-300'
                : 'text-sky-700 dark:text-sky-400'
            }`}
          >
            Không gian học tập sau khi đăng nhập · 4 phân khu cốt lõi
          </p>
          <h2 className="font-display text-[clamp(1.45rem,3.4vw,2.15rem)] font-bold tracking-tight text-[#16243E] dark:text-[#E6EFFC] mt-1.5 text-balance">
            Xem trước những gì mở khóa ngay trong Workspace của bạn
          </h2>
        </div>
        <p className="text-sm text-[#475B78] dark:text-[#B4C7E2] max-w-md leading-[1.6]">
          Trang này giới thiệu nhanh từng tính năng. Sau khi đăng nhập, bạn sẽ vào thẳng khu vực làm việc đầy đủ dữ liệu cá nhân.
        </p>
      </div>

      {/* Asymmetric 2-zone Workspace Preview Container */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-7 items-stretch">
        {/* Left Navigation List (Editorial Numbering 01–04) */}
        <div
          role="tablist"
          aria-label="Danh sách tính năng khu vực sau đăng nhập"
          className="lg:col-span-5 flex flex-col gap-2.5"
        >
          {PREVIEW_MODULES.map((mod) => {
            const Icon = mod.icon;
            const isActive = mod.id === activeId;
            return (
              <button
                key={mod.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => handleSelectModule(mod.id)}
                className={`group w-full text-left rounded-2xl p-4 sm:p-5 border transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 ${
                  isEthereal
                    ? 'focus-visible:ring-indigo-500'
                    : 'focus-visible:ring-sky-500'
                } ${
                  isActive
                    ? isEthereal
                      ? 'bg-white/95 dark:bg-[#141E3A]/95 border-indigo-300 dark:border-indigo-500/60 shadow-[0_14px_30px_-18px_rgba(79,70,229,0.42)]'
                      : 'bg-white dark:bg-slate-900 border-sky-400 dark:border-sky-500/70 shadow-sm'
                    : 'bg-white/55 dark:bg-slate-900/45 border-sky-200/65 dark:border-slate-800 hover:bg-white/85 dark:hover:bg-slate-900/75 hover:border-sky-300/80 dark:hover:border-slate-700'
                }`}
              >
                <div className="flex items-start gap-3.5">
                  <div
                    className={`mt-0.5 w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-colors ${
                      isActive
                        ? isEthereal
                          ? 'bg-indigo-600 text-white dark:bg-indigo-500'
                          : 'bg-sky-700 text-white dark:bg-sky-600'
                        : 'bg-slate-100 dark:bg-slate-800 text-[#475B78] dark:text-[#B4C7E2] group-hover:text-[#16243E] dark:group-hover:text-white'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span
                        className={`font-mono text-xs font-semibold tabular-nums ${
                          isActive
                            ? isEthereal
                              ? 'text-indigo-600 dark:text-indigo-300'
                              : 'text-sky-700 dark:text-sky-300'
                            : 'text-slate-400 dark:text-slate-500'
                        }`}
                      >
                        {mod.index}
                      </span>
                      <h3 className="font-display text-[15px] sm:text-base font-semibold text-[#16243E] dark:text-[#E6EFFC] leading-snug">
                        {mod.title}
                      </h3>
                    </div>
                    <p className="mt-1.5 text-xs sm:text-[13px] text-[#475B78] dark:text-[#B4C7E2] leading-[1.55]">
                      {mod.summary}
                    </p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Right Realistic Interactive Workspace Frame */}
        <div className="lg:col-span-7 flex flex-col">
          <div className="glass-surface rounded-3xl p-4 sm:p-6 flex-1 flex flex-col justify-between">
            {/* Mock Workspace Window Chrome */}
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-sky-200/60 dark:border-slate-800">
                <div className="flex items-center gap-2 min-w-0">
                  <Layers
                    className={`w-4 h-4 shrink-0 ${
                      isEthereal
                        ? 'text-indigo-600 dark:text-indigo-300'
                        : 'text-sky-700 dark:text-sky-400'
                    }`}
                  />
                  <span className="text-xs sm:text-[13px] font-semibold text-[#16243E] dark:text-[#E6EFFC] truncate">
                    {activeModule.workspaceTab}
                  </span>
                </div>
                <span className="text-[11px] text-[#475B78] dark:text-[#B4C7E2] whitespace-nowrap shrink-0">
                  Mô phỏng giao diện sau đăng nhập
                </span>
              </div>

              {/* Dynamic Interactive Stage */}
              <div className="mt-5 min-h-[285px]">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={activeModule.id}
                    initial={prefersReduced ? false : { opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={prefersReduced ? { opacity: 0 } : { opacity: 0, y: -6 }}
                    transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                  >
                    {activeModule.id === 'verify-ocr' && (
                      <div className="space-y-4">
                        <div className="rounded-2xl border border-sky-200/75 dark:border-slate-700/80 bg-white/80 dark:bg-slate-900/70 p-4">
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#475B78] dark:text-[#B4C7E2] pb-2.5 border-b border-slate-200/70 dark:border-slate-800">
                            <span className="font-semibold text-[#16243E] dark:text-[#E6EFFC]">
                              Bản đọc OCR · vo_hoa_chuong_3.jpg
                            </span>
                            <span className="font-mono tabular-nums text-emerald-700 dark:text-emerald-400 font-semibold">
                              Độ tin cậy OCR: 94%
                            </span>
                          </div>
                          <div className="mt-3 space-y-2.5 text-xs sm:text-[13px]">
                            <div className="flex items-start gap-2.5">
                              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                              <p className="text-[#16243E] dark:text-[#E6EFFC]">
                                Liên kết hydrogen yếu hơn liên kết cộng hóa trị nhưng mạnh hơn tương tác van der Waals.
                              </p>
                            </div>
                            <div className="flex items-start gap-2.5 rounded-xl bg-rose-50/80 dark:bg-rose-950/35 border border-rose-200/80 dark:border-rose-800/60 p-2.5">
                              <XCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                              <div className="min-w-0">
                                <p className="text-[#16243E] dark:text-[#E6EFFC]">
                                  Liên kết hydrogen chỉ hình thành giữa H và C hoặc N.
                                </p>
                                <p className="mt-1 text-[11px] text-rose-700 dark:text-rose-300 font-medium">
                                  Sai bản chất · Đối chiếu SGK Hóa 10 (Trang 54): phải là F, O, N có độ âm điện lớn.
                                </p>
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                          <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/75 dark:bg-slate-900/65 p-3.5">
                            <p className="text-[11px] text-[#475B78] dark:text-[#B4C7E2]">Độ chính xác</p>
                            <p className="mt-1 font-display text-xl font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                              84%
                            </p>
                          </div>
                          <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/75 dark:bg-slate-900/65 p-3.5">
                            <p className="text-[11px] text-[#475B78] dark:text-[#B4C7E2]">Độ đầy đủ chương</p>
                            <p className="mt-1 font-display text-xl font-bold text-sky-700 dark:text-sky-400 tabular-nums">
                              76%
                            </p>
                          </div>
                          <div className="col-span-2 sm:col-span-1 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/75 dark:bg-slate-900/65 p-3.5">
                            <p className="text-[11px] text-[#475B78] dark:text-[#B4C7E2]">Lớp kiểm định</p>
                            <p className="mt-1 font-display text-sm font-bold text-[#16243E] dark:text-[#E6EFFC]">
                              4 lớp GDPT 2018
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    {activeModule.id === 'exam-2025' && (
                      <div className="space-y-4">
                        <div className="rounded-2xl border border-sky-200/75 dark:border-slate-700/80 bg-white/80 dark:bg-slate-900/70 p-4">
                          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200/70 dark:border-slate-800 text-xs">
                            <span className="font-semibold text-[#16243E] dark:text-[#E6EFFC]">
                              Đề giữa kỳ 1 · Vật lý 11 · Phần II (Đúng / Sai)
                            </span>
                            <span className="inline-flex items-center gap-1.5 font-mono font-semibold text-indigo-700 dark:text-indigo-300 tabular-nums">
                              <Clock className="w-3.5 h-3.5" />
                              42:18 còn lại
                            </span>
                          </div>
                          <div className="mt-3 space-y-2 text-xs sm:text-[13px]">
                            {[
                              { id: 'a)', text: 'Biên độ dao động điều hòa là đại lượng luôn dương.', ans: 'Đúng' },
                              { id: 'b)', text: 'Vận tốc đạt cực đại khi vật đi qua vị trí biên.', ans: 'Sai' },
                              { id: 'c)', text: 'Gia tốc luôn hướng về vị trí cân bằng.', ans: 'Đúng' },
                            ].map((row) => (
                              <div
                                key={row.id}
                                className="flex items-center justify-between gap-3 py-1.5 border-b last:border-b-0 border-slate-100 dark:border-slate-800/80"
                              >
                                <p className="text-[#16243E] dark:text-[#E6EFFC]">
                                  <span className="font-semibold mr-1.5">{row.id}</span>
                                  {row.text}
                                </p>
                                <span
                                  className={`text-xs font-semibold shrink-0 tabular-nums ${
                                    row.ans === 'Đúng'
                                      ? 'text-emerald-700 dark:text-emerald-400'
                                      : 'text-rose-700 dark:text-rose-400'
                                  }`}
                                >
                                  {row.ans}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/75 dark:bg-slate-900/65 p-3.5">
                          <div className="flex items-center justify-between text-xs mb-2">
                            <span className="inline-flex items-center gap-1.5 font-semibold text-[#16243E] dark:text-[#E6EFFC]">
                              <Trophy className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                              Bảng xếp hạng Khối 11 · Tuần này
                            </span>
                            <span className="text-[11px] text-[#475B78] dark:text-[#B4C7E2]">
                              Điểm tích lũy lượt thi chính thức
                            </span>
                          </div>
                          <div className="grid grid-cols-3 gap-2 text-xs tabular-nums">
                            <div className="rounded-xl bg-slate-50 dark:bg-slate-800/70 px-3 py-2">
                              <p className="text-[11px] text-[#475B78] dark:text-[#B4C7E2]">#1 · Khối 11</p>
                              <p className="font-semibold text-[#16243E] dark:text-[#E6EFFC] mt-0.5">9,50 đ</p>
                            </div>
                            <div className="rounded-xl bg-slate-50 dark:bg-slate-800/70 px-3 py-2">
                              <p className="text-[11px] text-[#475B78] dark:text-[#B4C7E2]">#2 · Khối 11</p>
                              <p className="font-semibold text-[#16243E] dark:text-[#E6EFFC] mt-0.5">9,25 đ</p>
                            </div>
                            <div className="rounded-xl bg-slate-50 dark:bg-slate-800/70 px-3 py-2">
                              <p className="text-[11px] text-[#475B78] dark:text-[#B4C7E2]">#3 · Khối 11</p>
                              <p className="font-semibold text-[#16243E] dark:text-[#E6EFFC] mt-0.5">8,85 đ</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {activeModule.id === 'practice-flashcards' && (
                      <div className="space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#475B78] dark:text-[#B4C7E2]">
                          <span>Chu kỳ lặp lại ngắt quãng: 1 ngày · 3 ngày · 7 ngày · 14 ngày</span>
                          <span className="font-semibold text-indigo-700 dark:text-indigo-300">
                            Nhấp thẻ bên dưới để lật thử
                          </span>
                        </div>

                        {/* Interactive mini-Flashcard visitors can actually click */}
                        <button
                          type="button"
                          onClick={() => setFlashcardFlipped((v) => !v)}
                          aria-pressed={flashcardFlipped}
                          className="w-full text-left rounded-2xl border border-indigo-200/85 dark:border-indigo-500/40 bg-white/90 dark:bg-slate-900/80 p-5 transition-all duration-200 hover:border-indigo-400 dark:hover:border-indigo-400 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                        >
                          <div className="flex items-center justify-between gap-2 text-[11px] font-semibold text-indigo-600 dark:text-indigo-300 mb-2.5">
                            <span>
                              {flashcardFlipped
                                ? 'Mặt sau · Đáp án chuẩn SGK Hóa 10'
                                : 'Mặt trước · Câu hỏi từ lỗ hổng trong vở'}
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <RotateCw className="w-3.5 h-3.5" />
                              Lật thẻ
                            </span>
                          </div>
                          {!flashcardFlipped ? (
                            <p className="font-display text-base sm:text-lg font-semibold text-[#16243E] dark:text-[#E6EFFC] leading-snug">
                              Điều kiện cần để một phân tử tạo được liên kết hydrogen với phân tử khác là gì?
                            </p>
                          ) : (
                            <p className="text-sm text-[#16243E] dark:text-[#E6EFFC] leading-[1.6]">
                              Phải có nguyên tử H liên kết với nguyên tử có độ âm điện lớn (F, O, N) và một nguyên tử có độ âm điện lớn khác còn cặp electron hóa trị chưa liên kết.
                            </p>
                          )}
                        </button>

                        <div className="grid grid-cols-3 gap-2.5 text-xs tabular-nums">
                          <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 p-3">
                            <p className="text-[11px] text-[#475B78] dark:text-[#B4C7E2]">Đến hạn hôm nay</p>
                            <p className="mt-1 font-display text-base font-bold text-[#16243E] dark:text-[#E6EFFC]">
                              12 câu
                            </p>
                          </div>
                          <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 p-3">
                            <p className="text-[11px] text-[#475B78] dark:text-[#B4C7E2]">Sprint nhanh</p>
                            <p className="mt-1 font-display text-base font-bold text-[#16243E] dark:text-[#E6EFFC]">
                              10 phút
                            </p>
                          </div>
                          <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 p-3">
                            <p className="text-[11px] text-[#475B78] dark:text-[#B4C7E2]">Đã ghi nhớ vững</p>
                            <p className="mt-1 font-display text-base font-bold text-emerald-700 dark:text-emerald-400">
                              68%
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    {activeModule.id === 'analytics-admin' && (
                      <div className="space-y-4">
                        <div className="rounded-2xl border border-sky-200/75 dark:border-slate-700/80 bg-white/80 dark:bg-slate-900/70 p-4 space-y-3">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-[#16243E] dark:text-[#E6EFFC]">
                              Tiến độ nắm vững theo chương
                            </span>
                            <span className="text-[11px] text-[#475B78] dark:text-[#B4C7E2]">
                              Cập nhật tự động sau mỗi lần chấm & thi
                            </span>
                          </div>
                          {[
                            { name: 'Hóa 10 · Chương 3: Liên kết hóa học', pct: 84, bar: 'bg-emerald-500' },
                            { name: 'Vật lý 11 · Chương 1: Dao động điều hòa', pct: 72, bar: 'bg-indigo-500' },
                            { name: 'Toán 12 · Chương 1: Khảo sát hàm số', pct: 91, bar: 'bg-sky-500' },
                          ].map((row) => (
                            <div key={row.name}>
                              <div className="flex items-center justify-between gap-2 text-xs mb-1">
                                <span className="text-[#16243E] dark:text-[#E6EFFC] truncate">{row.name}</span>
                                <span className="font-mono font-semibold text-[#16243E] dark:text-[#E6EFFC] tabular-nums shrink-0">
                                  {row.pct}%
                                </span>
                              </div>
                              <div className="h-1.5 w-full rounded-full bg-slate-200/80 dark:bg-slate-800 overflow-hidden">
                                <div className={`h-full rounded-full ${row.bar}`} style={{ width: `${row.pct}%` }} />
                              </div>
                            </div>
                          ))}
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                          <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/75 dark:bg-slate-900/65 p-3.5 flex items-start gap-2.5">
                            <BookMarked className="w-4 h-4 text-sky-700 dark:text-sky-400 shrink-0 mt-0.5" />
                            <div>
                              <p className="font-semibold text-[#16243E] dark:text-[#E6EFFC]">Kho SGK chuẩn GDPT 2018</p>
                              <p className="mt-0.5 text-[#475B78] dark:text-[#B4C7E2]">
                                Quản trị viên nạp PDF sách giáo khoa để hệ thống trích dẫn đúng số trang.
                              </p>
                            </div>
                          </div>
                          <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/75 dark:bg-slate-900/65 p-3.5 flex items-start gap-2.5">
                            <ShieldCheck className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />
                            <div>
                              <p className="font-semibold text-[#16243E] dark:text-[#E6EFFC]">Phân quyền & Privacy Blur</p>
                              <p className="mt-0.5 text-[#475B78] dark:text-[#B4C7E2]">
                                Tách rõ Học sinh và Super Admin; nhấn Ctrl+H để ẩn dữ liệu nhạy cảm.
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>

            {/* Highlights + Direct Entry to Part 2 (Auth) */}
            <div className="mt-5 pt-4 border-t border-sky-200/60 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <ul className="space-y-1 text-xs text-[#475B78] dark:text-[#B4C7E2]">
                {activeModule.highlights.map((pt) => (
                  <li key={pt} className="flex items-start gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                    <span>{pt}</span>
                  </li>
                ))}
              </ul>

              <WaterRippleButton
                size="sm"
                onClick={() => onOpenAuth('login')}
                className={`shrink-0 min-h-[42px] px-4 ${
                  isEthereal
                    ? '!bg-gradient-to-r !from-[#4338CA] !via-[#4F46E5] !to-[#6366F1]'
                    : ''
                }`}
              >
                <span>Mở tính năng này</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </WaterRippleButton>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
