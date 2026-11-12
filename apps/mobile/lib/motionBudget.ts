/**
 * Motion budget — the one rule every looping animation in the app follows.
 *
 * Measured 2026-11-12 on a 120 Hz Android phone: an idle mentor Home drew ~114 frames/s and
 * held ~90% of a core while nothing happened, because a dozen `withRepeat(…, -1)` loops, a
 * Skia sky clock and Lottie loops ran forever. A loop that never ends keeps the UI thread
 * busy, the GPU drawing and the device awake, for as long as a screen stays open.
 *
 * The rule:
 *  1. A loop runs only for a bounded run after a real trigger (mount, focus regained, the app
 *     coming back to the foreground, a state change the caller passes as `restartKey`):
 *     at most LOOP_CYCLES cycles and never longer than LOOP_MAX_MS. Then it rests on a still
 *     frame (reversing loops end where they started).
 *  2. Nothing moves while the hosting screen is not focused or the app is not active.
 *  3. Reduced motion: no loops at all.
 *  4. Genuinely live indicators (typing dots) are mounted only while the state is live, so
 *     they are the one allowed exception (see e2e/motion-budget.test.cjs allowlist).
 *
 * Usage (Reanimated):
 *   const budget = useMotionBudget(restartKey);
 *   useEffect(() => {
 *     if (!budget.live) { cancelAnimation(v); v.value = withTiming(0, …); return; }
 *     v.value = withRepeat(withTiming(1, { duration: half }), budgetRepeats(half, true), true);
 *     return () => cancelAnimation(v);
 *   }, [budget.live, budget.run]);
 */
import { NavigationContext } from '@react-navigation/native';
import { useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { useReducedMotion } from '@/lib/useReducedMotion';

/** Maximum full cycles a loop plays per trigger. */
export const LOOP_CYCLES = 3;
/** Hard cap (ms) on one bounded run, whatever the period. */
export const LOOP_MAX_MS = 6000;

/**
 * The `numberOfReps` to pass to `withRepeat` for a step of `stepMs`.
 * - `reverse` (ping-pong): each rep is a half cycle; the count is even so the value ends
 *   back where it started (the rest pose). At least 2 when anything runs at all.
 * - not reversing: each rep is one full cycle (ends at the end value; callers reset to rest).
 * Never -1, never more than LOOP_CYCLES cycles, never longer than LOOP_MAX_MS.
 */
export function budgetRepeats(stepMs: number, reverse: boolean, cycles: number = LOOP_CYCLES): number {
  const step = Math.max(1, Number.isFinite(stepMs) ? stepMs : 1);
  const wanted = Math.max(1, Math.floor(cycles));
  if (reverse) {
    const byTime = Math.floor(LOOP_MAX_MS / step);
    const halves = Math.min(wanted * 2, byTime);
    return Math.max(2, halves - (halves % 2));
  }
  const byTime = Math.floor(LOOP_MAX_MS / step);
  return Math.max(1, Math.min(wanted, byTime));
}

/** Total ms a bounded run lasts (for timers that switch a frame clock off). */
export function budgetMs(stepMs: number, reverse: boolean, cycles: number = LOOP_CYCLES): number {
  return budgetRepeats(stepMs, reverse, cycles) * Math.max(1, stepMs);
}

/** Pure decision, exported for tests: may anything move right now? */
export function motionAllowed(state: { reduced: boolean; focused: boolean; appActive: boolean }): boolean {
  return !state.reduced && state.focused && state.appActive;
}

/** Focus of the screen hosting the caller; `true` outside any navigator (e.g. the root sky). */
export function useHostFocused(): boolean {
  const nav = useContext(NavigationContext);
  const [focused, setFocused] = useState(() => nav?.isFocused() ?? true);
  useEffect(() => {
    if (!nav) return;
    setFocused(nav.isFocused());
    const offFocus = nav.addListener('focus', () => setFocused(true));
    const offBlur = nav.addListener('blur', () => setFocused(false));
    return () => {
      offFocus();
      offBlur();
    };
  }, [nav]);
  return focused;
}

/** `true` while the app is in the foreground. */
export function useAppActive(): boolean {
  const [active, setActive] = useState(() => AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setActive(s === 'active'));
    return () => sub.remove();
  }, []);
  return active;
}

export type MotionBudget = {
  /** Motion is allowed now (focused, foreground, not reduced). */
  live: boolean;
  /** Changes every time a new bounded run should start: put it in the effect's deps. */
  run: number;
};

/**
 * The budget for one animated component. `restartKey`: a real change that deserves a new
 * bounded run (a new pose, a new arrival, a tap). Focus regained and the app coming back to
 * the foreground start a new run on their own.
 */
export function useMotionBudget(restartKey: unknown = null): MotionBudget {
  const reduced = useReducedMotion();
  const focused = useHostFocused();
  const appActive = useAppActive();
  const live = motionAllowed({ reduced, focused, appActive });
  const run = useRef(0);
  const last = useRef<{ live: boolean; key: unknown } | null>(null);
  if (!last.current || last.current.key !== restartKey || (live && !last.current.live)) run.current += 1;
  last.current = { live, key: restartKey };
  return { live, run: run.current };
}
