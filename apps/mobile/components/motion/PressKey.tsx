/**
 * PressKey — the pillow key (DECISIONS §K.8). A tappable face sits on a darker
 * "edge" of the same shape offset down by `travel`; pressing moves ONLY the face
 * down (translateY, transform-only) so the edge disappears under it, like a
 * physical key. One haptic on press-in chosen by INTENT (what the press means),
 * nothing on release — the travel is the feedback. Reduced motion: no travel, a 150 ms opacity dip instead.
 * Disabled: edge hidden, face dimmed, no haptic. Error states never use this.
 */
import { ReactNode } from 'react';
import {
  Pressable,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
  type AccessibilityRole,
  type AccessibilityState,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { haptic } from '@/lib/haptics';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { duration, easing, spring } from '@/theme/motion';
import { radius as radiusTokens } from '@/theme/tokens';

export type PressKeyTravel = 4 | 3 | 2;

/** What the press MEANS — picks the haptic and the press-in tempo, so a commit feels
 * different from a filter chip. Unset, it follows the key's size: full-travel keys
 * (4) navigate, chips and the tab pill (3 / 2) select. */
export type PressKeyIntent = 'commit' | 'navigate' | 'select' | 'toggle';

const INTENT_HAPTIC: Record<PressKeyIntent, () => void> = {
  commit: haptic.commit,
  navigate: haptic.advance,
  select: haptic.tick,
  toggle: haptic.toggle,
};

type Props = {
  children: ReactNode;
  onPress?: () => void;
  /** Colour of the underside (e.g. colors.accentEdge under an accent face). */
  edge: string;
  /** Key travel in px: 4 buttons/cards, 3 chips, 2 the tab pill. */
  travel?: PressKeyTravel;
  radius?: number;
  /** Per-corner radii for asymmetric faces (chat-bubble tails). Applied to BOTH the
   * face and the edge so they can never diverge. Overrides `radius` when given. */
  faceRadiusStyle?: Pick<
    ViewStyle,
    'borderTopLeftRadius' | 'borderTopRightRadius' | 'borderBottomLeftRadius' | 'borderBottomRightRadius'
  >;
  intent?: PressKeyIntent;
  haptic?: 'impact' | 'none';
  disabled?: boolean;
  /** Face visuals only: background, padding, inner layout. Never sizing constraints. */
  style?: StyleProp<ViewStyle>;
  /** Outer box: margins, alignSelf, flex, maxWidth / flexShrink — every sizing
   * constraint goes here, because percentage widths on the face resolve against
   * PressKey's unsized wrapper and silently stop applying. */
  containerStyle?: StyleProp<ViewStyle>;
  accessibilityRole?: AccessibilityRole;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityState?: AccessibilityState;
  testID?: string;
};

export function PressKey({
  children,
  onPress,
  edge,
  travel = 4,
  radius = radiusTokens.lg,
  faceRadiusStyle,
  intent,
  haptic: hapticMode = 'impact',
  disabled = false,
  style,
  containerStyle,
  accessibilityRole = 'button',
  accessibilityLabel,
  accessibilityHint,
  accessibilityState,
  testID,
}: Props) {
  const reduced = useReducedMotion();
  const press = useSharedValue(0);
  const cornerStyle = faceRadiusStyle ? { borderRadius: radius, ...faceRadiusStyle } : { borderRadius: radius };

  const face = useAnimatedStyle(() => ({
    transform: [{ translateY: reduced || disabled ? 0 : press.value * travel }],
    opacity: disabled ? 0.55 : reduced ? 1 - press.value * 0.15 : 1,
  }));

  const onPressIn = () => {
    if (disabled) return;
    const meaning: PressKeyIntent = intent ?? (travel === 4 ? 'navigate' : 'select');
    if (hapticMode === 'impact') INTENT_HAPTIC[meaning]();
    // A commit lands a touch more deliberately than a chip; both stay well under 150 ms.
    const pressIn = meaning === 'commit' ? duration.fast * 0.6 : duration.fast / 2;
    press.value = withTiming(1, { duration: pressIn, easing: easing.exit });
  };
  const onPressOut = () => {
    if (disabled) return;
    press.value = reduced
      ? withTiming(0, { duration: duration.fast - 50 })
      : withSpring(0, spring.calm);
  };

  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      disabled={disabled}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ ...accessibilityState, disabled }}
      testID={testID}
      style={[{ paddingBottom: travel }, containerStyle]}
    >
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          { top: travel, backgroundColor: disabled ? 'transparent' : edge },
          cornerStyle,
        ]}
      />
      <Animated.View style={[style, cornerStyle, face]}>{children}</Animated.View>
    </Pressable>
  );
}
