import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { PressKey } from '@/components/motion/PressKey';
import { haptic } from '@/lib/haptics';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space, type } from '@/theme/tokens';

type Props = {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  /** primary = filled key. ghost = warm alt-surface key with accent text. link = plain accent text. */
  variant?: 'primary' | 'ghost' | 'link';
  /** accent = companion colour. ink = charcoal key (onboarding CTAs). */
  tone?: 'accent' | 'ink';
  icon?: keyof typeof Ionicons.glyphMap;
  trailing?: 'arrow' | 'chevron';
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
  const inactive = !!(disabled || loading);
  const bg = filled ? (tone === 'ink' ? colors.ink : colors.accent) : colors.surfaceAlt;
  const edge = filled ? (tone === 'ink' ? colors.edgeInk : colors.accentEdge) : colors.edgeAlt;
  const fg = filled ? colors.onAccent : colors.accent;

  const content = loading ? (
    <ActivityIndicator color={fg} />
  ) : (
    <View style={styles.row}>
      {icon ? <Ionicons name={icon} size={18} color={fg} /> : null}
      <Text style={[type.bodySemi, styles.label, { color: fg }]}>{label}</Text>
      {trailing === 'arrow' ? <Ionicons name="arrow-forward" size={18} color={fg} /> : null}
      {trailing === 'chevron' ? <Ionicons name="chevron-forward" size={18} color={fg} /> : null}
    </View>
  );

  if (variant === 'link') {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ disabled: inactive, busy: !!loading }}
        onPress={() => {
          if (inactive) return;
          haptic.tick();
          onPress();
        }}
        disabled={inactive}
        testID={testID}
        style={({ pressed }) => [styles.link, inactive && styles.disabled, pressed && { opacity: 0.7 }]}
      >
        {content}
      </Pressable>
    );
  }

  return (
    <PressKey
      onPress={onPress}
      edge={edge}
      travel={4}
      intent={filled ? 'commit' : 'navigate'}
      radius={radius.pill}
      disabled={inactive}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ busy: !!loading }}
      testID={testID}
      style={[styles.base, { backgroundColor: bg }]}
    >
      {content}
    </PressKey>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 54,
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
