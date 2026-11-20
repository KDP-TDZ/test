import React, { useEffect } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { GlassSurface } from './GlassSurface';

interface AnimatedModalProps {
  open: boolean;
  onClose: () => void;
  ariaLabelledBy?: string;
  ariaLabel?: string;
  maxWidthClassName?: string;
  panelClassName?: string;
  children: React.ReactNode;
}

/**
 * Standardized Liquid Glass Modal/Dialog with smooth fade + scale (0.96 <-> 1)
 * on both open and close plus subtle backdrop blur (200ms).
 */
export const AnimatedModal: React.FC<AnimatedModalProps> = ({
  open,
  onClose,
  ariaLabelledBy,
  ariaLabel,
  maxWidthClassName = 'max-w-md',
  panelClassName = 'p-5 sm:p-8',
  children,
}) => {
  const prefersReduced = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="modal-backdrop"
          initial={prefersReduced ? { opacity: 1 } : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={prefersReduced ? { opacity: 0 } : { opacity: 0 }}
          transition={{ duration: prefersReduced ? 0 : 0.18, ease: [0.16, 1, 0.3, 1] }}
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/45 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby={ariaLabelledBy}
          aria-label={ariaLabel}
        >
          <motion.div
            key="modal-panel"
            initial={prefersReduced ? { opacity: 1 } : { opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={prefersReduced ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: 6 }}
            transition={{ duration: prefersReduced ? 0 : 0.22, ease: [0.16, 1, 0.3, 1] }}
            className={`w-full ${maxWidthClassName}`}
          >
            <GlassSurface hoverLift={false} className={`w-full rounded-3xl shadow-2xl ${panelClassName}`}>
              {children}
            </GlassSurface>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
