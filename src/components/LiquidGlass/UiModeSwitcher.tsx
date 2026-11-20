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
    label: 'Kì ảo',
    title: 'Giao diện Kì ảo — Liquid Glass & Bento trẻ trung',
    icon: Sparkles,
  },
];

export const UiModeSwitcher: React.FC<UiModeSwitcherProps> = ({ className = '' }) => {
  const { uiMode, setUiMode } = useUiMode();
  const prefersReduced = useReducedMotion();
  const groupId = useId();

  return (
    <div
      role="group"
      aria-label="Chọn phong cách giao diện"
      className={`glass-segment inline-flex items-center gap-0.5 rounded-xl p-0.5 shrink-0 ${className}`}
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
            className={`relative min-h-[32px] px-2.5 sm:px-3 py-1 rounded-[10px] text-[11px] sm:text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer select-none transition-colors duration-180 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
              active
                ? 'text-white'
                : 'text-[#475B78] dark:text-[#B4C7E2] hover:text-[#16243E] dark:hover:text-white'
            }`}
          >
            {active && (
              <motion.span
                layoutId={`ui-mode-pill-${groupId}`}
                aria-hidden="true"
                transition={
                  prefersReduced
                    ? { duration: 0 }
                    : { type: 'spring', stiffness: 500, damping: 36, mass: 0.65 }
                }
                className={`absolute inset-0 rounded-[10px] shadow-sm ${
                  opt.id === 'ethereal'
                    ? 'bg-gradient-to-r from-[#4F46E5] via-[#6366F1] to-[#8B5CF6]'
                    : 'bg-gradient-to-r from-sky-500 to-blue-600'
                }`}
              />
            )}
            <span className="relative z-10 inline-flex items-center gap-1">
              <Icon className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden xs:inline sm:inline">{opt.label}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
};
