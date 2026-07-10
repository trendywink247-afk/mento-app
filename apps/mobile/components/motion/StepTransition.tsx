/**
 * StepTransition — crossfades between steps of an in-screen flow (the onboarding
 * journey). Outgoing and incoming children are stacked absolutely during a ~350ms
 * transition: out = fade + 12px drift up, in = fade + 16px rise with a slight delay.
 * Transform/opacity only; reduced motion = a quick 100ms cut.
 *
 * The host container must have a size of its own (flex: 1) — children fill it.
 * Manual shared values (no `entering=`/`exiting=`) for react-native-web parity.
 */
import { ReactNode, useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { useReducedMotion } from '@/lib/useReducedMotion';
import { duration, easing } from '@/theme/motion';

type Props<K extends string> = {
  activeKey: K;
  /** Renders the content for a step key. Called for the incoming and outgoing step. */
  render: (key: K) => ReactNode;
};

export function StepTransition<K extends string>({ activeKey, render }: Props<K>) {
  const reduced = useReducedMotion();
  const [current, setCurrent] = useState(activeKey);
  const [previous, setPrevious] = useState<K | null>(null);
  const enter = useSharedValue(1);
  const exit = useSharedValue(0);

  useEffect(() => {
    if (activeKey === current) return;
    setPrevious(current);
    setCurrent(activeKey);
    enter.value = 0;
    exit.value = 0;
    const clearPrevious = () => setPrevious(null);
    const cut = reduced ? { duration: 100 } : null;
    exit.value = withTiming(
      1,
      cut ?? { duration: duration.base, easing: easing.exit },
      (done) => {
        if (done) runOnJS(clearPrevious)();
      }
    );
    enter.value = cut
      ? withTiming(1, cut)
      : withDelay(80, withTiming(1, { duration: duration.base, easing: easing.enter }));
    // reason: transition fires only on step change; shared values are stable refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey]);

  const enterStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: reduced ? 0 : 16 * (1 - enter.value) }],
  }));
  const exitStyle = useAnimatedStyle(() => ({
    opacity: 1 - exit.value,
    transform: [{ translateY: reduced ? 0 : -12 * exit.value }],
  }));

  return (
    <>
      {previous ? (
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, exitStyle]}>
          {render(previous)}
        </Animated.View>
      ) : null}
      <Animated.View key={current} style={[StyleSheet.absoluteFill, enterStyle]}>
        {render(current)}
      </Animated.View>
    </>
  );
}
