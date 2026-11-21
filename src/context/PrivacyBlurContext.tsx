import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthContext';

interface PrivacyBlurContextValue {
  privacyBlur: boolean;
  canUsePrivacyBlur: boolean;
  setPrivacyBlur: (next: boolean) => void;
  togglePrivacyBlur: () => void;
}

const PrivacyBlurContext = createContext<PrivacyBlurContextValue | undefined>(undefined);
const STORAGE_KEY = 'studycheck_privacy_blur';

export const PrivacyBlurProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isSuperAdmin } = useAuth();
  const canUsePrivacyBlur = Boolean(user && isSuperAdmin);

  const [privacyBlur, setPrivacyBlurState] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const originalTitleRef = useRef<string | null>(null);

  const effectivePrivacyBlur = canUsePrivacyBlur && privacyBlur;

  // Immediately reset state & storage if user is not an authenticated Admin
  useEffect(() => {
    if (!canUsePrivacyBlur && privacyBlur) {
      setPrivacyBlurState(false);
    }
  }, [canUsePrivacyBlur, privacyBlur]);

  useEffect(() => {
    const root = document.documentElement;
    if (effectivePrivacyBlur) {
      root.dataset.privacyBlur = 'true';
      if (originalTitleRef.current === null) {
        originalTitleRef.current = document.title;
      }
      document.title = 'UI Showcase';
    } else {
      delete root.dataset.privacyBlur;
      if (originalTitleRef.current !== null) {
        document.title = originalTitleRef.current;
        originalTitleRef.current = null;
      }
    }

    try {
      if (canUsePrivacyBlur) {
        sessionStorage.setItem(STORAGE_KEY, effectivePrivacyBlur ? 'true' : 'false');
      } else {
        sessionStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // Ignore storage access errors
    }
  }, [effectivePrivacyBlur, canUsePrivacyBlur]);

  // Admin-exclusive quick toggle shortcut: Ctrl+H
  useEffect(() => {
    if (!canUsePrivacyBlur) return;

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        setPrivacyBlurState((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [canUsePrivacyBlur]);

  const setPrivacyBlur = useCallback(
    (next: boolean) => {
      if (!canUsePrivacyBlur) return;
      setPrivacyBlurState(next);
    },
    [canUsePrivacyBlur]
  );

  const togglePrivacyBlur = useCallback(() => {
    if (!canUsePrivacyBlur) return;
    setPrivacyBlurState((prev) => !prev);
  }, [canUsePrivacyBlur]);

  return (
    <PrivacyBlurContext.Provider
      value={{
        privacyBlur: effectivePrivacyBlur,
        canUsePrivacyBlur,
        setPrivacyBlur,
        togglePrivacyBlur,
      }}
    >
      {children}
    </PrivacyBlurContext.Provider>
  );
};

export function usePrivacyBlur(): PrivacyBlurContextValue {
  const ctx = useContext(PrivacyBlurContext);
  if (!ctx) {
    throw new Error('usePrivacyBlur must be used inside PrivacyBlurProvider');
  }
  return ctx;
}
