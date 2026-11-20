import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';

// Register GSAP plugins once at application startup
gsap.registerPlugin(ScrollTrigger, useGSAP);

export const REDUCED_MOTION_MEDIA = '(prefers-reduced-motion: reduce)';
export const MOTION_ALLOWED_MEDIA = '(prefers-reduced-motion: no-preference)';

export { gsap, ScrollTrigger, useGSAP };
