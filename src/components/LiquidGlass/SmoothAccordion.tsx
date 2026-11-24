import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';

interface SmoothAccordionProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  children: React.ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onToggle?: (nextOpen: boolean) => void;
  className?: string;
  triggerClassName?: string;
  contentClassName?: string;
}

/**
 * Standardized smooth expand/collapse accordion (compositor-only CSS)
 * with synchronized rotating chevron icon and reduced-motion compliance.
 */
export const SmoothAccordion: React.FC<SmoothAccordionProps> = ({
  title,
  subtitle,
  icon,
  children,
  open: controlledOpen,
  defaultOpen = false,
  onToggle,
  className = '',
  triggerClassName = '',
  contentClassName = '',
}) => {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);

  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : internalOpen;

  const handleToggle = () => {
    const next = !isOpen;
    if (!isControlled) {
      setInternalOpen(next);
    }
    onToggle?.(next);
  };

  return (
    <div
      className={`rounded-2xl overflow-hidden transition-[border-color,box-shadow,background-color] duration-200 ease-out ${className}`}
    >
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={handleToggle}
        className={`w-full min-h-[44px] text-left flex items-center justify-between gap-3 cursor-pointer transition-colors duration-180 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500 ${triggerClassName}`}
      >
        <div className="min-w-0 flex items-center gap-2.5">
          {icon && <span className="shrink-0">{icon}</span>}
          <div className="min-w-0">
            <div className="text-sm font-medium text-[#16243E] dark:text-[#E6EFFC]">{title}</div>
            {subtitle && (
              <div className="text-xs text-[#475B78] dark:text-[#B4C7E2] mt-0.5">{subtitle}</div>
            )}
          </div>
        </div>
        <span
          aria-hidden="true"
          className={`shrink-0 text-[#475B78] dark:text-[#B4C7E2] inline-flex items-center justify-center transition-transform duration-200 ease-out motion-reduce:transition-none ${
            isOpen ? 'rotate-180' : 'rotate-0'
          }`}
        >
          <ChevronDown className="size-4" />
        </span>
      </button>

      {isOpen && (
        <div className="landing-fade-up">
          <div className={contentClassName}>{children}</div>
        </div>
      )}
    </div>
  );
};
