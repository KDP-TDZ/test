import React from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';

export const ThemeToggle: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? 'Chuyển sang giao diện Sáng' : 'Chuyển sang giao diện Tối'}
      title={isDark ? 'Giao diện Sáng' : 'Giao diện Tối'}
      className={`inline-flex items-center gap-1.5 rounded-xl glass-control px-3 py-2 text-xs font-medium cursor-pointer shrink-0 whitespace-nowrap ${className}`}
    >
      {isDark ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-sky-600" />}
      <span className="hidden sm:inline">{isDark ? 'Sáng' : 'Tối'}</span>
    </button>
  );
};
