import type { GradeLevel, ReferenceChunk, SubjectId } from './types.js';

function tokenizeVietnamese(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 2);
}

export interface RetrievedChunkResult {
  chunk: ReferenceChunk;
  lexicalScore: number;
  matchedKeywords: string[];
}

/**
 * Checks whether text extracted from a PDF page via pdfjs-dist has sufficient
 * readable Vietnamese/academic text (at least 80 chars and < 25% garbled/control chars).
 * Pages that fail this check are treated as scanned/vector pages and routed to multimodal OCR.
 */
export function isReadableExtractedPageText(text: string): boolean {
  const trimmed = (text || '').trim();
  if (trimmed.length < 80) {
    return false;
  }
  let readableCount = 0;
  let weirdCount = 0;
  for (const ch of trimmed) {
    const code = ch.codePointAt(0) || 0;
    if (
      /[\p{L}\p{N}\s.,;:!?()[\]{}'"+\-*/=<>%°~^_\\|@#$&\n\r\t]/u.test(ch) ||
      (code >= 0x2000 && code <= 0x2bff) // Math & technical symbols
    ) {
      readableCount += 1;
    } else {
      weirdCount += 1;
    }
  }
  const total = readableCount + weirdCount;
  if (total === 0) return false;
  return weirdCount / total < 0.25;
}

/**
 * Parses a user-supplied page range string (e.g. "1-120", "5 - 40", "12", or "")
 * and clamps it to valid 1..totalPages boundaries.
 */
export function parsePageRangeInput(
  rangeInput: string,
  totalPages: number
): { startPage: number; endPage: number } {
  const safeTotal = Math.max(1, Math.floor(totalPages) || 1);
  const cleaned = (rangeInput || '').trim();
  if (!cleaned) {
    return { startPage: 1, endPage: safeTotal };
  }

  const rangeMatch = cleaned.match(/^(\d+)\s*[-–—~tođến]+\s*(\d+)$/i);
  if (rangeMatch) {
    const rawStart = parseInt(rangeMatch[1], 10);
    const rawEnd = parseInt(rangeMatch[2], 10);
    const startPage = Math.max(1, Math.min(safeTotal, rawStart || 1));
    const endPage = Math.max(startPage, Math.min(safeTotal, rawEnd || safeTotal));
    return { startPage, endPage };
  }

  const singleMatch = cleaned.match(/^(\d+)$/);
  if (singleMatch) {
    const page = Math.max(1, Math.min(safeTotal, parseInt(singleMatch[1], 10) || 1));
    return { startPage: page, endPage: page };
  }

  return { startPage: 1, endPage: safeTotal };
}

/**
 * Sanitizes and enforces strict Firestore security rule constraints on a ReferenceChunk:
 * - chunkId matches ^[a-zA-Z0-9_-]{1,128}$
 * - chapter <= 190 chars (rule limit: 200)
 * - content <= 6000 chars (rule limit: 8000)
 * - pageNumber >= 1
 */
export function sanitizeReferenceChunkForFirestore(params: {
  chunkId?: string;
  referenceId: string;
  grade: GradeLevel;
  subject: SubjectId;
  textbookSeries: string;
  chapter?: string;
  lesson?: string;
  pageNumber?: number;
  sectionTitle?: string;
  content: string;
  keywords?: string[];
  learningObjectives?: string[];
  conceptTags?: string[];
  fallbackIndex?: number;
}): ReferenceChunk {
  const safeRefId = params.referenceId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'ref_book';
  const idx = Math.max(1, Math.floor(params.fallbackIndex ?? 1));
  const rawChunkId = (params.chunkId || `${safeRefId}_c${idx}`).replace(/[^a-zA-Z0-9_-]/g, '_');
  const chunkId = rawChunkId.slice(0, 120) || `${safeRefId}_c${idx}`;

  const chapter = (params.chapter || 'Chương 1: Kiến thức trọng tâm').trim().slice(0, 190);
  const lesson = (params.lesson || 'Bài học trọng tâm').trim().slice(0, 180);
  const sectionTitle = (params.sectionTitle || lesson || 'Nội dung chuẩn SGK').trim().slice(0, 180);
  const parsedPage = Math.floor(Number(params.pageNumber));
  const pageNumber = Number.isFinite(parsedPage) && parsedPage >= 1 ? parsedPage : idx;
  const content = (params.content || '').trim().slice(0, 6000) || chapter;

  const cleanList = (arr: string[] | undefined, maxItems: number, maxLen = 140): string[] =>
    Array.isArray(arr)
      ? arr
          .map((item) => (typeof item === 'string' ? item.trim().slice(0, maxLen) : ''))
          .filter(Boolean)
          .slice(0, maxItems)
      : [];

  let keywords = cleanList(params.keywords, 10, 80);
  if (keywords.length === 0) {
    const tokens = tokenizeVietnamese(`${sectionTitle} ${content}`);
    const freq = new Map<string, number>();
    for (const t of tokens) {
      if (t.length >= 3) freq.set(t, (freq.get(t) ?? 0) + 1);
    }
    keywords = Array.from(freq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([k]) => k);
  }

  const learningObjectives = cleanList(params.learningObjectives, 8, 220);
  const conceptTags =
    cleanList(params.conceptTags, 8, 80).length > 0
      ? cleanList(params.conceptTags, 8, 80)
      : keywords.slice(0, 4);

  return {
    chunkId,
    referenceId: safeRefId,
    grade: params.grade,
    subject: params.subject,
    textbookSeries: (params.textbookSeries || 'Chuẩn chương trình GDPT 2018').trim().slice(0, 100),
    chapter,
    lesson,
    pageNumber,
    sectionTitle,
    content,
    keywords,
    learningObjectives,
    conceptTags,
  };
}

/**
 * Honest metadata + keyword + lexical overlap retrieval over indexed textbook chunks.
 * Returns ranked excerpts with exact page, chapter, and lesson metadata for AI grounding.
 */
export function retrieveRelevantChunks(
  queryText: string,
  chunks: ReferenceChunk[],
  options: {
    referenceId?: string;
    selectedChapters?: string[];
    topK?: number;
  } = {}
): RetrievedChunkResult[] {
  const { referenceId, selectedChapters, topK = 6 } = options;
  const queryTokens = Array.from(new Set(tokenizeVietnamese(queryText)));
  if (queryTokens.length === 0 || chunks.length === 0) {
    return [];
  }

  const filtered = chunks.filter((c) => {
    if (referenceId && c.referenceId !== referenceId) return false;
    if (selectedChapters && selectedChapters.length > 0) {
      return selectedChapters.some(
        (ch) => c.chapter.toLowerCase().includes(ch.toLowerCase()) || ch.toLowerCase().includes(c.chapter.toLowerCase())
      );
    }
    return true;
  });

  const pool = filtered.length > 0 ? filtered : chunks.filter((c) => !referenceId || c.referenceId === referenceId);

  const scored: RetrievedChunkResult[] = pool.map((chunk) => {
    const contentTokens = new Set(tokenizeVietnamese(chunk.content));
    const titleTokens = new Set(tokenizeVietnamese(`${chunk.sectionTitle} ${chunk.lesson} ${chunk.chapter}`));
    const keywordSet = new Set(chunk.keywords.map((k) => k.toLowerCase()));
    const conceptSet = new Set(chunk.conceptTags.map((k) => k.toLowerCase()));

    let score = 0;
    const matchedKeywords: string[] = [];

    for (const qt of queryTokens) {
      if (titleTokens.has(qt)) {
        score += 3;
        matchedKeywords.push(qt);
      } else if (keywordSet.has(qt) || conceptSet.has(qt)) {
        score += 2.5;
        matchedKeywords.push(qt);
      } else if (contentTokens.has(qt)) {
        score += 1;
        matchedKeywords.push(qt);
      }
    }

    const normalized = score / Math.max(1, Math.sqrt(queryTokens.length));
    return {
      chunk,
      lexicalScore: Math.round(normalized * 100) / 100,
      matchedKeywords: Array.from(new Set(matchedKeywords)),
    };
  });

  return scored
    .filter((item) => item.lexicalScore > 0)
    .sort((a, b) => b.lexicalScore - a.lexicalScore)
    .slice(0, topK);
}

/**
 * Splits extracted textbook text into structured ReferenceChunk objects.
 */
export function buildChunksFromPages(params: {
  referenceId: string;
  grade: ReferenceChunk['grade'];
  subject: ReferenceChunk['subject'];
  textbookSeries: string;
  pages: { pageNumber: number; text: string }[];
  startingChunkIndex?: number;
  initialChapter?: string;
  initialLesson?: string;
}): ReferenceChunk[] {
  const {
    referenceId,
    grade,
    subject,
    textbookSeries,
    pages,
    startingChunkIndex = 0,
    initialChapter = 'Chương 1: Kiến thức nền tảng',
    initialLesson = 'Bài 1',
  } = params;
  const chunks: ReferenceChunk[] = [];
  let currentChapter = initialChapter;
  let currentLesson = initialLesson;
  let chunkIndex = startingChunkIndex;

  for (const page of pages) {
    const lines = page.text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    let buffer: string[] = [];
    let currentSection = 'Nội dung chính';

    const flushBuffer = () => {
      const content = buffer.join(' ').trim();
      if (content.length < 30) {
        buffer = [];
        return;
      }
      chunkIndex += 1;
      chunks.push(
        sanitizeReferenceChunkForFirestore({
          chunkId: `${referenceId}_c${chunkIndex}`,
          referenceId,
          grade,
          subject,
          textbookSeries,
          chapter: currentChapter,
          lesson: currentLesson,
          pageNumber: page.pageNumber,
          sectionTitle: currentSection,
          content,
          fallbackIndex: chunkIndex,
        })
      );
      buffer = [];
    };

    for (const line of lines) {
      if (/^(chương|chủ đề|chuyên đề)\s+[0-9ivxlcdm]+/i.test(line)) {
        flushBuffer();
        currentChapter = line.slice(0, 180);
      } else if (/^(bài|tiết)\s+[0-9]+/i.test(line)) {
        flushBuffer();
        currentLesson = line.slice(0, 180);
      } else if (/^([0-9]+\.|[ivx]+\.)\s+/i.test(line) && line.length < 90) {
        flushBuffer();
        currentSection = line;
      } else {
        buffer.push(line);
        if (buffer.join(' ').length >= 750) {
          flushBuffer();
        }
      }
    }
    flushBuffer();
  }

  return chunks;
}
