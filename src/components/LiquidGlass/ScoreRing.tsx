import React, { useRef } from 'react';
import { gsap, MOTION_ALLOWED_MEDIA, REDUCED_MOTION_MEDIA, useGSAP } from '../../lib/gsapSetup';

interface ScoreRingProps {
  label: string;
  value: number | null;
  subtitle: string;
  color: 'sky' | 'indigo' | 'emerald' | 'amber';
  size?: number;
}

const COLOR_MAP = {
  sky: {
    stroke: '#0284C7',
    trackClass: 'stroke-sky-100 dark:stroke-sky-950/70',
    text: 'text-sky-700 dark:text-sky-300',
  },
  indigo: {
    stroke: '#0369A1',
    trackClass: 'stroke-sky-100 dark:stroke-sky-950/70',
    text: 'text-sky-800 dark:text-sky-300',
  },
  emerald: {
    stroke: '#059669',
    trackClass: 'stroke-emerald-100 dark:stroke-emerald-950/70',
    text: 'text-emerald-700 dark:text-emerald-300',
  },
  amber: {
    stroke: '#D97706',
    trackClass: 'stroke-amber-100 dark:stroke-amber-950/70',
    text: 'text-amber-700 dark:text-amber-300',
  },
};

export const ScoreRing: React.FC<ScoreRingProps> = ({
  label,
  value,
  subtitle,
  color,
  size = 86,
}) => {
  const ringRef = useRef<HTMLDivElement>(null);
  const progressCircleRef = useRef<SVGCircleElement>(null);
  const numberRef = useRef<HTMLSpanElement>(null);

  const palette = COLOR_MAP[color];
  const strokeWidth = 7;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = value === null ? 0 : Math.max(0, Math.min(100, value));
  const offset = circumference - (clamped / 100) * circumference;

  useGSAP(
    () => {
      if (value === null || !progressCircleRef.current || !numberRef.current) return;

      const circleEl = progressCircleRef.current;
      const numEl = numberRef.current;
      const mm = gsap.matchMedia();

      mm.add(MOTION_ALLOWED_MEDIA, () => {
        const counter = { val: 0 };
        const tl = gsap.timeline({ defaults: { ease: 'power2.out' } });

        tl.fromTo(
          circleEl,
          { strokeDashoffset: circumference },
          { strokeDashoffset: offset, duration: 0.55 },
          0
        ).to(
          counter,
          {
            val: clamped,
            duration: 0.55,
            onUpdate: () => {
              numEl.textContent = `${Math.round(counter.val)}%`;
            },
            onComplete: () => {
              numEl.textContent = `${value}%`;
            },
          },
          0
        );
      });

      mm.add(REDUCED_MOTION_MEDIA, () => {
        gsap.set(circleEl, { strokeDashoffset: offset });
        numEl.textContent = `${value}%`;
      });
    },
    { scope: ringRef, dependencies: [value, circumference, offset, clamped] }
  );

  return (
    <div ref={ringRef} className="flex items-center gap-4">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            className={palette.trackClass}
            strokeWidth={strokeWidth}
          />
          {value !== null && (
            <circle
              ref={progressCircleRef}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={palette.stroke}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
            />
          )}
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span
            ref={numberRef}
            className={`font-mono text-base font-semibold tabular-nums ${palette.text}`}
          >
            {value === null ? '—' : `${value}%`}
          </span>
        </div>
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-[#16243E] dark:text-[#E6EFFC]">{label}</p>
        <p className="text-xs text-[#475B78] dark:text-[#B4C7E2] mt-0.5 leading-relaxed">{subtitle}</p>
      </div>
    </div>
  );
};
