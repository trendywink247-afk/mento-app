/**
 * FlyFrom — one element arriving from where the member touched (board T90 principle 3;
 * T05 the row's face into the chat header, T06 the header's avatar into the profile hero).
 *
 * It measures itself once it has landed, reads the rect the previous screen left in
 * `lib/originStore.ts`, and plays the difference backwards: the element is drawn at the
 * tapped thing's place and size and settles into its own. Transform and opacity only, one
 * mover, motion tokens, no spring — and under reduced motion (or with no fresh origin) it
 * simply is where it belongs, with nothing moving at all.
 */
import { useEffect, useRef } from 'react';
import { StyleProp, View, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { measureRect, takeOrigin, type OriginRect } from '@/lib/originStore';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { duration, easing } from '@/theme/motion';

export function FlyFrom({
  originKey,
  children,
  style,
  testID,
}: {
  /** The key the previous screen wrote its rect under; undefined = nothing to fly from. */
  originKey?: string;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const reduced = useReducedMotion();
  const ref = useRef<View>(null);
  const dx = useSharedValue(0);
  const dy = useSharedValue(0);
  const scale = useSharedValue(1);

  useEffect(() => {
    if (!originKey) return;
    const from: OriginRect | null = takeOrigin(originKey);
    if (!from || reduced) return;
    // One frame after mount the element has its own place; the difference is the flight.
    const id = requestAnimationFrame(() => {
      measureRect(ref.current, ({ x, y, width, height }) => {
        if (!width || !height) return;
        dx.value = from.x + from.width / 2 - (x + width / 2);
        dy.value = from.y + from.height / 2 - (y + height / 2);
        scale.value = Math.min(Math.max(from.width / width, 0.4), 2.5);
        const cfg = { duration: duration.base, easing: easing.settle };
        dx.value = withTiming(0, cfg);
        dy.value = withTiming(0, cfg);
        scale.value = withTiming(1, cfg);
      });
    });
    return () => cancelAnimationFrame(id);
    // reason: the flight belongs to this arrival — it plays once, on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flight = useAnimatedStyle(() => ({
    transform: [{ translateX: dx.value }, { translateY: dy.value }, { scale: scale.value }],
  }));

  // The measuring ref is a plain View around the mover: a Reanimated view's ref is the
  // animated component, which on web is not a DOM node and cannot be measured.
  return (
    <View ref={ref} collapsable={false}>
      <Animated.View style={[style, flight]} testID={testID}>
        {children}
      </Animated.View>
    </View>
  );
}
