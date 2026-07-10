/**
 * PandaStage — the guide mascot that accompanies the whole onboarding journey.
 * Mounted ONCE at the journey level (never remounts between steps); it glides
 * between per-step anchors using transforms only, breathes continuously, waves on
 * greeting moments, dips happily when a colour is picked, and sways gently while
 * "waiting with you" on the connecting step. On the ready step it fades out and
 * hands the moment to the in-arch companion (which may not be a panda at all).
 */
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { AnimatedPanda } from '@/components/art/AnimatedPanda';
import { useBreathing } from '@/components/motion/useBreathing';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { breathe, duration, easing } from '@/theme/motion';
import { useTheme } from '@/theme/ThemeProvider';

export type StageStep = 'age' | 'email' | 'companion' | 'ready' | 'connecting';

const BASE_SIZE = 64;

/** Transform-only anchors from a fixed top-right base position. */
const ANCHORS: Record<StageStep, { x: number; y: number; scale: number; opacity: number }> = {
  age: { x: 0, y: 0, scale: 1, opacity: 1 },
  email: { x: 0, y: 0, scale: 1, opacity: 1 },
  companion: { x: -2, y: 4, scale: 1.12, opacity: 1 },
  ready: { x: 0, y: 10, scale: 0.85, opacity: 0 }, // hands off to the in-arch companion
  connecting: { x: 0, y: 2, scale: 1, opacity: 1 },
};

/** Steps where arriving deserves a small wave. */
const GREETING_STEPS: StageStep[] = ['age', 'companion'];

export function PandaStage({ step }: { step: StageStep }) {
  const reduced = useReducedMotion();
  const { companionColor } = useTheme();
  const breathing = useBreathing();

  const x = useSharedValue(ANCHORS[step].x);
  const y = useSharedValue(ANCHORS[step].y);
  const scale = useSharedValue(ANCHORS[step].scale);
  const opacity = useSharedValue(0); // enters by fading in on mount
  const dip = useSharedValue(0);
  const sway = useSharedValue(0);
  const [waveTrigger, setWaveTrigger] = useState(0);
  const firstColour = useRef(true);
  const prevStep = useRef<StageStep | null>(null);

  // Glide between anchors on step change; wave on greeting steps.
  useEffect(() => {
    const a = ANCHORS[step];
    const cfg = { duration: duration.slow, easing: easing.settle };
    if (reduced) {
      x.value = a.x;
      y.value = a.y;
      scale.value = a.scale;
      opacity.value = withTiming(a.opacity, { duration: 150 });
    } else {
      x.value = withTiming(a.x, cfg);
      y.value = withTiming(a.y, cfg);
      scale.value = withTiming(a.scale, cfg);
      opacity.value = withTiming(a.opacity, { duration: duration.gentle });
      if (GREETING_STEPS.includes(step) && prevStep.current !== step) {
        setWaveTrigger((n) => n + 1);
      }
    }
    prevStep.current = step;
  }, [step, reduced, x, y, scale, opacity]);

  // Happy dip when the user picks a colour (the theme just re-accented).
  useEffect(() => {
    if (firstColour.current) {
      firstColour.current = false;
      return;
    }
    if (reduced) return;
    dip.value = withSequence(
      withTiming(6, { duration: 160, easing: easing.enter }),
      withTiming(0, { duration: 340, easing: easing.settle })
    );
  }, [companionColor, reduced, dip]);

  // Gentle "waiting with you" sway on connecting.
  useEffect(() => {
    if (step !== 'connecting' || reduced) {
      cancelAnimation(sway);
      sway.value = withTiming(0, { duration: 200 });
      return;
    }
    sway.value = withRepeat(
      withTiming(3, { duration: breathe.period * 0.75, easing: easing.breathe }),
      -1,
      true
    );
    return () => cancelAnimation(sway);
  }, [step, reduced, sway]);

  const stageStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [
      { translateX: x.value },
      { translateY: y.value + dip.value },
      { scale: scale.value },
      { rotate: `${sway.value - (sway.value !== 0 ? 1.5 : 0)}deg` },
    ],
  }));

  return (
    <View style={styles.host} pointerEvents="none">
      <Animated.View style={stageStyle}>
        <Animated.View style={breathing}>
          <AnimatedPanda size={BASE_SIZE} waveTrigger={waveTrigger} />
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Sits in the journey's header band, top-right — clear of the back chevron.
  host: { position: 'absolute', top: 6, right: 20 },
});
