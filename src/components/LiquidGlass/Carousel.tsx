import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import { computeCarouselTargetIndex } from '../../core/uiMotionMath';
import { useUiMode } from '../../context/UiModeContext';

export interface CarouselSlide {
  id: string;
  label: string;
  content: React.ReactNode;
}

interface CarouselProps {
  slides: ReadonlyArray<CarouselSlide>;
  ariaLabel: string;
  headerLeft?: React.ReactNode;
  slideClassName?: string;
  className?: string;
  loop?: boolean;
}

/**
 * Accessible W3C Carousel (NameThatUI / web/carousel pattern):
 * - role="region" + aria-roledescription="carousel"
 * - Native CSS scroll-snap-type: x mandatory for lag-free touch swipe
 * - IntersectionObserver sync (no raw scrollTop/scrollY animation loops)
 * - Prev/Next buttons with explicit aria-labels + keyboard Left/Right support
 * - Bottom Slide Picker controls with role="tablist" & aria-selected tabs
 */
export const Carousel: React.FC<CarouselProps> = ({
  slides,
  ariaLabel,
  headerLeft,
  slideClassName = 'w-[86%] sm:w-[68%] lg:w-[48%]',
  className = '',
  loop = false,
}) => {
  const { isEthereal } = useUiMode();
  const prefersReduced = useReducedMotion();
  const carouselId = useId();
  const trackRef = useRef<HTMLDivElement>(null);
  const slideRefs = useRef<Array<HTMLDivElement | null>>([]);
  const programmaticLockUntilRef = useRef<number>(0);
  const [activeIndex, setActiveIndex] = useState(0);

  const scrollToSlide = useCallback(
    (index: number) => {
      const clamped = computeCarouselTargetIndex(index, 0, slides.length, false);
      programmaticLockUntilRef.current = Date.now() + 550;
      setActiveIndex(clamped);
      const track = trackRef.current;
      const slideEl = slideRefs.current[clamped];
      if (!track || !slideEl) return;

      const trackRect = track.getBoundingClientRect();
      const slideRect = slideEl.getBoundingClientRect();
      const paddingLeft = parseFloat(window.getComputedStyle(track).paddingLeft) || 0;
      const targetLeft = track.scrollLeft + (slideRect.left - trackRect.left) - paddingLeft;
      track.scrollTo({
        left: Math.max(0, Math.round(targetLeft)),
        behavior: prefersReduced ? 'auto' : 'smooth',
      });
    },
    [slides.length, prefersReduced]
  );

  const handleStep = useCallback(
    (delta: number) => {
      const next = computeCarouselTargetIndex(activeIndex, delta, slides.length, loop);
      scrollToSlide(next);
    },
    [activeIndex, slides.length, loop, scrollToSlide]
  );

  // Sync active slide indicator when user swipes natively (via IntersectionObserver)
  useEffect(() => {
    const track = trackRef.current;
    if (!track || typeof IntersectionObserver === 'undefined') return;

    const ratios = new Map<number, number>();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const idxAttr = entry.target.getAttribute('data-slide-index');
          const parsed = idxAttr ? Number(idxAttr) : -1;
          if (parsed >= 0) {
            ratios.set(parsed, entry.isIntersecting ? entry.intersectionRatio : 0);
          }
        }

        if (Date.now() < programmaticLockUntilRef.current) return;

        // Pick the leftmost sufficiently visible slide for deterministic 2-up desktop sync
        let leftmostFull = -1;
        let bestFallback = -1;
        let bestRatio = 0.45;
        for (let i = 0; i < slides.length; i++) {
          const ratio = ratios.get(i) ?? 0;
          if (ratio >= 0.65 && leftmostFull === -1) {
            leftmostFull = i;
          }
          if (ratio > bestRatio) {
            bestRatio = ratio;
            bestFallback = i;
          }
        }

        const nextIdx = leftmostFull >= 0 ? leftmostFull : bestFallback;
        if (nextIdx >= 0) {
          setActiveIndex(nextIdx);
        }
      },
      {
        root: track,
        threshold: [0.5, 0.7, 0.9],
      }
    );

    slideRefs.current.forEach((node) => {
      if (node) observer.observe(node);
    });

    return () => observer.disconnect();
  }, [slides.length]);

  if (slides.length === 0) return null;

  const canPrev = loop || activeIndex > 0;
  const canNext = loop || activeIndex < slides.length - 1;

  return (
    <div
      role="region"
      aria-roledescription="carousel"
      aria-label={ariaLabel}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          handleStep(-1);
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          handleStep(1);
        }
      }}
      className={`space-y-4 ${className}`}
    >
      {/* Top Row: Optional heading + Prev/Next Controls */}
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">{headerLeft}</div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="hidden sm:inline-block font-mono text-xs font-medium text-[#6B7499] dark:text-[#A5B1D8] tabular-nums mr-1">
            {activeIndex + 1} / {slides.length}
          </span>
          <button
            type="button"
            onClick={() => handleStep(-1)}
            disabled={!canPrev}
            aria-label="Slide trước"
            className={`size-9 sm:size-10 rounded-xl inline-flex items-center justify-center glass-control cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-transform duration-150 ease-out active:scale-95 focus-visible:outline-none focus-visible:ring-2 ${
              isEthereal ? 'focus-visible:ring-indigo-500' : 'focus-visible:ring-sky-500'
            }`}
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => handleStep(1)}
            disabled={!canNext}
            aria-label="Slide tiếp theo"
            className={`size-9 sm:size-10 rounded-xl inline-flex items-center justify-center glass-control cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-transform duration-150 ease-out active:scale-95 focus-visible:outline-none focus-visible:ring-2 ${
              isEthereal ? 'focus-visible:ring-indigo-500' : 'focus-visible:ring-sky-500'
            }`}
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>

      {/* Horizontal Scroll-Snap Track */}
      <div
        ref={trackRef}
        className="carousel-track relative flex items-stretch gap-4 sm:gap-5 overflow-x-auto snap-x snap-mandatory scroll-pl-1 pb-2 -mx-1 px-1"
      >
        {slides.map((slide, idx) => (
          <div
            key={slide.id}
            id={`${carouselId}-slide-${idx}`}
            ref={(el) => {
              slideRefs.current[idx] = el;
            }}
            data-slide-index={idx}
            role="group"
            aria-roledescription="slide"
            aria-label={`${idx + 1} / ${slides.length}: ${slide.label}`}
            className={`snap-start shrink-0 ${slideClassName}`}
          >
            {slide.content}
          </div>
        ))}
      </div>

      {/* Bottom Slide Picker Controls (W3C tablist pattern) */}
      <div
        role="tablist"
        aria-label={`Chọn slide cho ${ariaLabel}`}
        className="flex items-center justify-center gap-1.5"
      >
        {slides.map((slide, idx) => {
          const isActive = idx === activeIndex;
          return (
            <button
              key={slide.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`${carouselId}-slide-${idx}`}
              aria-label={`Chuyển đến slide ${idx + 1}: ${slide.label}`}
              onClick={() => scrollToSlide(idx)}
              className={`min-h-[32px] px-1.5 inline-flex items-center justify-center cursor-pointer rounded-full focus-visible:outline-none focus-visible:ring-2 ${
                isEthereal ? 'focus-visible:ring-indigo-500' : 'focus-visible:ring-sky-500'
              }`}
            >
              <span
                aria-hidden="true"
                className={`block h-2 w-6 rounded-full origin-center transition-[transform,opacity,background-color] duration-200 ease-out ${
                  isActive
                    ? isEthereal
                      ? 'scale-x-100 opacity-100 bg-gradient-to-r from-[#4338CA] via-[#6366F1] to-[#8B5CF6]'
                      : 'scale-x-100 opacity-100 bg-gradient-to-r from-sky-500 to-blue-600'
                    : 'scale-x-[0.34] opacity-45 hover:opacity-75 bg-[#64748B] dark:bg-[#94A3B8]'
                }`}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
};
