/**
 * TierMark — a quiet word for a mentor's tier on cards (DECISIONS R.4, R.7): "Listener" or
 * "Mentor". Mento Verified keeps its own gold CertifiedBadge. Outline only, never loud.
 */
import { StyleSheet, Text, View } from 'react-native';

import type { Tier } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius } from '@/theme/tokens';

export function TierMark({ tier, testID }: { tier: Tier; testID?: string }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const word = tier === 'mentor' ? t('tier.mentor') : tier === 'verified' ? t('tier.verified') : t('tier.listener');
  const a11y = tier === 'mentor' ? t('tier.a11yMentor') : tier === 'verified' ? t('tier.verified') : t('tier.a11yListener');
  return (
    <View style={[styles.pill, { borderColor: colors.border }]} accessible accessibilityLabel={a11y} testID={testID}>
      <Text style={[styles.text, { color: colors.inkMuted }]} numberOfLines={1} maxFontSizeMultiplier={1.3}>
        {word}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, borderWidth: 1 },
  text: { fontFamily: font.sansBold, fontSize: 12, lineHeight: 16 },
});
