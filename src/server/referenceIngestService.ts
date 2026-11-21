import dns from 'node:dns';
import { isPrivateOrLoopbackHost, validateReferenceUrl } from '../core/urlSecurity.js';
import { buildChunksFromPages } from '../core/retrieval.js';
import type { GradeLevel, ReferenceChunk, SubjectId } from '../core/types.js';

async function assertResolvedHostSafe(urlStr: string): Promise<void> {
  const parsed = new URL(urlStr);
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
  if (isPrivateOrLoopbackHost(hostname)) {
    throw new Error('Từ chối kết nối tới địa chỉ mạng nội bộ/loopback.');
  }
  try {
    const records = await dns.promises.lookup(hostname, { all: true });
    for (const rec of records) {
      if (isPrivateOrLoopbackHost(rec.address)) {
        throw new Error('Từ chối kết nối: Tên miền phân giải về IP nội bộ hoặc loopback (DNS Rebinding guard).');
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Từ chối kết nối')) {
      throw err;
    }
    // If DNS lookup fails in restricted environment, fetch itself will fail or validateReferenceUrl already checked hostname
  }
}

const MAX_REMOTE_PDF_BYTES = 35 * 1024 * 1024; // 35MB

export interface IngestResult {
  chunks: ReferenceChunk[];
  chapters: string[];
  pageCount: number;
  extractedSummary: string;
}

/**
 * Extracts text pages from a PDF buffer using pdfjs-dist legacy build in Node.js.
 */
export async function extractPdfPagesFromBuffer(buffer: Buffer): Promise<{ pageNumber: number; text: string }[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const uint8 = new Uint8Array(buffer);
  const loadingTask = pdfjs.getDocument({
    data: uint8,
    useSystemFonts: true,
    disableFontFace: true,
  });
  const doc = await loadingTask.promise;
  const pages: { pageNumber: number; text: string }[] = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const lines: string[] = [];
    let currentLine = '';
    let lastY: number | null = null;

    for (const item of content.items) {
      if ('str' in item) {
        const y = Array.isArray(item.transform) ? item.transform[5] : null;
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
    pages.push({ pageNumber: i, text: lines.join('\n') });
  }

  return pages;
}

/**
 * Safely fetches a remote HTTPS reference document, re-validates redirect destinations
 * against SSRF rules, verifies MIME type and size, and extracts structured textbook chunks.
 */
export async function ingestReferenceFromUrl(params: {
  url: string;
  referenceId: string;
  grade: GradeLevel;
  subject: SubjectId;
  textbookSeries: string;
}): Promise<IngestResult> {
  const check = validateReferenceUrl(params.url);
  if (!check.valid || !check.normalizedUrl) {
    throw new Error(check.reason || 'URL không hợp lệ.');
  }

  let currentUrl = check.normalizedUrl;
  let response: Response | null = null;

  for (let hops = 0; hops < 4; hops++) {
    await assertResolvedHostSafe(currentUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const res = await fetch(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': 'StudyCheckAI-ReferenceIngest/1.0',
          Accept: 'application/pdf, text/html;q=0.9',
        },
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (!loc) throw new Error('Redirect không hợp lệ.');
        const resolved = new URL(loc, currentUrl).toString();
        const redirectCheck = validateReferenceUrl(resolved);
        if (!redirectCheck.valid || !redirectCheck.normalizedUrl) {
          throw new Error(`Chặn redirect không an toàn: ${redirectCheck.reason}`);
        }
        currentUrl = redirectCheck.normalizedUrl;
        continue;
      }
      response = res;
      break;
    } finally {
      clearTimeout(timer);
    }
  }

  if (!response) {
    throw new Error('Quá số lần chuyển hướng URL cho phép.');
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error('Tài liệu yêu cầu đăng nhập hoặc bị giới hạn quyền truy cập (HTTP 401/403). Vui lòng tải lên PDF có quyền sử dụng.');
  }
  if (!response.ok) {
    throw new Error(`Không thể tải tài liệu từ URL (HTTP ${response.status}).`);
  }

  const contentLengthHeader = response.headers.get('content-length');
  if (contentLengthHeader && Number(contentLengthHeader) > MAX_REMOTE_PDF_BYTES) {
    throw new Error('Tài liệu vượt quá giới hạn dung lượng 35MB.');
  }

  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_REMOTE_PDF_BYTES) {
    throw new Error('Tài liệu vượt quá giới hạn dung lượng 35MB.');
  }
  const buffer = Buffer.from(arrayBuffer);

  let pages: { pageNumber: number; text: string }[] = [];
  if (contentType.includes('application/pdf') || currentUrl.toLowerCase().endsWith('.pdf')) {
    pages = await extractPdfPagesFromBuffer(buffer);
  } else if (contentType.includes('text/html') || contentType.includes('text/plain')) {
    const rawHtml = buffer.toString('utf8');
    const cleanText = rawHtml
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, '\n')
      .replace(/\n{2,}/g, '\n')
      .trim();
    if (cleanText.length < 100) {
      throw new Error('Trang web không chứa nội dung văn bản đọc được hoặc yêu cầu JavaScript/đăng nhập.');
    }
    pages = [{ pageNumber: 1, text: cleanText.slice(0, 60000) }];
  } else {
    throw new Error(`Định dạng nội dung không được hỗ trợ (${contentType || 'unknown'}). Chỉ hỗ trợ PDF công khai hoặc trang tài liệu HTTPS.`);
  }

  const totalTextLen = pages.reduce((sum, p) => sum + p.text.trim().length, 0);
  if (totalTextLen < 40) {
    throw new Error('Không trích xuất được văn bản từ PDF (file có thể là PDF scan ảnh hoặc bị mã hóa DRM). Vui lòng tải lên file PDF có lớp văn bản.');
  }

  const chunks = buildChunksFromPages({
    referenceId: params.referenceId,
    grade: params.grade,
    subject: params.subject,
    textbookSeries: params.textbookSeries,
    pages,
  });

  const chapters = Array.from(new Set(chunks.map((c) => c.chapter)));

  return {
    chunks,
    chapters,
    pageCount: pages.length,
    extractedSummary: `Đã lập chỉ mục ${pages.length} trang thành ${chunks.length} đoạn tri thức.`,
  };
}

export async function ingestReferenceFromPdfBuffer(params: {
  buffer: Buffer;
  referenceId: string;
  grade: GradeLevel;
  subject: SubjectId;
  textbookSeries: string;
}): Promise<IngestResult> {
  const pages = await extractPdfPagesFromBuffer(params.buffer);
  const totalTextLen = pages.reduce((sum, p) => sum + p.text.trim().length, 0);
  if (totalTextLen < 30) {
    throw new Error('PDF không có lớp văn bản chọn được hoặc bị khóa mật khẩu.');
  }
  const chunks = buildChunksFromPages({
    referenceId: params.referenceId,
    grade: params.grade,
    subject: params.subject,
    textbookSeries: params.textbookSeries,
    pages,
  });
  const chapters = Array.from(new Set(chunks.map((c) => c.chapter)));
  return {
    chunks,
    chapters,
    pageCount: pages.length,
    extractedSummary: `Đã lập chỉ mục ${pages.length} trang thành ${chunks.length} đoạn tri thức.`,
  };
}

export async function ingestReferenceFromDocxBuffer(params: {
  buffer: Buffer;
  referenceId: string;
  grade: GradeLevel;
  subject: SubjectId;
  textbookSeries: string;
}): Promise<IngestResult> {
  const mammothMod = await import('mammoth');
  const mammothApi = mammothMod.default || mammothMod;
  const result = await mammothApi.extractRawText({ buffer: params.buffer });
  const raw = (result.value || '').trim();
  if (raw.length < 30) {
    throw new Error('File DOCX không chứa văn bản học thuật đọc được.');
  }
  return ingestReferenceFromTextOrJson({
    mode: 'text',
    content: raw,
    referenceId: params.referenceId,
    grade: params.grade,
    subject: params.subject,
    textbookSeries: params.textbookSeries,
  });
}

export function ingestReferenceFromTextOrJson(params: {
  mode: 'text' | 'json';
  content: string;
  referenceId: string;
  grade: GradeLevel;
  subject: SubjectId;
  textbookSeries: string;
}): IngestResult {
  const raw = (params.content || '').trim();
  if (raw.length < 20) {
    throw new Error('Nội dung tài liệu tham chiếu quá ngắn (tối thiểu 20 ký tự).');
  }

  if (params.mode === 'json') {
    const parsed = JSON.parse(raw) as Array<{
      chapter?: string;
      lesson?: string;
      pageNumber?: number;
      sectionTitle?: string;
      content?: string;
      keywords?: string[];
    }>;
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error('JSON phải là mảng các đoạn tri thức (ví dụ: [{ chapter, lesson, pageNumber, content }]).');
    }
    const chunks: ReferenceChunk[] = parsed
      .filter((item) => item && typeof item.content === 'string' && item.content.trim().length > 0)
      .slice(0, 120)
      .map((item, idx) => ({
        chunkId: `${params.referenceId}_j${idx + 1}`,
        referenceId: params.referenceId,
        grade: params.grade,
        subject: params.subject,
        textbookSeries: params.textbookSeries,
        chapter: (item.chapter || 'Chương tổng hợp').slice(0, 180),
        lesson: (item.lesson || `Mục ${idx + 1}`).slice(0, 180),
        pageNumber: Number(item.pageNumber) || idx + 1,
        sectionTitle: (item.sectionTitle || item.lesson || `Mục ${idx + 1}`).slice(0, 180),
        content: item.content!.trim().slice(0, 6000),
        keywords: Array.isArray(item.keywords) ? item.keywords.slice(0, 12) : [],
        learningObjectives: [],
        conceptTags: [],
      }));

    if (chunks.length === 0) {
      throw new Error('Không tìm thấy mục nào có trường "content" hợp lệ trong JSON.');
    }

    const chapters = Array.from(new Set(chunks.map((c) => c.chapter)));
    return {
      chunks,
      chapters,
      pageCount: chunks.length,
      extractedSummary: `Đã nhập ${chunks.length} đoạn tri thức từ JSON cấu trúc.`,
    };
  }

  // Plain text / Markdown split into logical pages (~1800 chars each)
  const blocks = raw.split(/\n{2,}/).filter((b) => b.trim().length > 0);
  const pages: { pageNumber: number; text: string }[] = [];
  let buf = '';
  let pageNum = 1;
  for (const b of blocks) {
    if (buf.length + b.length > 1800 && buf.length > 0) {
      pages.push({ pageNumber: pageNum, text: buf.trim() });
      pageNum += 1;
      buf = b;
    } else {
      buf += (buf ? '\n\n' : '') + b;
    }
  }
  if (buf.trim()) {
    pages.push({ pageNumber: pageNum, text: buf.trim() });
  }

  const chunks = buildChunksFromPages({
    referenceId: params.referenceId,
    grade: params.grade,
    subject: params.subject,
    textbookSeries: params.textbookSeries,
    pages,
  });
  const chapters = Array.from(new Set(chunks.map((c) => c.chapter)));
  return {
    chunks,
    chapters,
    pageCount: pages.length,
    extractedSummary: `Đã lập chỉ mục ${pages.length} phần văn bản thành ${chunks.length} đoạn tri thức.`,
  };
}
