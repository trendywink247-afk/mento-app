import { useState } from 'react';
import { Pressable, StyleSheet, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';

type Props = Omit<PressableProps, 'style'> & {
  style?: StyleProp<ViewStyle>;
  /** Extra style while a mouse hovers (web). Defaults to a soft dim. */
  hoverStyle?: StyleProp<ViewStyle>;
  /** Extra style while pressed. Defaults to a deeper dim. */
  pressStyle?: StyleProp<ViewStyle>;
};

/**
 * Pressable for the web-only console surfaces (listener console, admin cockpit) —
 * desktop affordances the mobile app expresses through motion instead: hover tint,
 * pressed dim, and a visible disabled state (also announced via accessibilityState).
 * Keyboard focus keeps react-native-web's built-in focus-visible ring.
 */
export function ConsolePressable({
  style,
  hoverStyle,
  pressStyle,
  disabled,
  onHoverIn,
  onHoverOut,
  accessibilityState,
  ...rest
}: Props) {
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      {...rest}
      disabled={disabled}
      accessibilityState={{ disabled: !!disabled, ...accessibilityState }}
      onHoverIn={(e) => {
        setHovered(true);
        onHoverIn?.(e);
      }}
      onHoverOut={(e) => {
        setHovered(false);
        onHoverOut?.(e);
      }}
      style={({ pressed }) => [
        style,
        disabled ? styles.disabled : null,
        !disabled && hovered ? (hoverStyle ?? styles.hovered) : null,
        !disabled && pressed ? (pressStyle ?? styles.pressed) : null,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  hovered: { opacity: 0.92 },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.45 },
});
