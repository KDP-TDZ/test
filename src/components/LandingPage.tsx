import React, { useState } from 'react';
import {
  ArrowRight,
  BookOpenCheck,
  CheckCircle2,
  ChevronDown,
  FileSearch,
  Layers,
  Repeat,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import { BRAND_CONFIG } from '../config/brand';
import heroPrismImage from '../assets/images/hero_liquid_prism_1795012421683.jpg';
import { GlassSurface } from './LiquidGlass/GlassSurface';
import { WaterRippleButton } from './LiquidGlass/WaterRippleButton';

interface LandingPageProps {
  onOpenAuth: (mode: 'login' | 'register') => void;
}

const SPECIMEN_ANNOTATIONS = [
  {
    id: 'err-1',
    color: 'red' as const,
    label: 'Kiến thức sai',
    studentExcerpt: 'Liên kết hydrogen chỉ hình thành giữa nguyên tử H và nguyên tử C hoặc N.',
    correctKnowledge:
      'Liên kết hydrogen hình thành giữa nguyên tử H (đã liên kết với nguyên tử có độ âm điện lớn như F, O, N) với nguyên tử khác có độ âm điện lớn (F, O, N) và còn cặp electron hóa trị chưa liên kết.',
    reason: 'Nguyên tử Carbon (C) có độ âm điện nhỏ (2,55), không đủ phân cực liên kết C–H để tạo liên kết hydrogen điển hình.',
    source: 'SGK Hóa học 10 · Chương 3 · Trang 54',
  },
  {
    id: 'part-1',
    color: 'orange' as const,
    label: 'Đúng một phần · Thiếu điều kiện',
    studentExcerpt: 'Nước có nhiệt độ sôi cao hơn H₂S vì phân tử nước có liên kết hydrogen.',
    correctKnowledge:
      'Nhận định đúng về xu hướng nhưng cần nêu rõ: liên kết hydrogen liên phân tử làm tăng năng lượng cần thiết để tách các phân tử nước khi chuyển pha.',
    reason: 'Cần phân biệt liên kết hydrogen liên phân tử (tăng nhiệt độ sôi) với liên kết nội phân tử.',
    source: 'SGK Hóa học 10 · Chương 3 · Trang 55',
  },
  {
    id: 'ok-1',
    color: 'green' as const,
    label: 'Kiến thức chính xác',
    studentExcerpt: 'Liên kết hydrogen yếu hơn liên kết cộng hóa trị nhưng mạnh hơn tương tác van der Waals.',
    correctKnowledge: 'Thứ tự độ bền liên kết được trình bày chính xác theo chuẩn chương trình.',
    reason: 'Năng lượng liên kết hydrogen thường từ 10–40 kJ/mol, nhỏ hơn liên kết cộng hóa trị nhưng lớn hơn tương tác van der Waals.',
    source: 'SGK Hóa học 10 · Bài 11 · Trang 56',
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
    q: 'Câu hỏi làm sai trong bài trắc nghiệm được lưu giữ như thế nào?',
    a: 'Mọi câu trả lời sai được tự động đưa vào Ngân hàng luyện tập cá nhân trên Firebase. Khi bạn trả lời đúng lại nhiều lần, trạng thái tiến bộ sẽ cập nhật nhưng câu hỏi không bao giờ bị tự động xóa — chỉ bạn mới có quyền xóa thủ công.',
  },
  {
    q: 'Hệ thống lấy nguồn kiến thức từ đâu để kiểm chứng?',
    a: 'Ưu tiên hàng đầu là bộ sách giáo khoa chuẩn do quản trị viên lập chỉ mục theo từng lớp và bộ sách. Với kiến thức nâng cao ngoài sách, hệ thống sử dụng Google Search Grounding kèm đường dẫn trích dẫn thực tế.',
  },
];

export const LandingPage: React.FC<LandingPageProps> = ({ onOpenAuth }) => {
  const [selectedSpecimenId, setSelectedSpecimenId] = useState<string>('err-1');
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(0);
  const [heroImgError, setHeroImgError] = useState(false);

  const activeSpecimen =
    SPECIMEN_ANNOTATIONS.find((s) => s.id === selectedSpecimenId) || SPECIMEN_ANNOTATIONS[0];

  return (
    <div className="flex flex-col min-h-screen">
      {/* Strict 3-zone Top Bar Contract */}
      <header className="sticky top-0 z-40 glass-nav">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
          <a
            href="#top"
            className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            {BRAND_CONFIG.name}
          </a>

          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600">
            <a href="#workflow" className="hover:text-slate-950 transition-colors whitespace-nowrap shrink-0">
              Quy trình
            </a>
            <a href="#specimen" className="hover:text-slate-950 transition-colors whitespace-nowrap shrink-0">
              Tính năng
            </a>
            <a href="#practice" className="hover:text-slate-950 transition-colors whitespace-nowrap shrink-0">
              Luyện tập
            </a>
            <a href="#faq" className="hover:text-slate-950 transition-colors whitespace-nowrap shrink-0">
              Hỏi đáp
            </a>
          </nav>

          <div className="shrink-0">
            <WaterRippleButton size="sm" onClick={() => onOpenAuth('login')}>
              Đăng nhập
            </WaterRippleButton>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main id="top" className="flex-1">
        <section className="mx-auto max-w-7xl px-4 sm:px-6 pt-12 pb-16 lg:pt-20 lg:pb-24">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-stretch">
            <div className="lg:col-span-6 flex flex-col justify-center">
              <p className="text-xs font-medium text-sky-700 tracking-wide mb-3">
                Nền tảng kiểm chứng học tập THPT · Lớp 10 · 11 · 12
              </p>
              <h1 className="font-display text-3xl sm:text-4xl lg:text-[2.85rem] font-bold tracking-tight text-slate-950 leading-[1.15] [text-wrap:balance]">
                Đừng chỉ học thuộc. Hãy kiểm chứng những gì bạn học.
              </h1>
              <p className="mt-5 text-base sm:text-lg text-slate-600 leading-relaxed max-w-xl">
                Tải tài liệu của bạn lên, đối chiếu với nguồn kiến thức chuẩn, phát hiện chỗ sai và
                tìm ra những gì còn thiếu.
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-4">
                <WaterRippleButton size="lg" onClick={() => onOpenAuth('login')}>
                  <Upload className="w-4 h-4" />
                  Tải tài liệu lên
                </WaterRippleButton>
                <button
                  type="button"
                  onClick={() => onOpenAuth('register')}
                  className="inline-flex items-center gap-1.5 px-4 py-3 text-sm font-medium text-slate-700 hover:text-sky-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Tạo tài khoản mới
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>

              <div className="mt-8 pt-6 border-t border-slate-200/80 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-600">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-sky-600" aria-hidden="true" />
                  Nhận diện PDF, DOCX & chữ viết tay
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-sky-600" aria-hidden="true" />
                  Đối chiếu sách giáo khoa theo bộ
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-sky-600" aria-hidden="true" />
                  Trắc nghiệm & thống kê ghi nhớ
                </span>
              </div>
            </div>

            <div className="lg:col-span-6">
              <GlassSurface enableRipple className="h-full rounded-3xl p-2 flex flex-col">
                <div className="relative w-full h-full min-h-[280px] sm:min-h-[340px] rounded-2xl overflow-hidden bg-gradient-to-br from-sky-50 via-white to-indigo-50">
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
                        <BookOpenCheck className="w-12 h-12 text-sky-600 mx-auto mb-3" />
                        <p className="text-sm font-medium text-slate-700">
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

        {/* Workflow Section */}
        <section id="workflow" className="mx-auto max-w-7xl px-4 sm:px-6 py-16 border-t border-slate-200/70">
          <div className="max-w-2xl mb-10">
            <h2 className="font-display text-2xl sm:text-3xl font-bold text-slate-950 [text-wrap:balance]">
              Chu trình học tập khép kín từ tài liệu ghi chép đến nắm vững kiến thức
            </h2>
            <p className="mt-3 text-sm sm:text-base text-slate-600">
              Không chỉ chấm điểm, StudyCheck AI đồng hành qua từng bước kiểm chứng có dẫn chứng và
              ôn luyện có mục tiêu.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              {
                num: '01.',
                icon: Upload,
                title: 'Tải lên & Kiểm tra OCR',
                desc: 'Hỗ trợ ảnh chụp vở viết tay, PDF scan, PDF văn bản và DOCX. Cho phép rà soát và sửa chữ nhận diện trước khi chấm.',
              },
              {
                num: '02.',
                icon: FileSearch,
                title: 'Đối chiếu nguồn chuẩn',
                desc: 'Tách thành từng mệnh đề kiến thức, tra cứu đúng bộ sách giáo khoa đã chọn và tìm nguồn học thuật qua Google Search khi cần.',
              },
              {
                num: '03.',
                icon: Layers,
                title: 'Tách biệt Chính xác & Đầy đủ',
                desc: 'Đo riêng tỷ lệ chính xác trên phần đã viết và độ bao phủ so với khung kiến thức chương, khoanh vùng trực tiếp trên tài liệu.',
              },
              {
                num: '04.',
                icon: Repeat,
                title: 'Luyện tập & Thống kê tiến bộ',
                desc: 'Tạo đề trắc nghiệm ABCD từ phần sai hoặc thiếu, lưu vĩnh viễn câu sai để ôn lại và theo dõi mức độ nắm vững theo chương.',
              },
            ].map((step) => {
              const Icon = step.icon;
              return (
                <GlassSurface key={step.num} enableRipple className="rounded-2xl p-6 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <span className="font-mono text-sm font-semibold text-sky-700">{step.num}</span>
                      <Icon className="w-5 h-5 text-slate-500" />
                    </div>
                    <h3 className="font-display text-base font-bold text-slate-900 mb-2">{step.title}</h3>
                    <p className="text-sm text-slate-600 leading-relaxed">{step.desc}</p>
                  </div>
                </GlassSurface>
              );
            })}
          </div>
        </section>

        {/* Interactive Document Annotation Specimen */}
        <section id="specimen" className="mx-auto max-w-7xl px-4 sm:px-6 py-16 border-t border-slate-200/70">
          <div className="max-w-2xl mb-10">
            <p className="text-xs font-medium text-sky-700 mb-2">
              Ví dụ minh họa không gian đối chiếu hai cột
            </p>
            <h2 className="font-display text-2xl sm:text-3xl font-bold text-slate-950 [text-wrap:balance]">
              Nhấn trực tiếp vào từng vùng đánh dấu để xem lý do và dẫn chứng sách giáo khoa
            </h2>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
            {/* Left: Simulated Student Document */}
            <div className="lg:col-span-7 document-paper rounded-2xl p-6 sm:p-8 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between pb-4 mb-5 border-b border-slate-100 text-xs text-slate-500">
                  <span>Tài liệu học sinh · Đề cương Hóa học 10</span>
                  <span className="font-mono">Trang 1 / 1</span>
                </div>

                <h3 className="font-display text-lg font-bold text-slate-900 mb-4">
                  Bài 11: Liên kết hydrogen và tương tác van der Waals
                </h3>

                <div className="space-y-4 text-sm leading-7 text-slate-800">
                  <button
                    type="button"
                    onClick={() => setSelectedSpecimenId('err-1')}
                    className={`w-full text-left px-3 py-2 rounded-lg transition-all cursor-pointer border ${
                      selectedSpecimenId === 'err-1'
                        ? 'bg-rose-50 border-rose-300 ring-2 ring-rose-200'
                        : 'bg-rose-50/60 border-rose-200/70 hover:bg-rose-50'
                    }`}
                  >
                    <span className="font-semibold text-rose-700 mr-2">[Sai]</span>
                    {SPECIMEN_ANNOTATIONS[0].studentExcerpt}
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedSpecimenId('part-1')}
                    className={`w-full text-left px-3 py-2 rounded-lg transition-all cursor-pointer border ${
                      selectedSpecimenId === 'part-1'
                        ? 'bg-amber-50 border-amber-300 ring-2 ring-amber-200'
                        : 'bg-amber-50/60 border-amber-200/70 hover:bg-amber-50'
                    }`}
                  >
                    <span className="font-semibold text-amber-700 mr-2">[Thiếu điều kiện]</span>
                    {SPECIMEN_ANNOTATIONS[1].studentExcerpt}
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedSpecimenId('ok-1')}
                    className={`w-full text-left px-3 py-2 rounded-lg transition-all cursor-pointer border ${
                      selectedSpecimenId === 'ok-1'
                        ? 'bg-emerald-50 border-emerald-300 ring-2 ring-emerald-200'
                        : 'bg-emerald-50/60 border-emerald-200/70 hover:bg-emerald-50'
                    }`}
                  >
                    <span className="font-semibold text-emerald-700 mr-2">[Đúng]</span>
                    {SPECIMEN_ANNOTATIONS[2].studentExcerpt}
                  </button>
                </div>
              </div>

              <div className="mt-6 pt-4 border-t border-slate-100 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-600">
                <span className="inline-flex items-center gap-1.5 text-rose-700 font-medium">
                  <span className="h-2 w-2 rounded-full bg-rose-600" aria-hidden="true" />
                  Đỏ: Lỗi kiến thức
                </span>
                <span className="inline-flex items-center gap-1.5 text-amber-700 font-medium">
                  <span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden="true" />
                  Cam: Đúng một phần
                </span>
                <span className="inline-flex items-center gap-1.5 text-emerald-700 font-medium">
                  <span className="h-2 w-2 rounded-full bg-emerald-600" aria-hidden="true" />
                  Xanh lá: Đã kiểm chứng
                </span>
              </div>
            </div>

            {/* Right: Reference & Explanation Panel */}
            <div className="lg:col-span-5">
              <GlassSurface className="h-full rounded-2xl p-6 sm:p-7 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-4 text-xs">
                    <span
                      className={`font-semibold ${
                        activeSpecimen.color === 'red'
                          ? 'text-rose-700'
                          : activeSpecimen.color === 'orange'
                          ? 'text-amber-700'
                          : 'text-emerald-700'
                      }`}
                    >
                      {activeSpecimen.label}
                    </span>
                    <span className="font-mono text-slate-500">{activeSpecimen.source}</span>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <p className="text-xs font-medium text-slate-500 mb-1">Kiến thức chuẩn theo tài liệu</p>
                      <p className="text-sm text-slate-900 leading-relaxed font-medium bg-emerald-50/70 border border-emerald-200/80 rounded-xl p-3.5">
                        {activeSpecimen.correctKnowledge}
                      </p>
                    </div>

                    <div>
                      <p className="text-xs font-medium text-slate-500 mb-1">Phân tích chi tiết</p>
                      <p className="text-sm text-slate-700 leading-relaxed">{activeSpecimen.reason}</p>
                    </div>
                  </div>
                </div>

                <div className="mt-6 pt-4 border-t border-slate-200/80 flex items-center justify-between text-xs text-slate-600">
                  <span>Nhấp các đoạn bên trái để đối chiếu</span>
                  <button
                    type="button"
                    onClick={() => onOpenAuth('login')}
                    className="font-semibold text-sky-700 hover:text-sky-800 cursor-pointer"
                  >
                    Thử với tài liệu của bạn →
                  </button>
                </div>
              </GlassSurface>
            </div>
          </div>
        </section>

        {/* Practice & Learning Analytics Highlights */}
        <section id="practice" className="mx-auto max-w-7xl px-4 sm:px-6 py-16 border-t border-slate-200/70">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <GlassSurface enableRipple className="rounded-2xl p-7">
              <ShieldCheck className="w-6 h-6 text-sky-700 mb-4" />
              <h3 className="font-display text-xl font-bold text-slate-900 mb-2">
                Ngân hàng luyện tập lưu giữ câu sai dài hạn
              </h3>
              <p className="text-sm text-slate-600 leading-relaxed">
                Mọi câu trắc nghiệm trả lời sai được tự động ghi nhận vào danh sách luyện tập riêng tư.
                Trả lời đúng lại giúp cập nhật trạng thái nắm vững mà không tự xóa mất câu hỏi cho đến
                khi bạn chủ động dọn dẹp.
              </p>
            </GlassSurface>

            <GlassSurface enableRipple className="rounded-2xl p-7">
              <CheckCircle2 className="w-6 h-6 text-indigo-700 mb-4" />
              <h3 className="font-display text-xl font-bold text-slate-900 mb-2">
                Thống kê kiến thức đã học theo môn và chương
              </h3>
              <p className="text-sm text-slate-600 leading-relaxed">
                Theo dõi rõ ràng sự khác biệt giữa khái niệm mới tiếp cận, đang củng cố, cần ôn tập và
                tạm nắm vững dựa trên lịch sử làm bài qua nhiều phiên, không đánh giá vội chỉ sau một câu
                đúng.
              </p>
            </GlassSurface>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="mx-auto max-w-4xl px-4 sm:px-6 py-16 border-t border-slate-200/70">
          <h2 className="font-display text-2xl sm:text-3xl font-bold text-slate-950 mb-8 text-center">
            Câu hỏi thường gặp
          </h2>
          <div className="space-y-3">
            {FAQS.map((item, idx) => {
              const isOpen = openFaqIndex === idx;
              return (
                <div key={item.q} className="glass-surface rounded-2xl overflow-hidden">
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setOpenFaqIndex(isOpen ? null : idx)}
                    className="w-full px-6 py-4 text-left flex items-center justify-between gap-4 font-medium text-sm sm:text-base text-slate-900 cursor-pointer"
                  >
                    <span>{item.q}</span>
                    <ChevronDown
                      className={`w-4 h-4 text-slate-500 shrink-0 transition-transform duration-200 ${
                        isOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </button>
                  {isOpen && (
                    <div className="px-6 pb-5 text-sm text-slate-600 leading-relaxed border-t border-slate-200/60 pt-3">
                      {item.a}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200/80 bg-white/50 backdrop-blur-md">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-600">
          <p>© {new Date().getFullYear()} {BRAND_CONFIG.name}. Nền tảng kiểm chứng học tập THPT.</p>
          <div className="flex items-center gap-4">
            <a href="#workflow" className="hover:text-slate-900">Quy trình</a>
            <span aria-hidden="true">·</span>
            <a href="#specimen" className="hover:text-slate-900">Minh họa</a>
            <span aria-hidden="true">·</span>
            <a href="#faq" className="hover:text-slate-900">Hỏi đáp</a>
          </div>
        </div>
      </footer>
    </div>
  );
};
