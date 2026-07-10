/**
 * Mento motion tokens — the timing/easing vocabulary for all animation, sibling to
 * theme/tokens.ts. Components consume these — never raw durations or bezier values.
 *
 * Register: calm and filmic (Calm/Headspace, not a game). No overshoot springs,
 * breathing-tempo idle loops, staggered ease-out entrances. Animate ONLY transform
 * and opacity — never layout props (60fps on mid-range Android is a hard target).
 *
 * Motion is not per-user themed; static imports are fine (no useTheme needed).
 */
import { Easing } from 'react-native-reanimated';

export const duration = {
  /** Micro-feedback: press states, check badges. */
  fast: 200,
  /** Step/content crossfades. */
  base: 350,
  /** Entrances of hero content. */
  gentle: 500,
  /** Ambient shifts: accent wash, scene mood. */
  slow: 700,
} as const;

export const easing = {
  /** Content arriving — decelerate in. */
  enter: Easing.out(Easing.cubic),
  /** Content leaving — accelerate out. */
  exit: Easing.in(Easing.quad),
  /** Long settles (accent wash, stage moves) — soft landing, no overshoot. */
  settle: Easing.bezier(0.22, 1, 0.36, 1),
  /** Idle loops — sinusoidal, seamless at the loop point. */
  breathe: Easing.inOut(Easing.sin),
} as const;

export const spring = {
  /** Critically-damped feel — settles without bounce. */
  calm: { damping: 22, stiffness: 160, mass: 1 },
} as const;

export const stagger = {
  /** Delay between sibling entrances (ms): delay = index * unit. */
  unit: 80,
} as const;

export const breathe = {
  /** Full inhale+exhale cycle (ms) — a calm human breathing tempo. */
  period: 5200,
  /** Scale amplitude: ±1.5% — perceptible life, never distracting. */
  scale: 0.015,
} as const;

export const motion = { duration, easing, spring, stagger, breathe };
export type Motion = typeof motion;
