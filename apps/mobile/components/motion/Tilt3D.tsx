/**
 * Tilt3D — dimensional presence without a 3D engine (DECISIONS: no 3D engine; the
 * depth register is 2.5D). Wraps children in a perspective + rotateX/rotateY
 * transform — still transform-only, GPU-composited, mid-Android-safe.
 *
 * Web (the pointer surface): the object gently faces the cursor — position drives
 * shared values directly (zero re-renders), and it eases home when the pointer
 * leaves. Native: a slow autonomous dimensional drift on two desynced sine periods
 * (like the companion sway), so the object reads as a thing in space, not a decal.
 * Reduced motion: perfectly still, flat, zero listeners.
 *
 * Calm register: default ±4° — depth you feel, not a gimmick you notice.
 */
import { ReactNode, useEffect } from 'react';
import { Platform, StyleProp, ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { useReducedMotion } from '@/lib/useReducedMotion';
import { breathe, duration, easing } from '@/theme/motion';

export function Tilt3D({
  children,
  maxTilt = 4,
  perspective = 800,
  /** Autonomous drift on native (web is pointer-driven). Off for tap-only surfaces. */
  drift = true,
  style,
}: {
  children: ReactNode;
  maxTilt?: number;
  perspective?: number;
  drift?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const reduced = useReducedMotion();
  const rx = useSharedValue(0); // rotateX degrees
  const ry = useSharedValue(0); // rotateY degrees

  useEffect(() => {
    if (reduced) {
      rx.value = 0;
      ry.value = 0;
      return;
    }

    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      // Face the cursor: normalized viewport position → tilt. Direct shared-value
      // writes — the React tree never re-renders on mouse move.
      const move = (e: MouseEvent) => {
        const nx = (e.clientX / window.innerWidth) * 2 - 1; // -1..1
        const ny = (e.clientY / window.innerHeight) * 2 - 1;
        ry.value = withTiming(nx * maxTilt, { duration: duration.base, easing: easing.settle });
        rx.value = withTiming(-ny * maxTilt, { duration: duration.base, easing: easing.settle });
      };
      const leave = () => {
        rx.value = withTiming(0, { duration: duration.gentle, easing: easing.settle });
        ry.value = withTiming(0, { duration: duration.gentle, easing: easing.settle });
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseout', leave);
      return () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseout', leave);
      };
    }

    if (drift) {
      // Two desynced periods (×1.7 and ×2.3 of the breath) — the composite drift
      // never visibly repeats, same trick as the companion's idle sway.
      rx.value = withRepeat(
        withSequence(
          withTiming(maxTilt * 0.6, { duration: breathe.period * 1.7, easing: easing.breathe }),
          withTiming(-maxTilt * 0.6, { duration: breathe.period * 1.7, easing: easing.breathe })
        ),
        -1,
        true
      );
      ry.value = withRepeat(
        withSequence(
          withTiming(-maxTilt, { duration: breathe.period * 2.3, easing: easing.breathe }),
          withTiming(maxTilt, { duration: breathe.period * 2.3, easing: easing.breathe })
        ),
        -1,
        true
      );
      return () => {
        cancelAnimation(rx);
        cancelAnimation(ry);
        rx.value = 0;
        ry.value = 0;
      };
    }
  }, [reduced, drift, maxTilt, rx, ry]);

  const anim = useAnimatedStyle(() => ({
    transform: [
      { perspective },
      { rotateX: `${rx.value}deg` },
      { rotateY: `${ry.value}deg` },
    ],
  }));

  return <Animated.View style={[style, anim]}>{children}</Animated.View>;
}
