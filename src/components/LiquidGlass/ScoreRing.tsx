import React from 'react';

interface ScoreRingProps {
  label: string;
  value: number | null;
  subtitle: string;
  color: 'sky' | 'indigo' | 'emerald' | 'amber';
  size?: number;
}

const COLOR_MAP = {
  sky: {
    stroke: '#2563EB',
    trackClass: 'stroke-sky-100 dark:stroke-sky-950/70',
    text: 'text-sky-700 dark:text-sky-300',
  },
  indigo: {
    stroke: '#4F46E5',
    trackClass: 'stroke-indigo-100 dark:stroke-indigo-950/70',
    text: 'text-indigo-700 dark:text-indigo-300',
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
  const palette = COLOR_MAP[color];
  const strokeWidth = 7;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = value === null ? 0 : Math.max(0, Math.min(100, value));
  const offset = circumference - (clamped / 100) * circumference;

  return (
    <div className="flex items-center gap-4">
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
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={palette.stroke}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              className="transition-all duration-500 ease-out"
            />
          )}
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={`font-mono text-base font-semibold tabular-nums ${palette.text}`}>
            {value === null ? '—' : `${value}%`}
          </span>
        </div>
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-[#17243A] dark:text-[#E5EDF9]">{label}</p>
        <p className="text-xs text-[#64748B] dark:text-slate-400 mt-0.5 leading-relaxed">{subtitle}</p>
      </div>
    </div>
  );
};
