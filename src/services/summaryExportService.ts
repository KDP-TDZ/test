import {
  formatSummaryReportAsTxt,
  type VerificationSummaryReport,
} from '../core/summaryReportBuilder';

export type SummaryExportFormat = 'txt' | 'docx' | 'xlsx' | 'pdf';

function triggerBlobDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function exportSummaryAsTxt(report: VerificationSummaryReport): string {
  const txt = formatSummaryReportAsTxt(report);
  // Prepend UTF-8 BOM so Windows Notepad and Excel recognize Vietnamese characters immediately
  const blob = new Blob(['\uFEFF', txt], { type: 'text/plain;charset=utf-8' });
  const fileName = `${report.fileBaseName}.txt`;
  triggerBlobDownload(blob, fileName);
  return fileName;
}

export async function exportSummaryAsDocx(report: VerificationSummaryReport): Promise<string> {
  const {
    AlignmentType,
    BorderStyle,
    Document,
    HeadingLevel,
    Packer,
    Paragraph,
    ShadingType,
    Table,
    TableCell,
    TableRow,
    TextRun,
    WidthType,
  } = await import('docx');

  const tableBorders = {
    top: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
    bottom: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
    left: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
    right: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
    insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
    insideVertical: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
  };

  const makeCell = (
    text: string,
    opts?: { bold?: boolean; shaded?: boolean; widthPct?: number; color?: string }
  ) =>
    new TableCell({
      width: opts?.widthPct
        ? { size: opts.widthPct, type: WidthType.PERCENTAGE }
        : undefined,
      shading: opts?.shaded
        ? { type: ShadingType.CLEAR, fill: 'EFF6FF', color: 'auto' }
        : undefined,
      margins: { top: 90, bottom: 90, left: 120, right: 120 },
      children: [
        new Paragraph({
          spacing: { after: 40 },
          children: [
            new TextRun({
              text: text || '—',
              bold: opts?.bold,
              color: opts?.color || '1E293B',
              size: 20,
              font: 'Calibri',
            }),
          ],
        }),
      ],
    });

  const makeSectionTitle = (title: string) =>
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 280, after: 120 },
      children: [
        new TextRun({
          text: title,
          bold: true,
          size: 26,
          color: '0E4D5D',
          font: 'Calibri',
        }),
      ],
    });

  const makeBullet = (lead: string, body: string, extra?: string) =>
    new Paragraph({
      spacing: { after: 80 },
      children: [
        new TextRun({ text: '• ', bold: true, size: 21, color: '0284C7', font: 'Calibri' }),
        new TextRun({ text: `${lead}: `, bold: true, size: 21, color: '0F172A', font: 'Calibri' }),
        new TextRun({ text: body, size: 21, color: '334155', font: 'Calibri' }),
        ...(extra
          ? [
              new TextRun({
                text: ` (${extra})`,
                italics: true,
                size: 19,
                color: '64748B',
                font: 'Calibri',
              }),
            ]
          : []),
      ],
    });

  const children: Array<InstanceType<typeof Paragraph> | InstanceType<typeof Table>> = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
      children: [
        new TextRun({
          text: 'BẢN TỔNG KẾT KIỂM ĐỊNH KIẾN THỨC',
          bold: true,
          size: 32,
          color: '0E4D5D',
          font: 'Calibri',
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 220 },
      children: [
        new TextRun({
          text: `Hệ thống StudyCheck AI · Xác nhận tạo lúc ${report.confirmedAtDisplay}`,
          italics: true,
          size: 20,
          color: '475569',
          font: 'Calibri',
        }),
      ],
    }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: tableBorders,
      rows: [
        new TableRow({
          children: [
            makeCell('Tên tài liệu', { bold: true, shaded: true, widthPct: 28 }),
            makeCell(report.documentTitle, { widthPct: 72 }),
          ],
        }),
        new TableRow({
          children: [
            makeCell('Môn học / Lớp', { bold: true, shaded: true, widthPct: 28 }),
            makeCell(`${report.subjectLabel} · Lớp ${report.grade}`, { widthPct: 72 }),
          ],
        }),
        new TableRow({
          children: [
            makeCell('Nguồn đối chiếu', { bold: true, shaded: true, widthPct: 28 }),
            makeCell(report.textbookTitle, { widthPct: 72 }),
          ],
        }),
        new TableRow({
          children: [
            makeCell('Phạm vi kiểm định', { bold: true, shaded: true, widthPct: 28 }),
            makeCell(report.scope, { widthPct: 72 }),
          ],
        }),
        new TableRow({
          children: [
            makeCell('Thời gian kiểm định', { bold: true, shaded: true, widthPct: 28 }),
            makeCell(report.analyzedAtDisplay, { widthPct: 72 }),
          ],
        }),
        new TableRow({
          children: [
            makeCell('Người xuất báo cáo', { bold: true, shaded: true, widthPct: 28 }),
            makeCell(report.generatedByName, { widthPct: 72 }),
          ],
        }),
        ...(report.customNote
          ? [
              new TableRow({
                children: [
                  makeCell('Ghi chú cá nhân', { bold: true, shaded: true, widthPct: 28 }),
                  makeCell(report.customNote, { widthPct: 72 }),
                ],
              }),
            ]
          : []),
      ],
    }),
    makeSectionTitle('1. Chỉ số đánh giá độc lập'),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: tableBorders,
      rows: [
        new TableRow({
          children: [
            makeCell('Độ chính xác (Accuracy)', { bold: true, shaded: true, widthPct: 25 }),
            makeCell('Độ đầy đủ (Completeness)', { bold: true, shaded: true, widthPct: 25 }),
            makeCell('Tỷ lệ có dẫn chứng', { bold: true, shaded: true, widthPct: 25 }),
            makeCell('Mức độ tin cậy', { bold: true, shaded: true, widthPct: 25 }),
          ],
        }),
        new TableRow({
          children: [
            makeCell(report.metrics.accuracyScoreDisplay, { bold: true, color: '0369A1', widthPct: 25 }),
            makeCell(report.metrics.completenessScoreDisplay, { bold: true, color: '0369A1', widthPct: 25 }),
            makeCell(report.metrics.evidenceCoverageDisplay, { bold: true, color: '047857', widthPct: 25 }),
            makeCell(report.metrics.confidenceLevel, { bold: true, widthPct: 25 }),
          ],
        }),
      ],
    }),
    new Paragraph({
      spacing: { before: 100, after: 100 },
      children: [
        new TextRun({
          text: `Thống kê mệnh đề (${report.metrics.totalClaims}): ${report.metrics.correctCount} đúng · ${report.metrics.incorrectCount} sai · ${report.metrics.partialCount} thiếu điều kiện · ${report.metrics.missingCount} thiếu ý · ${report.metrics.unverifiedCount} chưa đủ căn cứ/khác.`,
          size: 20,
          color: '334155',
          font: 'Calibri',
        }),
      ],
    }),
    ...(report.includeStudentCorrections && report.metrics.actionableTotal > 0
      ? [
          new Paragraph({
            spacing: { after: 100 },
            children: [
              new TextRun({
                text: `Tiến độ tự sửa ở Bước 4: Đã đánh dấu sửa ${report.metrics.resolvedCorrectionsCount}/${report.metrics.actionableTotal} mục.`,
                bold: true,
                size: 20,
                color: '047857',
                font: 'Calibri',
              }),
            ],
          }),
        ]
      : []),
    makeSectionTitle(`2. Điểm mạnh đã thể hiện (${report.strengths.length})`),
    ...(report.strengths.length === 0
      ? [
          new Paragraph({
            children: [
              new TextRun({
                text: 'Chưa ghi nhận điểm mạnh nổi bật đủ căn cứ.',
                italics: true,
                size: 20,
                color: '64748B',
                font: 'Calibri',
              }),
            ],
          }),
        ]
      : report.strengths.map((s) =>
          makeBullet(
            s.title,
            s.detail,
            s.pageNumber ? `Tr. ${s.pageNumber}` : undefined
          )
        )),
    makeSectionTitle(`3. Điểm cần khắc phục (${report.weaknesses.length})`),
    ...(report.weaknesses.length === 0
      ? [
          new Paragraph({
            children: [
              new TextRun({
                text: 'Không phát hiện lỗ hổng hay lỗi sai nghiêm trọng.',
                italics: true,
                size: 20,
                color: '64748B',
                font: 'Calibri',
              }),
            ],
          }),
        ]
      : report.weaknesses.map((w) =>
          makeBullet(
            `[${w.categoryLabel}] ${w.title}`,
            w.detail,
            w.pageNumber ? `Tr. ${w.pageNumber}` : undefined
          )
        )),
    makeSectionTitle(`4. Gợi ý cải thiện ưu tiên (${report.suggestions.length})`),
    ...(report.suggestions.length === 0
      ? [
          new Paragraph({
            children: [
              new TextRun({
                text: 'Tiếp tục ôn tập đều qua bộ câu hỏi trắc nghiệm thích ứng.',
                italics: true,
                size: 20,
                color: '64748B',
                font: 'Calibri',
              }),
            ],
          }),
        ]
      : report.suggestions.map((sg) =>
          makeBullet(`#${sg.priority} ${sg.title}`, sg.description)
        )),
    makeSectionTitle(`5. Chi tiết mệnh đề đã kiểm định (${report.claims.length})`),
  ];

  if (report.claims.length === 0) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: 'Không có mệnh đề trích xuất.',
            italics: true,
            size: 20,
            color: '64748B',
            font: 'Calibri',
          }),
        ],
      })
    );
  } else {
    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: tableBorders,
        rows: [
          new TableRow({
            children: [
              makeCell('#', { bold: true, shaded: true, widthPct: 6 }),
              makeCell('Khái niệm / Trạng thái', { bold: true, shaded: true, widthPct: 22 }),
              makeCell('Nội dung bài làm', { bold: true, shaded: true, widthPct: 24 }),
              makeCell('Giải thích & Kiến thức chuẩn', { bold: true, shaded: true, widthPct: 30 }),
              makeCell(
                report.includeStudentCorrections ? 'Tự sửa của học sinh' : 'Dẫn chứng',
                { bold: true, shaded: true, widthPct: 18 }
              ),
            ],
          }),
          ...report.claims.map((c) => {
            const statusColor =
              c.status === 'CORRECT'
                ? '047857'
                : c.status === 'INCORRECT'
                ? 'BE123C'
                : 'B45309';
            const fixAndExplain = [
              c.explanation,
              c.suggestedFix || c.correctKnowledge
                ? `Chuẩn/Gợi ý: ${c.suggestedFix || c.correctKnowledge}`
                : '',
            ]
              .filter(Boolean)
              .join('\n');
            const studentCol = report.includeStudentCorrections
              ? c.status === 'CORRECT'
                ? 'Đạt chuẩn'
                : `${c.studentResolved ? '[Đã sửa] ' : '[Chưa sửa] '}${c.studentFixText || 'Chưa nhập'}`
              : c.evidencesSummary || 'Theo khung SGK';

            return new TableRow({
              children: [
                makeCell(String(c.index), { widthPct: 6 }),
                makeCell(`${c.concept}\n[${c.statusLabel}]\nTr. ${c.sourcePage}`, {
                  bold: true,
                  color: statusColor,
                  widthPct: 22,
                }),
                makeCell(c.sourceText, { widthPct: 24 }),
                makeCell(fixAndExplain, { widthPct: 30 }),
                makeCell(studentCol, { widthPct: 18 }),
              ],
            });
          }),
        ],
      })
    );
  }

  if (report.includeCoverageAndSources) {
    children.push(makeSectionTitle(`6. Bảng kiểm độ bao phủ kiến thức (${report.coverageItems.length})`));
    if (report.coverageItems.length === 0) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: 'Không có danh sách mục tiêu chương cụ thể cho phiên kiểm định này.',
              italics: true,
              size: 20,
              color: '64748B',
              font: 'Calibri',
            }),
          ],
        })
      );
    } else {
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: tableBorders,
          rows: [
            new TableRow({
              children: [
                makeCell('Mục tiêu / Khái niệm', { bold: true, shaded: true, widthPct: 30 }),
                makeCell('Chương', { bold: true, shaded: true, widthPct: 20 }),
                makeCell('Trạng thái', { bold: true, shaded: true, widthPct: 18 }),
                makeCell('Nội dung cần bổ sung', { bold: true, shaded: true, widthPct: 32 }),
              ],
            }),
            ...report.coverageItems.map(
              (cov) =>
                new TableRow({
                  children: [
                    makeCell(cov.concept, { bold: true, widthPct: 30 }),
                    makeCell(
                      `${cov.chapter}${cov.referencePage ? ` (Tr. ${cov.referencePage})` : ''}`,
                      { widthPct: 20 }
                    ),
                    makeCell(cov.statusLabel, { widthPct: 18 }),
                    makeCell(
                      cov.status === 'COVERED'
                        ? 'Đã bao phủ đầy đủ'
                        : cov.suggestedAddition || cov.referenceExcerpt || 'Cần bổ sung',
                      { widthPct: 32 }
                    ),
                  ],
                })
            ),
          ],
        })
      );
    }

    if (report.webSources.length > 0) {
      children.push(makeSectionTitle(`7. Nguồn tham khảo bổ sung (${report.webSources.length})`));
      report.webSources.forEach((src, idx) => {
        children.push(makeBullet(`${idx + 1}. ${src.title}`, src.url || src.domain, src.domain));
      });
    }
  }

  const doc = new Document({
    sections: [
      {
        properties: {},
        children,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const fileName = `${report.fileBaseName}.docx`;
  triggerBlobDownload(blob, fileName);
  return fileName;
}

export async function exportSummaryAsXlsx(report: VerificationSummaryReport): Promise<string> {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  type SheetType = Parameters<typeof writeXlsxFile>[0] extends Array<infer S> ? S : never;
  type RowType = SheetType['data'][number];

  const headerStyle = {
    fontWeight: 'bold' as const,
    backgroundColor: '#E0F2FE',
    textColor: '#0F172A',
    borderColor: '#94A3B8',
    borderStyle: 'thin' as const,
    wrap: true,
    alignVertical: 'center' as const,
  };

  const labelStyle = {
    fontWeight: 'bold' as const,
    backgroundColor: '#F8FAFC',
    textColor: '#1E293B',
    borderColor: '#CBD5E1',
    borderStyle: 'thin' as const,
    wrap: true,
    alignVertical: 'top' as const,
  };

  const bodyStyle = {
    textColor: '#1E293B',
    borderColor: '#CBD5E1',
    borderStyle: 'thin' as const,
    wrap: true,
    alignVertical: 'top' as const,
  };

  // Sheet 1: Tổng quan
  const overviewData: RowType[] = [
    [
      {
        value: 'BẢN TỔNG KẾT KIỂM ĐỊNH KIẾN THỨC — STUDYCHECK AI',
        fontWeight: 'bold',
        fontSize: 14,
        textColor: '#0E4D5D',
        columnSpan: 2,
      },
      null,
    ],
    [{ value: 'Tên tài liệu', ...labelStyle }, { value: report.documentTitle, ...bodyStyle }],
    [{ value: 'Tệp gốc', ...labelStyle }, { value: report.originalFileName || report.documentTitle, ...bodyStyle }],
    [{ value: 'Môn học / Lớp', ...labelStyle }, { value: `${report.subjectLabel} · Lớp ${report.grade}`, ...bodyStyle }],
    [{ value: 'Nguồn đối chiếu', ...labelStyle }, { value: report.textbookTitle, ...bodyStyle }],
    [{ value: 'Phạm vi kiểm định', ...labelStyle }, { value: report.scope, ...bodyStyle }],
    [{ value: 'Thời gian kiểm định', ...labelStyle }, { value: report.analyzedAtDisplay, ...bodyStyle }],
    [{ value: 'Xác nhận tạo bản tổng kết', ...labelStyle }, { value: report.confirmedAtDisplay, ...bodyStyle }],
    [{ value: 'Người xuất báo cáo', ...labelStyle }, { value: report.generatedByName, ...bodyStyle }],
    ...(report.customNote
      ? [[{ value: 'Ghi chú cá nhân', ...labelStyle }, { value: report.customNote, ...bodyStyle }] as RowType]
      : []),
    [null, null],
    [{ value: 'CHỈ SỐ ĐÁNH GIÁ', ...headerStyle }, { value: 'KẾT QUẢ', ...headerStyle }],
    [{ value: 'Độ chính xác (Accuracy)', ...labelStyle }, { value: report.metrics.accuracyScoreDisplay, ...bodyStyle }],
    [{ value: 'Độ đầy đủ (Completeness)', ...labelStyle }, { value: report.metrics.completenessScoreDisplay, ...bodyStyle }],
    [{ value: 'Tỷ lệ có dẫn chứng', ...labelStyle }, { value: report.metrics.evidenceCoverageDisplay, ...bodyStyle }],
    [{ value: 'Mức độ tin cậy', ...labelStyle }, { value: report.metrics.confidenceLevel, ...bodyStyle }],
    [{ value: 'Lý do mức độ tin cậy', ...labelStyle }, { value: report.metrics.confidenceReason, ...bodyStyle }],
    [{ value: 'Tổng mệnh đề đã kiểm định', ...labelStyle }, { value: report.metrics.totalClaims, type: Number, ...bodyStyle }],
    [{ value: 'Số mệnh đề chính xác', ...labelStyle }, { value: report.metrics.correctCount, type: Number, ...bodyStyle }],
    [{ value: 'Số mệnh đề sai kiến thức/CT', ...labelStyle }, { value: report.metrics.incorrectCount, type: Number, ...bodyStyle }],
    [{ value: 'Số mệnh đề thiếu điều kiện', ...labelStyle }, { value: report.metrics.partialCount, type: Number, ...bodyStyle }],
    ...(report.includeStudentCorrections
      ? [
          [
            { value: 'Tiến độ tự sửa (Bước 4)', ...labelStyle },
            {
              value: `${report.metrics.resolvedCorrectionsCount}/${report.metrics.actionableTotal} mục đã đánh dấu sửa`,
              ...bodyStyle,
            },
          ] as RowType,
        ]
      : []),
  ];

  // Sheet 2: Chi tiết mệnh đề
  const claimsHeader: RowType = [
    { value: 'STT', ...headerStyle },
    { value: 'Khái niệm', ...headerStyle },
    { value: 'Chương', ...headerStyle },
    { value: 'Trang', ...headerStyle },
    { value: 'Trạng thái', ...headerStyle },
    { value: 'Trích đoạn bài làm', ...headerStyle },
    { value: 'Giải thích học thuật', ...headerStyle },
    { value: 'Kiến thức chuẩn / Gợi ý sửa', ...headerStyle },
    ...(report.includeStudentCorrections
      ? [
          { value: 'Tự sửa của học sinh', ...headerStyle },
          { value: 'Trạng thái tự sửa', ...headerStyle },
        ]
      : []),
    { value: 'Dẫn chứng SGK / Web', ...headerStyle },
  ];

  const claimsRows: RowType[] = report.claims.map((c) => [
    { value: c.index, type: Number, ...bodyStyle },
    { value: c.concept, ...bodyStyle },
    { value: c.chapter, ...bodyStyle },
    { value: c.sourcePage, type: Number, ...bodyStyle },
    { value: c.statusLabel, ...bodyStyle },
    { value: c.sourceText, ...bodyStyle },
    { value: c.explanation, ...bodyStyle },
    { value: c.suggestedFix || c.correctKnowledge, ...bodyStyle },
    ...(report.includeStudentCorrections
      ? [
          { value: c.studentFixText || '—', ...bodyStyle },
          {
            value:
              c.status === 'CORRECT'
                ? 'Đạt chuẩn'
                : c.studentResolved
                ? 'Đã sửa xong'
                : 'Chưa đánh dấu sửa',
            ...bodyStyle,
          },
        ]
      : []),
    { value: c.evidencesSummary || 'Theo khung SGK', ...bodyStyle },
  ]);

  // Sheet 3: Đánh giá & Bao phủ
  const evalAndCovData: RowType[] = [
    [{ value: 'NHÓM', ...headerStyle }, { value: 'TIÊU ĐỀ / KHÁI NIỆM', ...headerStyle }, { value: 'CHI TIẾT / TRẠNG THÁI', ...headerStyle }],
    ...report.strengths.map(
      (s) =>
        [
          { value: 'Điểm mạnh', ...labelStyle },
          { value: s.title, ...bodyStyle },
          { value: `${s.detail}${s.pageNumber ? ` (Tr. ${s.pageNumber})` : ''}`, ...bodyStyle },
        ] as RowType
    ),
    ...report.weaknesses.map(
      (w) =>
        [
          { value: `Cần khắc phục (${w.categoryLabel})`, ...labelStyle },
          { value: w.title, ...bodyStyle },
          { value: `${w.detail}${w.pageNumber ? ` (Tr. ${w.pageNumber})` : ''}`, ...bodyStyle },
        ] as RowType
    ),
    ...report.suggestions.map(
      (sg) =>
        [
          { value: `Gợi ý #${sg.priority}`, ...labelStyle },
          { value: sg.title, ...bodyStyle },
          { value: sg.description, ...bodyStyle },
        ] as RowType
    ),
    ...(report.includeCoverageAndSources
      ? report.coverageItems.map(
          (cov) =>
            [
              { value: `Bao phủ chương (${cov.statusLabel})`, ...labelStyle },
              {
                value: `${cov.concept} · ${cov.chapter}${cov.referencePage ? ` (Tr. ${cov.referencePage})` : ''}`,
                ...bodyStyle,
              },
              {
                value:
                  cov.status === 'COVERED'
                    ? 'Đã bao phủ đầy đủ'
                    : cov.suggestedAddition || cov.referenceExcerpt,
                ...bodyStyle,
              },
            ] as RowType
        )
      : []),
  ];

  const sheets: SheetType[] = [
    {
      sheet: 'Tổng quan',
      columns: [{ width: 32 }, { width: 72 }],
      data: overviewData,
    },
    {
      sheet: 'Chi tiết mệnh đề',
      columns: [
        { width: 6 },
        { width: 24 },
        { width: 20 },
        { width: 8 },
        { width: 24 },
        { width: 34 },
        { width: 38 },
        { width: 38 },
        ...(report.includeStudentCorrections ? [{ width: 32 }, { width: 18 }] : []),
        { width: 36 },
      ],
      data: [claimsHeader, ...claimsRows],
    },
    {
      sheet: 'Đánh giá & Bao phủ',
      columns: [{ width: 28 }, { width: 36 }, { width: 64 }],
      data: evalAndCovData,
    },
  ];

  const blob = await writeXlsxFile(sheets, {
    fontFamily: 'Calibri',
    fontSize: 11,
  }).toBlob();

  const fileName = `${report.fileBaseName}.xlsx`;
  triggerBlobDownload(blob, fileName);
  return fileName;
}
