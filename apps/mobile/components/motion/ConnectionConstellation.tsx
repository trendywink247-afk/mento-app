/**
 * ConnectionConstellation — the connecting step's hero: two souls finding each other.
 *
 * The member orb (companion accent) sits left, the listener orb (warm gold) right.
 * While searching, a luminous thread creeps between them and the orbs pulse gently
 * in alternation (one mover at a time — motion budget). On `found`, the orbs glide
 * to the middle, the thread completes, and a soft ring blooms. On `still` (error)
 * everything freezes and dims — stillness signals the problem (T&S #11).
 *
 * An optional breathe ring (around the member orb) carries the breathe-with-me idle:
 * it inflates/deflates at the shared breathing tempo so the step's guide text stays
 * in sync by construction (same breathe.period token).
 *
 * Views + transforms only (no SVG, no layout animation). Reduced motion: static
 * composition at meeting distance, no loops; found = a simple opacity lift.
 */
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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
import { breathe, duration, easing } from '@/theme/motion';
import { useTheme } from '@/theme/ThemeProvider';

const ORB = 26;
const TRAVEL = 96; // how far each orb glides from its rest position to the meeting point
const GOLD = '#E8B84B'; // listener warmth — chart-adjacent accent, not UI chrome

export type ConstellationState = 'searching' | 'found' | 'still';

export function ConnectionConstellation({
  state,
  breatheActive = false,
}: {
  state: ConstellationState;
  /** Inflate/deflate the ring around the member orb at breathing tempo. */
  breatheActive?: boolean;
}) {
  const reduced = useReducedMotion();
  const { colors } = useTheme();

  const approach = useSharedValue(0); // 0 = apart, 1 = met in the middle
  const memberPulse = useSharedValue(1);
  const listenerPulse = useSharedValue(1);
  const thread = useSharedValue(0); // scaleX of the connecting line
  const bloom = useSharedValue(0); // found ring: scales up + fades
  const dim = useSharedValue(1);
  const ring = useSharedValue(1); // breathe ring scale

  // --- searching: creep + alternate pulses -------------------------------------
  useEffect(() => {
    if (state !== 'searching') return;
    if (reduced) {
      approach.value = 0.5;
      thread.value = 0.6;
      return;
    }
    // The thread creeps most of the way and holds — honest (never "complete" until
    // someone is actually found), alive (always moving somewhere).
    approach.value = withTiming(0.55, { duration: breathe.period * 3, easing: easing.settle });
    thread.value = withTiming(0.75, { duration: breathe.period * 3, easing: easing.settle });
    // Alternate pulses: each orb owns half the cycle → exactly one mover at a time.
    memberPulse.value = withRepeat(
      withSequence(
        withTiming(1.12, { duration: breathe.period / 4, easing: easing.breathe }),
        withTiming(1, { duration: breathe.period / 4, easing: easing.breathe }),
        withDelay(breathe.period / 2, withTiming(1, { duration: 0 }))
      ),
      -1
    );
    listenerPulse.value = withRepeat(
      withSequence(
        withDelay(breathe.period / 2, withTiming(1.12, { duration: breathe.period / 4, easing: easing.breathe })),
        withTiming(1, { duration: breathe.period / 4, easing: easing.breathe })
      ),
      -1
    );
    return () => {
      cancelAnimation(memberPulse);
      cancelAnimation(listenerPulse);
      memberPulse.value = 1;
      listenerPulse.value = 1;
    };
  }, [state, reduced, approach, thread, memberPulse, listenerPulse]);

  // --- found: meet + bloom -------------------------------------------------------
  useEffect(() => {
    if (state !== 'found') return;
    cancelAnimation(memberPulse);
    cancelAnimation(listenerPulse);
    memberPulse.value = 1;
    listenerPulse.value = 1;
    if (reduced) {
      approach.value = 1;
      thread.value = 1;
      bloom.value = 0.6;
      return;
    }
    approach.value = withTiming(1, { duration: duration.gentle, easing: easing.settle });
    thread.value = withTiming(1, { duration: duration.gentle, easing: easing.settle });
    bloom.value = withSequence(
      withDelay(duration.base, withTiming(1, { duration: duration.slow, easing: easing.enter }))
    );
  }, [state, reduced, approach, thread, bloom, memberPulse, listenerPulse]);

  // --- still (error): freeze and dim ---------------------------------------------
  useEffect(() => {
    if (state === 'still') {
      cancelAnimation(memberPulse);
      cancelAnimation(listenerPulse);
      cancelAnimation(approach);
      cancelAnimation(thread);
      dim.value = withTiming(0.35, { duration: duration.fast });
    } else {
      dim.value = withTiming(1, { duration: duration.fast });
    }
  }, [state, dim, memberPulse, listenerPulse, approach, thread]);

  // --- breathe ring ----------------------------------------------------------------
  useEffect(() => {
    if (!breatheActive || reduced || state !== 'searching') {
      cancelAnimation(ring);
      ring.value = withTiming(1, { duration: duration.fast });
      return;
    }
    ring.value = withRepeat(
      withSequence(
        withTiming(1.55, { duration: breathe.period / 2, easing: easing.breathe }),
        withTiming(1, { duration: breathe.period / 2, easing: easing.breathe })
      ),
      -1
    );
    return () => cancelAnimation(ring);
  }, [breatheActive, reduced, state, ring]);

  const hostStyle = useAnimatedStyle(() => ({ opacity: dim.value }));
  const memberStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: approach.value * TRAVEL }, { scale: memberPulse.value }],
  }));
  const listenerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -approach.value * TRAVEL }, { scale: listenerPulse.value }],
  }));
  const threadStyle = useAnimatedStyle(() => ({
    opacity: 0.25 + thread.value * 0.5,
    transform: [{ scaleX: thread.value }],
  }));
  const bloomStyle = useAnimatedStyle(() => ({
    opacity: bloom.value > 0 ? (1 - bloom.value) * 0.9 : 0,
    transform: [{ scale: 0.4 + bloom.value * 2.2 }],
  }));
  const heartStyle = useAnimatedStyle(() => ({ opacity: bloom.value }));
  const ringStyle = useAnimatedStyle(() => ({
    opacity: breatheActive && state === 'searching' ? 0.5 : 0,
    transform: [{ scale: ring.value }],
  }));

  return (
    <Animated.View style={[styles.host, hostStyle]} pointerEvents="none">
      {/* thread */}
      <Animated.View style={[styles.thread, { backgroundColor: colors.accentSoft }, threadStyle]} />
      {/* bloom ring + heart at the meeting point */}
      <Animated.View style={[styles.bloom, { borderColor: colors.accent }, bloomStyle]} />
      <Animated.View style={[styles.heart, heartStyle]}>
        <Ionicons name="heart" size={20} color={colors.accent} />
      </Animated.View>
      {/* member orb (left) with breathe ring */}
      <Animated.View style={[styles.orbSlot, styles.left, memberStyle]}>
        <Animated.View style={[styles.ring, { borderColor: colors.accent }, ringStyle]} />
        <View style={[styles.orb, { backgroundColor: colors.accent }]} />
      </Animated.View>
      {/* listener orb (right) */}
      <Animated.View style={[styles.orbSlot, styles.right, listenerStyle]}>
        <View style={[styles.orb, { backgroundColor: GOLD }]} />
      </Animated.View>
    </Animated.View>
  );
}

const W = 300;
const H = 96;

const styles = StyleSheet.create({
  host: { width: W, height: H, alignSelf: 'center', justifyContent: 'center' },
  thread: { position: 'absolute', left: 40, right: 40, top: H / 2 - 1, height: 2, borderRadius: 1 },
  orbSlot: {
    position: 'absolute',
    top: H / 2 - ORB / 2,
    width: ORB,
    height: ORB,
    alignItems: 'center',
    justifyContent: 'center',
  },
  left: { left: 28 },
  right: { right: 28 },
  orb: { width: ORB, height: ORB, borderRadius: ORB / 2 },
  ring: {
    position: 'absolute',
    width: ORB + 18,
    height: ORB + 18,
    borderRadius: (ORB + 18) / 2,
    borderWidth: 2,
  },
  bloom: {
    position: 'absolute',
    alignSelf: 'center',
    top: H / 2 - 30,
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 2,
  },
  heart: { position: 'absolute', alignSelf: 'center', top: H / 2 - 10 },
});
