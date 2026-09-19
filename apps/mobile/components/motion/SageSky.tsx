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

export function SageSky({ on }: { on: boolean }) {
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
  const rx = 330 * k;
  const ry = 310 * k;
  const cx = -135 * k + rx;
  const cy = -120 * k + ry;

  return (
    <Animated.View style={[StyleSheet.absoluteFill, style]} pointerEvents="none">
      <Svg width="100%" height="100%">
        <Defs>
          <RadialGradient id={`sage${uid}`} cx={cx} cy={cy} rx={rx} ry={ry} fx={cx} fy={cy} gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor={sage} stopOpacity={0.28} />
            <Stop offset="0.55" stopColor={sage} stopOpacity={0.09} />
            <Stop offset="1" stopColor={sage} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={`url(#sage${uid})`} />
      </Svg>
    </Animated.View>
  );
}
