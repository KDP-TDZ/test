import React, { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { computeTypewriterFrame } from '../../core/uiMotionMath';

interface TypewriterTextProps {
  text: string;
  charIntervalMs?: number;
  startDelayMs?: number;
  className?: string;
  caretClassName?: string;
}

/**
 * Zero-CLS Typewriter text reveal.
 * Reserves exact final layout dimensions using an invisible shadow copy so
 * surrounding headings never shift, uses compositor-only opacity for the caret,
 * pauses off-screen via IntersectionObserver, and renders immediately under
 * prefers-reduced-motion.
 */
export const TypewriterText: React.FC<TypewriterTextProps> = ({
  text,
  charIntervalMs = 30,
  startDelayMs = 140,
  className = '',
  caretClassName = 'bg-current',
}) => {
  const prefersReduced = useReducedMotion();
  const containerRef = useRef<HTMLSpanElement>(null);
  const [inView, setInView] = useState(true);
  const [visibleText, setVisibleText] = useState(() => (prefersReduced ? text : ''));
  const [isComplete, setIsComplete] = useState(() => Boolean(prefersReduced));
  const [showCaret, setShowCaret] = useState(() => !prefersReduced);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        setInView(entry.isIntersecting);
      },
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (prefersReduced) {
      setVisibleText(text);
      setIsComplete(true);
      setShowCaret(false);
      return;
    }

    let timerId: number | undefined;
    let settleCaretTimer: number | undefined;
    let elapsed = 0;

    setVisibleText('');
    setIsComplete(false);
    setShowCaret(true);

    const startTimer = window.setTimeout(() => {
      timerId = window.setInterval(() => {
        elapsed += charIntervalMs;
        const frame = computeTypewriterFrame(text, elapsed, charIntervalMs, false);
        setVisibleText(frame.visibleText);
        if (frame.isComplete) {
          setIsComplete(true);
          if (timerId !== undefined) window.clearInterval(timerId);
          settleCaretTimer = window.setTimeout(() => {
            setShowCaret(false);
          }, 1400);
        }
      }, charIntervalMs);
    }, startDelayMs);

    return () => {
      window.clearTimeout(startTimer);
      if (timerId !== undefined) window.clearInterval(timerId);
      if (settleCaretTimer !== undefined) window.clearTimeout(settleCaretTimer);
    };
  }, [text, charIntervalMs, startDelayMs, prefersReduced]);

  return (
    <span
      ref={containerRef}
      aria-label={text}
      className={`relative inline-block max-w-full align-top ${className}`}
    >
      {/* Invisible shadow text + caret spacer guarantees zero layout shift and prevents caret line-wrap */}
      <span aria-hidden="true" className="invisible select-none">
        {text}
        <span className="inline-block ml-0.5 w-[2px] h-[1.05em] align-[-0.12em]" />
      </span>

      {/* Live typed overlay */}
      <span aria-hidden="true" className="absolute inset-0">
        {visibleText}
        {showCaret && (
          <span
            className={`inline-block align-[-0.12em] ml-0.5 w-[2px] h-[1.05em] rounded-full transition-opacity duration-200 ${caretClassName} ${
              inView ? (isComplete ? 'typewriter-caret-blink' : 'opacity-90') : 'opacity-0'
            }`}
          />
        )}
      </span>
    </span>
  );
};
