import type { AnnotationItem, ExtractedClaim, ExtractedTextBlock } from './types.js';

const BULLET_LINE_RE = /^([-*+•▪▫◦–—]|\d+[.)]|[a-zA-Z][.)])\s+/;
const ANNOTATION_INTRO_RE =
  /^(trong\s+đó|trong\s+do|với|voi|ký\s+hiệu|ky\s+hieu|chú\s+thích|chu\s+thich|ở\s+đây|o\s+day)\s*[:,-]?\s*$/i;
const FORMULA_OPERATOR_RE = /[=≈≠≤≥±×÷·]|(\b[a-zA-Z][a-zA-Z0-9_]*\s*=\s*[-+a-zA-Z0-9_(])/;

export function isBulletLine(line: string): boolean {
  return BULLET_LINE_RE.test((line || '').trim());
}

export function isAnnotationIntroLine(line: string): boolean {
  const trimmed = (line || '').trim();
  if (!trimmed || trimmed.length > 48) return false;
  return ANNOTATION_INTRO_RE.test(trimmed);
}

export function isFormulaLine(line: string): boolean {
  const trimmed = (line || '').trim();
  if (!trimmed || trimmed.length > 110) return false;
  if (isBulletLine(trimmed)) return false;
  if (/[:?!]$/.test(trimmed)) return false;

  // Reject prose sentences that happen to contain a symbol or colon
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  if (wordCount > 14) return false;

  // Must contain a mathematical relation / equality sign
  if (!FORMULA_OPERATOR_RE.test(trimmed)) return false;

  // Avoid Vietnamese explanation lines like "v là tốc độ = ..."
  const vietnameseProseWords = (
    trimmed.match(/\b(là|của|theo|trong|khi|với|thời|gian|quãng|đường|vật|chuyển|động|được|định|nghĩa)\b/gi) || []
  ).length;
  if (vietnameseProseWords >= 3) return false;

  return true;
}

/**
 * Recognizes a short lead-in label ending with ":" (e.g. "Công thức tính quãng đường:",
 * "Phương trình chuyển động thẳng đều:", "Định nghĩa:", "Hệ quả:") that introduces the next line
 * and is NOT an independent knowledge assertion on its own.
 */
export function isLeadInLabel(line: string): boolean {
  const trimmed = (line || '').trim();
  if (!trimmed || trimmed.length > 96) return false;
  if (!/:\s*$/.test(trimmed)) return false;
  if (isBulletLine(trimmed)) return false;
  // If it already contains an equation on the same line, it's not a bare label
  if (/[=≈≠≤≥]/.test(trimmed)) return false;
  return true;
}

/**
 * Detects symbol explanation lines immediately following "Trong đó:" even if OCR dropped the bullet dot,
 * e.g. "s là quãng đường vật đi được (m)." or "v: tốc độ của vật (m/s)".
 */
function isSymbolAnnotationLine(line: string): boolean {
  const trimmed = (line || '').trim();
  if (!trimmed || trimmed.length > 150) return false;
  if (isBulletLine(trimmed)) return true;
  if (isLeadInLabel(trimmed) || isAnnotationIntroLine(trimmed) || isFormulaLine(trimmed)) {
    return false;
  }
  return /^[a-zA-Z][a-zA-Z0-9_0-9,.\s]{0,12}\s+(?:là|:|-|–)\s+/i.test(trimmed);
}

/**
 * Safety guard used after AI grading: identifies bare lead-in/header claims
 * (e.g., "Công thức tính quãng đường:", "Trong đó:") that carry zero factual truth value
 * and must NEVER be scored as standalone CORRECT claims (preventing score inflation).
 */
export function isNonGradableLeadInClaim(sourceText: string): boolean {
  const trimmed = (sourceText || '').trim();
  if (!trimmed) return true;
  // Multi-line merged blocks contain real content after the label -> gradable
  if (trimmed.includes('\n')) return false;
  if (trimmed.length > 96) return false;
  if (/[=≈≠≤≥]/.test(trimmed)) return false;
  if (isAnnotationIntroLine(trimmed)) return true;
  if (/:\s*$/.test(trimmed)) return true;
  return false;
}

/**
 * Deterministically groups raw OCR / PDF / DOCX lines into coherent semantic blocks:
 * 1. "Trong đó:" (or "Với:", "Ký hiệu:") + consecutive bullet/symbol explanation lines -> 1 annotation block ('list'), separate from the formula above.
 * 2. Short lead-in label ending with ":" (e.g. "Công thức tính quãng đường:") + immediately following formula or content -> 1 merged block.
 *    When merged with a formula, `extractedText` holds `${label}\n${formula}` and `formulaText` holds ONLY `${formula}`.
 * 3. Preserves standalone paragraphs, formulas, and headings without duplicating formula text.
 */
export function groupRawTextIntoSemanticBlocks(
  rawText: string,
  pageNumber: number,
  confidence: number
): ExtractedTextBlock[] {
  const safeConf = Math.max(0.1, Math.min(1, Number(confidence) || 0.92));
  const lines = (rawText || '')
    .split(/\r?\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const blocks: ExtractedTextBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Rule 1: Annotation intro ("Trong đó:") + its bullet / symbol explanation lines -> 1 cohesive annotation block
    if (isAnnotationIntroLine(line)) {
      const grouped = [line];
      let j = i + 1;
      while (j < lines.length && isSymbolAnnotationLine(lines[j])) {
        grouped.push(lines[j]);
        j += 1;
      }
      if (grouped.length > 1) {
        blocks.push({
          blockId: `p${pageNumber}_b${blocks.length + 1}`,
          pageNumber,
          extractedText: grouped.join('\n'),
          textType: 'list',
          confidence: safeConf,
          readingOrder: blocks.length + 1,
          boundingBox: null,
        });
        i = j;
        continue;
      }
      // Single-line "Trong đó:" followed by a single prose explanation sentence (e.g., "Trong đó:\nx0 là tọa độ...")
      if (
        j < lines.length &&
        !isLeadInLabel(lines[j]) &&
        !isFormulaLine(lines[j]) &&
        !isAnnotationIntroLine(lines[j])
      ) {
        blocks.push({
          blockId: `p${pageNumber}_b${blocks.length + 1}`,
          pageNumber,
          extractedText: `${line}\n${lines[j]}`,
          textType: 'paragraph',
          confidence: safeConf,
          readingOrder: blocks.length + 1,
          boundingBox: null,
        });
        i = j + 1;
        continue;
      }
    }

    // Rule 2: Short lead-in label ending with ":" (e.g. "Công thức tính quãng đường:") + immediately following formula / bullets / content
    if (isLeadInLabel(line) && i + 1 < lines.length) {
      const nextLine = lines[i + 1];

      // 2a: Lead-in + formula -> 1 formula block (label + formula)
      if (isFormulaLine(nextLine)) {
        blocks.push({
          blockId: `p${pageNumber}_b${blocks.length + 1}`,
          pageNumber,
          extractedText: `${line}\n${nextLine}`,
          textType: 'formula',
          formulaText: nextLine,
          confidence: safeConf,
          readingOrder: blocks.length + 1,
          boundingBox: null,
        });
        i += 2;
        continue;
      }

      // 2b: Lead-in + consecutive bullet list -> 1 list block
      if (isBulletLine(nextLine)) {
        const grouped = [line];
        let j = i + 1;
        while (j < lines.length && isBulletLine(lines[j])) {
          grouped.push(lines[j]);
          j += 1;
        }
        blocks.push({
          blockId: `p${pageNumber}_b${blocks.length + 1}`,
          pageNumber,
          extractedText: grouped.join('\n'),
          textType: 'list',
          confidence: safeConf,
          readingOrder: blocks.length + 1,
          boundingBox: null,
        });
        i = j;
        continue;
      }

      // 2c: Lead-in + immediately following content sentence (not another label/intro) -> 1 paragraph block
      if (!isLeadInLabel(nextLine) && !isAnnotationIntroLine(nextLine)) {
        blocks.push({
          blockId: `p${pageNumber}_b${blocks.length + 1}`,
          pageNumber,
          extractedText: `${line}\n${nextLine}`,
          textType: 'paragraph',
          confidence: safeConf,
          readingOrder: blocks.length + 1,
          boundingBox: null,
        });
        i += 2;
        continue;
      }
    }

    // Rule 3: Standalone formula line
    if (isFormulaLine(line)) {
      blocks.push({
        blockId: `p${pageNumber}_b${blocks.length + 1}`,
        pageNumber,
        extractedText: line,
        textType: 'formula',
        formulaText: line,
        confidence: safeConf,
        readingOrder: blocks.length + 1,
        boundingBox: null,
      });
      i += 1;
      continue;
    }

    // Rule 4: Standalone bullet line
    if (isBulletLine(line)) {
      blocks.push({
        blockId: `p${pageNumber}_b${blocks.length + 1}`,
        pageNumber,
        extractedText: line,
        textType: 'list',
        confidence: safeConf,
        readingOrder: blocks.length + 1,
        boundingBox: null,
      });
      i += 1;
      continue;
    }

    // Rule 5: Heading (only genuine short title on line 0 that does NOT end in sentence punctuation) or paragraph
    const isGenuineTitle =
      blocks.length === 0 &&
      line.length < 80 &&
      !/[.!?]$/.test(line) &&
      !isLeadInLabel(line);

    blocks.push({
      blockId: `p${pageNumber}_b${blocks.length + 1}`,
      pageNumber,
      extractedText: line,
      textType: isGenuineTitle ? 'heading' : 'paragraph',
      confidence: safeConf,
      readingOrder: blocks.length + 1,
      boundingBox: null,
    });
    i += 1;
  }

  return blocks;
}

/**
 * Splits a merged formula block ("Công thức tính quãng đường:\ns = v + t") into its optional lead-in label
 * and its formula expression so UI viewers never render the formula twice.
 */
export function splitFormulaBlockDisplay(block: Pick<ExtractedTextBlock, 'extractedText' | 'textType' | 'formulaText'>): {
  leadInLabel: string | null;
  formulaBody: string | null;
} {
  const raw = (block.extractedText || '').trim();
  const lines = raw
    .split(/\r?\n+/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length >= 2 && isLeadInLabel(lines[0])) {
    const rest = lines.slice(1).join('\n').trim();
    if (block.textType === 'formula' || isFormulaLine(rest)) {
      return { leadInLabel: lines[0], formulaBody: rest };
    }
  }

  if (block.textType === 'formula') {
    return { leadInLabel: null, formulaBody: raw };
  }

  // Only treat formulaText separately if it actually contains distinct info not already identical to extractedText
  const ft = (block.formulaText || '').trim();
  if (ft && normalizeCompact(ft) !== normalizeCompact(raw) && !normalizeCompact(raw).includes(normalizeCompact(ft))) {
    return { leadInLabel: raw, formulaBody: ft };
  }

  return { leadInLabel: null, formulaBody: null };
}

function normalizeCompact(text: string): string {
  return (text || '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/\s+/g, '');
}

/**
 * Finds the exact [start, end) character span of `needle` inside `haystack`,
 * tolerant to differences in spaces, capitalization, and Unicode NFC normalization
 * (so "s=v+t" accurately highlights "s = v + t" and "x0" matches "x_0" or "x₀").
 */
export function findFlexibleSubstringRange(
  haystack: string,
  needle: string
): { start: number; end: number } | null {
  if (!haystack || !needle) return null;
  const trimmedNeedle = needle.trim();
  if (trimmedNeedle.length < 2) return null;

  // Fast path 1: case-insensitive direct substring match
  const lowerHay = haystack.toLowerCase();
  const lowerNeedle = trimmedNeedle.toLowerCase();
  const directIdx = lowerHay.indexOf(lowerNeedle);
  if (directIdx >= 0) {
    return { start: directIdx, end: directIdx + trimmedNeedle.length };
  }

  // Fast path 2: whitespace-insensitive character-mapped match (crucial for formulas like "s=v+t" vs "s = v + t")
  const hayCompactChars: string[] = [];
  const hayIndexMap: number[] = [];
  for (let i = 0; i < haystack.length; i += 1) {
    const ch = haystack[i];
    if (/\s/.test(ch)) continue;
    hayCompactChars.push(ch.toLowerCase());
    hayIndexMap.push(i);
  }
  const compactHay = hayCompactChars.join('');
  const compactNeedle = trimmedNeedle.replace(/\s+/g, '').toLowerCase();
  if (compactNeedle.length < 2) return null;

  const compactIdx = compactHay.indexOf(compactNeedle);
  if (compactIdx >= 0) {
    const start = hayIndexMap[compactIdx];
    const end = hayIndexMap[compactIdx + compactNeedle.length - 1] + 1;
    return { start, end };
  }

  return null;
}

export interface InlineHighlightTarget {
  claimId: string;
  blockId?: string;
  blockIds?: string[];
  errorSpan?: string;
  textExcerpt: string;
  annotationColor: AnnotationItem['annotationColor'];
  orderNumber?: number;
}

export interface InlineTextSegment {
  text: string;
  claimId?: string;
  annotationColor?: AnnotationItem['annotationColor'];
  orderNumber?: number;
}

const COLOR_PRIORITY: Record<AnnotationItem['annotationColor'], number> = {
  red: 4,
  orange: 3,
  yellow: 2,
  green: 1,
};

/**
 * Computes ordered, non-overlapping inline highlight segments for a block of text.
 * Supports multiple distinct errors in one multi-sentence paragraph, exact phrase underlining via `errorSpan`,
 * and short formula matching (e.g. `s = v + t` / `s=v+t`) without an artificial 8-character minimum.
 */
export function computeInlineHighlightSegments(
  text: string,
  blockId: string,
  targets: InlineHighlightTarget[]
): { segments: InlineTextSegment[]; matchedClaimIds: string[] } {
  if (!text) return { segments: [], matchedClaimIds: [] };

  type CandidateSpan = {
    start: number;
    end: number;
    claimId: string;
    annotationColor: AnnotationItem['annotationColor'];
    orderNumber?: number;
    priority: number;
    specificity: number; // smaller span = more surgical underline (prefer errorSpan over whole block)
  };

  const candidates: CandidateSpan[] = [];
  const matchedClaimSet = new Set<string>();

  for (const target of targets) {
    const isExplicitBlockMatch =
      (target.blockId && target.blockId === blockId) ||
      (Array.isArray(target.blockIds) && target.blockIds.includes(blockId));

    // Try surgical errorSpan first
    const spanFromError = target.errorSpan
      ? findFlexibleSubstringRange(text, target.errorSpan)
      : null;

    // Fallback to textExcerpt / sourceText
    const spanFromExcerpt = !spanFromError
      ? findFlexibleSubstringRange(text, target.textExcerpt)
      : null;

    let resolvedRange = spanFromError || spanFromExcerpt;

    // If explicitly bound to this blockId but excerpt spans slightly different punctuation/bullets,
    // check whether textExcerpt is a superstring of a line inside this block or highlight the whole block.
    if (!resolvedRange && isExplicitBlockMatch) {
      // If block is a lead-in + formula ("Công thức tính quãng đường:\ns = v + t") and the target is the error,
      // try highlighting the formula line specifically when errorSpan wasn't given.
      const lines = text.split('\n');
      if (lines.length === 2 && isLeadInLabel(lines[0]) && isFormulaLine(lines[1])) {
        const formulaStart = text.indexOf(lines[1]);
        if (formulaStart >= 0) {
          resolvedRange = { start: formulaStart, end: formulaStart + lines[1].length };
        }
      }
      if (!resolvedRange) {
        resolvedRange = { start: 0, end: text.length };
      }
    }

    // Also allow matching when the block text itself is a meaningful line inside a multi-block textExcerpt
    // (for legacy records saved before semantic grouping where "Trong đó:" and "• s..." were separate blocks)
    if (!resolvedRange && !isExplicitBlockMatch) {
      const trimmedBlock = text.trim();
      if (trimmedBlock.length >= 6 && findFlexibleSubstringRange(target.textExcerpt, trimmedBlock)) {
        resolvedRange = { start: 0, end: text.length };
      }
    }

    if (resolvedRange && resolvedRange.end > resolvedRange.start) {
      matchedClaimSet.add(target.claimId);
      candidates.push({
        start: resolvedRange.start,
        end: resolvedRange.end,
        claimId: target.claimId,
        annotationColor: target.annotationColor,
        orderNumber: target.orderNumber,
        priority: COLOR_PRIORITY[target.annotationColor] || 1,
        specificity: resolvedRange.end - resolvedRange.start,
      });
    }
  }

  if (candidates.length === 0) {
    return { segments: [{ text }], matchedClaimIds: [] };
  }

  // Pick non-overlapping spans: prefer higher severity (red > orange > yellow > green), then tighter/more surgical span
  const sortedForSelection = [...candidates].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    if (a.specificity !== b.specificity) return a.specificity - b.specificity;
    return a.start - b.start;
  });

  const accepted: CandidateSpan[] = [];
  for (const cand of sortedForSelection) {
    const overlaps = accepted.some((acc) => cand.start < acc.end && cand.end > acc.start);
    if (!overlaps) {
      accepted.push(cand);
    }
  }

  accepted.sort((a, b) => a.start - b.start);

  const segments: InlineTextSegment[] = [];
  let cursor = 0;

  for (const span of accepted) {
    if (span.start > cursor) {
      segments.push({ text: text.slice(cursor, span.start) });
    }
    segments.push({
      text: text.slice(span.start, span.end),
      claimId: span.claimId,
      annotationColor: span.annotationColor,
      orderNumber: span.orderNumber,
    });
    cursor = span.end;
  }

  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor) });
  }

  return {
    segments,
    matchedClaimIds: Array.from(matchedClaimSet),
  };
}

/**
 * Derives a concise 1-line fix text for collapsed right-column annotation cards.
 */
export function getConciseFixText(claim: Pick<ExtractedClaim, 'shortFix' | 'suggestedFix' | 'correctKnowledge' | 'explanation'>): string {
  const preferred = (claim.shortFix || claim.suggestedFix || claim.correctKnowledge || claim.explanation || '').trim();
  if (!preferred) return '';
  if (preferred.length <= 165) return preferred;
  const firstSentence = preferred.match(/^[^.!?\n]+[.!?]?/)?.[0]?.trim();
  if (firstSentence && firstSentence.length >= 20 && firstSentence.length <= 170) {
    return firstSentence;
  }
  return `${preferred.slice(0, 160).trimEnd()}…`;
}
