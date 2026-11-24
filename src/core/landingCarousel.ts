/**
 * Pure state-transition helpers for the StudyCheck AI fullscreen expanding-card landing carousel.
 */

export function stepSlideIndex(currentIndex: number, total: number, delta: number): number {
  if (total <= 0) return 0;
  const normalizedCurrent = ((Math.trunc(currentIndex) % total) + total) % total;
  const next = (normalizedCurrent + Math.trunc(delta)) % total;
  return (next + total) % total;
}

/**
 * Returns the ordered indices of upcoming slides starting right after `activeIndex`.
 * For example, with total=5 and activeIndex=1, returns [2, 3, 4, 0].
 */
export function getUpcomingIndices(activeIndex: number, total: number): number[] {
  if (total <= 1) return [];
  const safeActive = stepSlideIndex(activeIndex, total, 0);
  const result: number[] = [];
  for (let offset = 1; offset < total; offset += 1) {
    result.push((safeActive + offset) % total);
  }
  return result;
}

/**
 * Computes the horizontal progress bar fill percentage (0..100) for the active slide.
 */
export function computeProgressPercent(activeIndex: number, total: number): number {
  if (total <= 0) return 0;
  const safeActive = stepSlideIndex(activeIndex, total, 0);
  return Math.round(((safeActive + 1) / total) * 10000) / 100;
}

/**
 * Formats a zero-based slide index as a two-digit display counter ("01", "02", ...).
 */
export function formatSlideNumber(activeIndex: number, total: number): string {
  if (total <= 0) return '00';
  const safeActive = stepSlideIndex(activeIndex, total, 0);
  return String(safeActive + 1).padStart(2, '0');
}

/**
 * Immutably toggles an item ID inside a bookmark collection.
 */
export function toggleBookmarkId(bookmarkedIds: readonly string[], targetId: string): string[] {
  if (bookmarkedIds.includes(targetId)) {
    return bookmarkedIds.filter((id) => id !== targetId);
  }
  return [...bookmarkedIds, targetId];
}
