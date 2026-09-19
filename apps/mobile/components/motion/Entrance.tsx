/**
 * Entrance — fade + gentle rise on mount, staggered by sibling index.
 *
 * Implemented with manual shared values, NOT Reanimated's `entering=` layout
 * animations — those are unreliable on react-native-web, and web is our test
 * surface. Manual withDelay/withTiming behaves identically on both platforms.
 */
import { ReactNode, useContext, useEffect } from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { StepArrivalContext } from '@/components/motion/stepArrival';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { duration, easing, stagger } from '@/theme/motion';

type Props = {
  children: ReactNode;
  /** Sibling order — entrance is delayed by index * stagger.unit ms. */
  index?: number;
  /** Direction the content travels from. 'up' = rises from below (the default). */
  from?: 'up' | 'down' | 'none';
  distance?: number;
  /** Explicit delay (ms, from a motion token) instead of index × stagger. */
  delay?: number;
  /** Start scaled (e.g. 0.92) and settle to 1 — a door rising out of a key. */
  scaleFrom?: number;
  /** Override the entrance duration (a motion token). */
  duration?: number;
  style?: StyleProp<ViewStyle>;
};

export function Entrance({
  children,
  index = 0,
  from = 'up',
  distance,
  delay,
  scaleFrom = 1,
  duration: ms = duration.gentle,
  style,
}: Props) {
  const reduced = useReducedMotion();
  // Inside a step flow the step's own hand-over decides when pieces may start and which
  // way they travel (board T02: forward rises from below, back is the exact reverse).
  const arrival = useContext(StepArrivalContext);
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = reduced
      ? withTiming(1, { duration: 150 })
      : withDelay(
          arrival.delay + (delay ?? index * stagger.unit),
          withTiming(1, { duration: ms, easing: easing.settle })
        );
    // reason: an entrance plays exactly once, on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const travel = distance ?? arrival.travel ?? 16;
  const flip = arrival.kind === 'back' ? -1 : 1;
  const offset = from === 'none' ? 0 : (from === 'up' ? travel : -travel) * flip;
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: reduced
      ? [{ translateY: 0 }, { scale: 1 }]
      : [{ translateY: offset * (1 - progress.value) }, { scale: scaleFrom + (1 - scaleFrom) * progress.value }],
  }));

  return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>;
}
