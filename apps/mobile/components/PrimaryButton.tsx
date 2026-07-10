import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { haptic } from '@/lib/haptics';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space, type } from '@/theme/tokens';

type Props = {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  /**
   * primary = filled pill. ghost = borderless accent text in a pill. link = plain
   * accent text ("Skip for now" in the mockups).
   */
  variant?: 'primary' | 'ghost' | 'link';
  /**
   * accent = companion colour (post-onboarding CTAs). ink = deep-navy pill — the
   * onboarding CTAs in the mockups ("Continue →", "Start a Conversation").
   */
  tone?: 'accent' | 'ink';
  /** Leading Ionicons glyph (e.g. the chat bubble on "Start a Conversation"). */
  icon?: keyof typeof Ionicons.glyphMap;
  /** Trailing arrow per the mockups: '→' on onboarding, '›' on post-onboarding CTAs. */
  trailing?: 'arrow' | 'chevron';
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
  tone = 'accent',
  icon,
  trailing,
  accessibilityLabel,
  accessibilityHint,
  testID,
}: Props) {
  const { colors } = useTheme();
  const filled = variant === 'primary';
  const inactive = disabled || loading;
  const bg = tone === 'ink' ? colors.ink : colors.accent;
  const bgPress = tone === 'ink' ? '#2A2F55' : colors.accentPress;
  const fg = filled ? colors.onAccent : colors.accent;

  const handlePress = () => {
    if (inactive) return;
    haptic.tick();
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
        variant === 'link' ? styles.link : styles.base,
        filled && { backgroundColor: pressed ? bgPress : bg },
        inactive && styles.disabled,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={styles.row}>
          {icon ? <Ionicons name={icon} size={18} color={fg} /> : null}
          <Text style={[type.bodySemi, styles.label, { color: fg }]}>{label}</Text>
          {trailing === 'arrow' ? <Ionicons name="arrow-forward" size={18} color={fg} /> : null}
          {trailing === 'chevron' ? <Ionicons name="chevron-forward" size={18} color={fg} /> : null}
        </View>
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
  link: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  disabled: { opacity: 0.5 },
  label: { fontSize: 16 },
});
