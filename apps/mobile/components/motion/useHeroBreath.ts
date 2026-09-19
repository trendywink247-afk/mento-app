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

export function useHeroBreath() {
  const reduced = useReducedMotion();
  const p = useSharedValue(0);
  useEffect(() => {
    if (reduced) {
      cancelAnimation(p);
      p.value = 0;
      return;
    }
    p.value = withRepeat(withTiming(1, { duration: heroBreath.half, easing: easing.breathe }), -1, true);
    return () => cancelAnimation(p);
  }, [reduced, p]);
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
