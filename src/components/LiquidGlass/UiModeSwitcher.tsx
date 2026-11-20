import React, { useId } from 'react';
import { LayoutGrid, Sparkles } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useUiMode, type UiMode } from '../../context/UiModeContext';

interface UiModeSwitcherProps {
  className?: string;
}

const OPTIONS: ReadonlyArray<{
  id: UiMode;
  label: string;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    id: 'classic',
    label: 'Cổ điển',
    title: 'Giao diện Cổ điển — Tối giản, học thuật',
    icon: LayoutGrid,
  },
  {
    id: 'ethereal',
    label: 'Hiện đại',
    title: 'Giao diện Hiện đại — Liquid Glass & Bento năng động',
    icon: Sparkles,
  },
];

/**
 * Refined Liquid Glass segmented UI mode switcher ("Cổ điển" | "Hiện đại").
 * Uses compositor-only spring slide (<= 200ms), dual specular rim,
 * and WCAG AA light/dark contrast pairs.
 */
export const UiModeSwitcher: React.FC<UiModeSwitcherProps> = ({ className = '' }) => {
  const { uiMode, setUiMode } = useUiMode();
  const prefersReduced = useReducedMotion();
  const groupId = useId();

  return (
    <div
      role="group"
      aria-label="Chọn phong cách giao diện"
      className={`ui-switcher-track inline-flex items-center gap-1 rounded-2xl p-1 shrink-0 ${className}`}
    >
      {OPTIONS.map((opt) => {
        const active = uiMode === opt.id;
        const Icon = opt.icon;
        return (
          <button
            key={opt.id}
            type="button"
            title={opt.title}
            aria-pressed={active}
            onClick={() => setUiMode(opt.id)}
            className={`relative min-h-[34px] px-3 sm:px-3.5 py-1.5 rounded-xl text-xs font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer select-none transition-[color,transform] duration-150 ease-out active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 ${
              opt.id === 'ethereal'
                ? 'focus-visible:ring-indigo-500'
                : 'focus-visible:ring-sky-500'
            } ${
              active
                ? 'text-white'
                : 'text-[#475B78] dark:text-[#B8C5E4] hover:text-[#16243E] dark:hover:text-white'
            }`}
          >
            {active && (
              <motion.span
                layoutId={`ui-mode-pill-${groupId}`}
                aria-hidden="true"
                transition={
                  prefersReduced
                    ? { duration: 0 }
                    : { type: 'spring', stiffness: 560, damping: 38, mass: 0.6 }
                }
                className={`absolute inset-0 rounded-xl ${
                  opt.id === 'ethereal'
                    ? 'bg-gradient-to-r from-[#4338CA] via-[#5B52F8] to-[#7C3AED] shadow-[0_8px_20px_-6px_rgba(79,70,229,0.65),inset_0_1px_0_rgba(255,255,255,0.45)]'
                    : 'bg-gradient-to-r from-[#0284C7] via-[#0EA5E9] to-[#2563EB] shadow-[0_8px_18px_-6px_rgba(2,132,199,0.55),inset_0_1px_0_rgba(255,255,255,0.42)]'
                }`}
              />
            )}
            <span className="relative z-10 inline-flex items-center gap-1.5">
              <Icon className="size-3.5 shrink-0" />
              <span>{opt.label}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
};
