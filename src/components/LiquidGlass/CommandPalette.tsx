import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  FileText,
  Moon,
  Search,
  Sun,
} from 'lucide-react';
import { SUBJECT_LABELS, type AnalysisRecord } from '../../core/types';
import { useTheme } from '../../context/ThemeContext';
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
  group: 'Điều hướng' | 'Phân tích gần đây' | 'Tùy chỉnh hiển thị';
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
        key: 'toggle-dark-mode',
        group: 'Tùy chỉnh hiển thị',
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
    isDark,
    onSelectNav,
    onSelectAnalysis,
    onClose,
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
    const order: CommandEntry['group'][] = ['Điều hướng', 'Phân tích gần đây', 'Tùy chỉnh hiển thị'];
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
      panelClassName="p-0 overflow-hidden bg-white dark:bg-[#111B30] border border-[#E6ECF5] dark:border-[#1E293B]"
    >
      <div className="flex items-center gap-3 px-4 sm:px-5 py-3.5 border-b border-[#E6ECF5] dark:border-[#1E293B]">
        <Search className="w-4 h-4 text-[#2563EB] dark:text-[#60A5FA] shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Tìm tính năng, bài phân tích gần đây hoặc chuyển chế độ màu..."
          className="w-full bg-transparent text-sm text-[#172033] dark:text-[#E6EFFC] placeholder:text-[#525E75]/70 dark:placeholder:text-[#94A3B8]/70 focus:outline-none"
        />
        <kbd className="hidden sm:inline-block font-mono text-[10px] px-2 py-0.5 rounded-md bg-[#F1F5FA] dark:bg-[#0D1628] text-[#525E75] dark:text-[#94A3B8] border border-[#E6ECF5] dark:border-[#334155]">
          ESC
        </kbd>
      </div>

      <div className="max-h-[380px] overflow-y-auto p-2.5 sm:p-3 space-y-3">
        {grouped.length === 0 ? (
          <div className="py-10 text-center text-xs text-[#525E75] dark:text-[#94A3B8]">
            Không tìm thấy kết quả phù hợp với “{query}”.
          </div>
        ) : (
          grouped.map((group) => (
            <div key={group.name}>
              <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#525E75] dark:text-[#94A3B8]">
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
                      className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl text-left cursor-pointer transition-colors duration-150 ${
                        isHighlighted
                          ? 'bg-[#EAF2FF] dark:bg-[#2563EB]/20 text-[#172033] dark:text-white'
                          : 'text-[#172033] dark:text-[#CBD5E1] hover:bg-[#F1F5FA] dark:hover:bg-[#0D1628]'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span
                          className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                            isHighlighted
                              ? 'bg-[#2563EB] text-white shadow-xs'
                              : 'bg-[#F1F5FA] dark:bg-[#0D1628] text-[#2563EB] dark:text-[#60A5FA] border border-[#E6ECF5] dark:border-[#1E293B]'
                          }`}
                        >
                          <Icon className="w-4 h-4" />
                        </span>
                        <div className="min-w-0">
                          <p className="text-xs sm:text-sm font-semibold truncate">{entry.label}</p>
                          {entry.subtitle && (
                            <p className="text-[11px] text-[#525E75] dark:text-[#94A3B8] truncate">
                              {entry.subtitle}
                            </p>
                          )}
                        </div>
                      </div>
                      <ArrowRight
                        className={`w-3.5 h-3.5 shrink-0 transition-transform duration-150 ${
                          isHighlighted
                            ? 'text-[#2563EB] dark:text-[#60A5FA] translate-x-0.5'
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

      <div className="px-4 py-2.5 border-t border-[#E6ECF5] dark:border-[#1E293B] flex items-center justify-between text-[11px] text-[#525E75] dark:text-[#94A3B8] bg-[#F8FAFC] dark:bg-[#0D1628]">
        <span>Dùng ↑ ↓ để chọn · Enter để mở</span>
        <span className="font-mono">Ctrl + K</span>
      </div>
    </AnimatedModal>
  );
};
