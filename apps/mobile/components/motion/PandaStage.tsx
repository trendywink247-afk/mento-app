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
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { Companion, type CompanionTrigger } from '@/components/art/Companion';
import type { CompanionAnimal } from '@/components/art/Companions';
import { Tilt3D } from '@/components/motion/Tilt3D';
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

export function PandaStage({
  step,
  celebrate = 0,
  animal = null,
}: {
  step: StageStep;
  /** Bump to celebrate (match found): wave + a joyful double dip. */
  celebrate?: number;
  /** The chosen companion — becomes the star from the moment of choice (DECISIONS
   * §I.5). null = not chosen yet, the panda remains the brand guide. */
  animal?: CompanionAnimal | null;
}) {
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
  const [rigTrigger, setRigTrigger] = useState<CompanionTrigger>(null);
  const firstColour = useRef(true);
  const prevStep = useRef<StageStep | null>(null);

  // The star swap: fade through when the chosen animal changes (never a hard cut).
  const [shownAnimal, setShownAnimal] = useState<CompanionAnimal | null>(animal);
  const swap = useSharedValue(1);

  const finishSwap = (next: CompanionAnimal | null) => {
    setShownAnimal(next);
    swap.value = withTiming(1, { duration: 175, easing: easing.enter });
  };

  useEffect(() => {
    if (animal === shownAnimal) return;
    if (reduced) {
      setShownAnimal(animal);
      return;
    }
    swap.value = withTiming(0, { duration: 175, easing: easing.exit }, (done) => {
      if (done) runOnJS(finishSwap)(animal);
    });
    // reason: shownAnimal/finishSwap are the swap's own state, not triggers
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animal, reduced]);

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
        setRigTrigger((t) => ({ kind: 'greet', n: (t?.n ?? 0) + 1 }));
      } else if (step === 'email' && prevStep.current !== step) {
        // "Optional, but helpful" — the companion tilts in, curious about you.
        setRigTrigger((t) => ({ kind: 'curious', n: (t?.n ?? 0) + 1 }));
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

  // Celebration (match found): the rig's crouch-hop-squash + the panda's wave.
  useEffect(() => {
    if (!celebrate || reduced) return;
    setWaveTrigger((n) => n + 1);
    setRigTrigger((t) => ({ kind: 'celebrate', n: (t?.n ?? 0) + 1 }));
  }, [celebrate, reduced]);

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
    opacity: opacity.value * swap.value,
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
        {/* Dimensional presence: the companion is an object in space — it faces the
          * pointer on web and drifts on two desynced periods on native. */}
        <Tilt3D maxTilt={6}>
          <Animated.View style={breathing}>
            <Companion
              animal={shownAnimal}
              size={BASE_SIZE}
              waveTrigger={waveTrigger}
              trigger={rigTrigger}
            />
          </Animated.View>
        </Tilt3D>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Sits in the journey's header band, top-right — clear of the back chevron.
  host: { position: 'absolute', top: 6, right: 20 },
});
