import React, { useId } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';

export interface SlidingTabItem<T extends string = string> {
  id: T;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  disabled?: boolean;
}

interface SlidingTabsProps<T extends string> {
  items: ReadonlyArray<SlidingTabItem<T>>;
  activeId: T;
  onChange: (id: T) => void;
  layoutGroupId?: string;
  className?: string;
  ariaLabel?: string;
}

/**
 * Unified editorial tab bar with a smooth Cobalt sliding active indicator
 * and clean horizontal scroll support on narrow screens.
 */
export function SlidingTabs<T extends string>({
  items,
  activeId,
  onChange,
  layoutGroupId,
  className = '',
  ariaLabel = 'Điều hướng thẻ',
}: SlidingTabsProps<T>) {
  const autoId = useId();
  const indicatorId = layoutGroupId || `sliding-tab-${autoId}`;
  const prefersReduced = useReducedMotion();

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`glass-segment inline-flex items-center gap-1 rounded-2xl p-1.5 max-w-full overflow-x-auto sc-no-scrollbar ${className}`}
    >
      {items.map((item) => {
        const isActive = item.id === activeId;
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            disabled={item.disabled}
            onClick={() => onChange(item.id)}
            className={`relative min-h-[38px] inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 select-none cursor-pointer transition-colors duration-180 ease-out active:scale-[0.98] disabled:opacity-45 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] ${
              isActive
                ? 'text-white'
                : 'text-[#525E75] dark:text-[#94A3B8] hover:text-[#172033] dark:hover:text-[#E6EFFC] hover:bg-white/75 dark:hover:bg-[#111B30]'
            }`}
          >
            {isActive && (
              <motion.span
                layoutId={indicatorId}
                aria-hidden="true"
                transition={
                  prefersReduced
                    ? { duration: 0 }
                    : { type: 'spring', stiffness: 480, damping: 36, mass: 0.7 }
                }
                className="absolute inset-0 rounded-xl bg-[#2563EB] shadow-[0_6px_14px_-6px_rgba(37,99,235,0.55)]"
              />
            )}
            <span className="relative z-10 inline-flex items-center gap-1.5">
              {Icon && <Icon className="w-3.5 h-3.5 shrink-0" />}
              <span>{item.label}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

interface TabContentFadeProps {
  activeKey: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * Smooth 180ms crossfade wrapper for tab panel content transitions.
 */
export const TabContentFade: React.FC<TabContentFadeProps> = ({
  activeKey,
  children,
  className = '',
}) => {
  const prefersReduced = useReducedMotion();

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={activeKey}
        initial={prefersReduced ? { opacity: 1 } : { opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
        exit={prefersReduced ? { opacity: 1 } : { opacity: 0, y: -4 }}
        transition={{
          duration: prefersReduced ? 0 : 0.18,
          ease: [0.16, 1, 0.3, 1],
        }}
        className={className}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
};
