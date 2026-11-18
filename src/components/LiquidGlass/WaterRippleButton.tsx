import React, { useRef, useState } from 'react';

interface WaterRippleButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
}

export const WaterRippleButton: React.FC<WaterRippleButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  className = '',
  onClick,
  disabled,
  type = 'button',
  ...rest
}) => {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [ripples, setRipples] = useState<Array<{ id: number; x: number; y: number }>>([]);
  const idCounter = useRef(0);

  const variantClasses: Record<NonNullable<WaterRippleButtonProps['variant']>, string> = {
    primary:
      'bg-gradient-to-b from-sky-600 to-sky-700 text-white shadow-[0_6px_18px_-6px_rgba(2,132,199,0.55),inset_0_1px_0_rgba(255,255,255,0.35)] hover:from-sky-500 hover:to-sky-700 border border-sky-600/30',
    secondary:
      'bg-white/80 backdrop-blur-md text-slate-800 border border-slate-200/90 shadow-xs hover:bg-white hover:border-sky-300/70',
    ghost:
      'bg-transparent text-slate-700 hover:bg-slate-900/5 border border-transparent',
    danger:
      'bg-rose-600 text-white hover:bg-rose-700 border border-rose-700/20 shadow-xs',
  };

  const sizeClasses: Record<NonNullable<WaterRippleButtonProps['size']>, string> = {
    sm: 'px-3 py-1.5 text-xs rounded-lg',
    md: 'px-4 py-2 text-sm rounded-xl',
    lg: 'px-6 py-3 text-sm rounded-xl',
  };

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!disabled && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      const x = e.clientX ? e.clientX - rect.left : rect.width / 2;
      const y = e.clientY ? e.clientY - rect.top : rect.height / 2;
      const id = ++idCounter.current;
      setRipples((prev) => [...prev.slice(-2), { id, x, y }]);
      setTimeout(() => {
        setRipples((prev) => prev.filter((r) => r.id !== id));
      }, 720);
    }
    onClick?.(e);
  };

  return (
    <button
      ref={btnRef}
      type={type}
      disabled={disabled}
      onClick={handleClick}
      className={`relative inline-flex items-center justify-center gap-2 font-medium whitespace-nowrap shrink-0 overflow-hidden select-none cursor-pointer transition-all duration-150 ease-out active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...rest}
    >
      {ripples.map((r) => (
        <span key={r.id} aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
          <span
            className="ripple-ring-1 absolute h-16 w-16 rounded-full border border-white/60 bg-white/25"
            style={{ left: r.x, top: r.y }}
          />
          <span
            className="ripple-ring-2 absolute h-10 w-10 rounded-full border border-sky-200/70"
            style={{ left: r.x, top: r.y }}
          />
        </span>
      ))}
      <span className="relative z-10 inline-flex items-center gap-2">{children}</span>
    </button>
  );
};
