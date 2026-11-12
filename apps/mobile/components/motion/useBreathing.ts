/**
 * useBreathing — a slow ±1.5% scale at a calm breathing tempo (theme/motion breathe
 * tokens). Returns an animated style for an Animated.View.
 *
 * It breathes a few times and then rests (scale 1), instead of looping forever. An
 * endless loop runs a frame callback on the UI thread for as long as the screen is open,
 * keeps the view tree "busy" (no idle state, so the device never settles), and costs
 * battery on screens people leave open for an hour, like a chat. `restartKey` breathes
 * again on a real change (a new pose, a new arrival). Off under reduced motion.
 */
import { useEffect } from 'react';
import {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useReducedMotion } from '@/lib/useReducedMotion';
import { breathe, easing } from '@/theme/motion';
import { useMotionBudget } from '@/lib/motionBudget';

/** Breaths before the art rests. Each breath is an inhale and an exhale. */
export const BREATHS_BEFORE_REST = 3;

/** Number of half-cycles for `n` breaths. Even, so the reversing repeat ends back at rest. */
export const breathHalves = (n: number): number => Math.max(0, Math.floor(n)) * 2;

export function useBreathing(enabled = true, restartKey: unknown = null) {
  const reduced = useReducedMotion();
  const scale = useSharedValue(1);
  // Focus lost or app in the background: rest; coming back breathes again (lib/motionBudget).
  const budget = useMotionBudget(restartKey);

  useEffect(() => {
    if (!enabled || reduced || !budget.live) {
      cancelAnimation(scale);
      scale.value = withTiming(1, { duration: 150 });
      return;
    }
    scale.value = 1;
    scale.value = withRepeat(
      withTiming(1 + breathe.scale, { duration: breathe.period / 2, easing: easing.breathe }),
      breathHalves(BREATHS_BEFORE_REST),
      true
    );
    return () => cancelAnimation(scale);
  }, [enabled, reduced, scale, budget.live, budget.run]);

  return useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
}
