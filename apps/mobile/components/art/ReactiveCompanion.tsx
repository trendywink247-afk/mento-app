/**
 * ReactiveCompanion — the in-house reactive character rig (DECISIONS §I.4 amended):
 * gives EVERY companion animal the full state vocabulary the Rive brief specified,
 * in code — transforms/opacity only, calm register.
 *
 * States:
 *  - idle      breathing (host adds via useBreathing where it fits) + micro-sway here;
 *              22:00–06:00 local the idle turns sleepy (slower, softer, gentle droop)
 *  - greet     soft double nod           trigger={kind:'greet', n}
 *  - celebrate crouch → gentle hop → landing squash → settle
 *  - comfort   slow caring lean, held, released slower (for heavy moments)
 *  - curious   head-tilt + tiny rise — "what's this?"
 *  - joy       light wiggle for small wins — a smile, not the celebrate hop
 *  - tap-react instant squish acknowledgement (interactive prop)
 *
 * The panda additionally keeps its bespoke layered rig (blink + waving arm) inside
 * the same wrapper. All loops/states collapse under reduced motion.
 */
import { ReactNode, useEffect } from 'react';
import { Pressable } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { haptic } from '@/lib/haptics';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { character, easing } from '@/theme/motion';

export type CompanionTrigger = {
  kind: 'greet' | 'celebrate' | 'comfort' | 'curious' | 'joy';
  n: number;
} | null;

/** Sleepy window check — local device time, wraps midnight. Shared with
 * Companion.tsx's `restingPose` (which re-checks per render; this rig checks once
 * per mount, in the idle-sway effect below). */
export function isSleepyHour(): boolean {
  const h = new Date().getHours();
  const { startHour, endHour } = character.sleepy;
  return h >= startHour || h < endHour;
}

export function ReactiveCompanion({
  children,
  size,
  trigger = null,
  interactive = false,
  onPress,
}: {
  /** The character art (CompanionArt face or the AnimatedPanda rig). */
  children: ReactNode;
  size: number;
  /** Bump n with a kind to play a state. */
  trigger?: CompanionTrigger;
  /** Tap-react: the character acknowledges touches (adds a Pressable wrapper). */
  interactive?: boolean;
  onPress?: () => void;
}) {
  const reduced = useReducedMotion();
  const sway = useSharedValue(0);
  const nod = useSharedValue(0);
  const y = useSharedValue(0);
  const scaleX = useSharedValue(1);
  const scaleY = useSharedValue(1);
  const lean = useSharedValue(0);
  const droop = useSharedValue(0); // sleepy baseline — separate from lean so state
  // sequences (which end at 0) never erase the night posture.

  // Idle micro-sway, phase-offset from the breathing the host applies — two
  // incommensurate periods keep the idle from ever reading as a mechanical loop.
  useEffect(() => {
    if (reduced) {
      cancelAnimation(sway);
      sway.value = withTiming(0, { duration: 150 });
      droop.value = 0;
      return;
    }
    const sleepy = isSleepyHour();
    // Sleepy idle: softer amplitude on a slower period + a held droop. Checked once
    // per mount — a screen alive across the 22:00 boundary just stays awake.
    const amplitude = character.sway.degrees * (sleepy ? character.sleepy.swayScale : 1);
    const period = character.sway.period * (sleepy ? 1.5 : 1);
    droop.value = withTiming(sleepy ? character.sleepy.droop : 0, {
      duration: character.comfort.duration * 0.3,
      easing: easing.settle,
    });
    sway.value = withRepeat(
      withTiming(amplitude, { duration: period / 2, easing: easing.breathe }),
      -1,
      true
    );
    return () => cancelAnimation(sway);
  }, [reduced, sway, droop]);

  // Triggered states.
  useEffect(() => {
    if (!trigger || reduced) return;
    const g = character.greet;
    const c = character.celebrate;
    const f = character.comfort;
    switch (trigger.kind) {
      case 'greet':
        // Soft double nod.
        nod.value = withSequence(
          withTiming(-g.dip, { duration: g.duration * 0.22, easing: easing.enter }),
          withTiming(g.dip * 0.55, { duration: g.duration * 0.26 }),
          withTiming(-g.dip * 0.4, { duration: g.duration * 0.24 }),
          withTiming(0, { duration: g.duration * 0.28, easing: easing.settle })
        );
        break;
      case 'celebrate': {
        const hop = size * c.hopRatio;
        // Volume-preserving counterpart of a Y-scale (plush register, k<1).
        const xOf = (sy: number) => 1 + (1 - sy) * character.squashK;
        // crouch(.28) → rise(.19) → hang(.07) → land(.12) → settle(.34) of ~800ms —
        // slow anticipation and landing, fast action in between.
        scaleY.value = withSequence(
          withTiming(c.crouch, { duration: c.duration * 0.28, easing: easing.enter }),
          withTiming(c.stretch, { duration: c.duration * 0.19 }),
          withTiming(1, { duration: c.duration * 0.07 }),
          withTiming(c.squash, { duration: c.duration * 0.12 }),
          withTiming(1, { duration: c.duration * 0.34, easing: easing.settle })
        );
        scaleX.value = withSequence(
          withTiming(xOf(c.crouch), { duration: c.duration * 0.28, easing: easing.enter }),
          withTiming(xOf(c.stretch), { duration: c.duration * 0.19 }),
          withTiming(1, { duration: c.duration * 0.07 }),
          withTiming(xOf(c.squash), { duration: c.duration * 0.12 }),
          withTiming(1, { duration: c.duration * 0.34, easing: easing.settle })
        );
        y.value = withSequence(
          withDelay(
            c.duration * 0.28,
            withTiming(-hop, { duration: c.duration * 0.19, easing: easing.exit })
          ),
          withTiming(0, { duration: c.duration * 0.19, easing: easing.enter })
        );
        break;
      }
      case 'curious': {
        const q = character.curious;
        // Tilt toward the thing, rise a touch, hold the look, settle back.
        lean.value = withSequence(
          withTiming(q.tilt, { duration: q.duration * 0.25, easing: easing.enter }),
          withDelay(q.duration * 0.35, withTiming(0, { duration: q.duration * 0.4, easing: easing.settle }))
        );
        y.value = withSequence(
          withTiming(-q.rise, { duration: q.duration * 0.25, easing: easing.enter }),
          withDelay(q.duration * 0.35, withTiming(0, { duration: q.duration * 0.4, easing: easing.settle }))
        );
        break;
      }
      case 'joy': {
        const j = character.joy;
        const beat = j.duration / (j.cycles * 2 + 1);
        // Alternating light wiggles, decaying to rest — warmth without spectacle.
        lean.value = withSequence(
          withTiming(j.wiggle, { duration: beat, easing: easing.enter }),
          withTiming(-j.wiggle * 0.8, { duration: beat }),
          withTiming(j.wiggle * 0.5, { duration: beat }),
          withTiming(-j.wiggle * 0.3, { duration: beat }),
          withTiming(0, { duration: beat * 3, easing: easing.settle })
        );
        break;
      }
      case 'comfort':
        // Slow lean-in, held, released even slower — caring, never cheerful.
        lean.value = withSequence(
          withTiming(f.lean, { duration: f.duration * 0.3, easing: easing.settle }),
          withDelay(
            f.duration * 0.3,
            withTiming(0, { duration: f.duration * 0.4, easing: easing.breathe })
          )
        );
        y.value = withSequence(
          withTiming(f.sink, { duration: f.duration * 0.3, easing: easing.settle }),
          withDelay(
            f.duration * 0.3,
            withTiming(0, { duration: f.duration * 0.4, easing: easing.breathe })
          )
        );
        break;
    }
    // reason: shared values are stable refs; trigger.n is the replay signal
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger?.kind, trigger?.n, reduced]);

  const tapReact = () => {
    haptic.tick();
    if (!reduced) {
      const sx = 1 + (1 - character.tap.squish) * character.squashK;
      scaleY.value = withSequence(
        withTiming(character.tap.squish, { duration: character.tap.inMs, easing: easing.exit }),
        withTiming(1, { duration: character.tap.outMs, easing: easing.settle })
      );
      scaleX.value = withSequence(
        withTiming(sx, { duration: character.tap.inMs, easing: easing.exit }),
        withTiming(1, { duration: character.tap.outMs, easing: easing.settle })
      );
    }
    onPress?.();
  };

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateY: y.value + nod.value * 0.4 + droop.value * 0.6 },
      {
        rotate: `${
          sway.value - character.sway.degrees / 2 + nod.value * 0.3 + lean.value + droop.value
        }deg`,
      },
      { scaleX: scaleX.value },
      { scaleY: scaleY.value },
    ],
  }));

  const body = <Animated.View style={style}>{children}</Animated.View>;
  if (!interactive) return body;
  return (
    <Pressable
      onPress={tapReact}
      accessibilityRole="button"
      accessibilityLabel="Your companion"
      testID="companion-tap"
    >
      {body}
    </Pressable>
  );
}
