import type {
  AnnotationItem,
  AnnotationLocationStatus,
  ExtractedClaim,
  ExtractedPage,
  ExtractedTextBlock,
} from './types.js';

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

interface NormalizedUnit {
  char: string;
  origStart: number;
  origEnd: number;
}

/**
 * Projects `text` into NFC-normalized lowercase comparison units while keeping exact
 * UTF-16 [origStart, origEnd) code-unit indices in the ORIGINAL string.
 * Guarantees String.slice(start, end) integrity for Vietnamese NFD combining diacritics,
 * Greek symbols, math operators, subscripts/superscripts (x₀, v², H₂SO₄), and surrogate pairs.
 */
function buildNormalizedIndexMap(text: string, stripWhitespace: boolean): {
  normalized: string;
  units: NormalizedUnit[];
} {
  const units: NormalizedUnit[] = [];
  let i = 0;
  while (i < text.length) {
    const cp = text.codePointAt(i)!;
    const baseLen = cp > 0xffff ? 2 : 1;
    let clusterEnd = i + baseLen;
    // Group trailing Unicode combining diacritical marks (Mn/Mc/Me) with their base code point
    while (clusterEnd < text.length) {
      const nextCp = text.codePointAt(clusterEnd)!;
      const nextLen = nextCp > 0xffff ? 2 : 1;
      const nextChar = text.slice(clusterEnd, clusterEnd + nextLen);
      if (/^\p{M}$/u.test(nextChar)) {
        clusterEnd += nextLen;
      } else {
        break;
      }
    }

    const rawCluster = text.slice(i, clusterEnd);
    if (stripWhitespace && /^\s+$/u.test(rawCluster)) {
      i = clusterEnd;
      continue;
    }

    const nfcLower = rawCluster.normalize('NFC').toLowerCase();
    for (let k = 0; k < nfcLower.length; k += 1) {
      units.push({
        char: nfcLower[k],
        origStart: i,
        origEnd: clusterEnd,
      });
    }

    i = clusterEnd;
  }

  return {
    normalized: units.map((u) => u.char).join(''),
    units,
  };
}

/**
 * Finds ALL exact [start, end) UTF-16 character spans of `needle` inside `haystack`,
 * tolerant to case, Unicode NFC/NFD composition, and optionally whitespace differences
 * (e.g. "s=v+t" matching "s = v + t"). Never fabricates matches or alters `haystack`.
 */
export function findAllFlexibleSubstringRanges(
  haystack: string,
  needle: string
): Array<{ start: number; end: number }> {
  if (!haystack || !needle) return [];
  const trimmedNeedle = needle.trim();
  if (trimmedNeedle.length < 2) return [];

  // Path 1: NFC-normalized, case-insensitive direct match preserving whitespace
  const normNeedle = trimmedNeedle.normalize('NFC').toLowerCase();
  const hayDirect = buildNormalizedIndexMap(haystack, false);
  const directMatches: Array<{ start: number; end: number }> = [];
  if (normNeedle.length >= 2) {
    let from = 0;
    while (from <= hayDirect.normalized.length - normNeedle.length) {
      const idx = hayDirect.normalized.indexOf(normNeedle, from);
      if (idx < 0) break;
      const start = hayDirect.units[idx].origStart;
      const end = hayDirect.units[idx + normNeedle.length - 1].origEnd;
      directMatches.push({ start, end });
      from = idx + Math.max(1, normNeedle.length);
    }
  }
  if (directMatches.length > 0) {
    return directMatches;
  }

  // Path 2: Whitespace-insensitive NFC match (handles "s=v+t" vs "s = v + t" or multiline wraps)
  const compactNeedle = normNeedle.replace(/\s+/gu, '');
  if (compactNeedle.length < 2) return [];
  const hayCompact = buildNormalizedIndexMap(haystack, true);
  const compactMatches: Array<{ start: number; end: number }> = [];
  let from = 0;
  while (from <= hayCompact.normalized.length - compactNeedle.length) {
    const idx = hayCompact.normalized.indexOf(compactNeedle, from);
    if (idx < 0) break;
    const start = hayCompact.units[idx].origStart;
    const end = hayCompact.units[idx + compactNeedle.length - 1].origEnd;
    compactMatches.push({ start, end });
    from = idx + Math.max(1, compactNeedle.length);
  }

  return compactMatches;
}

/**
 * Finds the first exact [start, end) character span of `needle` inside `haystack`,
 * tolerant to differences in spaces, capitalization, and Unicode NFC/NFD normalization.
 */
export function findFlexibleSubstringRange(
  haystack: string,
  needle: string
): { start: number; end: number } | null {
  const ranges = findAllFlexibleSubstringRanges(haystack, needle);
  return ranges[0] ?? null;
}

export interface VerifiedSpanResult {
  locationStatus: AnnotationLocationStatus;
  startOffset?: number;
  endOffset?: number;
  verifiedSpan?: string;
  reason?: string;
}

function scoreContextMatch(
  haystack: string,
  range: { start: number; end: number },
  contextBefore?: string,
  contextAfter?: string
): number {
  let score = 0;
  const normBefore = normalizeCompact(contextBefore || '');
  const normAfter = normalizeCompact(contextAfter || '');

  if (normBefore.length >= 2) {
    const windowBefore = normalizeCompact(haystack.slice(Math.max(0, range.start - 64), range.start));
    if (windowBefore.endsWith(normBefore)) {
      score += normBefore.length * 3;
    } else if (windowBefore.includes(normBefore)) {
      score += normBefore.length;
    }
  }

  if (normAfter.length >= 2) {
    const windowAfter = normalizeCompact(haystack.slice(range.end, Math.min(haystack.length, range.end + 64)));
    if (windowAfter.startsWith(normAfter)) {
      score += normAfter.length * 3;
    } else if (windowAfter.includes(normAfter)) {
      score += normAfter.length;
    }
  }

  return score;
}

/**
 * Strictly verifies whether an AI-provided `errorSpan` (or fallback `sourceText`) maps uniquely
 * to a real UTF-16 range in `blockText`.
 * - Disambiguates duplicate occurrences via `contextBefore` / `contextAfter` / unique `sourceText` / `startOffset`.
 * - NEVER fabricates a replacement string or blindly highlights the first match when ambiguous.
 * - Returns `locationStatus: 'unverified'` when invalid or ambiguous so the right-column card
 *   is preserved while the left column refuses to draw a false underline.
 */
export function verifyAndAnchorErrorSpan(params: {
  blockText: string;
  errorSpan?: string;
  sourceText?: string;
  startOffset?: number;
  endOffset?: number;
  contextBefore?: string;
  contextAfter?: string;
  isMissing?: boolean;
  allowLegacyBlockFallback?: boolean;
}): VerifiedSpanResult {
  const {
    blockText,
    errorSpan,
    sourceText,
    startOffset,
    endOffset,
    contextBefore,
    contextAfter,
    isMissing,
    allowLegacyBlockFallback = false,
  } = params;

  if (isMissing) {
    return {
      locationStatus: 'anchor_missing',
      reason: 'missing_content_anchor',
    };
  }

  if (!blockText) {
    return {
      locationStatus: 'unverified',
      reason: 'empty_block_text',
    };
  }

  const trimmedErrorSpan = (errorSpan || '').trim();
  const trimmedSourceText = (sourceText || '').trim();

  // Step 1: Validate explicit numeric offsets first when present
  if (
    typeof startOffset === 'number' &&
    typeof endOffset === 'number' &&
    Number.isInteger(startOffset) &&
    Number.isInteger(endOffset) &&
    startOffset >= 0 &&
    endOffset > startOffset &&
    endOffset <= blockText.length
  ) {
    const slice = blockText.slice(startOffset, endOffset);
    const expected = trimmedErrorSpan || trimmedSourceText;
    if (!expected || normalizeCompact(slice) === normalizeCompact(expected)) {
      return {
        locationStatus: 'verified',
        startOffset,
        endOffset,
        verifiedSpan: slice,
      };
    }
  }

  // Helper to resolve candidate occurrences with strict ambiguity guard
  const pickUniqueOccurrence = (
    ranges: Array<{ start: number; end: number }>,
    enclosingRanges?: Array<{ start: number; end: number }>
  ): VerifiedSpanResult => {
    if (ranges.length === 0) {
      return { locationStatus: 'unverified', reason: 'span_not_found' };
    }
    if (ranges.length === 1) {
      const r = ranges[0];
      return {
        locationStatus: 'verified',
        startOffset: r.start,
        endOffset: r.end,
        verifiedSpan: blockText.slice(r.start, r.end),
      };
    }

    // Disambiguation 1: unique enclosing sourceText range inside this block
    if (enclosingRanges && enclosingRanges.length === 1) {
      const enc = enclosingRanges[0];
      const inside = ranges.filter((r) => r.start >= enc.start && r.end <= enc.end);
      if (inside.length === 1) {
        return {
          locationStatus: 'verified',
          startOffset: inside[0].start,
          endOffset: inside[0].end,
          verifiedSpan: blockText.slice(inside[0].start, inside[0].end),
        };
      }
      if (inside.length > 1) {
        ranges = inside;
      }
    }

    // Disambiguation 2: contextBefore / contextAfter scoring
    if ((contextBefore && contextBefore.trim()) || (contextAfter && contextAfter.trim())) {
      const scored = ranges
        .map((r) => ({ r, score: scoreContextMatch(blockText, r, contextBefore, contextAfter) }))
        .sort((a, b) => b.score - a.score);
      if (scored[0].score > 0 && (scored.length === 1 || scored[0].score > scored[1].score)) {
        return {
          locationStatus: 'verified',
          startOffset: scored[0].r.start,
          endOffset: scored[0].r.end,
          verifiedSpan: blockText.slice(scored[0].r.start, scored[0].r.end),
        };
      }
    }

    // Disambiguation 3: numeric startOffset proximity hint
    if (typeof startOffset === 'number' && Number.isFinite(startOffset)) {
      const byDist = ranges
        .map((r) => ({ r, dist: Math.abs(r.start - startOffset) }))
        .sort((a, b) => a.dist - b.dist);
      if (byDist[0].dist <= 5 && (byDist.length === 1 || byDist[0].dist < byDist[1].dist)) {
        return {
          locationStatus: 'verified',
          startOffset: byDist[0].r.start,
          endOffset: byDist[0].r.end,
          verifiedSpan: blockText.slice(byDist[0].r.start, byDist[0].r.end),
        };
      }
    }

    // Still ambiguous: NEVER blindly pick index 0
    return {
      locationStatus: 'unverified',
      reason: 'ambiguous_duplicate_span',
    };
  };

  // Step 2: Explicit errorSpan must exist in blockText (never silently highlight whole block when errorSpan is invalid)
  if (trimmedErrorSpan.length >= 2) {
    const errorRanges = findAllFlexibleSubstringRanges(blockText, trimmedErrorSpan);
    const sourceRanges =
      trimmedSourceText.length >= 2
        ? findAllFlexibleSubstringRanges(blockText, trimmedSourceText)
        : undefined;
    const resolved = pickUniqueOccurrence(errorRanges, sourceRanges);
    if (resolved.locationStatus === 'verified') {
      return resolved;
    }
    return {
      locationStatus: 'unverified',
      reason: errorRanges.length > 1 ? 'ambiguous_duplicate_span' : 'error_span_not_found',
    };
  }

  // Step 3: No errorSpan supplied — anchor via sourceText
  if (trimmedSourceText.length >= 2) {
    const sourceRanges = findAllFlexibleSubstringRanges(blockText, trimmedSourceText);
    const resolved = pickUniqueOccurrence(sourceRanges);
    if (resolved.locationStatus === 'verified') {
      return resolved;
    }

    // Formula block ("Lead-in:\nformula") fallback when sourceText is the formula line or block
    const lines = blockText.split('\n');
    if (lines.length === 2 && isLeadInLabel(lines[0]) && isFormulaLine(lines[1])) {
      const formulaStart = blockText.indexOf(lines[1]);
      if (
        formulaStart >= 0 &&
        (normalizeCompact(trimmedSourceText).includes(normalizeCompact(lines[1])) ||
          allowLegacyBlockFallback)
      ) {
        return {
          locationStatus: 'verified',
          startOffset: formulaStart,
          endOffset: formulaStart + lines[1].length,
          verifiedSpan: lines[1],
        };
      }
    }

    // Legacy multi-block excerpt fallback (when blockText is a clean line inside a larger legacy sourceText)
    if (allowLegacyBlockFallback) {
      const trimmedBlock = blockText.trim();
      if (
        trimmedBlock.length >= 6 &&
        findAllFlexibleSubstringRanges(trimmedSourceText, trimmedBlock).length > 0
      ) {
        return {
          locationStatus: 'verified',
          startOffset: 0,
          endOffset: blockText.length,
          verifiedSpan: blockText,
        };
      }
    }
  }

  return {
    locationStatus: 'unverified',
    reason: 'span_not_found',
  };
}

export interface InlineHighlightTarget {
  claimId: string;
  blockId?: string;
  blockIds?: string[];
  errorSpan?: string;
  textExcerpt: string;
  startOffset?: number;
  endOffset?: number;
  contextBefore?: string;
  contextAfter?: string;
  locationStatus?: AnnotationLocationStatus;
  annotationColor: AnnotationItem['annotationColor'];
  orderNumber?: number;
}

export interface InlineCoLocatedBadge {
  claimId: string;
  annotationColor: AnnotationItem['annotationColor'];
  orderNumber?: number;
}

export interface InlineTextSegment {
  text: string;
  claimId?: string;
  claimIds?: string[];
  annotationColor?: AnnotationItem['annotationColor'];
  orderNumber?: number;
  coLocatedBadges?: InlineCoLocatedBadge[];
}

const COLOR_PRIORITY: Record<AnnotationItem['annotationColor'], number> = {
  red: 4,
  orange: 3,
  yellow: 2,
  green: 1,
};

/**
 * Computes ordered, non-overlapping DOM highlight segments for a block of text while
 * faithfully preserving 100% verbatim student text AND handling overlapping or co-located
 * annotations via atomic interval splitting (zero dropped badges, zero broken nested DOM).
 *
 * Strictly refuses to underline `locationStatus === 'unverified'` or `'anchor_missing'` targets,
 * and refuses to guess ambiguous duplicate occurrences.
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
    specificity: number;
  };

  const candidates: CandidateSpan[] = [];
  const matchedClaimSet = new Set<string>();

  for (const target of targets) {
    // Never draw fake underlines for unverified locations or MISSING anchors
    if (
      target.locationStatus === 'unverified' ||
      target.locationStatus === 'anchor_missing'
    ) {
      continue;
    }

    const isExplicitBlockMatch =
      (target.blockId && target.blockId === blockId) ||
      (Array.isArray(target.blockIds) && target.blockIds.includes(blockId));

    // If the target explicitly belongs to another blockId, do NOT accidentally match duplicate text here
    if (
      (target.blockId || (Array.isArray(target.blockIds) && target.blockIds.length > 0)) &&
      !isExplicitBlockMatch
    ) {
      continue;
    }

    const anchored = verifyAndAnchorErrorSpan({
      blockText: text,
      errorSpan: target.errorSpan,
      sourceText: target.textExcerpt,
      startOffset: isExplicitBlockMatch ? target.startOffset : undefined,
      endOffset: isExplicitBlockMatch ? target.endOffset : undefined,
      contextBefore: target.contextBefore,
      contextAfter: target.contextAfter,
      allowLegacyBlockFallback: !target.errorSpan,
    });

    if (
      anchored.locationStatus === 'verified' &&
      typeof anchored.startOffset === 'number' &&
      typeof anchored.endOffset === 'number' &&
      anchored.endOffset > anchored.startOffset
    ) {
      matchedClaimSet.add(target.claimId);
      candidates.push({
        start: anchored.startOffset,
        end: anchored.endOffset,
        claimId: target.claimId,
        annotationColor: target.annotationColor,
        orderNumber: target.orderNumber,
        priority: COLOR_PRIORITY[target.annotationColor] || 1,
        specificity: anchored.endOffset - anchored.startOffset,
      });
    }
  }

  if (candidates.length === 0) {
    return { segments: [{ text }], matchedClaimIds: [] };
  }

  // Atomic boundary split: handles adjacent, nested, identical, and partially overlapping spans
  // without ever dropping an annotation or mutating/duplicating a single character of `text`.
  const boundarySet = new Set<number>([0, text.length]);
  for (const c of candidates) {
    boundarySet.add(Math.max(0, Math.min(text.length, c.start)));
    boundarySet.add(Math.max(0, Math.min(text.length, c.end)));
  }
  const boundaries = Array.from(boundarySet).sort((a, b) => a - b);

  const segments: InlineTextSegment[] = [];

  for (let i = 0; i < boundaries.length - 1; i += 1) {
    const segStart = boundaries[i];
    const segEnd = boundaries[i + 1];
    if (segEnd <= segStart) continue;

    const segText = text.slice(segStart, segEnd);
    const active = candidates.filter((c) => c.start <= segStart && c.end >= segEnd);

    if (active.length === 0) {
      segments.push({ text: segText });
      continue;
    }

    // Choose visual styling by highest severity, then tightest span, then lowest orderNumber
    const sortedActive = [...active].sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      if (a.specificity !== b.specificity) return a.specificity - b.specificity;
      return (a.orderNumber ?? Number.MAX_SAFE_INTEGER) - (b.orderNumber ?? Number.MAX_SAFE_INTEGER);
    });
    const primary = sortedActive[0];

    // Emit badges for every candidate whose span ENDS at `segEnd` (each annotation gets its badge exactly once)
    const endingBadges: InlineCoLocatedBadge[] = active
      .filter((c) => c.end === segEnd)
      .sort((a, b) => {
        const orderDiff =
          (a.orderNumber ?? Number.MAX_SAFE_INTEGER) - (b.orderNumber ?? Number.MAX_SAFE_INTEGER);
        if (orderDiff !== 0) return orderDiff;
        return b.priority - a.priority;
      })
      .map((c) => ({
        claimId: c.claimId,
        annotationColor: c.annotationColor,
        orderNumber: c.orderNumber,
      }));

    const uniqueClaimIds = Array.from(new Set(sortedActive.map((c) => c.claimId)));

    segments.push({
      text: segText,
      claimId: primary.claimId,
      claimIds: uniqueClaimIds,
      annotationColor: primary.annotationColor,
      orderNumber: endingBadges.length > 0 ? endingBadges[0].orderNumber : undefined,
      coLocatedBadges: endingBadges.length > 0 ? endingBadges : undefined,
    });
  }

  return {
    segments,
    matchedClaimIds: Array.from(matchedClaimSet),
  };
}

/**
 * Deterministically sorts claims by their real appearance order in the student document:
 * pageNumber -> block reading order -> verified startOffset -> original index.
 */
export function sortClaimsByDocumentPosition<
  T extends Pick<ExtractedClaim, 'sourcePage' | 'blockId' | 'blockIds' | 'startOffset' | 'evaluationStatus'>
>(claims: T[], pages: ExtractedPage[]): T[] {
  const blockOrderByPage = new Map<number, Map<string, number>>();
  for (const page of pages) {
    const map = new Map<string, number>();
    (page.blocks || []).forEach((block, idx) => {
      map.set(block.blockId, idx);
    });
    blockOrderByPage.set(page.pageNumber, map);
  }

  return claims
    .map((claim, originalIndex) => {
      const pageNum = claim.sourcePage || 1;
      const pageBlockMap = blockOrderByPage.get(pageNum);
      const primaryBlockId = claim.blockId || claim.blockIds?.[0];
      const blockIdx =
        primaryBlockId && pageBlockMap?.has(primaryBlockId)
          ? pageBlockMap.get(primaryBlockId)!
          : Number.MAX_SAFE_INTEGER;
      const isMissing = claim.evaluationStatus === 'MISSING' ? 1 : 0;
      const offset =
        typeof claim.startOffset === 'number' && Number.isFinite(claim.startOffset)
          ? claim.startOffset
          : Number.MAX_SAFE_INTEGER;
      return { claim, originalIndex, pageNum, blockIdx, isMissing, offset };
    })
    .sort((a, b) => {
      if (a.pageNum !== b.pageNum) return a.pageNum - b.pageNum;
      if (a.blockIdx !== b.blockIdx) return a.blockIdx - b.blockIdx;
      // Within the same block, place inline claims before block-end MISSING anchors
      if (a.isMissing !== b.isMissing) return a.isMissing - b.isMissing;
      if (a.offset !== b.offset) return a.offset - b.offset;
      return a.originalIndex - b.originalIndex;
    })
    .map((entry) => entry.claim);
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
