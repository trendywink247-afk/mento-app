import * as Haptics from 'expo-haptics';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';
import { radius, space, type } from '@/theme/tokens';

type Props = {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'ghost';
  /** Defaults to `label`; set when the visible label needs more screen-reader context. */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
};

export function PrimaryButton({
  label,
  onPress,
  loading,
  disabled,
  variant = 'primary',
  accessibilityLabel,
  accessibilityHint,
  testID,
}: Props) {
  const { colors } = useTheme();
  const isGhost = variant === 'ghost';
  const inactive = disabled || loading;
  const handlePress = () => {
    if (inactive) return;
    if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {});
    onPress();
  };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      onPress={handlePress}
      disabled={inactive}
      testID={testID}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: isGhost ? 'transparent' : colors.accent },
        pressed && !isGhost && { backgroundColor: colors.accentPress },
        inactive && styles.disabled,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={isGhost ? colors.accent : colors.onAccent} />
      ) : (
        <Text style={[type.label, styles.label, { color: isGhost ? colors.accent : colors.onAccent }]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 54, // generous, accessible touch target
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  disabled: { opacity: 0.5 },
  label: { fontSize: 16 },
});
