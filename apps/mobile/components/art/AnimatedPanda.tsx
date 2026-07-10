/**
 * AnimatedPanda — the Panda.tsx wave-pose drawing re-layered for life: the exact
 * same paths/colours split across stacked SVG layers (base body+cape / waving arm /
 * head / eyes) so each can move independently via its container's TRANSFORM only.
 *
 * Motion in the rig (all calm register):
 *  - blink: eyes layer scaleY squash on a randomized 2.5–5.5s cycle
 *  - head tilt: ±2° slow sway
 *  - wave: the raised arm rocks around the shoulder when `waveTrigger` changes
 * Breathing/position/scale belong to the HOST (PandaStage / useBreathing) — this
 * component only animates its internal parts. All loops stop under reduced motion.
 */
import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Ellipse, Path, Text as SvgText } from 'react-native-svg';

import { useReducedMotion } from '@/lib/useReducedMotion';
import { breathe, easing } from '@/theme/motion';
import { useTheme } from '@/theme/ThemeProvider';

const WHITE = '#FFFFFF';
const BLACK = '#2B2B33';
const BLUSH = '#F3C5C5';
const VIEWBOX = '0 0 160 160';

export function AnimatedPanda({
  size = 160,
  waveTrigger = 0,
}: {
  size?: number;
  /** Bump this number to make the panda wave (entrances, greetings). */
  waveTrigger?: number;
}) {
  const { colors } = useTheme();
  const accent = colors.accent;
  const reduced = useReducedMotion();

  const eyesScaleY = useSharedValue(1);
  const headTilt = useSharedValue(0);
  const armAngle = useSharedValue(0);
  const blinkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Blink on a randomized cycle — regularity reads robotic.
  useEffect(() => {
    if (reduced) return;
    let alive = true;
    const schedule = () => {
      blinkTimer.current = setTimeout(() => {
        if (!alive) return;
        eyesScaleY.value = withSequence(
          withTiming(0.12, { duration: 90 }),
          withTiming(1, { duration: 110 })
        );
        schedule();
      }, 2500 + Math.random() * 3000);
    };
    schedule();
    return () => {
      alive = false;
      if (blinkTimer.current) clearTimeout(blinkTimer.current);
    };
  }, [reduced, eyesScaleY]);

  // Head sway, breathing-tempo.
  useEffect(() => {
    if (reduced) {
      cancelAnimation(headTilt);
      headTilt.value = withTiming(0, { duration: 150 });
      return;
    }
    headTilt.value = withRepeat(
      withTiming(2, { duration: breathe.period, easing: easing.breathe }),
      -1,
      true
    );
    return () => cancelAnimation(headTilt);
  }, [reduced, headTilt]);

  // Wave: two gentle rocks of the raised arm, then settle.
  useEffect(() => {
    if (reduced) return;
    armAngle.value = withSequence(
      withTiming(-14, { duration: 240, easing: easing.enter }),
      withTiming(10, { duration: 300 }),
      withTiming(-10, { duration: 300 }),
      withTiming(0, { duration: 320, easing: easing.settle })
    );
  }, [waveTrigger, reduced, armAngle]);

  const eyesStyle = useAnimatedStyle(() => ({
    transform: [{ scaleY: eyesScaleY.value }],
  }));
  const headStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${headTilt.value - 1}deg` }],
  }));
  const armStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${armAngle.value}deg` }],
  }));

  return (
    <View style={{ width: size, height: size }}>
      {/* base: cape, body, legs, resting arm, medallion */}
      <Svg style={StyleSheet.absoluteFill} viewBox={VIEWBOX}>
        <Path d="M38 88 Q30 130 44 148 L80 138 116 148 Q130 130 122 88 Q102 78 80 78 Q58 78 38 88 Z" fill={accent} opacity={0.9} />
        <Ellipse cx="80" cy="112" rx="42" ry="36" fill={WHITE} />
        <Ellipse cx="80" cy="124" rx="26" ry="20" fill="#F4F1F6" />
        <Ellipse cx="52" cy="140" rx="14" ry="10" fill={BLACK} />
        <Ellipse cx="108" cy="140" rx="14" ry="10" fill={BLACK} />
        <Ellipse cx="118" cy="108" rx="10" ry="15" fill={BLACK} transform="rotate(20 118 108)" />
        <Circle cx="80" cy="92" r="7" fill="#D9B36A" />
        <SvgText x="80" y="96" fontSize="9" fontWeight="bold" fill={WHITE} textAnchor="middle">
          M
        </SvgText>
      </Svg>

      {/* waving arm — rocks around the shoulder (transformOrigin at ~(46,66)/160) */}
      <Animated.View style={[StyleSheet.absoluteFill, { transformOrigin: '29% 41%' }, armStyle]}>
        <Svg style={StyleSheet.absoluteFill} viewBox={VIEWBOX}>
          <Ellipse cx="40" cy="74" rx="10" ry="16" fill={BLACK} transform="rotate(-42 40 74)" />
        </Svg>
      </Animated.View>

      {/* head — slow ±2° sway around the neck */}
      <Animated.View style={[StyleSheet.absoluteFill, { transformOrigin: '50% 45%' }, headStyle]}>
        <Svg style={StyleSheet.absoluteFill} viewBox={VIEWBOX}>
          <Circle cx="80" cy="58" r="38" fill={WHITE} />
          <Circle cx="48" cy="30" r="13" fill={BLACK} />
          <Circle cx="112" cy="30" r="13" fill={BLACK} />
          <Ellipse cx="64" cy="58" rx="11" ry="13" fill={BLACK} transform="rotate(-12 64 58)" />
          <Ellipse cx="96" cy="58" rx="11" ry="13" fill={BLACK} transform="rotate(12 96 58)" />
          <Ellipse cx="80" cy="72" rx="9" ry="6.5" fill={BLACK} opacity={0.95} />
          <Ellipse cx="80" cy="70.5" rx="3.6" ry="2.4" fill={WHITE} opacity={0.25} />
          <Path d="M73 80 q7 7 14 0" stroke={BLACK} strokeWidth="2.5" fill="none" strokeLinecap="round" />
          <Ellipse cx="52" cy="70" rx="5" ry="3" fill={BLUSH} />
          <Ellipse cx="108" cy="70" rx="5" ry="3" fill={BLUSH} />
        </Svg>

        {/* eyes — squash to a line to blink (origin on the eye line) */}
        <Animated.View style={[StyleSheet.absoluteFill, { transformOrigin: '50% 36%' }, eyesStyle]}>
          <Svg style={StyleSheet.absoluteFill} viewBox={VIEWBOX}>
            <Circle cx="64" cy="57" r="4.2" fill={WHITE} />
            <Circle cx="96" cy="57" r="4.2" fill={WHITE} />
            <Circle cx="65.5" cy="55.5" r="1.5" fill={BLACK} />
            <Circle cx="97.5" cy="55.5" r="1.5" fill={BLACK} />
          </Svg>
        </Animated.View>
      </Animated.View>
    </View>
  );
}
