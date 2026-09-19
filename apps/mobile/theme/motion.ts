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

/** Pillow-key press timings (PressKey). Press-in is quick and decelerating so the face
 * meets the thumb at once; a commit lands a touch more deliberately than a chip. */
export const press = {
  commit: 120,
  light: 100,
  /** Reduced motion: the opacity dip's release. */
  reduced: 150,
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

/** Tab hand-over (components/motion/tabTransition.ts): a short lateral shift in tab order. */
export const tabSwitch = {
  /** How far a tab sits to its side while parked (px) — a nudge, not a page slide. */
  distance: 24,
  /** Progress past which a scene is fully clear: the leaving tab is gone before the
   * arriving one appears, so two screens never ghost through each other. */
  clear: 0.5,
} as const;

export const breathe = {
  /** Full inhale+exhale cycle (ms) — a calm human breathing tempo. */
  period: 5200,
  /** Scale amplitude: ±1.5% — perceptible life, never distracting. */
  scale: 0.015,
} as const;

export const drift = {
  /** Sky-mote drift: one full three-mote rotation (ms). Each mote owns period/3,
   * so only ONE mote is ever moving — the landing's motion budget (≤3 simultaneous
   * movers: breathing logo + mountain drift + one mote). */
  period: 36000,
} as const;

/**
 * The round Stage (board A01 / A18): ambient, low-contrast, very slow. None of these
 * are attention-movers — a ring turn takes over a minute — so they sit under the
 * ≤3-movers budget the way the sky does. Ripples share the breathing period.
 */
export const stage = {
  ringSpin: 70000,
  ringSpinBack: 95000,
  sheen: 9000,
  motes: 9000,
  /** The two floating chat cards bob on unrelated periods so they never sync. */
  floatA: 6500,
  floatB: 7500,
  /** The hand-drawn underline draws once, after the headline has landed. */
  underlineDraw: 1100,
  underlineDelay: 1000,
} as const;

/** Step hand-over inside a flow (board T02): the old step is gone by `fast` (200), then a
 * breath — the new step's pieces start arriving at `arrive`, one every stagger unit, having
 * travelled `travel` px (from below going forward, from above going back). */
export const stepHandover = { arrive: 320, travel: 20 } as const;

/** Landing → role fork (board T01). The landing leaves fast and upward (the scene shrinks
 * away, the key dips); on the fork the two doors rise OUT of the Start key's place, 80ms
 * apart, then the art settles, then the headline, the sub, and the footer line — last. */
export const forkArrival = {
  backKey: 200,
  doors: 200,
  art: 400,
  head: 520,
  sub: 600,
  foot: 720,
  /** How far below its seat each door waits (the Start key sits about there). */
  doorRise: [170, 42],
  doorScale: 0.92,
  artScale: 1.04,
  artRise: 14,
  textRise: 18,
  footRise: 10,
  /** The landing's exit: the scene lifts and shrinks, the CTA dips. */
  sceneLift: 150,
  sceneScale: 0.55,
  ctaScale: 0.94,
  cardLift: 12,
  cardScale: 0.92,
  textLift: 16,
} as const;

/** Small dot rhythms: the typing dots in a chat card, and the five seeking dots that
 * light in turn between the two orbs while a mentor is being found. */
export const dots = {
  typing: { period: 1400, stagger: 180, rise: 4 },
  seek: { period: 2400, stagger: 300 },
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
  /** Curious: head-tilt + tiny rise — "what's this?" (email step, new questions). */
  curious: { tilt: 7, rise: 3, duration: 1600 },
  /** Joy: light wiggle for small wins (path chosen, journal saved) — a smile,
   * not the celebrate hop; joy stays lighter than a match. */
  joy: { wiggle: 4, cycles: 3, duration: 700 },
  /** Sleepy idle (22:00–06:00 local): slower/softer sway + a gentle droop — the
   * companion keeps you company at 2am, it doesn't perform. */
  sleepy: { startHour: 22, endHour: 6, droop: 2.5, swayScale: 0.6 },
  /** Volume-preservation factor: scaleX = 1 + (1 − scaleY) × k. Full mirroring
   * (k=1) reads rubbery; k≈0.6 reads plush — the cute register. */
  squashK: 0.6,
} as const;

/** Sheets and depth (board T06): a sheet rises over a screen that has settled back. */
export const sheet = {
  /** The screen underneath, while a sheet is up. */
  settleScale: 0.96,
  settleShift: 8,
  /** How far a deeper page's content comes in from the side. */
  deepShift: 48,
} as const;

/**
 * Inside a conversation (boards A05 / A20). `glow` is the soft ring that swells and fades
 * once around a mentor's message as it arrives; `settle` is how far the save key and the
 * "Saved" chip travel as they land; `sheetBack` is how far the screen under a sheet settles
 * back (FINAL_SPEC: 0.96, 8px down) — one shared value drives it together with the scrim.
 */
export const chat = {
  glow: 3200,
  /** The ring is brightest this far through its life, then fades for the rest. */
  glowPeakAt: 0.22,
  settle: { from: 0.92, rise: 6 },
  sheetBack: { scale: 0.96, shift: 8 },
} as const;

/**
 * The board's companion breath on a still screen (A23 reflection, A39 not found): an
 * alternating inhale of 3.5% with a one-degree lean, each half one `breathe.period` long.
 * Reduced motion: none — the companion simply sits.
 */
export const heroBreath = { scale: 0.035, lean: { from: -1, to: 0.8 }, half: 5200 } as const;

export const motion = { duration, easing, spring, stagger, breathe, character, stage, dots, chat };
export type Motion = typeof motion;

/** Mentor hand-off (board A34 "auto / continue"): once the session exists the screen holds
 * long enough to be read, then goes to Mentor Home by itself; the key goes at once. */
export const handoff = { hold: 3200 } as const;

/**
 * The letter on its way (board A04, request sent). The note lands once, tilted, a moment
 * after the headline; a small envelope then flies the dotted arc from the member's companion
 * to the mentor, one crossing per `fly` with a long rest at the far end; the postmark ripples
 * twice per breath, half a breath apart. Reduced motion: none of it — the envelope rests at
 * the top of the arc, the note is simply there, no ripples.
 */
export const letter = {
  land: { duration: 800, delay: 250, from: { rise: -22, tilt: -5 }, tilt: -1.2 },
  landEase: Easing.bezier(0.2, 0.7, 0.2, 1),
  fly: { period: 7800, delay: 1200 },
  /** Envelope keyframes along the arc: progress through the loop → (share of the arc's
   * width travelled, lift in px). It is visible between `show` and `hide`. */
  flyStops: [0, 0.07, 0.175, 0.35, 0.525, 0.63, 0.7, 1],
  flyX: [0, 0.085, 0.229, 0.5, 0.771, 0.915, 1, 1],
  flyY: [0, -8, -17, -22, -17, -8, 0, 0],
  flyShow: 0.07,
  flyFade: 0.63,
  flyHide: 0.7,
  ripple: { period: 5200, delays: [1100, 3700], grow: 2.4, peak: 0.7, peakAt: 0.12 },
  rippleEase: Easing.bezier(0.2, 0.6, 0.3, 1),
} as const;
