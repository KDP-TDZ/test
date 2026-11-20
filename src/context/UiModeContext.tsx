import React, { createContext, useContext, useEffect, useState } from 'react';

export type UiMode = 'classic' | 'ethereal';

interface UiModeContextValue {
  uiMode: UiMode;
  setUiMode: (mode: UiMode) => void;
  toggleUiMode: () => void;
  isEthereal: boolean;
}

const UiModeContext = createContext<UiModeContextValue | undefined>(undefined);
const STORAGE_KEY = 'studycheck_ui_mode';

export const UiModeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [uiMode, setUiModeState] = useState<UiMode>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'classic' || saved === 'ethereal') return saved;
    } catch {
      // Ignore storage access errors
    }
    return 'ethereal';
  });

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.uiMode = uiMode;
    try {
      localStorage.setItem(STORAGE_KEY, uiMode);
    } catch {
      // Ignore storage access errors
    }
  }, [uiMode]);

  const setUiMode = (next: UiMode) => setUiModeState(next);
  const toggleUiMode = () => setUiModeState((prev) => (prev === 'classic' ? 'ethereal' : 'classic'));

  return (
    <UiModeContext.Provider
      value={{
        uiMode,
        setUiMode,
        toggleUiMode,
        isEthereal: uiMode === 'ethereal',
      }}
    >
      {children}
    </UiModeContext.Provider>
  );
};

export function useUiMode(): UiModeContextValue {
  const ctx = useContext(UiModeContext);
  if (!ctx) {
    throw new Error('useUiMode must be used inside UiModeProvider');
  }
  return ctx;
}
