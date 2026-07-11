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

/**
 * Character-state timing for the reactive companions (DECISIONS §I.4 amended —
 * in-house rig). Calm register: squash/stretch stays subtle (≤8%), anticipation
 * before any hop, everything settles without overshoot.
 */
export const character = {
  /** Idle micro-sway layered over breathing; 8.6s vs the 5.2s breathe — the two
   * periods share no small multiple, so the composite idle never visibly repeats. */
  sway: { period: 8600, degrees: 1 },
  /** Greet: a soft double nod. */
  greet: { dip: 6, duration: 900 },
  /** Celebrate: crouch(220) → rise(150) → hang(60) → land(100) → settle(270) ≈ 800ms —
   * the classic gentle-hop structure (slow anticipation/landing, fast action). */
  celebrate: { crouch: 0.94, hopRatio: 0.12, stretch: 1.04, squash: 0.95, duration: 800 },
  /** Comfort: slow heavy lean-in (~800ms), held, exit even slower (~1s) —
   * present-and-caring, never drooping (no guilt mechanics, T&S #5). */
  comfort: { lean: 6, sink: 2, duration: 2600 },
  /** Tap-react: response starts <100ms (perceived-instant), calm 220ms settle. */
  tap: { squish: 0.96, inMs: 100, outMs: 220 },
  /** Volume-preservation factor: scaleX = 1 + (1 − scaleY) × k. Full mirroring
   * (k=1) reads rubbery; k≈0.6 reads plush — the cute register. */
  squashK: 0.6,
} as const;

export const motion = { duration, easing, spring, stagger, breathe, character };
export type Motion = typeof motion;
