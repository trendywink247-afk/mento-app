/**
 * useBreathing — a slow ±1.5% scale loop at a calm breathing tempo (theme/motion
 * breathe tokens). Returns an animated style for an Animated.View. The loop is
 * cancelled (and scale settles back to 1) when disabled or under reduced motion.
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

export function useBreathing(enabled = true) {
  const reduced = useReducedMotion();
  const scale = useSharedValue(1);

  useEffect(() => {
    if (!enabled || reduced) {
      cancelAnimation(scale);
      scale.value = withTiming(1, { duration: 150 });
      return;
    }
    scale.value = withRepeat(
      withTiming(1 + breathe.scale, { duration: breathe.period / 2, easing: easing.breathe }),
      -1,
      true
    );
    return () => cancelAnimation(scale);
  }, [enabled, reduced, scale]);

  return useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
}
