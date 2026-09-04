/**
 * TiltCard — a pressable surface that tilts toward the exact touch point, like a
 * card balanced on a pin. Press the top-right corner and the top-right corner dips.
 * Transform-only (perspective + rotateX/rotateY + scale), settles on spring.calm.
 *
 * The dimensional counterpart of PrimaryButton's press physics, for card-shaped
 * surfaces (pathfinder options, prompt cards, listener cards). Reduced motion:
 * a plain Pressable with the caller's pressed-state styling untouched.
 */
import { ReactNode, useRef } from 'react';
import {
  GestureResponderEvent,
  LayoutChangeEvent,
  Pressable,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { useReducedMotion } from '@/lib/useReducedMotion';
import { duration, easing, spring } from '@/theme/motion';
import { radius } from '@/theme/tokens';

export function TiltCard({
  children,
  onPress,
  maxTilt = 5,
  disabled = false,
  style,
  /** Pillow-key underside colour; when given the card draws an edge and travels 4px on press. */
  edge,
  accessibilityRole = 'button',
  accessibilityLabel,
  testID,
}: {
  children: ReactNode;
  onPress?: () => void;
  maxTilt?: number;
  disabled?: boolean;
  /** Card visuals (background, radius, padding, elevation) live on this style. */
  style?: StyleProp<ViewStyle>;
  edge?: string;
  accessibilityRole?: 'button' | 'none';
  accessibilityLabel?: string;
  testID?: string;
}) {
  const reduced = useReducedMotion();
  const rx = useSharedValue(0);
  const ry = useSharedValue(0);
  const scale = useSharedValue(1);
  const ty = useSharedValue(0);
  const size = useRef({ w: 1, h: 1 });

  const onLayout = (e: LayoutChangeEvent) => {
    size.current = { w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height };
  };

  const pressIn = (e: GestureResponderEvent) => {
    if (reduced) return;
    const { locationX, locationY } = e.nativeEvent;
    // Normalize the touch point to -1..1 from the card's center.
    const nx = Math.max(-1, Math.min(1, (locationX / size.current.w) * 2 - 1));
    const ny = Math.max(-1, Math.min(1, (locationY / size.current.h) * 2 - 1));
    const cfg = { duration: duration.fast / 2, easing: easing.exit };
    // The touched corner dips: rotateY follows X, rotateX opposes Y.
    ry.value = withTiming(nx * maxTilt, cfg);
    rx.value = withTiming(-ny * maxTilt, cfg);
    scale.value = withTiming(0.985, cfg);
    ty.value = withTiming(edge ? 4 : 0, cfg);
  };

  const pressOut = () => {
    if (reduced) return;
    rx.value = withSpring(0, spring.calm);
    ry.value = withSpring(0, spring.calm);
    scale.value = withSpring(1, spring.calm);
    ty.value = withSpring(0, spring.calm);
  };

  const anim = useAnimatedStyle(() => ({
    transform: [
      { translateY: ty.value },
      { perspective: 700 },
      { rotateX: `${rx.value}deg` },
      { rotateY: `${ry.value}deg` },
      { scale: scale.value },
    ],
  }));

  return (
    <Pressable
      onPress={onPress}
      onPressIn={pressIn}
      onPressOut={pressOut}
      onLayout={onLayout}
      disabled={disabled}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      style={edge ? { paddingBottom: 4 } : undefined}
    >
      {edge ? (
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { top: 4, borderRadius: radius.lg, backgroundColor: edge }]}
        />
      ) : null}
      <Animated.View style={[style, anim]}>{children}</Animated.View>
    </Pressable>
  );
}
