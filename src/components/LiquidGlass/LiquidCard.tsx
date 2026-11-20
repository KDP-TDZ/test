import React, { useRef, useState } from 'react';
import { gsap, MOTION_ALLOWED_MEDIA, REDUCED_MOTION_MEDIA, useGSAP } from '../../lib/gsapSetup';

interface RippleInstance {
  id: number;
  x: number;
  y: number;
}

export interface LiquidCardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  enableTilt?: boolean;
  hoverLift?: boolean;
  enableRipple?: boolean;
}

/**
 * LiquidCard: Custom Liquid Glass wrapper combining multi-layer glassmorphism CSS
 * with GSAP pointer-responsive specular sheen, gentle 3D liquid tilt, and lift.
 */
export const LiquidCard: React.FC<LiquidCardProps> = ({
  children,
  className = '',
  enableTilt = true,
  hoverLift = true,
  enableRipple = false,
  onClick,
  onMouseEnter,
  onMouseMove,
  onMouseLeave,
  ...rest
}) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const sheenRef = useRef<HTMLDivElement>(null);
  const pointerMotionEnabledRef = useRef(false);
  const [ripples, setRipples] = useState<RippleInstance[]>([]);
  const nextRippleId = useRef(0);

  const { contextSafe } = useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(`${MOTION_ALLOWED_MEDIA} and (hover: hover) and (pointer: fine)`, () => {
        pointerMotionEnabledRef.current = true;
        return () => {
          pointerMotionEnabledRef.current = false;
        };
      });
      mm.add(REDUCED_MOTION_MEDIA, () => {
        pointerMotionEnabledRef.current = false;
      });
    },
    { scope: cardRef }
  );

  const handleMouseEnter = contextSafe((e: React.MouseEvent<HTMLDivElement>) => {
    onMouseEnter?.(e);
    if (!pointerMotionEnabledRef.current || !cardRef.current) return;

    const rect = cardRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (hoverLift) {
      gsap.to(cardRef.current, {
        y: -3,
        scale: 1.015,
        duration: 0.24,
        ease: 'power2.out',
        overwrite: 'auto',
      });
    }

    if (sheenRef.current) {
      gsap.set(sheenRef.current, { x, y, scale: 0.85 });
      gsap.to(sheenRef.current, {
        autoAlpha: 0.9,
        scale: 1,
        duration: 0.28,
        ease: 'power2.out',
        overwrite: 'auto',
      });
    }
  });

  const handleMouseMove = contextSafe((e: React.MouseEvent<HTMLDivElement>) => {
    onMouseMove?.(e);
    if (!pointerMotionEnabledRef.current || !cardRef.current) return;

    const rect = cardRef.current.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const nx = x / rect.width - 0.5;
    const ny = y / rect.height - 0.5;

    if (sheenRef.current) {
      gsap.to(sheenRef.current, {
        x,
        y,
        autoAlpha: 0.95,
        duration: 0.32,
        ease: 'power2.out',
        overwrite: 'auto',
      });
    }

    if (enableTilt) {
      gsap.to(cardRef.current, {
        rotationY: nx * 4.5,
        rotationX: -ny * 4.5,
        transformPerspective: 950,
        duration: 0.32,
        ease: 'power2.out',
        overwrite: 'auto',
      });
    }
  });

  const handleMouseLeave = contextSafe((e: React.MouseEvent<HTMLDivElement>) => {
    onMouseLeave?.(e);
    if (!pointerMotionEnabledRef.current || !cardRef.current) return;

    gsap.to(cardRef.current, {
      y: 0,
      scale: 1,
      rotationX: 0,
      rotationY: 0,
      duration: 0.36,
      ease: 'power2.out',
      overwrite: 'auto',
      clearProps: 'transform',
    });

    if (sheenRef.current) {
      gsap.to(sheenRef.current, {
        autoAlpha: 0,
        scale: 0.85,
        duration: 0.24,
        ease: 'power2.out',
        overwrite: 'auto',
      });
    }
  });

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (enableRipple && cardRef.current) {
      const rect = cardRef.current.getBoundingClientRect();
      const id = ++nextRippleId.current;
      const x = e.clientX ? e.clientX - rect.left : rect.width / 2;
      const y = e.clientY ? e.clientY - rect.top : rect.height / 2;
      setRipples((prev) => [...prev.slice(-2), { id, x, y }]);
      setTimeout(() => {
        setRipples((prev) => prev.filter((r) => r.id !== id));
      }, 760);
    }
    onClick?.(e);
  };

  return (
    <div
      ref={cardRef}
      onMouseEnter={handleMouseEnter}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
      className={`liquid-card-glass relative overflow-hidden ${className}`}
      {...rest}
    >
      {/* Top optical refraction edge highlight */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-5 top-0 h-px bg-gradient-to-r from-transparent via-white/95 dark:via-sky-200/35 to-transparent z-0"
      />

      {/* Pointer-following liquid specular orb (compositor x/y/scale/autoAlpha only) */}
      <div
        ref={sheenRef}
        aria-hidden="true"
        className="liquid-card-specular pointer-events-none absolute -top-24 -left-24 h-48 w-48 rounded-full opacity-0 z-0"
      />

      {enableRipple &&
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
          </span>
        ))}

      <div className="relative z-10 h-full">{children}</div>
    </div>
  );
};
