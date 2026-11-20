import React, { useEffect, useRef, useState } from 'react';
import { useUiMode } from '../../context/UiModeContext';

interface RippleInstance {
  id: number;
  x: number;
  y: number;
}

interface GlassSurfaceProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  enableCursorLight?: boolean;
  enableRipple?: boolean;
  hoverLift?: boolean;
  subtle?: boolean;
}

/**
 * Dual-mode surface container:
 * - Modern (`isEthereal`): Liquid Glass with optical top-edge highlight, cursor light, hover lift, and optional ripple.
 * - Classic (`!isEthereal`): Clean flat card with 1px hairline border, zero blur, zero cursor light, and zero ripple.
 */
export const GlassSurface: React.FC<GlassSurfaceProps> = ({
  children,
  className = '',
  enableCursorLight = true,
  enableRipple = false,
  hoverLift,
  subtle = false,
  onClick,
  ...rest
}) => {
  const { isEthereal } = useUiMode();
  const activeCursorLight = isEthereal && enableCursorLight;
  const activeRipple = isEthereal && enableRipple;
  const shouldLift = isEthereal && (hoverLift ?? Boolean(enableRipple || onClick));

  const containerRef = useRef<HTMLDivElement>(null);
  const lightRef = useRef<HTMLDivElement>(null);
  const targetPos = useRef({ x: 50, y: 50, active: false });
  const currentPos = useRef({ x: 50, y: 50, opacity: 0 });
  const rafRef = useRef<number | null>(null);
  const [ripples, setRipples] = useState<RippleInstance[]>([]);
  const nextRippleId = useRef(0);

  useEffect(() => {
    if (!activeCursorLight) return;
    const isTouch =
      typeof window !== 'undefined' &&
      (window.matchMedia('(pointer: coarse)').matches ||
        window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (isTouch) return;

    let running = true;
    const tick = () => {
      if (!running) return;
      const cur = currentPos.current;
      const tgt = targetPos.current;
      cur.x += (tgt.x - cur.x) * 0.16;
      cur.y += (tgt.y - cur.y) * 0.16;
      const desiredOpacity = tgt.active ? 1 : 0;
      cur.opacity += (desiredOpacity - cur.opacity) * 0.14;

      if (lightRef.current) {
        lightRef.current.style.opacity = cur.opacity.toFixed(3);
        lightRef.current.style.background = `radial-gradient(280px circle at ${cur.x}% ${cur.y}%, rgba(186, 230, 253, 0.36), rgba(255, 255, 255, 0.24) 40%, transparent 74%)`;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      running = false;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [activeCursorLight]);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!activeCursorLight || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    targetPos.current = {
      x: ((e.clientX - rect.left) / rect.width) * 100,
      y: ((e.clientY - rect.top) / rect.height) * 100,
      active: true,
    };
  };

  const handleMouseLeave = () => {
    targetPos.current.active = false;
  };

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (activeRipple && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const id = ++nextRippleId.current;
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      setRipples((prev) => [...prev.slice(-3), { id, x, y }]);
      setTimeout(() => {
        setRipples((prev) => prev.filter((r) => r.id !== id));
      }, 760);
    }
    onClick?.(e);
  };

  return (
    <div
      ref={containerRef}
      onMouseMove={activeCursorLight ? handleMouseMove : undefined}
      onMouseLeave={activeCursorLight ? handleMouseLeave : undefined}
      onClick={handleClick}
      className={`relative overflow-hidden ${
        isEthereal
          ? 'transition-[border-color,box-shadow,transform] duration-200 ease-out'
          : 'transition-colors duration-150'
      } ${subtle ? 'glass-panel-subtle' : 'glass-surface'} ${shouldLift ? 'glass-card-hover' : ''} ${className}`}
      {...rest}
    >
      {isEthereal && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-white/90 dark:via-sky-200/25 to-transparent z-0"
        />
      )}
      {activeCursorLight && (
        <div
          ref={lightRef}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-0 opacity-0 transition-opacity duration-200"
        />
      )}
      {activeRipple &&
        ripples.map((r) => (
          <span
            key={r.id}
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-10 overflow-hidden"
          >
            <span
              className="ripple-ring-1 absolute h-20 w-20 rounded-full border border-sky-400/45 bg-sky-200/15"
              style={{ left: r.x, top: r.y }}
            />
            <span
              className="ripple-ring-2 absolute h-14 w-14 rounded-full border border-white/75"
              style={{ left: r.x, top: r.y }}
            />
            <span
              className="ripple-ring-3 absolute h-8 w-8 rounded-full bg-white/35"
              style={{ left: r.x, top: r.y }}
            />
          </span>
        ))}
      <div className="relative z-10 h-full">{children}</div>
    </div>
  );
};
