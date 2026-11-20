/**
 * Pure deterministic UI calculation utilities for Dock magnification,
 * Carousel slide navigation, and Hero Typewriter progression.
 */

export interface DockMagnificationConfig {
  baseScale?: number;
  maxScale?: number;
  neighborScale?: number;
  farNeighborScale?: number;
  maxLiftPx?: number;
}

export interface DockItemTransform {
  scale: number;
  liftY: number;
}

/**
 * Computes macOS Dock wave magnification scale and vertical lift
 * strictly as compositor transform values (`scale`, `translateY`).
 */
export function computeDockItemTransform(
  itemIndex: number,
  hoveredIndex: number | null,
  reducedMotion = false,
  config: DockMagnificationConfig = {}
): DockItemTransform {
  const baseScale = config.baseScale ?? 1;
  if (reducedMotion || hoveredIndex === null || hoveredIndex < 0 || itemIndex < 0) {
    return { scale: baseScale, liftY: 0 };
  }

  const maxScale = config.maxScale ?? 1.26;
  const neighborScale = config.neighborScale ?? 1.12;
  const farNeighborScale = config.farNeighborScale ?? 1.04;
  const maxLiftPx = config.maxLiftPx ?? -6;

  const distance = Math.abs(itemIndex - hoveredIndex);
  if (distance === 0) {
    return { scale: maxScale, liftY: maxLiftPx };
  }
  if (distance === 1) {
    return { scale: neighborScale, liftY: Math.round(maxLiftPx * 0.45 * 10) / 10 };
  }
  if (distance === 2) {
    return { scale: farNeighborScale, liftY: Math.round(maxLiftPx * 0.18 * 10) / 10 };
  }
  return { scale: baseScale, liftY: 0 };
}

/**
 * Computes next carousel slide index safely for Prev/Next/Keyboard controls.
 */
export function computeCarouselTargetIndex(
  currentIndex: number,
  delta: number,
  totalSlides: number,
  loop = false
): number {
  if (totalSlides <= 0) return 0;
  const safeCurrent = Math.min(Math.max(0, Math.trunc(currentIndex)), totalSlides - 1);
  const rawNext = safeCurrent + Math.trunc(delta);

  if (loop) {
    return ((rawNext % totalSlides) + totalSlides) % totalSlides;
  }
  return Math.min(Math.max(0, rawNext), totalSlides - 1);
}

export interface TypewriterFrame {
  visibleText: string;
  charCount: number;
  isComplete: boolean;
}

/**
 * Deterministic progression for the Hero Typewriter animation.
 * Uses Array.from so Vietnamese diacritics/surrogate pairs never split mid-codepoint.
 */
export function computeTypewriterFrame(
  fullText: string,
  elapsedMs: number,
  charIntervalMs = 34,
  reducedMotion = false
): TypewriterFrame {
  const chars = Array.from(fullText);
  if (reducedMotion || chars.length === 0) {
    return {
      visibleText: fullText,
      charCount: chars.length,
      isComplete: true,
    };
  }

  const safeElapsed = Math.max(0, elapsedMs);
  const safeInterval = Math.max(1, charIntervalMs);
  const count = Math.min(chars.length, Math.floor(safeElapsed / safeInterval));

  return {
    visibleText: chars.slice(0, count).join(''),
    charCount: count,
    isComplete: count >= chars.length,
  };
}
