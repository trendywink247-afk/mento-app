/**
 * useHeroBreath — the board's companion breath (A23 / A39): scale 1 → 1.035 with a lean from
 * -1° to 0.8°, alternating, one `heroBreath.half` each way, sinusoidal. Put the style on an
 * Animated.View whose transform origin is the companion's feet. Transform only. Reduced
 * motion: still.
 */
import { useEffect } from 'react';
import { cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { useReducedMotion } from '@/lib/useReducedMotion';
import { easing, heroBreath } from '@/theme/motion';
import { budgetRepeats, useMotionBudget } from '@/lib/motionBudget';

export function useHeroBreath(restartKey: unknown = null) {
  const reduced = useReducedMotion();
  const p = useSharedValue(0);
  // Bounded (lib/motionBudget): a few breaths after a real trigger, then still.
  const budget = useMotionBudget(restartKey);
  useEffect(() => {
    if (reduced || !budget.live) {
      cancelAnimation(p);
      p.value = 0;
      return;
    }
    p.value = withRepeat(withTiming(1, { duration: heroBreath.half, easing: easing.breathe }), budgetRepeats(heroBreath.half, true), true);
    return () => cancelAnimation(p);
  }, [reduced, p, budget.live, budget.run]);
  return useAnimatedStyle(() =>
    reduced
      ? { transform: [{ scale: 1 }, { rotate: '0deg' }] }
      : {
          transform: [
            { scale: 1 + heroBreath.scale * p.value },
            { rotate: `${heroBreath.lean.from + (heroBreath.lean.to - heroBreath.lean.from) * p.value}deg` },
          ],
        },
  );
}
