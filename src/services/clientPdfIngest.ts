import * as pdfjsLib from 'pdfjs-dist';
import {
  buildChunksFromPages,
  isReadableExtractedPageText,
  parsePageRangeInput,
} from '../core/retrieval';
import type {
  GradeLevel,
  KnowledgeSourceType,
  ReferenceBook,
  ReferenceChunk,
  SourceLicenseStatus,
  SubjectId,
} from '../core/types';
import { authorizedFetch, parseApiResponse } from './apiClient';
import {
  saveReferenceBookProgress,
  saveReferenceBookRecord,
  saveReferenceChunksBatch,
} from './firestoreService';

let workerConfigured = false;

function ensurePdfWorkerConfigured(): void {
  if (workerConfigured || typeof window === 'undefined') return;
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url
    ).toString();
    workerConfigured = true;
  } catch {
    // Fallback if bundler resolves worker differently
    workerConfigured = true;
  }
}

export async function inspectClientPdfPageCount(file: File): Promise<number> {
  ensurePdfWorkerConfigured();
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(arrayBuffer),
    useSystemFonts: true,
  });
  const pdfDoc = await loadingTask.promise;
  const numPages = pdfDoc.numPages;
  await pdfDoc.cleanup();
  await loadingTask.destroy().catch(() => {});
  return numPages;
}

export interface SmartPdfIngestProgress {
  currentPage: number;
  startPage: number;
  endPage: number;
  processedPages: number;
  totalTargetPages: number;
  directTextPages: number;
  ocrPages: number;
  savedChunksCount: number;
  detectedChapters: string[];
  stageLabel: string;
}

async function extractTextFromPdfPage(page: pdfjsLib.PDFPageProxy): Promise<string> {
  const content = await page.getTextContent();
  const lines: string[] = [];
  let currentLine = '';
  let lastY: number | null = null;

  for (const item of content.items) {
    if ('str' in item && typeof item.str === 'string') {
      const y = Array.isArray(item.transform) ? Number(item.transform[5]) : null;
      if (lastY !== null && y !== null && Math.abs(y - lastY) > 4) {
        if (currentLine.trim()) lines.push(currentLine.trim());
        currentLine = item.str;
      } else {
        currentLine += (currentLine && item.str ? ' ' : '') + item.str;
      }
      lastY = y;
    }
  }
  if (currentLine.trim()) lines.push(currentLine.trim());
  return lines.join('\n').trim();
}

async function renderPdfPageToJpegBlob(page: pdfjsLib.PDFPageProxy): Promise<Blob> {
  const baseViewport = page.getViewport({ scale: 1.5 });
  const maxWidth = 1400;
  const scale =
    baseViewport.width > maxWidth ? (1.5 * maxWidth) / baseViewport.width : 1.5;
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Không thể khởi tạo Canvas 2D để đọc trang PDF scan.');
  }

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({
    canvasContext: ctx,
    canvas,
    viewport,
  }).promise;

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        canvas.width = 0;
        canvas.height = 0;
        if (blob) resolve(blob);
        else reject(new Error('Không thể nén ảnh trang PDF scan.'));
      },
      'image/jpeg',
      0.78
    );
  });
}

async function ocrScannedPagesBatch(params: {
  items: Array<{ pageNumber: number; blob: Blob }>;
  grade: GradeLevel;
  subject: SubjectId;
  textbookSeries: string;
  signal?: AbortSignal;
}): Promise<Array<{ pageNumber: number; text: string }>> {
  const results: Array<{ pageNumber: number; text: string }> = [];
  const OCR_SUB_BATCH = 3;

  for (let i = 0; i < params.items.length; i += OCR_SUB_BATCH) {
    if (params.signal?.aborted) break;
    const sub = params.items.slice(i, i + OCR_SUB_BATCH);
    const formData = new FormData();
    sub.forEach((it) => {
      formData.append('files', it.blob, `page_${it.pageNumber}.jpg`);
    });
    formData.append('pageNumbers', JSON.stringify(sub.map((it) => it.pageNumber)));
    formData.append('grade', params.grade);
    formData.append('subject', params.subject);
    formData.append('textbookSeries', params.textbookSeries);

    const res = await authorizedFetch('/api/admin/references/ocr-pages', {
      method: 'POST',
      body: formData,
      signal: params.signal,
    });
    const data = await parseApiResponse<{
      pages: Array<{ pageNumber: number; text: string }>;
    }>(res, 'Không thể đọc OCR các trang PDF scan.');

    if (Array.isArray(data.pages)) {
      results.push(...data.pages);
    }
  }

  return results;
}

export async function runSmartClientPdfIngest(params: {
  file: File;
  referenceId: string;
  title: string;
  grade: GradeLevel;
  subject: SubjectId;
  textbookSeries: string;
  publisher: string;
  editionYear: string;
  description: string;
  knowledgeSourceType: KnowledgeSourceType;
  licenseStatus: SourceLicenseStatus;
  pageRangeInput?: string;
  signal?: AbortSignal;
  onProgress?: (progress: SmartPdfIngestProgress) => void;
}): Promise<{
  book: ReferenceBook;
  totalChunksSaved: number;
  chapters: string[];
  directTextPages: number;
  ocrPages: number;
  stoppedEarly: boolean;
}> {
  ensurePdfWorkerConfigured();

  const arrayBuffer = await params.file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(arrayBuffer),
    useSystemFonts: true,
  });
  const pdfDoc = await loadingTask.promise;

  const { startPage, endPage } = parsePageRangeInput(
    params.pageRangeInput || '',
    pdfDoc.numPages
  );
  const totalTargetPages = Math.max(1, endPage - startPage + 1);

  const now = new Date().toISOString();
  const initialBook: ReferenceBook = {
    referenceId: params.referenceId,
    title: params.title.trim() || params.file.name.replace(/\.pdf$/i, ''),
    grade: params.grade,
    subject: params.subject,
    textbookSeries: params.textbookSeries.trim(),
    publisher: params.publisher.trim(),
    editionYear: params.editionYear.trim(),
    description:
      params.description.trim() ||
      `Đọc PDF thông minh (${startPage}–${endPage}/${pdfDoc.numPages} trang)`,
    sourceType: 'upload',
    knowledgeSourceType: params.knowledgeSourceType,
    licenseStatus: params.licenseStatus,
    chapters: [],
    chunkCount: 0,
    status: 'active',
    indexStatus: 'processing',
    createdAt: now,
    updatedAt: now,
  };

  await saveReferenceBookRecord(initialBook);

  const BATCH_SIZE = 5;
  let processedPages = 0;
  let directTextPages = 0;
  let ocrPages = 0;
  let savedChunksCount = 0;
  let lastChapter = 'Chương 1: Kiến thức nền tảng';
  let lastLesson = 'Bài 1';
  const chapterSet = new Set<string>();
  let stoppedEarly = false;

  const emitProgress = (currentPage: number, stageLabel: string) => {
    params.onProgress?.({
      currentPage,
      startPage,
      endPage,
      processedPages,
      totalTargetPages,
      directTextPages,
      ocrPages,
      savedChunksCount,
      detectedChapters: Array.from(chapterSet),
      stageLabel,
    });
  };

  try {
    for (let batchStart = startPage; batchStart <= endPage; batchStart += BATCH_SIZE) {
      if (params.signal?.aborted) {
        stoppedEarly = true;
        break;
      }

      const batchEnd = Math.min(endPage, batchStart + BATCH_SIZE - 1);
      const batchPagesText: Array<{ pageNumber: number; text: string }> = [];
      const scannedToOcr: Array<{ pageNumber: number; blob: Blob }> = [];

      for (let pageNum = batchStart; pageNum <= batchEnd; pageNum += 1) {
        if (params.signal?.aborted) {
          stoppedEarly = true;
          break;
        }

        emitProgress(
          pageNum,
          `Đang phân tích trang ${pageNum}/${endPage} trên trình duyệt...`
        );

        const page = await pdfDoc.getPage(pageNum);
        const extractedText = await extractTextFromPdfPage(page);

        if (isReadableExtractedPageText(extractedText)) {
          directTextPages += 1;
          processedPages += 1;
          batchPagesText.push({ pageNumber: pageNum, text: extractedText });
        } else {
          emitProgress(
            pageNum,
            `Trang ${pageNum} là bản scan/ảnh — đang kết xuất ảnh nén để đọc OCR AI...`
          );
          const blob = await renderPdfPageToJpegBlob(page);
          scannedToOcr.push({ pageNumber: pageNum, blob });
        }
      }

      if (scannedToOcr.length > 0 && !params.signal?.aborted) {
        emitProgress(
          scannedToOcr[0].pageNumber,
          `Đang đọc OCR AI cho ${scannedToOcr.length} trang scan (${scannedToOcr
            .map((s) => s.pageNumber)
            .join(', ')})...`
        );
        const ocrResults = await ocrScannedPagesBatch({
          items: scannedToOcr,
          grade: params.grade,
          subject: params.subject,
          textbookSeries: params.textbookSeries,
          signal: params.signal,
        });
        for (const r of ocrResults) {
          if (r.text && r.text.trim().length > 0) {
            batchPagesText.push({ pageNumber: r.pageNumber, text: r.text.trim() });
          }
        }
        ocrPages += scannedToOcr.length;
        processedPages += scannedToOcr.length;
      }

      batchPagesText.sort((a, b) => a.pageNumber - b.pageNumber);

      if (batchPagesText.length > 0) {
        const newChunks: ReferenceChunk[] = buildChunksFromPages({
          referenceId: params.referenceId,
          grade: params.grade,
          subject: params.subject,
          textbookSeries: params.textbookSeries,
          pages: batchPagesText,
          startingChunkIndex: savedChunksCount,
          initialChapter: lastChapter,
          initialLesson: lastLesson,
        });

        if (newChunks.length > 0) {
          const tail = newChunks[newChunks.length - 1];
          lastChapter = tail.chapter || lastChapter;
          lastLesson = tail.lesson || lastLesson;
          newChunks.forEach((c) => {
            if (c.chapter) chapterSet.add(c.chapter);
          });

          emitProgress(
            batchEnd,
            `Đang lưu ${newChunks.length} đoạn tri thức từ trang ${batchStart}–${batchEnd} vào Firestore...`
          );

          await saveReferenceChunksBatch(newChunks);
          savedChunksCount += newChunks.length;

          await saveReferenceBookProgress(params.referenceId, {
            chapters: Array.from(chapterSet).slice(0, 60),
            chunkCount: savedChunksCount,
            indexStatus: 'processing',
          });
        }
      }
    }

    const finalChapters = Array.from(chapterSet).slice(0, 60);
    const finalStatus: ReferenceBook['indexStatus'] =
      savedChunksCount > 0 ? 'indexed' : 'failed';
    const finalError =
      savedChunksCount === 0
        ? 'Không trích xuất được đoạn tri thức nào từ khoảng trang đã chọn.'
        : undefined;

    await saveReferenceBookProgress(params.referenceId, {
      chapters: finalChapters,
      chunkCount: savedChunksCount,
      indexStatus: finalStatus,
      ...(finalError ? { indexError: finalError } : {}),
    });

    if (savedChunksCount === 0) {
      throw new Error(
        'Không trích xuất được nội dung văn bản từ các trang PDF đã chọn. Hãy kiểm tra lại khoảng trang hoặc tệp PDF.'
      );
    }

    const finalBook: ReferenceBook = {
      ...initialBook,
      chapters: finalChapters,
      chunkCount: savedChunksCount,
      indexStatus: 'indexed',
      updatedAt: new Date().toISOString(),
    };

    return {
      book: finalBook,
      totalChunksSaved: savedChunksCount,
      chapters: finalChapters,
      directTextPages,
      ocrPages,
      stoppedEarly,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Lỗi đọc và lập chỉ mục PDF.';
    await saveReferenceBookProgress(params.referenceId, {
      chapters: Array.from(chapterSet).slice(0, 60),
      chunkCount: savedChunksCount,
      indexStatus: savedChunksCount > 0 ? 'indexed' : 'failed',
      indexError: msg.slice(0, 240),
    }).catch(() => {});
    throw err;
  } finally {
    await pdfDoc.cleanup();
    await loadingTask.destroy().catch(() => {});
  }
}
