import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  FileText,
  Moon,
  Search,
  Sparkles,
  Sun,
} from 'lucide-react';
import { SUBJECT_LABELS, type AnalysisRecord } from '../../core/types';
import { useTheme } from '../../context/ThemeContext';
import { useUiMode } from '../../context/UiModeContext';
import { AnimatedModal } from './AnimatedModal';

export interface CommandPaletteNavItem {
  id: string;
  label: string;
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  navItems: CommandPaletteNavItem[];
  analyses: AnalysisRecord[];
  onSelectNav: (id: string) => void;
  onSelectAnalysis: (analysisId: string) => void;
}

interface CommandEntry {
  key: string;
  group: 'Điều hướng' | 'Phân tích gần đây' | 'Tùy chỉnh giao diện';
  label: string;
  subtitle?: string;
  icon: React.ComponentType<{ className?: string }>;
  run: () => void;
}

/**
 * Keyboard-first Quick Jump Command Palette (Ctrl+K / Cmd+K),
 * built on AnimatedModal for consistent fade + scale + backdrop blur.
 */
export const CommandPalette: React.FC<CommandPaletteProps> = ({
  open,
  onClose,
  navItems,
  analyses,
  onSelectNav,
  onSelectAnalysis,
}) => {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';
  const { isEthereal, toggleUiMode } = useUiMode();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      const timer = window.setTimeout(() => inputRef.current?.focus(), 40);
      return () => window.clearTimeout(timer);
    }
  }, [open]);

  const entries = useMemo<CommandEntry[]>(() => {
    const navEntries: CommandEntry[] = navItems.map((item) => ({
      key: `nav-${item.id}`,
      group: 'Điều hướng',
      label: item.label,
      subtitle: item.hint,
      icon: item.icon,
      run: () => {
        onSelectNav(item.id);
        onClose();
      },
    }));

    const analysisEntries: CommandEntry[] = analyses.slice(0, 6).map((a) => ({
      key: `an-${a.analysisId}`,
      group: 'Phân tích gần đây',
      label: a.documentTitle,
      subtitle: `${SUBJECT_LABELS[a.subject]} · Lớp ${a.grade}${
        a.accuracyScore !== null ? ` · Chính xác ${a.accuracyScore}%` : ''
      }`,
      icon: FileText,
      run: () => {
        onSelectAnalysis(a.analysisId);
        onClose();
      },
    }));

    const themeEntries: CommandEntry[] = [
      {
        key: 'toggle-ui-mode',
        group: 'Tùy chỉnh giao diện',
        label: isEthereal
          ? 'Chuyển sang giao diện Cổ điển (tối giản)'
          : 'Chuyển sang giao diện Hiện đại (Liquid Glass)',
        subtitle: 'Giữ nguyên toàn bộ dữ liệu và tính năng',
        icon: Sparkles,
        run: () => {
          toggleUiMode();
          onClose();
        },
      },
      {
        key: 'toggle-dark-mode',
        group: 'Tùy chỉnh giao diện',
        label: isDark ? 'Chuyển sang chế độ Sáng (Light Mode)' : 'Chuyển sang chế độ Tối (Dark Mode)',
        subtitle: 'Cân chỉnh độ tương phản nền',
        icon: isDark ? Sun : Moon,
        run: () => {
          toggleTheme();
          onClose();
        },
      },
    ];

    const all = [...navEntries, ...analysisEntries, ...themeEntries];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (entry) =>
        entry.label.toLowerCase().includes(q) ||
        (entry.subtitle && entry.subtitle.toLowerCase().includes(q)) ||
        entry.group.toLowerCase().includes(q)
    );
  }, [
    navItems,
    analyses,
    query,
    isEthereal,
    isDark,
    onSelectNav,
    onSelectAnalysis,
    onClose,
    toggleUiMode,
    toggleTheme,
  ]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((idx) => (entries.length > 0 ? (idx + 1) % entries.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((idx) =>
        entries.length > 0 ? (idx - 1 + entries.length) % entries.length : 0
      );
    } else if (e.key === 'Enter' && entries[activeIndex]) {
      e.preventDefault();
      entries[activeIndex].run();
    }
  };

  const grouped = useMemo(() => {
    const groups: Array<{ name: CommandEntry['group']; items: Array<{ entry: CommandEntry; flatIndex: number }> }> = [];
    const order: CommandEntry['group'][] = ['Điều hướng', 'Phân tích gần đây', 'Tùy chỉnh giao diện'];
    let flatIndex = 0;
    for (const g of order) {
      const matched = entries.filter((e) => e.group === g);
      if (matched.length > 0) {
        groups.push({
          name: g,
          items: matched.map((entry) => ({ entry, flatIndex: flatIndex++ })),
        });
      }
    }
    return groups;
  }, [entries]);

  return (
    <AnimatedModal
      open={open}
      onClose={onClose}
      ariaLabel="Bảng tìm kiếm và điều hướng nhanh"
      maxWidthClassName="max-w-xl"
      panelClassName="p-0 overflow-hidden"
    >
      <div className="flex items-center gap-3 px-4 sm:px-5 py-3.5 border-b border-indigo-100/80 dark:border-slate-700/80">
        <Search className="w-4 h-4 text-indigo-500 dark:text-indigo-400 shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Tìm tính năng, bài phân tích gần đây hoặc chuyển giao diện..."
          className="w-full bg-transparent text-sm text-[#171B3A] dark:text-[#EEF1FF] placeholder:text-slate-400 focus:outline-none"
        />
        <kbd className="hidden sm:inline-block font-mono text-[10px] px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-slate-800 text-slate-500 dark:text-slate-300 border border-indigo-200/70 dark:border-slate-700">
          ESC
        </kbd>
      </div>

      <div className="max-h-[380px] overflow-y-auto p-2.5 sm:p-3 space-y-3">
        {grouped.length === 0 ? (
          <div className="py-10 text-center text-xs text-slate-500 dark:text-slate-400">
            Không tìm thấy kết quả phù hợp với “{query}”.
          </div>
        ) : (
          grouped.map((group) => (
            <div key={group.name}>
              <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400">
                {group.name}
              </p>
              <div className="space-y-0.5">
                {group.items.map(({ entry, flatIndex }) => {
                  const Icon = entry.icon;
                  const isHighlighted = flatIndex === activeIndex;
                  return (
                    <button
                      key={entry.key}
                      type="button"
                      onMouseEnter={() => setActiveIndex(flatIndex)}
                      onClick={entry.run}
                      className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-2xl text-left cursor-pointer transition-colors duration-150 ${
                        isHighlighted
                          ? 'bg-indigo-500/12 dark:bg-indigo-500/22 text-[#171B3A] dark:text-white'
                          : 'text-[#334155] dark:text-[#CBD5E1] hover:bg-indigo-50/70 dark:hover:bg-white/5'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span
                          className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 transition-colors ${
                            isHighlighted
                              ? 'bg-gradient-to-br from-[#4F46E5] to-[#7C3AED] text-white shadow-sm'
                              : 'bg-white/80 dark:bg-slate-800/80 text-indigo-600 dark:text-indigo-400 border border-indigo-100/80 dark:border-slate-700'
                          }`}
                        >
                          <Icon className="w-4 h-4" />
                        </span>
                        <div className="min-w-0">
                          <p className="text-xs sm:text-sm font-semibold truncate">{entry.label}</p>
                          {entry.subtitle && (
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                              {entry.subtitle}
                            </p>
                          )}
                        </div>
                      </div>
                      <ArrowRight
                        className={`w-3.5 h-3.5 shrink-0 transition-transform duration-150 ${
                          isHighlighted
                            ? 'text-indigo-600 dark:text-indigo-300 translate-x-0.5'
                            : 'text-slate-300 dark:text-slate-600'
                        }`}
                      />
                    </button>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="px-4 py-2.5 border-t border-indigo-100/80 dark:border-slate-700/80 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 bg-indigo-50/40 dark:bg-slate-900/40">
        <span>Dùng ↑ ↓ để chọn · Enter để mở</span>
        <span className="font-mono">Ctrl + K</span>
      </div>
    </AnimatedModal>
  );
};
