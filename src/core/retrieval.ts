import type { ReferenceChunk } from './types';

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
}): ReferenceChunk[] {
  const { referenceId, grade, subject, textbookSeries, pages } = params;
  const chunks: ReferenceChunk[] = [];
  let currentChapter = 'Chương 1: Kiến thức nền tảng';
  let currentLesson = 'Bài 1';
  let chunkIndex = 0;

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
      const tokens = tokenizeVietnamese(content);
      const freq = new Map<string, number>();
      for (const t of tokens) {
        if (t.length >= 3) freq.set(t, (freq.get(t) ?? 0) + 1);
      }
      const keywords = Array.from(freq.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([k]) => k);

      chunks.push({
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
        keywords,
        learningObjectives: [],
        conceptTags: keywords.slice(0, 4),
      });
      buffer = [];
    };

    for (const line of lines) {
      if (/^(chương|chủ đề)\s+[0-9ivxlcdm]+/i.test(line)) {
        flushBuffer();
        currentChapter = line.slice(0, 120);
      } else if (/^(bài|tiết)\s+[0-9]+/i.test(line)) {
        flushBuffer();
        currentLesson = line.slice(0, 120);
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
