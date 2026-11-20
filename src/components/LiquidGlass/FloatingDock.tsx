import React from 'react';
import { Command } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';

export interface FloatingDockItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
}

interface FloatingDockProps {
  items: FloatingDockItem[];
  activeId: string;
  onSelect: (id: string) => void;
  onOpenCommandPalette: () => void;
}

/**
 * Liquid Glass Floating Bottom Dock (Ethereal UI mode).
 * Hidden on narrow mobile viewports (where the hamburger drawer handles nav)
 * to preserve viewport clarity and stay compact on desktop/tablet.
 */
export const FloatingDock: React.FC<FloatingDockProps> = ({
  items,
  activeId,
  onSelect,
  onOpenCommandPalette,
}) => {
  const prefersReduced = useReducedMotion();

  return (
    <nav
      aria-label="Thanh điều hướng nổi"
      className="no-print hidden md:flex fixed bottom-5 left-1/2 -translate-x-1/2 z-40 pointer-events-none"
    >
      <div className="ethereal-dock pointer-events-auto flex items-center gap-1.5 rounded-[22px] px-2.5 py-2">
        {items.map((item) => {
          const Icon = item.icon;
          const active = item.id === activeId;
          return (
            <motion.button
              key={item.id}
              type="button"
              onClick={() => onSelect(item.id)}
              aria-current={active ? 'page' : undefined}
              aria-label={item.label}
              title={item.label}
              whileHover={prefersReduced ? undefined : { y: -4, scale: 1.08 }}
              whileTap={prefersReduced ? undefined : { scale: 0.94 }}
              transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              className={`group relative h-11 w-11 rounded-2xl flex items-center justify-center cursor-pointer transition-colors duration-180 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                active
                  ? 'text-white'
                  : 'text-[#4B5578] dark:text-[#B9C2E6] hover:text-[#1D2348] dark:hover:text-white hover:bg-indigo-50/80 dark:hover:bg-white/10'
              }`}
            >
              {active && (
                <motion.span
                  layoutId="ethereal-dock-active"
                  aria-hidden="true"
                  transition={
                    prefersReduced
                      ? { duration: 0 }
                      : { type: 'spring', stiffness: 460, damping: 34, mass: 0.7 }
                  }
                  className="absolute inset-0 rounded-2xl bg-gradient-to-br from-[#4F46E5] via-[#6366F1] to-[#8B5CF6] shadow-[0_10px_24px_-6px_rgba(79,70,229,0.6),inset_0_1px_0_rgba(255,255,255,0.4)]"
                />
              )}

              <Icon className="relative z-10 w-[19px] h-[19px]" />

              {typeof item.badge === 'number' && item.badge > 0 && (
                <span className="absolute -top-0.5 -right-0.5 z-20 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center shadow-sm">
                  {item.badge > 99 ? '99+' : item.badge}
                </span>
              )}

              {/* Hover tooltip */}
              <span className="pointer-events-none absolute -top-10 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-lg bg-[#171B3A] dark:bg-white text-white dark:text-[#171B3A] text-[11px] font-semibold whitespace-nowrap opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-150 shadow-lg">
                {item.label}
              </span>
            </motion.button>
          );
        })}

        <span
          aria-hidden="true"
          className="h-6 w-px mx-1 bg-indigo-200/80 dark:bg-indigo-400/20 shrink-0"
        />

        <motion.button
          type="button"
          onClick={onOpenCommandPalette}
          aria-label="Mở bảng lệnh nhanh (Ctrl+K)"
          title="Tìm kiếm nhanh (Ctrl+K)"
          whileHover={prefersReduced ? undefined : { y: -3, scale: 1.05 }}
          whileTap={prefersReduced ? undefined : { scale: 0.95 }}
          transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
          className="group relative h-11 px-3 rounded-2xl flex items-center gap-1.5 text-xs font-semibold text-[#4B5578] dark:text-[#C5CEEE] hover:text-[#4F46E5] dark:hover:text-white hover:bg-indigo-50/85 dark:hover:bg-white/10 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          <Command className="w-4 h-4" />
          <kbd className="font-mono text-[10px] px-1.5 py-0.5 rounded-md bg-white/80 dark:bg-white/10 border border-indigo-200/70 dark:border-indigo-400/25">
            K
          </kbd>
          <span className="pointer-events-none absolute -top-10 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-lg bg-[#171B3A] dark:bg-white text-white dark:text-[#171B3A] text-[11px] font-semibold whitespace-nowrap opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-150 shadow-lg">
            Tìm nhanh (Ctrl+K)
          </span>
        </motion.button>
      </div>
    </nav>
  );
};
