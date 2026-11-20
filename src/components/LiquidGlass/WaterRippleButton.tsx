import React, { useRef, useState } from 'react';
import { gsap, MOTION_ALLOWED_MEDIA, REDUCED_MOTION_MEDIA, useGSAP } from '../../lib/gsapSetup';

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
  onPointerDown,
  onPointerUp,
  onPointerLeave,
  onPointerCancel,
  disabled,
  type = 'button',
  ...rest
}) => {
  const btnRef = useRef<HTMLButtonElement>(null);
  const motionAllowedRef = useRef(true);
  const [ripples, setRipples] = useState<Array<{ id: number; x: number; y: number }>>([]);
  const idCounter = useRef(0);

  const { contextSafe } = useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_ALLOWED_MEDIA, () => {
        motionAllowedRef.current = true;
        return () => {
          motionAllowedRef.current = false;
        };
      });
      mm.add(REDUCED_MOTION_MEDIA, () => {
        motionAllowedRef.current = false;
      });
    },
    { scope: btnRef }
  );

  const handlePressDown = contextSafe((e: React.PointerEvent<HTMLButtonElement>) => {
    onPointerDown?.(e);
    if (disabled || !motionAllowedRef.current || !btnRef.current) return;
    gsap.to(btnRef.current, {
      scale: 0.97,
      y: 0,
      duration: 0.12,
      ease: 'power2.out',
      overwrite: 'auto',
    });
  });

  const handlePressRelease = contextSafe(() => {
    if (!motionAllowedRef.current || !btnRef.current) return;
    gsap.to(btnRef.current, {
      scale: 1,
      duration: 0.2,
      ease: 'power2.out',
      overwrite: 'auto',
      clearProps: 'transform',
    });
  });

  const variantClasses: Record<NonNullable<WaterRippleButtonProps['variant']>, string> = {
    primary:
      'bg-gradient-to-b from-sky-500 to-blue-600 text-white shadow-[0_8px_22px_-8px_rgba(37,99,235,0.52),inset_0_1px_1px_rgba(255,255,255,0.45)] hover:from-sky-400 hover:to-blue-600 hover:shadow-[0_12px_26px_-8px_rgba(2,132,199,0.58),inset_0_1px_1px_rgba(255,255,255,0.55)] border border-sky-400/40',
    secondary:
      'bg-white/78 dark:bg-slate-800/78 backdrop-blur-md text-[#16243E] dark:text-[#E6EFFC] border border-white/85 dark:border-slate-700/70 shadow-[0_4px_14px_-6px_rgba(37,78,145,0.12),inset_0_1px_0_rgba(255,255,255,0.9)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] hover:bg-white/95 dark:hover:bg-slate-800/95 hover:border-sky-300/85 dark:hover:border-sky-500/50 hover:shadow-[0_10px_22px_-10px_rgba(2,132,199,0.24)]',
    ghost:
      'bg-transparent text-[#16243E] dark:text-[#E6EFFC] hover:bg-white/65 dark:hover:bg-white/10 border border-transparent hover:border-sky-200/60 dark:hover:border-white/15',
    danger:
      'bg-gradient-to-b from-rose-500 to-rose-600 text-white hover:from-rose-400 hover:to-rose-600 border border-rose-400/35 shadow-[0_6px_18px_-6px_rgba(225,29,72,0.45),inset_0_1px_0_rgba(255,255,255,0.3)] hover:shadow-[0_10px_24px_-6px_rgba(225,29,72,0.55)]',
  };

  const sizeClasses: Record<NonNullable<WaterRippleButtonProps['size']>, string> = {
    sm: 'px-3.5 py-1.5 text-xs rounded-xl',
    md: 'px-4 py-2 text-sm rounded-xl',
    lg: 'px-6 py-3 text-sm rounded-2xl',
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
      onPointerDown={handlePressDown}
      onPointerUp={(e) => {
        onPointerUp?.(e);
        handlePressRelease();
      }}
      onPointerLeave={(e) => {
        onPointerLeave?.(e);
        handlePressRelease();
      }}
      onPointerCancel={(e) => {
        onPointerCancel?.(e);
        handlePressRelease();
      }}
      className={`relative inline-flex items-center justify-center gap-2 font-medium whitespace-nowrap shrink-0 overflow-hidden select-none cursor-pointer transition-[transform,box-shadow,background-color,border-color,color] duration-180 ease-out hover:not(:disabled):-translate-y-[1.5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-950 disabled:opacity-50 disabled:cursor-not-allowed ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
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
