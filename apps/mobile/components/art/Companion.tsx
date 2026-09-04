/**
 * Companion — THE single entry point for rendering the growth companion anywhere
 * (onboarding stage, ready arch, profile). Asset strategy is hidden inside
 * (DECISIONS §I.4 amended, §K.8 2026-09-05): the founder-approved painterly pose set
 * (six animals × idle/greet/joy/comfort/curious/sleepy, +coffee/shield for Panda,
 * assets/companions/generated) on the in-house ReactiveCompanion rig is the default;
 * a Lottie file from assets/companions/registry.ts overrides per-animal when dropped
 * in; Fluent Emoji art remains the fallback for any animal without generated art;
 * a commissioned Rive set can replace the internals later — call sites never change.
 *
 * Pose: callers may pin a pose directly (`pose`), or let it derive from the rig
 * `trigger` (greet/celebrate/joy/comfort/curious → the matching painterly pose, held
 * for the trigger's character duration + a short tail, then released back to rest).
 * Rest is `sleepy` during the companion's local night window (theme/motion.ts
 * `character.sleepy`), else `idle`. Pose changes crossfade (opacity only, manual
 * shared value) — instant under reduced motion. The crossfade tracks the resolved
 * ART (animal + pose), not just the pose key, so an animal change crossfades too
 * instead of hard-cutting.
 *
 * State vocabulary (all animals): idle micro-sway (+ host breathing), greet,
 * celebrate, comfort, tap-react (`interactive`).
 */
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, type ImageSourcePropType } from 'react-native';
import LottieView from 'lottie-react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { SvgXml } from 'react-native-svg';

import { COMPANION_FLUENT } from '@/assets/companions/fluent';
import { COMPANION_GENERATED, type CompanionPose } from '@/assets/companions/generated';
import { COMPANION_LOTTIE } from '@/assets/companions/registry';
import { type CompanionAnimal } from '@/components/art/Companions';
import { ReactiveCompanion, isSleepyHour, type CompanionTrigger } from '@/components/art/ReactiveCompanion';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { character, duration, easing } from '@/theme/motion';

export type { CompanionTrigger, CompanionPose };

/** Rig trigger kind → the painterly pose it plays while the state animates. */
const TRIGGER_POSE: Record<NonNullable<CompanionTrigger>['kind'], CompanionPose> = {
  greet: 'greet',
  celebrate: 'joy',
  joy: 'joy',
  comfort: 'comfort',
  curious: 'curious',
};

/** How long (ms, on top of the character duration) the triggered pose lingers before
 * releasing back to rest — a small tail so the pose doesn't cut out mid-gesture. */
const TRIGGER_TAIL: Record<NonNullable<CompanionTrigger>['kind'], number> = {
  greet: 400,
  celebrate: 600,
  joy: 400,
  comfort: 0,
  curious: 0,
};

/** Rest pose: sleepy during the companion's local night window, else idle.
 * Shares `isSleepyHour` with ReactiveCompanion's idle sway — but where that rig
 * checks once per mount (a screen alive across the boundary stays in its opening
 * state), this re-evaluates on every render, so the pose can flip live. */
function restingPose(): CompanionPose {
  return isSleepyHour() ? 'sleepy' : 'idle';
}

export function Companion({
  animal,
  size = 72,
  waveTrigger = 0,
  trigger = null,
  pose,
  interactive = false,
  onPress,
}: {
  /** null = no choice yet — the panda greets as the brand guide. */
  animal: CompanionAnimal | null;
  size?: number;
  /** Panda-only bonus: bump to wave the arm (rides on top of the rig states). */
  waveTrigger?: number;
  /** Play a state: {kind: 'greet'|'celebrate'|'comfort', n}. */
  trigger?: CompanionTrigger;
  /** Pin a specific pose directly, overriding trigger-derived pose. */
  pose?: CompanionPose;
  /** Tap-react acknowledgement (wraps in a Pressable). */
  interactive?: boolean;
  onPress?: () => void;
}) {
  const reduced = useReducedMotion();
  void waveTrigger; // kept in the API for a future rig that waves (Rive)

  // Unknown strings (corrupted/legacy stored value, e.g. lowercase 'panda') must
  // degrade to the brand guide, not crash the screen with fluent === undefined.
  const requested = animal ?? 'Panda';
  const resolved: CompanionAnimal = requested in COMPANION_FLUENT ? requested : 'Panda';
  const lottieSource = COMPANION_LOTTIE[resolved];
  const set = COMPANION_GENERATED[resolved];
  const fluent = COMPANION_FLUENT[resolved];

  // Trigger-derived pose, held for the character duration + tail then released.
  const [triggerPose, setTriggerPose] = useState<CompanionPose | null>(null);
  const tailTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!trigger) {
      // A caller stopping the trigger mid-hold (e.g. CompanionStep passes
      // trigger=null the instant a thumbnail is deselected) must NOT cut the
      // gesture short — the tail timer already scheduled below releases it.
      return;
    }
    if (tailTimer.current) clearTimeout(tailTimer.current);
    setTriggerPose(TRIGGER_POSE[trigger.kind]);
    const hold = character[trigger.kind].duration + TRIGGER_TAIL[trigger.kind];
    tailTimer.current = setTimeout(() => setTriggerPose(null), hold);
    // reason: trigger.n is the replay signal for the same kind
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger?.kind, trigger?.n]);
  // Unmount-only cleanup — the effect above deliberately does not return a cleanup
  // (that would fire on every dependency change, including the null one above).
  useEffect(
    () => () => {
      if (tailTimer.current) clearTimeout(tailTimer.current);
    },
    []
  );

  const wanted = pose ?? triggerPose ?? restingPose();
  const effective: CompanionPose = set.poses[wanted] ? wanted : 'idle';
  const artSource = set.poses[effective] ?? set.poses.idle;
  const artKey = `${resolved}/${effective}`;

  // Crossfade between resolved art — opacity only, manual shared value (never
  // entering=/exiting=). Keyed on animal+pose together so switching the companion
  // itself crossfades too, instead of the new animal's set hard-cutting in.
  const fade = useSharedValue(1);
  const [shown, setShown] = useState<{ key: string; source: ImageSourcePropType }>({
    key: artKey,
    source: artSource,
  });
  const [previous, setPrevious] = useState<ImageSourcePropType | null>(null);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (artKey === shown.key) return;
    if (clearTimer.current) clearTimeout(clearTimer.current);
    if (reduced) {
      setShown({ key: artKey, source: artSource });
      setPrevious(null);
      fade.value = 1;
      return;
    }
    setPrevious(shown.source);
    setShown({ key: artKey, source: artSource });
    fade.value = 0;
    fade.value = withTiming(1, { duration: duration.base, easing: easing.settle });
    clearTimer.current = setTimeout(() => setPrevious(null), duration.base + 50);
    // reason: fade is a stable shared-value ref
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artKey, reduced]);
  useEffect(
    () => () => {
      if (clearTimer.current) clearTimeout(clearTimer.current);
    },
    []
  );

  // Explicit sizes for the two crossfade layers — on web, Reanimated's animated
  // component does not preserve an absolute-fill inset when the style is driven by
  // an inline shared value, so the images collapse to intrinsic size. Give each
  // layer its own box instead of relying on absoluteFill alone.
  const box = size * set.scale;
  const currentStyle = useAnimatedStyle(() => ({ opacity: fade.value }));
  const previousStyle = useAnimatedStyle(() => ({ opacity: 1 - fade.value }));

  // Every animal has at least an `idle` painterly pose, so the Fluent branch below is
  // presently unreachable — kept as the documented fallback tier (matches the prior
  // behaviour, where the generated set was also always fully populated) for any future
  // animal shipped without art yet.
  const hasGenerated = Boolean(set.poses.idle);

  const art = lottieSource ? (
    <LottieView
      source={lottieSource}
      autoPlay={!reduced}
      loop={!reduced}
      style={{ width: size, height: size }}
    />
  ) : hasGenerated ? (
    <View
      style={{
        width: box,
        height: box,
        margin: (size - box) / 2,
        overflow: 'hidden',
      }}
    >
      {previous && (
        <Animated.Image
          source={previous}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
          style={[styles.layer, { width: box, height: box }, previousStyle]}
        />
      )}
      <Animated.Image
        source={shown.source}
        resizeMode="contain"
        accessibilityIgnoresInvertColors
        style={[styles.layer, { width: box, height: box }, currentStyle]}
      />
    </View>
  ) : (
    <SvgXml
      xml={fluent.xml}
      width={size * fluent.scale}
      height={size * fluent.scale}
      // Framing-normalised (face vs full-body emoji) — keep the visual centre.
      style={{ margin: (size - size * fluent.scale) / 2 }}
    />
  );

  return (
    <ReactiveCompanion size={size} trigger={trigger} interactive={interactive} onPress={onPress}>
      {art}
    </ReactiveCompanion>
  );
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', top: 0, left: 0 },
});
