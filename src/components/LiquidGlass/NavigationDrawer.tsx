import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

interface HamburgerButtonProps {
  open: boolean;
  controlsId: string;
  onToggle: () => void;
  buttonRef?: React.RefObject<HTMLButtonElement | null>;
  className?: string;
  labelOpen?: string;
  labelClose?: string;
}

export const HamburgerButton: React.FC<HamburgerButtonProps> = ({
  open,
  controlsId,
  onToggle,
  buttonRef,
  className = '',
  labelOpen = 'Mở menu điều hướng',
  labelClose = 'Đóng menu điều hướng',
}) => {
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-expanded={open}
      aria-controls={controlsId}
      aria-label={open ? labelClose : labelOpen}
      onClick={onToggle}
      className={`min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-xl text-[#16243E] dark:text-[#E6EFFC] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
        open
          ? 'bg-sky-500/15 dark:bg-white/12'
          : 'hover:bg-white/60 dark:hover:bg-white/10'
      } ${className}`}
    >
      <svg
        viewBox="0 0 24 24"
        width="20"
        height="20"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
        aria-hidden="true"
        className="shrink-0"
      >
        <line x1="4" y1="6.5" x2="20" y2="6.5" />
        <line x1="4" y1="12" x2="20" y2="12" />
        <line x1="4" y1="17.5" x2="20" y2="17.5" />
      </svg>
    </button>
  );
};

interface NavigationDrawerProps {
  id: string;
  open: boolean;
  onClose: () => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  ariaLabel?: string;
  panelRef?: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export const NavigationDrawer: React.FC<NavigationDrawerProps> = ({
  id,
  open,
  onClose,
  triggerRef,
  ariaLabel = 'Điều hướng chính',
  panelRef: externalPanelRef,
  children,
  footer,
}) => {
  const internalPanelRef = useRef<HTMLElement>(null);
  const wasOpenRef = useRef(false);

  const setPanelRef = (node: HTMLElement | null) => {
    internalPanelRef.current = node;
    if (externalPanelRef) {
      externalPanelRef.current = node;
    }
  };

  // Lock body scroll while drawer is open
  useEffect(() => {
    if (!open) return;

    const prevBodyOverflow = document.body.style.overflow;
    const prevHtmlOverflow = document.documentElement.style.overflow;
    const prevBodyPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }

    return () => {
      document.body.style.overflow = prevBodyOverflow;
      document.documentElement.style.overflow = prevHtmlOverflow;
      document.body.style.paddingRight = prevBodyPaddingRight;
    };
  }, [open]);

  // Close on Escape and trap Tab focus inside the drawer while open
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === 'Tab' && internalPanelRef.current) {
        const focusable = Array.from(
          internalPanelRef.current.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
          )
        ).filter((el) => el.offsetParent !== null);

        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  // Move focus into the drawer when opened, and return focus to trigger button on close
  useEffect(() => {
    if (open) {
      wasOpenRef.current = true;
      const raf = requestAnimationFrame(() => {
        const firstTarget =
          internalPanelRef.current?.querySelector<HTMLElement>(
            '[aria-current="page"], a[href], button:not([disabled])'
          ) || internalPanelRef.current;
        firstTarget?.focus({ preventScroll: true });
      });
      return () => cancelAnimationFrame(raf);
    } else if (wasOpenRef.current) {
      wasOpenRef.current = false;
      triggerRef.current?.focus({ preventScroll: true });
    }
  }, [open, triggerRef]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className={`fixed top-[52px] md:top-16 inset-x-0 bottom-0 z-[44] no-print ${
        open ? 'pointer-events-auto' : 'pointer-events-none'
      }`}
    >
      {/* Compositor-only scrim fade (zero GSAP dependency on landing bundle) */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className={`absolute inset-0 bg-[#09111E]/45 backdrop-blur-[2px] transition-[opacity,visibility] duration-200 ease-out motion-reduce:transition-none ${
          open ? 'opacity-100 visible' : 'opacity-0 invisible'
        }`}
      />

      {/* Off-canvas <nav> panel sliding smoothly via GPU translateX */}
      <nav
        ref={setPanelRef}
        id={id}
        aria-label={ariaLabel}
        aria-hidden={!open}
        inert={!open}
        tabIndex={-1}
        className={`absolute inset-y-0 left-0 w-[min(80vw,272px)] max-w-full flex flex-col glass-surface border-t-0 border-l-0 border-b-0 border-r border-sky-200/75 dark:border-slate-700/70 shadow-2xl outline-none transition-[transform,opacity,visibility] duration-250 ease-out motion-reduce:transition-none will-change-transform ${
          open
            ? 'translate-x-0 opacity-100 visible'
            : '-translate-x-full opacity-0 invisible'
        }`}
      >
        <div className="flex-1 overflow-y-auto px-3 py-4">{children}</div>

        {footer && (
          <div className="px-3 py-3 border-t border-sky-200/60 dark:border-slate-800/80">
            {footer}
          </div>
        )}
      </nav>
    </div>,
    document.body
  );
};
