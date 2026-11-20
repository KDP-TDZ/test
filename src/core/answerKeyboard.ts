export type AbcdChoice = 'A' | 'B' | 'C' | 'D';

export interface EditableTargetLike {
  tagName?: string;
  isContentEditable?: boolean;
  getAttribute?: (name: string) => string | null;
}

/**
 * Returns true when focus is inside an editable form field so keyboard shortcuts
 * (1-4 / A-D / arrows) never hijack typing in short-answer inputs or report fields.
 */
export function isEditableKeyboardTarget(target: EditableTargetLike | null | undefined): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = (target.tagName || '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    return true;
  }
  const role = target.getAttribute?.('role');
  if (role === 'textbox' || role === 'combobox') {
    return true;
  }
  return false;
}

/**
 * Maps desktop shortcut keys (1-4 or A-D, case-insensitive) to an ABCD option.
 */
export function mapKeyToAbcdChoice(key: string): AbcdChoice | null {
  const normalized = key.trim().toUpperCase();
  if (normalized === '1' || normalized === 'A') return 'A';
  if (normalized === '2' || normalized === 'B') return 'B';
  if (normalized === '3' || normalized === 'C') return 'C';
  if (normalized === '4' || normalized === 'D') return 'D';
  return null;
}

/**
 * Computes next active question index on ArrowUp / ArrowDown navigation.
 */
export function computeNextQuestionIndex(
  currentIndex: number,
  key: string,
  totalQuestions: number
): number | null {
  if (totalQuestions <= 0) return null;
  if (key === 'ArrowDown') {
    return Math.min(totalQuestions - 1, Math.max(0, currentIndex + 1));
  }
  if (key === 'ArrowUp') {
    return Math.max(0, Math.min(totalQuestions - 1, currentIndex - 1));
  }
  return null;
}
