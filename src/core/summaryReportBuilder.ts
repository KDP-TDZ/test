import {
  SUBJECT_LABELS,
  type AnalysisRecord,
  type ClaimStatus,
  type CoverageStatus,
} from './types';
import { buildErrorCorrectionQueue } from './verificationStepper';

export interface StudentCorrectionEntry {
  studentText: string;
  resolved: boolean;
  updatedAt?: string;
}

export interface SummaryReportBuildOptions {
  confirmed: boolean;
  confirmedAt?: string;
  includeStudentCorrections?: boolean;
  includeCoverageAndSources?: boolean;
  customNote?: string;
  correctionsMap?: Record<string, StudentCorrectionEntry>;
  generatedByName?: string;
}

export interface SummaryReportClaimRow {
  index: number;
  claimId: string;
  concept: string;
  chapter: string;
  sourcePage: number;
  status: ClaimStatus;
  statusLabel: string;
  sourceText: string;
  explanation: string;
  correctKnowledge: string;
  suggestedFix: string;
  studentFixText: string;
  studentResolved: boolean;
  evidencesSummary: string;
}

export interface SummaryReportCoverageRow {
  index: number;
  itemId: string;
  concept: string;
  chapter: string;
  referencePage?: number;
  status: CoverageStatus;
  statusLabel: string;
  suggestedAddition: string;
  referenceExcerpt: string;
  studentFixText: string;
  studentResolved: boolean;
}

export interface VerificationSummaryReport {
  analysisId: string;
  confirmedAt: string;
  confirmedAtDisplay: string;
  analyzedAtDisplay: string;
  fileBaseName: string;
  documentTitle: string;
  originalFileName: string;
  subjectLabel: string;
  grade: string;
  textbookTitle: string;
  scope: string;
  generatedByName: string;
  customNote: string;
  includeStudentCorrections: boolean;
  includeCoverageAndSources: boolean;
  metrics: {
    accuracyScore: number | null;
    accuracyScoreDisplay: string;
    completenessScore: number | null;
    completenessScoreDisplay: string;
    evidenceCoverage: number | null;
    evidenceCoverageDisplay: string;
    confidenceLevel: string;
    confidenceReason: string;
    totalClaims: number;
    correctCount: number;
    partialCount: number;
    incorrectCount: number;
    missingCount: number;
    unverifiedCount: number;
    totalCoverageItems: number;
    coveredCount: number;
    partialCoverageCount: number;
    missingCoverageCount: number;
    actionableTotal: number;
    resolvedCorrectionsCount: number;
  };
  claims: SummaryReportClaimRow[];
  coverageItems: SummaryReportCoverageRow[];
  strengths: Array<{
    title: string;
    detail: string;
    sourceExcerpt: string;
    pageNumber: number;
  }>;
  weaknesses: Array<{
    title: string;
    categoryLabel: string;
    detail: string;
    pageNumber?: number;
  }>;
  suggestions: Array<{
    priority: number;
    title: string;
    description: string;
  }>;
  webSources: Array<{
    title: string;
    domain: string;
    url: string;
  }>;
}

export const CLAIM_STATUS_VI_LABELS: Record<ClaimStatus, string> = {
  CORRECT: 'Chính xác',
  PARTIALLY_CORRECT: 'Thiếu điều kiện / Một phần',
  INCORRECT: 'Sai kiến thức / Công thức',
  MISSING: 'Thiếu ý trọng tâm',
  UNVERIFIED: 'Chưa đủ căn cứ',
  AMBIGUOUS: 'Diễn đạt chưa rõ',
  OCR_UNCERTAIN: 'Chữ OCR chưa rõ',
  OUT_OF_SCOPE: 'Ngoài phạm vi',
};

export const COVERAGE_STATUS_VI_LABELS: Record<CoverageStatus, string> = {
  COVERED: 'Đã bao phủ',
  PARTIALLY_COVERED: 'Bao phủ một phần',
  MISSING: 'Còn thiếu',
  OUT_OF_SCOPE: 'Ngoài phạm vi',
};

const WEAKNESS_CATEGORY_LABELS: Record<string, string> = {
  knowledge_error: 'Sai kiến thức / Công thức',
  missing_content: 'Thiếu nội dung trọng tâm',
  partial_condition: 'Thiếu điều kiện áp dụng',
  unverified: 'Chưa đủ dẫn chứng',
  presentation: 'Trình bày',
};

export function sanitizeSummaryFileBaseName(title: string, dateIso: string): string {
  const ascii = title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);

  const datePart = (dateIso || new Date().toISOString()).slice(0, 10).replace(/-/g, '');
  const safeSlug = ascii || 'Tai_lieu';
  return `Ban_Tong_Ket_${safeSlug}_${datePart}`;
}

function formatViDateTime(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString('vi-VN');
}

export function buildVerificationSummaryReport(
  analysis: AnalysisRecord,
  options: SummaryReportBuildOptions
): VerificationSummaryReport {
  if (!options.confirmed) {
    throw new Error('Cần xác nhận của người dùng trước khi tạo bản tổng kết kiểm định.');
  }

  const confirmedAt = options.confirmedAt || new Date().toISOString();
  const includeStudentCorrections = options.includeStudentCorrections ?? true;
  const includeCoverageAndSources = options.includeCoverageAndSources ?? true;
  const correctionsMap = options.correctionsMap || {};
  const actionableQueue = buildErrorCorrectionQueue(analysis);
  const resolvedCorrectionsCount = actionableQueue.filter((item) =>
    Boolean(correctionsMap[item.id]?.resolved)
  ).length;

  const claims: SummaryReportClaimRow[] = analysis.claims.map((claim, idx) => {
    const corr = includeStudentCorrections ? correctionsMap[`claim:${claim.claimId}`] : undefined;
    const evidencesSummary = (claim.evidences || [])
      .map((ev) => {
        const pageStr = ev.pageNumber ? ` (Tr. ${ev.pageNumber})` : '';
        return `${ev.title}${pageStr}: "${ev.excerpt}"`;
      })
      .join(' | ');

    return {
      index: idx + 1,
      claimId: claim.claimId,
      concept: claim.concept || 'Nội dung kiểm định',
      chapter: claim.chapter || analysis.scope || SUBJECT_LABELS[analysis.subject],
      sourcePage: claim.sourcePage || 1,
      status: claim.evaluationStatus,
      statusLabel: CLAIM_STATUS_VI_LABELS[claim.evaluationStatus] || claim.evaluationStatus,
      sourceText: claim.sourceText || '',
      explanation: claim.explanation || '',
      correctKnowledge: claim.correctKnowledge || '',
      suggestedFix: claim.suggestedFix || claim.correctKnowledge || '',
      studentFixText: corr?.studentText?.trim() || '',
      studentResolved: Boolean(corr?.resolved),
      evidencesSummary,
    };
  });

  const coverageItems: SummaryReportCoverageRow[] = includeCoverageAndSources
    ? analysis.coverageItems.map((cov, idx) => {
        const corr = includeStudentCorrections
          ? correctionsMap[`coverage:${cov.itemId}`]
          : undefined;
        return {
          index: idx + 1,
          itemId: cov.itemId,
          concept: cov.concept,
          chapter: cov.chapter,
          referencePage: cov.referencePage,
          status: cov.status,
          statusLabel: COVERAGE_STATUS_VI_LABELS[cov.status] || cov.status,
          suggestedAddition: cov.suggestedAddition || '',
          referenceExcerpt: cov.referenceExcerpt || '',
          studentFixText: corr?.studentText?.trim() || '',
          studentResolved: Boolean(corr?.resolved),
        };
      })
    : [];

  const correctCount = analysis.claims.filter((c) => c.evaluationStatus === 'CORRECT').length;
  const partialCount = analysis.claims.filter(
    (c) => c.evaluationStatus === 'PARTIALLY_CORRECT'
  ).length;
  const incorrectCount = analysis.claims.filter((c) => c.evaluationStatus === 'INCORRECT').length;
  const missingCount = analysis.claims.filter((c) => c.evaluationStatus === 'MISSING').length;
  const unverifiedCount = analysis.claims.filter(
    (c) =>
      c.evaluationStatus === 'UNVERIFIED' ||
      c.evaluationStatus === 'AMBIGUOUS' ||
      c.evaluationStatus === 'OCR_UNCERTAIN' ||
      c.evaluationStatus === 'OUT_OF_SCOPE'
  ).length;

  const coveredCount = analysis.coverageItems.filter((i) => i.status === 'COVERED').length;
  const partialCoverageCount = analysis.coverageItems.filter(
    (i) => i.status === 'PARTIALLY_COVERED'
  ).length;
  const missingCoverageCount = analysis.coverageItems.filter((i) => i.status === 'MISSING').length;

  return {
    analysisId: analysis.analysisId,
    confirmedAt,
    confirmedAtDisplay: formatViDateTime(confirmedAt),
    analyzedAtDisplay: formatViDateTime(analysis.createdAt),
    fileBaseName: sanitizeSummaryFileBaseName(analysis.documentTitle, confirmedAt),
    documentTitle: analysis.documentTitle,
    originalFileName: analysis.originalFileName,
    subjectLabel: SUBJECT_LABELS[analysis.subject],
    grade: analysis.grade,
    textbookTitle: analysis.textbookTitle || 'Đối chiếu chương trình phổ thông (GDPT 2018)',
    scope: analysis.scope || (analysis.selectedChapters || []).join(', ') || 'Toàn bộ tài liệu',
    generatedByName: (options.generatedByName || '').trim() || 'Học sinh StudyCheck AI',
    customNote: (options.customNote || '').trim(),
    includeStudentCorrections,
    includeCoverageAndSources,
    metrics: {
      accuracyScore: analysis.accuracyScore,
      accuracyScoreDisplay:
        analysis.accuracyScore !== null ? `${analysis.accuracyScore}%` : 'Chưa đủ dữ liệu',
      completenessScore: analysis.completenessScore,
      completenessScoreDisplay:
        analysis.completenessScore !== null ? `${analysis.completenessScore}%` : 'Không áp dụng',
      evidenceCoverage: analysis.evidenceCoverage,
      evidenceCoverageDisplay:
        analysis.evidenceCoverage !== null ? `${analysis.evidenceCoverage}%` : '—',
      confidenceLevel: analysis.confidenceLevel,
      confidenceReason: analysis.confidenceReason || '',
      totalClaims: analysis.claims.length,
      correctCount,
      partialCount,
      incorrectCount,
      missingCount,
      unverifiedCount,
      totalCoverageItems: analysis.coverageItems.length,
      coveredCount,
      partialCoverageCount,
      missingCoverageCount,
      actionableTotal: actionableQueue.length,
      resolvedCorrectionsCount,
    },
    claims,
    coverageItems,
    strengths: analysis.strengths.map((s) => ({
      title: s.title,
      detail: s.detail,
      sourceExcerpt: s.sourceExcerpt,
      pageNumber: s.pageNumber,
    })),
    weaknesses: analysis.weaknesses.map((w) => ({
      title: w.title,
      categoryLabel: WEAKNESS_CATEGORY_LABELS[w.category] || w.category,
      detail: w.detail,
      pageNumber: w.pageNumber,
    })),
    suggestions: [...analysis.suggestions]
      .sort((a, b) => (a.priority || 99) - (b.priority || 99))
      .map((sg, idx) => ({
        priority: sg.priority || idx + 1,
        title: sg.title,
        description: sg.description,
      })),
    webSources: includeCoverageAndSources
      ? (analysis.webSources || []).map((src) => ({
          title: src.title,
          domain: src.domain || '',
          url: src.url || '',
        }))
      : [],
  };
}

export function formatSummaryReportAsTxt(report: VerificationSummaryReport): string {
  const lines: string[] = [];
  const hr = '========================================================================';
  const subHr = '------------------------------------------------------------------------';

  lines.push(hr);
  lines.push('BẢN TỔNG KẾT KIỂM ĐỊNH KIẾN THỨC — STUDYCHECK AI');
  lines.push(hr);
  lines.push(`Tài liệu         : ${report.documentTitle}`);
  if (report.originalFileName && report.originalFileName !== report.documentTitle) {
    lines.push(`Tệp gốc          : ${report.originalFileName}`);
  }
  lines.push(`Môn học / Lớp    : ${report.subjectLabel} · Lớp ${report.grade}`);
  lines.push(`Nguồn đối chiếu  : ${report.textbookTitle}`);
  lines.push(`Phạm vi kiểm định: ${report.scope}`);
  lines.push(`Thời gian chấm   : ${report.analyzedAtDisplay}`);
  lines.push(`Xác nhận tạo lúc : ${report.confirmedAtDisplay}`);
  lines.push(`Người xuất       : ${report.generatedByName}`);
  if (report.customNote) {
    lines.push(`Ghi chú cá nhân  : ${report.customNote}`);
  }
  lines.push('');

  lines.push('1. CHỈ SỐ ĐÁNH GIÁ ĐỘC LẬP');
  lines.push(subHr);
  lines.push(`- Độ chính xác (Accuracy)     : ${report.metrics.accuracyScoreDisplay}`);
  lines.push(`- Độ đầy đủ (Completeness)    : ${report.metrics.completenessScoreDisplay}`);
  lines.push(`- Tỷ lệ có dẫn chứng          : ${report.metrics.evidenceCoverageDisplay}`);
  lines.push(`- Mức độ tin cậy              : ${report.metrics.confidenceLevel}`);
  if (report.metrics.confidenceReason) {
    lines.push(`  Lý do tin cậy               : ${report.metrics.confidenceReason}`);
  }
  lines.push(
    `- Thống kê mệnh đề (${report.metrics.totalClaims})   : ${report.metrics.correctCount} đúng · ${report.metrics.incorrectCount} sai · ${report.metrics.partialCount} thiếu điều kiện · ${report.metrics.missingCount} thiếu ý · ${report.metrics.unverifiedCount} chưa đủ căn cứ/khác`
  );
  if (report.includeStudentCorrections && report.metrics.actionableTotal > 0) {
    lines.push(
      `- Tiến độ tự sửa (Bước 4)     : Đã đánh dấu sửa ${report.metrics.resolvedCorrectionsCount}/${report.metrics.actionableTotal} mục`
    );
  }
  lines.push('');

  lines.push(`2. ĐIỂM MẠNH ĐÃ THỂ HIỆN (${report.strengths.length})`);
  lines.push(subHr);
  if (report.strengths.length === 0) {
    lines.push('  (Chưa ghi nhận điểm mạnh nổi bật đủ căn cứ.)');
  } else {
    report.strengths.forEach((s, idx) => {
      lines.push(`  ${idx + 1}. ${s.title}${s.pageNumber ? ` (Tr. ${s.pageNumber})` : ''}`);
      lines.push(`     ${s.detail}`);
      if (s.sourceExcerpt) {
        lines.push(`     Trích dẫn: "${s.sourceExcerpt}"`);
      }
    });
  }
  lines.push('');

  lines.push(`3. ĐIỂM CẦN KHẮC PHỤC (${report.weaknesses.length})`);
  lines.push(subHr);
  if (report.weaknesses.length === 0) {
    lines.push('  (Không phát hiện lỗ hổng hay lỗi sai nghiêm trọng.)');
  } else {
    report.weaknesses.forEach((w, idx) => {
      lines.push(
        `  ${idx + 1}. [${w.categoryLabel}] ${w.title}${w.pageNumber ? ` (Tr. ${w.pageNumber})` : ''}`
      );
      lines.push(`     ${w.detail}`);
    });
  }
  lines.push('');

  lines.push(`4. GỢI Ý CẢI THIỆN THEO THỨ TỰ ƯU TIÊN (${report.suggestions.length})`);
  lines.push(subHr);
  if (report.suggestions.length === 0) {
    lines.push('  (Tiếp tục ôn tập đều qua bộ câu hỏi trắc nghiệm.)');
  } else {
    report.suggestions.forEach((sg) => {
      lines.push(`  #${sg.priority}. ${sg.title}`);
      lines.push(`      ${sg.description}`);
    });
  }
  lines.push('');

  lines.push(`5. CHI TIẾT TỪNG MỆNH ĐỀ ĐÃ KIỂM ĐỊNH (${report.claims.length})`);
  lines.push(subHr);
  if (report.claims.length === 0) {
    lines.push('  (Không có mệnh đề trích xuất.)');
  } else {
    report.claims.forEach((c) => {
      lines.push(`  #${c.index} [${c.statusLabel}] ${c.concept} · ${c.chapter} (Tr. ${c.sourcePage})`);
      lines.push(`     - Trích đoạn bài làm : "${c.sourceText}"`);
      lines.push(`     - Giải thích         : ${c.explanation}`);
      if (c.suggestedFix || c.correctKnowledge) {
        lines.push(`     - Kiến thức / Sửa    : ${c.suggestedFix || c.correctKnowledge}`);
      }
      if (c.evidencesSummary) {
        lines.push(`     - Dẫn chứng          : ${c.evidencesSummary}`);
      }
      if (report.includeStudentCorrections && c.status !== 'CORRECT') {
        const statusMark = c.studentResolved ? 'Đã đánh dấu sửa xong' : 'Chưa đánh dấu sửa';
        lines.push(`     - Tự sửa (Bước 4)    : [${statusMark}] ${c.studentFixText || '(Chưa nhập)'}`);
      }
    });
  }
  lines.push('');

  if (report.includeCoverageAndSources) {
    lines.push(`6. BẢNG KIỂM ĐỘ BAO PHỦ KIẾN THỨC CHƯƠNG (${report.coverageItems.length})`);
    lines.push(subHr);
    if (report.coverageItems.length === 0) {
      lines.push('  (Không áp dụng danh sách mục tiêu chương cụ thể.)');
    } else {
      report.coverageItems.forEach((cov) => {
        const pageStr = cov.referencePage ? ` · SGK Tr. ${cov.referencePage}` : '';
        lines.push(`  ${cov.index}. [${cov.statusLabel}] ${cov.concept} (${cov.chapter}${pageStr})`);
        if (cov.status !== 'COVERED' && cov.suggestedAddition) {
          lines.push(`     Cần bổ sung: ${cov.suggestedAddition}`);
        }
        if (report.includeStudentCorrections && cov.status !== 'COVERED' && cov.studentFixText) {
          lines.push(`     Ghi chú tự bổ sung: ${cov.studentFixText}`);
        }
      });
    }
    lines.push('');

    if (report.webSources.length > 0) {
      lines.push(`7. NGUỒN THAM KHẢO BỔ SUNG (${report.webSources.length})`);
      lines.push(subHr);
      report.webSources.forEach((src, idx) => {
        lines.push(`  ${idx + 1}. ${src.title} (${src.domain || src.url})`);
        if (src.url) lines.push(`     ${src.url}`);
      });
      lines.push('');
    }
  }

  lines.push(hr);
  lines.push('Xuất từ hệ thống StudyCheck AI — Kiểm chứng tài liệu & Phân tích kiến thức');
  lines.push(hr);

  return lines.join('\n');
}
