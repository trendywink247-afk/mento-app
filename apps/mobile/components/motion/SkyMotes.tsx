import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { useReducedMotion } from '@/lib/useReducedMotion';
import { drift, easing } from '@/theme/motion';

/**
 * Three soft light motes drifting up through the sky, SEQUENCED so only one moves
 * at any moment (motion budget: the landing already has the breathing logo and the
 * mountain drift; CLAUDE.md caps simultaneous movers at 3). Transform/opacity only.
 * Reduced motion renders nothing at all — stillness, not frozen dots.
 */
const MOTES: { left: `${number}%`; top: `${number}%`; size: number }[] = [
  { left: '18%', top: '22%', size: 10 },
  { left: '74%', top: '14%', size: 7 },
  { left: '58%', top: '34%', size: 8 },
];

const ACTIVE = drift.period / 3;

function Mote({ index, left, top, size }: { index: number } & (typeof MOTES)[number]) {
  const t = useSharedValue(0);

  useEffect(() => {
    // Each mote drifts for one window, then holds at rest while the other two take
    // their turns — so exactly one mote animates at any instant.
    t.value = withDelay(
      index * ACTIVE,
      withRepeat(
        withSequence(
          withTiming(1, { duration: ACTIVE, easing: easing.breathe }),
          withTiming(0, { duration: 0 }),
          withTiming(0, { duration: ACTIVE * 2 }),
        ),
        -1,
      ),
    );
    return () => cancelAnimation(t);
  }, [index, t]);

  const style = useAnimatedStyle(() => ({
    // sin curve: fade in, peak mid-drift, fade out — never pops at the reset.
    opacity: Math.sin(t.value * Math.PI) * 0.45,
    transform: [{ translateY: t.value * -34 }, { translateX: t.value * 10 }],
  }));

  return (
    <Animated.View
      style={[styles.mote, { left, top, width: size, height: size, borderRadius: size / 2 }, style]}
    />
  );
}

export function SkyMotes() {
  const reduced = useReducedMotion();
  if (reduced) return null;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {MOTES.map((m, i) => (
        <Mote key={i} index={i} {...m} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  mote: { position: 'absolute', backgroundColor: '#FFFFFF' },
});
