/**
 * SwapFade — replaces a block of content without ever showing two versions at once: the
 * old content leaves fast, THEN the new content arrives (rise + fade). The same "leave
 * fast, arrive slow — never two headlines at once" rule StepTransition keeps between
 * steps, for a change INSIDE a step (connecting: finding → found). Manual shared values;
 * reduced motion = an instant swap.
 */
import { ReactNode, useEffect, useRef, useState } from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { useReducedMotion } from '@/lib/useReducedMotion';
import { duration, easing } from '@/theme/motion';

export function SwapFade({
  swapKey,
  children,
  style,
}: {
  /** Change this to swap; content updates under the same key render straight through. */
  swapKey: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const reduced = useReducedMotion();
  const visible = useSharedValue(1);
  const [shownKey, setShownKey] = useState(swapKey);
  // The node to show while the OLD key is still fading out.
  const held = useRef<ReactNode>(children);
  if (shownKey === swapKey) held.current = children;

  useEffect(() => {
    if (swapKey === shownKey) return;
    if (reduced) {
      setShownKey(swapKey);
      return;
    }
    visible.value = withTiming(0, { duration: duration.fast, easing: easing.exit });
    const t = setTimeout(() => {
      setShownKey(swapKey);
      visible.value = withTiming(1, { duration: duration.base, easing: easing.enter });
    }, duration.fast);
    return () => clearTimeout(t);
    // reason: shownKey is this component's own state, not a trigger
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swapKey, reduced]);

  const anim = useAnimatedStyle(() => ({
    opacity: visible.value,
    transform: [{ translateY: reduced ? 0 : 16 * (1 - visible.value) }],
  }));

  return <Animated.View style={[style, anim]}>{shownKey === swapKey ? children : held.current}</Animated.View>;
}
