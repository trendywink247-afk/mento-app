/**
 * GroundGlow — the soft contact shadow under a piece of hero art (board A01 / A18), so
 * the art stands ON the stage instead of floating over it. It breathes with the
 * companion tempo: opacity 0.35↔0.8 and a small horizontal stretch. Transform and
 * opacity only; still (mid-strength) under reduced motion.
 */
import { useEffect, useId } from 'react';
import Animated, {
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, Ellipse, RadialGradient, Stop } from 'react-native-svg';

import { useReducedMotion } from '@/lib/useReducedMotion';
import { breathe, easing } from '@/theme/motion';
import { useTheme } from '@/theme/ThemeProvider';

export function GroundGlow({ width, height }: { width: number; height: number }) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const p = useSharedValue(0.5);

  useEffect(() => {
    if (reduced) {
      cancelAnimation(p);
      p.value = 0.5;
      return;
    }
    p.value = 0;
    p.value = withRepeat(withTiming(1, { duration: breathe.period, easing: easing.breathe }), -1, true);
    return () => cancelAnimation(p);
  }, [reduced, p]);

  const style = useAnimatedStyle(() => ({
    opacity: interpolate(p.value, [0, 1], [0.35, 0.8]),
    transform: [{ scaleX: interpolate(p.value, [0, 1], [0.92, 1.04]) }],
  }));

  return (
    <Animated.View style={[{ width, height }, style]} pointerEvents="none">
      <Svg width={width} height={height}>
        <Defs>
          <RadialGradient id={`glow${uid}`} cx="50%" cy="50%" rx="50%" ry="50%">
            <Stop offset="0" stopColor={colors.ink} stopOpacity={0.2} />
            <Stop offset="1" stopColor={colors.ink} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Ellipse cx={width / 2} cy={height / 2} rx={width / 2} ry={height / 2} fill={`url(#glow${uid})`} />
      </Svg>
    </Animated.View>
  );
}
