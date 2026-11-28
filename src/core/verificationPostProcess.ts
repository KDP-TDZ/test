import {
  findAllFlexibleSubstringRanges,
  sortClaimsByDocumentPosition,
  verifyAndAnchorErrorSpan,
} from './semanticBlocks.js';
import type {
  AnnotationItem,
  ClaimStatus,
  ExtractedClaim,
  ExtractedPage,
  ExtractedTextBlock,
} from './types.js';

export const OCR_PAGE_LOW_CONFIDENCE_THRESHOLD = 0.55;
export const OCR_BLOCK_LOW_CONFIDENCE_THRESHOLD = 0.65;
export const UNREADABLE_OCR_MARKER = '[KHÔNG NHÌN RÕ]';

export interface VerifierAdjustment {
  claimIndex?: number;
  claimId?: string;
  previousStatus?: ClaimStatus;
  evaluationStatus: ClaimStatus;
  reason: string;
  evidenceBasis?: string;
  errorSpan?: string;
  contextBefore?: string;
  contextAfter?: string;
  shortFix?: string;
  explanation?: string;
  correctKnowledge?: string;
  suggestedFix?: string;
  sourceText?: string;
  blockId?: string;
  sourcePage?: number;
  concept?: string;
  chapter?: string;
}

export interface VerifierReconciliationResult {
  claims: ExtractedClaim[];
  appliedCount: number;
  rejectedCount: number;
  addedCount: number;
  notes: string[];
}

function normalizeCompactKey(text: string): string {
  return (text || '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/\s+/g, '');
}

/**
 * Checks whether the extracted student pages contain meaningful readable text
 * (excluding `[KHÔNG NHÌN RÕ]` markers and whitespace/punctuation).
 * Used to distinguish truly empty/unreadable documents from invalid AI output (`claims: []`).
 */
export function hasMeaningfulReadableContent(pages: ExtractedPage[]): boolean {
  const combined = pages
    .map((p) => {
      if (Array.isArray(p.blocks) && p.blocks.length > 0) {
        return p.blocks.map((b) => b.extractedText || '').join('\n');
      }
      return p.rawText || '';
    })
    .join('\n')
    .replace(/\[KHÔNG NHÌN RÕ\]/gi, '')
    .replace(/[\s\p{P}\p{S}]+/gu, '');

  return combined.length >= 12;
}

/**
 * Returns true if a block has individual low OCR confidence or contains unreadable OCR markers.
 */
export function isBlockOcrUncertain(
  block: Pick<ExtractedTextBlock, 'extractedText' | 'confidence'>,
  ocrConfirmed: boolean
): boolean {
  const text = block.extractedText || '';
  if (text.includes(UNREADABLE_OCR_MARKER)) return true;
  if (!ocrConfirmed && typeof block.confidence === 'number' && block.confidence < OCR_BLOCK_LOW_CONFIDENCE_THRESHOLD) {
    return true;
  }
  return false;
}

/**
 * Builds a lookup map of blockId -> { block, pageNumber } across all pages.
 */
export function buildBlockLookup(
  pages: ExtractedPage[]
): Map<string, { block: ExtractedTextBlock; pageNumber: number; orderIndex: number }> {
  const map = new Map<string, { block: ExtractedTextBlock; pageNumber: number; orderIndex: number }>();
  for (const page of pages) {
    (page.blocks || []).forEach((block, orderIndex) => {
      if (block.blockId) {
        map.set(block.blockId, { block, pageNumber: page.pageNumber, orderIndex });
      }
    });
  }
  return map;
}

const VALID_CLAIM_STATUSES = new Set<ClaimStatus>([
  'CORRECT',
  'PARTIALLY_CORRECT',
  'INCORRECT',
  'MISSING',
  'UNVERIFIED',
  'AMBIGUOUS',
  'OCR_UNCERTAIN',
  'OUT_OF_SCOPE',
]);

/**
 * Strictly validates and applies cross-provider verifier adjustments.
 * - Requires structured reason and valid target (claimId or claimIndex).
 * - Rejects misaligned `previousStatus` to prevent index drift corruption.
 * - Guards against ungrounded downgrades of `INCORRECT -> CORRECT` without `evidenceBasis`.
 * - Verifies proposed `errorSpan` against the real block text before replacing an existing valid span.
 * - Supports adding a genuinely missed error (`claimIndex === -1`) with duplicate prevention.
 */
export function validateAndApplyVerifierAdjustments(
  originalClaims: ExtractedClaim[],
  adjustments: VerifierAdjustment[],
  pages: ExtractedPage[]
): VerifierReconciliationResult {
  const claims: ExtractedClaim[] = originalClaims.map((c) => ({ ...c }));
  const blockLookup = buildBlockLookup(pages);
  const notes: string[] = [];
  let appliedCount = 0;
  let rejectedCount = 0;
  let addedCount = 0;

  if (!Array.isArray(adjustments) || adjustments.length === 0) {
    return { claims, appliedCount: 0, rejectedCount: 0, addedCount: 0, notes };
  }

  for (const adj of adjustments) {
    if (!adj || typeof adj !== 'object') {
      rejectedCount += 1;
      continue;
    }

    const nextStatus = adj.evaluationStatus;
    if (!VALID_CLAIM_STATUSES.has(nextStatus)) {
      rejectedCount += 1;
      notes.push(`Bỏ qua điều chỉnh trạng thái không hợp lệ: ${String(nextStatus)}`);
      continue;
    }

    const reason = (adj.reason || '').trim();
    if (reason.length < 6) {
      rejectedCount += 1;
      notes.push('Bỏ qua điều chỉnh thiếu lý do đối chiếu cụ thể.');
      continue;
    }

    // Resolve target claim
    let targetIdx = -1;
    if (adj.claimId) {
      targetIdx = claims.findIndex((c) => c.claimId === adj.claimId);
    }
    if (
      targetIdx < 0 &&
      typeof adj.claimIndex === 'number' &&
      Number.isInteger(adj.claimIndex) &&
      adj.claimIndex >= 0 &&
      adj.claimIndex < claims.length
    ) {
      targetIdx = adj.claimIndex;
    }

    // Handle verifier surfacing a brand-new missed error (claimIndex === -1 and no target found)
    if (targetIdx < 0 && adj.claimIndex === -1 && (nextStatus === 'INCORRECT' || nextStatus === 'PARTIALLY_CORRECT')) {
      const sourceText = (adj.sourceText || '').trim();
      if (sourceText.length < 2) {
        rejectedCount += 1;
        continue;
      }

      // Verify block / text grounding before adding
      const blockInfo = adj.blockId ? blockLookup.get(adj.blockId) : undefined;
      const targetText = blockInfo?.block.extractedText || '';
      const anchor = targetText
        ? verifyAndAnchorErrorSpan({
            blockText: targetText,
            errorSpan: adj.errorSpan,
            sourceText,
            contextBefore: adj.contextBefore,
            contextAfter: adj.contextAfter,
          })
        : null;

      // Prevent duplicate claim on same block & span
      const dupKey = normalizeCompactKey(adj.errorSpan || sourceText);
      const isDuplicate = claims.some(
        (existing) =>
          existing.blockId === adj.blockId &&
          existing.evaluationStatus === nextStatus &&
          normalizeCompactKey(existing.errorSpan || existing.sourceText) === dupKey
      );
      if (isDuplicate) {
        rejectedCount += 1;
        notes.push('Bỏ qua lỗi bổ sung bị trùng lặp từ bước Dò.');
        continue;
      }

      const template = claims[0];
      const newClaim: ExtractedClaim = {
        claimId: `claim_verify_${claims.length + 1}`,
        sourceText,
        normalizedMeaning: (adj.concept || sourceText).slice(0, 120),
        subject: template?.subject || 'khac',
        chapter: (adj.chapter || template?.chapter || 'Toàn bộ tài liệu').trim(),
        concept: (adj.concept || 'Nội dung phát hiện thêm khi dò chéo').trim(),
        importanceLevel: nextStatus === 'INCORRECT' ? 'core' : 'supporting',
        importanceWeight: nextStatus === 'INCORRECT' ? 3 : 2,
        sourcePage: blockInfo?.pageNumber || adj.sourcePage || 1,
        blockId: blockInfo?.block.blockId || adj.blockId,
        blockIds: blockInfo?.block.blockId ? [blockInfo.block.blockId] : undefined,
        errorSpan: anchor?.verifiedSpan || adj.errorSpan?.trim() || undefined,
        startOffset: anchor?.startOffset,
        endOffset: anchor?.endOffset,
        contextBefore: adj.contextBefore?.trim() || undefined,
        contextAfter: adj.contextAfter?.trim() || undefined,
        locationStatus: anchor?.locationStatus || 'unverified',
        verificationNote: `Bước Dò bổ sung: ${reason}`,
        shortFix: (adj.shortFix || adj.suggestedFix || adj.correctKnowledge || '').trim() || undefined,
        ocrConfidence: blockInfo?.block.confidence ?? 0.9,
        knowledgeType: 'textbook_core',
        evaluationStatus: nextStatus,
        explanation: (adj.explanation || reason).trim(),
        correctKnowledge: (adj.correctKnowledge || adj.shortFix || '').trim(),
        suggestedFix: (adj.suggestedFix || adj.shortFix || '').trim() || undefined,
        evidences: [],
      };
      claims.push(newClaim);
      appliedCount += 1;
      addedCount += 1;
      continue;
    }

    if (targetIdx < 0) {
      rejectedCount += 1;
      notes.push(`Không tìm thấy mệnh đề mục tiêu cho điều chỉnh (${String(adj.claimId ?? adj.claimIndex)}).`);
      continue;
    }

    const target = claims[targetIdx];

    // Enforce previousStatus consistency when provided
    if (adj.previousStatus && adj.previousStatus !== target.evaluationStatus) {
      rejectedCount += 1;
      notes.push(
        `Từ chối điều chỉnh cho ${target.claimId}: trạng thái cũ không khớp (${adj.previousStatus} != ${target.evaluationStatus}).`
      );
      continue;
    }

    // Protect against ungrounded downgrade of INCORRECT -> CORRECT
    if (target.evaluationStatus === 'INCORRECT' && nextStatus === 'CORRECT') {
      const basis = (adj.evidenceBasis || '').trim();
      if (basis.length < 8 || reason.length < 12) {
        rejectedCount += 1;
        target.verificationNote = `Bước Dò nghi ngờ lỗi nhưng thiếu căn cứ cụ thể (${reason}); giữ nguyên để người học kiểm tra.`;
        notes.push(`Từ chối hạ lỗi ${target.claimId} từ INCORRECT -> CORRECT do thiếu evidenceBasis.`);
        continue;
      }
    }

    // Verify proposed errorSpan if present before mutating an existing valid span
    let nextErrorSpan = target.errorSpan;
    let nextStartOffset = target.startOffset;
    let nextEndOffset = target.endOffset;
    let nextLocationStatus = target.locationStatus;

    if (nextStatus === 'CORRECT') {
      nextErrorSpan = undefined;
      nextStartOffset = undefined;
      nextEndOffset = undefined;
      nextLocationStatus = undefined;
    } else if (nextStatus === 'MISSING') {
      nextErrorSpan = undefined;
      nextStartOffset = undefined;
      nextEndOffset = undefined;
      nextLocationStatus = 'anchor_missing';
    } else if (adj.errorSpan && adj.errorSpan.trim()) {
      const blockInfo = target.blockId ? blockLookup.get(target.blockId) : undefined;
      if (blockInfo) {
        const verified = verifyAndAnchorErrorSpan({
          blockText: blockInfo.block.extractedText,
          errorSpan: adj.errorSpan.trim(),
          sourceText: target.sourceText,
          contextBefore: adj.contextBefore || target.contextBefore,
          contextAfter: adj.contextAfter || target.contextAfter,
        });
        if (verified.locationStatus === 'verified') {
          nextErrorSpan = verified.verifiedSpan;
          nextStartOffset = verified.startOffset;
          nextEndOffset = verified.endOffset;
          nextLocationStatus = 'verified';
        } else if (!target.errorSpan) {
          // Keep proposed errorSpan text for display, but mark unverified (never fake underline)
          nextErrorSpan = adj.errorSpan.trim();
          nextStartOffset = undefined;
          nextEndOffset = undefined;
          nextLocationStatus = 'unverified';
        }
      } else {
        nextErrorSpan = adj.errorSpan.trim();
      }
    }

    const updated: ExtractedClaim = {
      ...target,
      evaluationStatus: nextStatus,
      errorSpan: nextErrorSpan,
      startOffset: nextStartOffset,
      endOffset: nextEndOffset,
      locationStatus: nextLocationStatus,
      contextBefore: adj.contextBefore?.trim() || target.contextBefore,
      contextAfter: adj.contextAfter?.trim() || target.contextAfter,
      shortFix:
        nextStatus === 'CORRECT'
          ? undefined
          : (adj.shortFix || target.shortFix || adj.suggestedFix || '').trim() || undefined,
      explanation: (adj.explanation || target.explanation || reason).trim(),
      correctKnowledge: (adj.correctKnowledge || target.correctKnowledge || '').trim(),
      suggestedFix:
        nextStatus === 'CORRECT'
          ? undefined
          : (adj.suggestedFix || target.suggestedFix || adj.shortFix || '').trim() || undefined,
      verificationNote: `Dò chéo (${target.evaluationStatus} → ${nextStatus}): ${reason}`,
    };

    claims[targetIdx] = updated;
    appliedCount += 1;
  }

  return { claims, appliedCount, rejectedCount, addedCount, notes };
}

/**
 * Post-processes graded & verified claims against actual OCR pages/blocks:
 * 1. Enforces block-level OCR confidence & `[KHÔNG NHÌN RÕ]` protection (never guess unreadable regions,
 *    while still grading clearly readable blocks on the same page).
 * 2. Verifies & anchors every `errorSpan` to exact UTF-16 `[startOffset, endOffset)` on its real block text,
 *    disambiguating duplicate phrases via blockId/context/sourceText and marking invalid or ambiguous spans
 *    as `locationStatus: 'unverified'` (never drawing false highlights or mutating student text).
 * 3. Anchors `MISSING` claims cleanly with `locationStatus: 'anchor_missing'` (no fake underline).
 * 4. Sorts claims & annotations deterministically by appearance order in the student document.
 * 5. Builds deduplicated `AnnotationItem[]` including `INCORRECT`, `PARTIALLY_CORRECT`, `MISSING`,
 *    and `OCR_UNCERTAIN`/`UNVERIFIED`/`AMBIGUOUS`.
 */
export function anchorClaimsAndBuildAnnotations(params: {
  claims: ExtractedClaim[];
  pages: ExtractedPage[];
  ocrConfirmed: boolean;
}): {
  claims: ExtractedClaim[];
  annotations: AnnotationItem[];
  lowConfidenceBlockIds: string[];
} {
  const { pages, ocrConfirmed } = params;
  const blockLookup = buildBlockLookup(pages);
  const lowConfidenceBlockIds: string[] = [];

  for (const page of pages) {
    for (const block of page.blocks || []) {
      if (isBlockOcrUncertain(block, ocrConfirmed)) {
        lowConfidenceBlockIds.push(block.blockId);
      }
    }
  }

  const findUniqueBlockForClaim = (
    claim: ExtractedClaim
  ): { block: ExtractedTextBlock; pageNumber: number } | null => {
    // 1. Explicit blockId match
    if (claim.blockId && blockLookup.has(claim.blockId)) {
      const found = blockLookup.get(claim.blockId)!;
      return { block: found.block, pageNumber: found.pageNumber };
    }
    if (Array.isArray(claim.blockIds)) {
      for (const bid of claim.blockIds) {
        if (blockLookup.has(bid)) {
          const found = blockLookup.get(bid)!;
          return { block: found.block, pageNumber: found.pageNumber };
        }
      }
    }

    // 2. Search within claim.sourcePage first (then all pages) for a UNIQUE matching block
    const targetPages = pages.filter((p) => p.pageNumber === (claim.sourcePage || 1));
    const searchPool = targetPages.length > 0 ? targetPages : pages;

    const matchingBlocks: Array<{ block: ExtractedTextBlock; pageNumber: number }> = [];
    for (const page of searchPool) {
      for (const block of page.blocks || []) {
        const res = verifyAndAnchorErrorSpan({
          blockText: block.extractedText,
          errorSpan: claim.errorSpan,
          sourceText: claim.sourceText,
          contextBefore: claim.contextBefore,
          contextAfter: claim.contextAfter,
          allowLegacyBlockFallback: !claim.errorSpan,
        });
        if (res.locationStatus === 'verified') {
          matchingBlocks.push({ block, pageNumber: page.pageNumber });
        }
      }
    }

    // Only auto-bind when match is STRICTLY unique across candidate blocks (never guess duplicate block)
    if (matchingBlocks.length === 1) {
      return matchingBlocks[0];
    }

    return null;
  };

  const processedClaims: ExtractedClaim[] = params.claims.map((rawClaim) => {
    const claim: ExtractedClaim = { ...rawClaim };
    const matched = findUniqueBlockForClaim(claim);

    if (matched) {
      claim.blockId = matched.block.blockId;
      claim.blockIds = Array.from(new Set([matched.block.blockId, ...(claim.blockIds || [])]));
      claim.sourcePage = matched.pageNumber;
      claim.boundingBox = claim.boundingBox ?? matched.block.boundingBox ?? null;
    }

    // Rule A: MISSING claim — anchor cleanly to its associated block (or last block of sourcePage), never underline text
    if (claim.evaluationStatus === 'MISSING') {
      if (!claim.blockId) {
        const page = pages.find((p) => p.pageNumber === (claim.sourcePage || 1)) || pages[0];
        const lastBlock = page?.blocks?.[page.blocks.length - 1];
        if (lastBlock) {
          claim.blockId = lastBlock.blockId;
          claim.blockIds = [lastBlock.blockId];
        }
      }
      claim.errorSpan = undefined;
      claim.startOffset = undefined;
      claim.endOffset = undefined;
      claim.locationStatus = 'anchor_missing';
      return claim;
    }

    // Rule B: Block-level OCR confidence & `[KHÔNG NHÌN RÕ]` safeguard
    const targetBlock = claim.blockId ? blockLookup.get(claim.blockId)?.block : undefined;
    const sourceContainsUnreadable =
      (claim.sourceText || '').includes(UNREADABLE_OCR_MARKER) ||
      (claim.errorSpan || '').includes(UNREADABLE_OCR_MARKER);
    const blockReadableWithoutMarker = targetBlock
      ? targetBlock.extractedText.replace(/\[KHÔNG NHÌN RÕ\]/gi, '').replace(/[\s\p{P}]+/gu, '')
      : '';
    const blockMostlyUnreadable = Boolean(
      targetBlock &&
        targetBlock.extractedText.includes(UNREADABLE_OCR_MARKER) &&
        blockReadableWithoutMarker.length < 8
    );
    const blockLowConf = Boolean(
      targetBlock &&
        !ocrConfirmed &&
        typeof targetBlock.confidence === 'number' &&
        targetBlock.confidence < OCR_BLOCK_LOW_CONFIDENCE_THRESHOLD
    );

    if (
      claim.evaluationStatus !== 'OUT_OF_SCOPE' &&
      (sourceContainsUnreadable || blockMostlyUnreadable || blockLowConf)
    ) {
      const confVal =
        targetBlock && typeof targetBlock.confidence === 'number'
          ? Math.min(claim.ocrConfidence ?? 1, targetBlock.confidence)
          : Math.min(claim.ocrConfidence ?? 0.5, 0.5);
      claim.ocrConfidence = Math.round(confVal * 100) / 100;
      if (
        claim.evaluationStatus === 'INCORRECT' ||
        claim.evaluationStatus === 'CORRECT' ||
        claim.evaluationStatus === 'PARTIALLY_CORRECT'
      ) {
        claim.evaluationStatus = 'OCR_UNCERTAIN';
        claim.explanation = sourceContainsUnreadable || blockMostlyUnreadable
          ? 'Đoạn này chứa vùng OCR không nhìn rõ ([KHÔNG NHÌN RÕ]); hệ thống không suy đoán để tránh chấm sai. Vui lòng chụp rõ hơn hoặc sửa lại văn bản OCR.'
          : `Độ tin cậy OCR của đoạn này thấp (${Math.round(claim.ocrConfidence * 100)}%); hệ thống tạm đánh dấu cần kiểm tra lại chữ nhận dạng trước khi kết luận đúng/sai.`;
        claim.shortFix = 'Kiểm tra lại chữ OCR ở đoạn này và đối chiếu với bài làm gốc.';
      }
    }

    // Rule C: Verify & anchor errorSpan / sourceText strictly on the exact block text
    if (!targetBlock) {
      if (
        claim.evaluationStatus === 'INCORRECT' ||
        claim.evaluationStatus === 'PARTIALLY_CORRECT' ||
        claim.evaluationStatus === 'OCR_UNCERTAIN' ||
        claim.evaluationStatus === 'UNVERIFIED' ||
        claim.evaluationStatus === 'AMBIGUOUS'
      ) {
        claim.startOffset = undefined;
        claim.endOffset = undefined;
        claim.locationStatus = 'unverified';
        if (!claim.verificationNote) {
          claim.verificationNote = 'Không xác định được duy nhất đoạn văn bản chứa lỗi trên bản gốc.';
        }
      }
      return claim;
    }

    const anchored = verifyAndAnchorErrorSpan({
      blockText: targetBlock.extractedText,
      errorSpan:
        claim.evaluationStatus === 'CORRECT' || claim.evaluationStatus === 'OUT_OF_SCOPE'
          ? undefined
          : claim.errorSpan,
      sourceText: claim.sourceText,
      startOffset: claim.startOffset,
      endOffset: claim.endOffset,
      contextBefore: claim.contextBefore,
      contextAfter: claim.contextAfter,
      allowLegacyBlockFallback: !claim.errorSpan,
    });

    if (
      anchored.locationStatus === 'verified' &&
      typeof anchored.startOffset === 'number' &&
      typeof anchored.endOffset === 'number'
    ) {
      claim.startOffset = anchored.startOffset;
      claim.endOffset = anchored.endOffset;
      if (claim.evaluationStatus !== 'CORRECT' && claim.evaluationStatus !== 'OUT_OF_SCOPE') {
        claim.errorSpan = anchored.verifiedSpan;
        claim.locationStatus = 'verified';
      }
    } else if (
      claim.evaluationStatus === 'INCORRECT' ||
      claim.evaluationStatus === 'PARTIALLY_CORRECT' ||
      claim.evaluationStatus === 'OCR_UNCERTAIN' ||
      claim.evaluationStatus === 'UNVERIFIED' ||
      claim.evaluationStatus === 'AMBIGUOUS'
    ) {
      claim.startOffset = undefined;
      claim.endOffset = undefined;
      claim.locationStatus = 'unverified';
      if (!claim.verificationNote) {
        claim.verificationNote =
          anchored.reason === 'ambiguous_duplicate_span'
            ? 'Cụm từ xuất hiện nhiều lần trong đoạn nhưng thiếu ngữ cảnh định vị duy nhất.'
            : 'Cụm từ lỗi do AI trích không khớp chính xác với văn bản nguyên bản.';
      }
    }

    return claim;
  });

  // Sort deterministically by real appearance order in the student document
  const sortedClaims = sortClaimsByDocumentPosition(processedClaims, pages);

  // Build deduplicated annotations including MISSING & unverified-location claims
  const annotations: AnnotationItem[] = [];
  const seenAnnotationKeys = new Set<string>();

  for (const claim of sortedClaims) {
    if (claim.evaluationStatus === 'CORRECT' || claim.evaluationStatus === 'OUT_OF_SCOPE') {
      continue;
    }

    let color: AnnotationItem['annotationColor'] = 'yellow';
    let kind: AnnotationItem['annotationKind'] = 'ocr_warning';

    if (claim.evaluationStatus === 'INCORRECT') {
      color = 'red';
      kind = 'error';
    } else if (claim.evaluationStatus === 'PARTIALLY_CORRECT') {
      color = 'orange';
      kind = 'partial';
    } else if (claim.evaluationStatus === 'MISSING') {
      color = 'orange';
      kind = 'missing';
    } else {
      color = 'yellow';
      kind = 'ocr_warning';
    }

    const dedupKey = [
      claim.sourcePage || 1,
      claim.blockId || 'no_block',
      claim.evaluationStatus,
      claim.locationStatus || 'unknown',
      claim.startOffset ?? 'na',
      claim.endOffset ?? 'na',
      normalizeCompactKey(claim.errorSpan || claim.concept || claim.sourceText).slice(0, 80),
    ].join('|');

    if (seenAnnotationKeys.has(dedupKey)) {
      continue;
    }
    seenAnnotationKeys.add(dedupKey);

    annotations.push({
      annotationId: `ann_${annotations.length + 1}`,
      pageNumber: claim.sourcePage || 1,
      blockId: claim.blockId,
      blockIds: claim.blockIds,
      textExcerpt: claim.sourceText,
      errorSpan: claim.errorSpan,
      startOffset: claim.startOffset,
      endOffset: claim.endOffset,
      locationStatus: claim.locationStatus,
      annotationKind: kind,
      claimId: claim.claimId,
      boundingBox: claim.boundingBox ?? null,
      annotationColor: color,
      reason: claim.explanation,
      evidenceId: claim.evidences[0]?.evidenceId,
    });
  }

  return {
    claims: sortedClaims,
    annotations,
    lowConfidenceBlockIds,
  };
}
