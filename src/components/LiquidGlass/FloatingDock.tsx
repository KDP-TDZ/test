import React, { useState } from 'react';
import { Command } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { computeDockItemTransform } from '../../core/uiMotionMath';

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
 * macOS-inspired Liquid Glass Floating Dock (NameThatUI / macos/dock pattern).
 * - Double-rim frosted capsule with specular inner highlight
 * - Pointer-distance wave magnification strictly on GPU compositor (scale, y)
 * - Floating tooltip on hover & keyboard focus-visible
 * - Centered active dot indicator under the current view icon
 * - macOS-style badgeLabel counter for pending review items
 * - Hairline divider separating main navigation from Command Palette utility
 */
export const FloatingDock: React.FC<FloatingDockProps> = ({
  items,
  activeId,
  onSelect,
  onOpenCommandPalette,
}) => {
  const prefersReduced = useReducedMotion();
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const commandIndex = items.length;
  const cmdTransform = computeDockItemTransform(
    commandIndex,
    hoveredIndex,
    Boolean(prefersReduced),
    { maxScale: 1.12, neighborScale: 1.06, farNeighborScale: 1.02, maxLiftPx: -4 }
  );

  return (
    <nav
      aria-label="Thanh điều hướng nổi kiểu macOS Dock"
      className="no-print hidden md:flex fixed bottom-4 left-1/2 -translate-x-1/2 z-40 pointer-events-none"
    >
      <div
        onMouseLeave={() => setHoveredIndex(null)}
        className="ethereal-dock pointer-events-auto flex items-end gap-1.5 rounded-[26px] px-3 pt-2.5 pb-2.5 max-w-[calc(100vw-1.5rem)] overflow-x-auto no-scrollbar"
      >
        {items.map((item, index) => {
          const Icon = item.icon;
          const active = item.id === activeId;
          const { scale, liftY } = computeDockItemTransform(
            index,
            hoveredIndex,
            Boolean(prefersReduced)
          );

          return (
            <div key={item.id} className="relative flex flex-col items-center">
              <motion.button
                type="button"
                onClick={() => onSelect(item.id)}
                onMouseEnter={() => setHoveredIndex(index)}
                onFocus={() => setHoveredIndex(index)}
                onBlur={() => setHoveredIndex((prev) => (prev === index ? null : prev))}
                aria-current={active ? 'page' : undefined}
                aria-label={item.label}
                animate={{ scale, y: liftY }}
                whileTap={prefersReduced ? undefined : { scale: 0.94 }}
                transition={
                  prefersReduced
                    ? { duration: 0 }
                    : { type: 'spring', stiffness: 520, damping: 32, mass: 0.55 }
                }
                style={{ transformOrigin: 'bottom center' }}
                className={`group relative size-11 rounded-2xl flex items-center justify-center cursor-pointer transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                  active
                    ? 'text-white'
                    : 'text-[#434D73] dark:text-[#C1CAE9] hover:text-[#171B3A] dark:hover:text-white hover:bg-indigo-50/85 dark:hover:bg-white/10'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="macos-dock-active-bg"
                    aria-hidden="true"
                    transition={
                      prefersReduced
                        ? { duration: 0 }
                        : { type: 'spring', stiffness: 520, damping: 36, mass: 0.65 }
                    }
                    className="absolute inset-0 rounded-2xl bg-gradient-to-br from-[#4338CA] via-[#5B52F8] to-[#7C3AED] shadow-[0_10px_22px_-6px_rgba(79,70,229,0.62),inset_0_1px_0_rgba(255,255,255,0.45)]"
                  />
                )}

                <Icon className="relative z-10 size-[19px]" />

                {/* macOS-style badgeLabel */}
                {typeof item.badge === 'number' && item.badge > 0 && (
                  <span
                    aria-label={`${item.badge} mục cần ôn`}
                    className="absolute -top-1 -right-1 z-20 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold tabular-nums flex items-center justify-center ring-2 ring-white dark:ring-[#151A3B] shadow-sm"
                  >
                    {item.badge > 99 ? '99+' : item.badge}
                  </span>
                )}

                {/* Elevated floating tooltip (hover + keyboard focus-visible) */}
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute -top-10 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-lg bg-[#171B3A]/95 dark:bg-white/95 text-white dark:text-[#171B3A] text-[11px] font-semibold whitespace-nowrap opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 group-focus-visible:opacity-100 group-focus-visible:translate-y-0 transition-[opacity,transform] duration-150 ease-out shadow-lg"
                >
                  {item.label}
                </span>
              </motion.button>

              {/* macOS active dot indicator underneath active app */}
              <span
                aria-hidden="true"
                className={`mt-1 size-1 rounded-full transition-[opacity,transform] duration-180 ease-out ${
                  active
                    ? 'opacity-100 scale-100 bg-[#4F46E5] dark:bg-indigo-300'
                    : 'opacity-0 scale-50 bg-transparent'
                }`}
              />
            </div>
          );
        })}

        {/* Hairline vertical divider separating app icons from utilities */}
        <span
          aria-hidden="true"
          className="self-center h-7 w-px mx-1.5 mb-1.5 bg-indigo-200/90 dark:bg-indigo-300/20 shrink-0"
        />

        {/* Quick Search / Command Palette Dock Utility */}
        <div className="relative flex flex-col items-center">
          <motion.button
            type="button"
            onClick={onOpenCommandPalette}
            onMouseEnter={() => setHoveredIndex(commandIndex)}
            onFocus={() => setHoveredIndex(commandIndex)}
            onBlur={() => setHoveredIndex((prev) => (prev === commandIndex ? null : prev))}
            aria-label="Mở bảng tìm kiếm nhanh (Ctrl+K)"
            animate={{ scale: cmdTransform.scale, y: cmdTransform.liftY }}
            whileTap={prefersReduced ? undefined : { scale: 0.95 }}
            transition={
              prefersReduced
                ? { duration: 0 }
                : { type: 'spring', stiffness: 520, damping: 32, mass: 0.55 }
            }
            style={{ transformOrigin: 'bottom center' }}
            className="group relative h-11 px-3 rounded-2xl flex items-center gap-1.5 text-xs font-semibold text-[#434D73] dark:text-[#C8D0EE] hover:text-[#4338CA] dark:hover:text-white hover:bg-indigo-50/90 dark:hover:bg-white/10 cursor-pointer transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <Command className="size-4 shrink-0" />
            <kbd className="font-mono text-[10px] px-1.5 py-0.5 rounded-md bg-white/85 dark:bg-white/10 border border-indigo-200/80 dark:border-indigo-400/25 tabular-nums">
              K
            </kbd>
            <span
              aria-hidden="true"
              className="pointer-events-none absolute -top-10 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-lg bg-[#171B3A]/95 dark:bg-white/95 text-white dark:text-[#171B3A] text-[11px] font-semibold whitespace-nowrap opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 group-focus-visible:opacity-100 group-focus-visible:translate-y-0 transition-[opacity,transform] duration-150 ease-out shadow-lg"
            >
              Tìm nhanh (Ctrl+K)
            </span>
          </motion.button>
          <span aria-hidden="true" className="mt-1 size-1 rounded-full opacity-0" />
        </div>
      </div>
    </nav>
  );
};
