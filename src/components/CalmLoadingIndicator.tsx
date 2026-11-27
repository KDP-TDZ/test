import React from 'react';

interface CalmDotsProps {
  className?: string;
}

/**
 * Calm 3-dot breathing wave indicator (replaces distracting spinning loaders in buttons & badges).
 */
export const CalmDots: React.FC<CalmDotsProps> = ({ className = '' }) => (
  <span aria-hidden="true" className={`sc-loading-dots ${className}`}>
    <span />
    <span />
    <span />
  </span>
);

interface CalmProgressBarProps {
  className?: string;
  label?: string;
}

/**
 * Calm horizontal indeterminate glide bar (zero spinning, zero layout jitter).
 */
export const CalmProgressBar: React.FC<CalmProgressBarProps> = ({
  className = 'h-1.5 w-full',
  label = 'Đang xử lý',
}) => (
  <div
    role="progressbar"
    aria-label={label}
    aria-busy="true"
    className={`sc-progress-indeterminate ${className}`}
  />
);
