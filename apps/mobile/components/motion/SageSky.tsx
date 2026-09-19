/**
 * SageSky — the mentor side's green light over the journey sky (board A34: a sage
 * radial glow high on the left). It lies over the persistent AmbientBackground and only
 * fades — opacity only; under reduced motion it switches at the short opacity step.
 */
import { useEffect, useId } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Defs, Ellipse, RadialGradient, Stop } from 'react-native-svg';

import { useReducedMotion } from '@/lib/useReducedMotion';
import { useFrameSize } from '@/lib/useFrameSize';
import { COMPANION_COLORS } from '@/theme/companion';
import { duration, easing } from '@/theme/motion';
import { wash } from '@/theme/tokens';

/** 'journey' = A34's glow high on the left; 'top' = the mentor pages' soft wash across the
 * top edge (A35 / A36 / A37: a wide ellipse, sage tint fading to the ground). */
export function SageSky({ on = true, shape = 'journey' }: { on?: boolean; shape?: 'journey' | 'top' }) {
  const reduced = useReducedMotion();
  const { width } = useFrameSize();
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const o = useSharedValue(on ? 1 : 0);

  useEffect(() => {
    o.value = withTiming(on ? 1 : 0, reduced ? { duration: duration.fast * 0.75 } : { duration: duration.slow, easing: easing.settle });
  }, [on, reduced, o]);

  const style = useAnimatedStyle(() => ({ opacity: o.value }));
  const sage = COMPANION_COLORS.sage.accent;
  // Board: 660×620 at (-135, -120) on a 390-wide frame — scaled to the frame width.
  const k = width / 390;
  const top = shape === 'top';
  const rx = top ? width / 2 + 60 : 330 * k;
  const ry = top ? 165 : 310 * k;
  const cx = top ? width / 2 : -135 * k + rx;
  const cy = top ? 15 : -120 * k + ry;
  // The top wash is the board's plain tint (#DCE6DD at full strength) fading out.
  const stops = top ? [wash.green, 1, 0] : [sage, 0.28, 0.09];

  return (
    <Animated.View style={[StyleSheet.absoluteFill, style]} pointerEvents="none">
      <Svg width="100%" height="100%">
        <Defs>
          <RadialGradient id={`sage${uid}`} cx={cx} cy={cy} rx={rx} ry={ry} fx={cx} fy={cy} gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor={stops[0] as string} stopOpacity={stops[1] as number} />
            <Stop offset="0.55" stopColor={stops[0] as string} stopOpacity={top ? 0.3 : (stops[2] as number)} />
            <Stop offset="1" stopColor={stops[0] as string} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={`url(#sage${uid})`} />
      </Svg>
    </Animated.View>
  );
}
