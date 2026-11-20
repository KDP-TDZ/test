import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

interface PrivacyBlurContextValue {
  privacyBlur: boolean;
  setPrivacyBlur: (next: boolean) => void;
  togglePrivacyBlur: () => void;
}

const PrivacyBlurContext = createContext<PrivacyBlurContextValue | undefined>(undefined);
const STORAGE_KEY = 'studycheck_privacy_blur';

export const PrivacyBlurProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [privacyBlur, setPrivacyBlurState] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const originalTitleRef = useRef<string | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    if (privacyBlur) {
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
      sessionStorage.setItem(STORAGE_KEY, privacyBlur ? 'true' : 'false');
    } catch {
      // Ignore storage access errors
    }
  }, [privacyBlur]);

  // Quick toggle shortcut: Alt+B
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setPrivacyBlurState((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const setPrivacyBlur = useCallback((next: boolean) => setPrivacyBlurState(next), []);
  const togglePrivacyBlur = useCallback(() => setPrivacyBlurState((prev) => !prev), []);

  return (
    <PrivacyBlurContext.Provider
      value={{
        privacyBlur,
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
