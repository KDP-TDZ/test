import React, { useState } from 'react';
import {
  AlertTriangle,
  BookCheck,
  Calculator,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  Globe,
  HelpCircle,
  Lightbulb,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { SUBJECT_LABELS, type AnalysisRecord } from '../core/types';
import { GlassSurface } from './LiquidGlass/GlassSurface';
import { ScoreRing } from './LiquidGlass/ScoreRing';
import { WaterRippleButton } from './LiquidGlass/WaterRippleButton';
import { SplitDocumentViewer } from './SplitDocumentViewer';

interface AnalysisReportViewProps {
  analysis: AnalysisRecord;
  localFile?: File | null;
  onStartQuiz: (analysis: AnalysisRecord) => void;
  onBack?: () => void;
}

export const AnalysisReportView: React.FC<AnalysisReportViewProps> = ({
  analysis,
  localFile,
  onStartQuiz,
  onBack,
}) => {
  const [showFormula, setShowFormula] = useState(false);

  const acc = analysis.accuracyBreakdown;
  const comp = analysis.completenessBreakdown;

  return (
    <div className="space-y-8">
      {/* Header & Explicit Quiz Offer */}
      <GlassSurface className="rounded-3xl p-6 sm:p-7">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          <div>
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                className="text-xs font-medium text-sky-700 hover:underline mb-2 cursor-pointer"
              >
                ← Quay lại danh sách
              </button>
            )}
            <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-950">
              {analysis.documentTitle}
            </h1>
            <p className="text-xs sm:text-sm text-slate-600 mt-1.5">
              {SUBJECT_LABELS[analysis.subject]} · Lớp {analysis.grade} ·{' '}
              {analysis.textbookTitle || 'Đối chiếu chương trình phổ thông'} ·{' '}
              {new Date(analysis.createdAt).toLocaleString('vi-VN')}
            </p>
            {analysis.scope && (
              <p className="text-xs text-slate-500 mt-1">Phạm vi kiểm định: {analysis.scope}</p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <WaterRippleButton size="lg" onClick={() => onStartQuiz(analysis)}>
              <HelpCircle className="w-4 h-4" />
              Tạo bài tập trắc nghiệm ôn tập
            </WaterRippleButton>
          </div>
        </div>
      </GlassSurface>

      {/* Four Independent Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5">
        <GlassSurface className="rounded-2xl p-5">
          <ScoreRing
            label="Độ chính xác (Accuracy)"
            value={analysis.accuracyScore}
            subtitle={
              acc
                ? `${acc.counts.correct} đúng · ${acc.counts.partiallyCorrect} đúng 1 phần · ${acc.counts.incorrect} sai`
                : 'Chỉ chấm trên kiến thức đã viết & kiểm chứng'
            }
            color="sky"
          />
        </GlassSurface>

        <GlassSurface className="rounded-2xl p-5">
          <ScoreRing
            label="Độ đầy đủ (Completeness)"
            value={analysis.completenessScore}
            subtitle={
              comp && comp.totalRequiredWeight > 0
                ? `Đủ ${comp.coveredCount} · Thiếu một phần ${comp.partialCount} · Thiếu ${comp.missingCount}`
                : 'Chưa chọn phạm vi chương/sách tham chiếu'
            }
            color="indigo"
          />
        </GlassSurface>

        <GlassSurface className="rounded-2xl p-5">
          <ScoreRing
            label="Tỷ lệ có dẫn chứng"
            value={analysis.evidenceCoverage}
            subtitle="Tỷ lệ nội dung có nguồn đối chiếu xác thực"
            color="emerald"
          />
        </GlassSurface>

        <GlassSurface className="rounded-2xl p-5 flex flex-col justify-between">
          <div>
            <p className="text-xs font-medium text-slate-500">Mức độ tin cậy đánh giá</p>
            <p className="font-display text-xl font-bold text-slate-950 mt-1">
              {analysis.confidenceLevel}
            </p>
          </div>
          <p className="text-xs text-slate-600 mt-2 leading-relaxed">{analysis.confidenceReason}</p>
        </GlassSurface>
      </div>

      {/* Formula Transparency Drawer */}
      <div className="glass-panel-subtle rounded-2xl overflow-hidden">
        <button
          type="button"
          onClick={() => setShowFormula((v) => !v)}
          className="w-full px-5 py-3.5 flex items-center justify-between text-xs font-semibold text-slate-800 cursor-pointer"
        >
          <span className="inline-flex items-center gap-2">
            <Calculator className="w-4 h-4 text-sky-700" />
            Xem công thức tách biệt Độ chính xác và Độ đầy đủ
          </span>
          <ChevronDown
            className={`w-4 h-4 text-slate-500 transition-transform ${showFormula ? 'rotate-180' : ''}`}
          />
        </button>
        {showFormula && (
          <div className="px-5 pb-4 pt-2 border-t border-slate-200/70 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-slate-700 leading-relaxed">
            <div>
              <p className="font-semibold text-sky-800 mb-1">
                Độ chính xác = Trọng số đúng đạt được / Tổng trọng số đã xác minh
              </p>
              <p>
                Đúng = 1,0 · Đúng một phần = 0,5 · Sai = 0. Các ý không đủ căn cứ kiểm chứng
                (UNVERIFIED), chữ OCR mờ (OCR_UNCERTAIN) hoặc ngoài phạm vi không bị tính vào mẫu số
                để tránh phạt oan.
              </p>
              {acc && (
                <p className="font-mono mt-1.5 text-slate-900">
                  Tính toán thực tế: {acc.earnedWeight} / {acc.verifiedWeight} ={' '}
                  {acc.accuracyScore !== null ? `${acc.accuracyScore}%` : 'Chưa đủ dữ liệu'}
                </p>
              )}
            </div>
            <div>
              <p className="font-semibold text-indigo-800 mb-1">
                Độ đầy đủ = Trọng số ý đã bao phủ / Tổng trọng số khung kiến thức chương
              </p>
              <p>
                Chỉ chấm khi có sách giáo khoa hoặc khung mục tiêu chương rõ ràng. Thiếu ý chỉ ảnh
                hưởng Độ đầy đủ, tuyệt đối không làm giảm Độ chính xác.
              </p>
              {comp && (
                <p className="font-mono mt-1.5 text-slate-900">
                  Tính toán thực tế: {comp.coveredWeight} / {comp.totalRequiredWeight} ={' '}
                  {comp.completenessScore !== null ? `${comp.completenessScore}%` : 'Không áp dụng'}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Explicit Quiz Offer Banner */}
      <GlassSurface enableRipple className="rounded-2xl p-6 border border-sky-200/80">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <Sparkles className="w-6 h-6 text-sky-700 shrink-0 mt-0.5" />
            <div>
              <h2 className="font-display text-base font-bold text-slate-950">
                Bạn có muốn luyện tập với bài trắc nghiệm từ những điểm còn yếu?
              </h2>
              <p className="text-xs text-slate-600 mt-1">
                Tạo bộ câu hỏi ABCD (5 / 10 / 15 / 20 câu) tập trung vào nội dung bạn làm sai hoặc
                còn thiếu. Câu trả lời sai sẽ tự động lưu vào Ngân hàng luyện tập để ôn lại lâu dài.
              </p>
            </div>
          </div>
          <WaterRippleButton onClick={() => onStartQuiz(analysis)}>
            Tạo bài trắc nghiệm ngay
          </WaterRippleButton>
        </div>
      </GlassSurface>

      {/* Split Document & Evidence Workspace */}
      <section className="space-y-3">
        <h2 className="font-display text-xl font-bold text-slate-950">
          Đối chiếu tài liệu & dẫn chứng nguồn chuẩn
        </h2>
        <SplitDocumentViewer analysis={analysis} localFile={localFile} />
      </section>

      {/* Strengths, Weaknesses, Suggestions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <GlassSurface className="rounded-2xl p-6 space-y-4">
          <h3 className="font-display text-base font-bold text-emerald-900 flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            Điểm mạnh đã thể hiện ({analysis.strengths.length})
          </h3>
          {analysis.strengths.length === 0 ? (
            <p className="text-xs text-slate-500">Chưa ghi nhận điểm mạnh nổi bật đủ căn cứ.</p>
          ) : (
            <div className="space-y-3">
              {analysis.strengths.map((s, idx) => (
                <div key={idx} className="rounded-xl bg-emerald-50/70 border border-emerald-200/80 p-3.5 text-xs space-y-1">
                  <p className="font-semibold text-emerald-950">{s.title}</p>
                  <p className="text-slate-700 leading-relaxed">{s.detail}</p>
                  {s.sourceExcerpt && (
                    <p className="text-emerald-800 italic">
                      “{s.sourceExcerpt}” (Tr. {s.pageNumber})
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </GlassSurface>

        <GlassSurface className="rounded-2xl p-6 space-y-4">
          <h3 className="font-display text-base font-bold text-rose-900 flex items-center gap-2">
            <XCircle className="w-5 h-5 text-rose-600" />
            Điểm cần khắc phục ({analysis.weaknesses.length})
          </h3>
          {analysis.weaknesses.length === 0 ? (
            <p className="text-xs text-slate-500">Không phát hiện lỗ hổng hay lỗi sai nghiêm trọng.</p>
          ) : (
            <div className="space-y-3">
              {analysis.weaknesses.map((w, idx) => (
                <div key={idx} className="rounded-xl bg-rose-50/70 border border-rose-200/80 p-3.5 text-xs space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-rose-950">{w.title}</p>
                    {w.pageNumber && <span className="font-mono text-rose-700">Tr. {w.pageNumber}</span>}
                  </div>
                  <p className="text-slate-700 leading-relaxed">{w.detail}</p>
                </div>
              ))}
            </div>
          )}
        </GlassSurface>

        <GlassSurface className="rounded-2xl p-6 space-y-4">
          <h3 className="font-display text-base font-bold text-sky-900 flex items-center gap-2">
            <Lightbulb className="w-5 h-5 text-sky-600" />
            Gợi ý cải thiện theo thứ tự ưu tiên
          </h3>
          {analysis.suggestions.length === 0 ? (
            <p className="text-xs text-slate-500">Tiếp tục ôn tập đều qua bộ câu hỏi trắc nghiệm.</p>
          ) : (
            <div className="space-y-3">
              {analysis.suggestions.map((sg, idx) => (
                <div key={idx} className="rounded-xl bg-sky-50/70 border border-sky-200/80 p-3.5 text-xs space-y-1">
                  <p className="font-semibold text-sky-950">
                    #{sg.priority || idx + 1} · {sg.title}
                  </p>
                  <p className="text-slate-700 leading-relaxed">{sg.description}</p>
                </div>
              ))}
            </div>
          )}
        </GlassSurface>
      </div>

      {/* Coverage Checklist & Grounded Web Sources */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 glass-surface rounded-2xl p-6">
          <h3 className="font-display text-base font-bold text-slate-950 mb-4 flex items-center gap-2">
            <BookCheck className="w-5 h-5 text-indigo-700" />
            Bảng kiểm mức độ bao phủ kiến thức chương ({analysis.coverageItems.length})
          </h3>
          {analysis.coverageItems.length === 0 ? (
            <p className="text-xs text-slate-600">
              Không có danh sách mục tiêu chương cụ thể cho lần phân tích này.
            </p>
          ) : (
            <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
              {analysis.coverageItems.map((cov) => (
                <div
                  key={cov.itemId}
                  className="rounded-xl bg-white/85 border border-slate-200 p-3.5 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-900">{cov.concept}</span>
                    <span
                      className={`font-semibold shrink-0 ${
                        cov.status === 'COVERED'
                          ? 'text-emerald-700'
                          : cov.status === 'PARTIALLY_COVERED'
                          ? 'text-amber-700'
                          : 'text-rose-700'
                      }`}
                    >
                      {cov.status === 'COVERED'
                        ? 'Đã bao phủ'
                        : cov.status === 'PARTIALLY_COVERED'
                        ? 'Thiếu một phần'
                        : 'Còn thiếu'}
                    </span>
                  </div>
                  <p className="text-slate-500 mt-0.5">
                    {cov.chapter}
                    {cov.referencePage ? ` · SGK Tr. ${cov.referencePage}` : ''}
                  </p>
                  {cov.status !== 'COVERED' && cov.suggestedAddition && (
                    <p className="text-slate-700 mt-1.5 bg-amber-50/70 rounded-lg px-2.5 py-1.5">
                      Cần bổ sung: {cov.suggestedAddition}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="lg:col-span-5 glass-surface rounded-2xl p-6">
          <h3 className="font-display text-base font-bold text-slate-950 mb-4 flex items-center gap-2">
            <Globe className="w-5 h-5 text-sky-700" />
            Nguồn tham khảo ngoài sách (Web Grounding)
          </h3>
          {analysis.webGroundingNotice && (
            <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50/80 p-3 text-xs text-amber-900 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <span>{analysis.webGroundingNotice}</span>
            </div>
          )}
          {analysis.webSources.length === 0 ? (
            <p className="text-xs text-slate-600 leading-relaxed">
              {analysis.usedWebGrounding
                ? 'Google Search Grounding không trả về liên kết ngoài bổ sung cho truy vấn này.'
                : 'Phiên kiểm định này chỉ đối chiếu trên bộ sách giáo khoa và kiến thức chuẩn chương trình.'}
            </p>
          ) : (
            <div className="space-y-2.5">
              {analysis.webSources.map((src) => (
                <a
                  key={src.evidenceId}
                  href={src.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block rounded-xl bg-white/85 border border-slate-200 p-3.5 text-xs hover:border-sky-300 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2 font-semibold text-sky-800">
                    <span className="truncate">{src.title}</span>
                    <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                  </div>
                  <p className="text-slate-500 font-mono text-[11px] mt-1 truncate">
                    {src.domain || src.url}
                  </p>
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
