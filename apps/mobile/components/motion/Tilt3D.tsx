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

/** Max parallax travel at depth=1 (px). Depth scales it: closer planes move more. */
const SHIFT_MAX = 16;

export function Tilt3D({
  children,
  maxTilt = 4,
  perspective = 800,
  /** Parallax depth: 0 = locked to the page, 1 = closest plane (moves most with the
   * pointer), negative = background plane (moves against the pointer). Different
   * depths on sibling layers is what separates the planes into a 3D scene. */
  depth = 0,
  /** Autonomous drift on native (web is pointer-driven). Off for tap-only surfaces. */
  drift = true,
  style,
}: {
  children: ReactNode;
  maxTilt?: number;
  perspective?: number;
  depth?: number;
  drift?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const reduced = useReducedMotion();
  const rx = useSharedValue(0); // rotateX degrees
  const ry = useSharedValue(0); // rotateY degrees
  const tx = useSharedValue(0); // parallax shift px
  const ty = useSharedValue(0);

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
        const cfg = { duration: duration.base, easing: easing.settle };
        ry.value = withTiming(nx * maxTilt, cfg);
        rx.value = withTiming(-ny * maxTilt, cfg);
        tx.value = withTiming(nx * SHIFT_MAX * depth, cfg);
        ty.value = withTiming(ny * SHIFT_MAX * depth, cfg);
      };
      const leave = () => {
        const cfg = { duration: duration.gentle, easing: easing.settle };
        rx.value = withTiming(0, cfg);
        ry.value = withTiming(0, cfg);
        tx.value = withTiming(0, cfg);
        ty.value = withTiming(0, cfg);
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
      // The drift breathes a hint of parallax too, tied to the same sines.
      tx.value = withRepeat(
        withTiming(SHIFT_MAX * depth * 0.4, {
          duration: breathe.period * 2.3,
          easing: easing.breathe,
        }),
        -1,
        true
      );
      return () => {
        cancelAnimation(rx);
        cancelAnimation(ry);
        cancelAnimation(tx);
        rx.value = 0;
        ry.value = 0;
        tx.value = 0;
      };
    }
  }, [reduced, drift, maxTilt, depth, rx, ry, tx, ty]);

  const anim = useAnimatedStyle(() => ({
    transform: [
      { perspective },
      { translateX: tx.value },
      { translateY: ty.value },
      { rotateX: `${rx.value}deg` },
      { rotateY: `${ry.value}deg` },
    ],
  }));

  return <Animated.View style={[style, anim]}>{children}</Animated.View>;
}
