import React from 'react';

interface ScoreRingProps {
  label: string;
  value: number | null;
  subtitle: string;
  color: 'sky' | 'indigo' | 'emerald' | 'amber';
  size?: number;
}

const COLOR_MAP = {
  sky: { stroke: '#0284C7', track: '#E0F2FE', text: 'text-sky-700' },
  indigo: { stroke: '#4F46E5', track: '#E0E7FF', text: 'text-indigo-700' },
  emerald: { stroke: '#059669', track: '#D1FAE5', text: 'text-emerald-700' },
  amber: { stroke: '#D97706', track: '#FEF3C7', text: 'text-amber-700' },
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
            stroke={palette.track}
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
        <p className="text-sm font-semibold text-slate-900">{label}</p>
        <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">{subtitle}</p>
      </div>
    </div>
  );
};
