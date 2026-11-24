export const SESSION_HINT_STORAGE_KEY = 'studycheck_has_session';

export interface MinimalStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function getDefaultStorage(): MinimalStorage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // Ignore restricted storage environments (e.g. private browsing / sandboxed iframe)
  }
  return null;
}

/**
 * Returns true if the browser previously recorded an authenticated Firebase session.
 * Used to avoid flashing the landing page for returning signed-in users while allowing
 * first-time / signed-out visitors to paint the landing page immediately without waiting
 * for Firebase Auth network/IndexedDB initialization.
 */
export function readHasSessionHint(storage?: MinimalStorage | null): boolean {
  const target = storage === undefined ? getDefaultStorage() : storage;
  if (!target) return false;
  try {
    return target.getItem(SESSION_HINT_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeHasSessionHint(
  hasSession: boolean,
  storage?: MinimalStorage | null
): void {
  const target = storage === undefined ? getDefaultStorage() : storage;
  if (!target) return;
  try {
    if (hasSession) {
      target.setItem(SESSION_HINT_STORAGE_KEY, '1');
    } else {
      target.removeItem(SESSION_HINT_STORAGE_KEY);
    }
  } catch {
    // Ignore storage quota or security errors
  }
}
