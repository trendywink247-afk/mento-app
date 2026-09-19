import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';
import { COMPANION_COLORS } from '@/theme/companion';
import { radius, wash, type Wash } from '@/theme/tokens';

/**
 * The mockups' recurring icon treatment: a thin-line icon inside a soft pastel circle
 * (Conversation Options sheet, connecting guidelines, journals list, profile rows).
 * `tone="accent"` follows the companion accent; the rest are fixed pastel washes.
 */
export function IconBadge({
  icon,
  tone = 'accent',
  size = 44,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tone?: Wash;
  size?: number;
}) {
  const { colors } = useTheme();
  // Wash tones keep their legacy names; glyph inks come from the matching clay accents.
  const fg: Record<Wash, string> = {
    accent: colors.accent,
    indigo: COMPANION_COLORS.plum.accent,
    orange: COMPANION_COLORS.mustard.accent,
    green: COMPANION_COLORS.sage.accent,
    danger: colors.danger,
    sky: COMPANION_COLORS.sky.accent,
  };
  const bg = tone === 'accent' ? colors.accentTint : wash[tone];
  return (
    <View style={[styles.badge, { width: size, height: size, backgroundColor: bg }]}>
      <Ionicons name={icon} size={Math.round(size * 0.45)} color={fg[tone]} />
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
});
