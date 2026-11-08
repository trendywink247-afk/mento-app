/**
 * CertifiedBadge — the gold mark of a mentor an admin certified for exam mentoring (DECISIONS §O).
 * Every mentor is admin-approved; this is the extra mark for exam roads. Still: it never moves.
 * Gold on the warm wash (the ink is the app's own dark amber, 7:1 on it), a check, and the word —
 * colour is never the only signal.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import { useI18n } from '@/lib/i18n';
import { font, radius, wash, washInk } from '@/theme/tokens';

export function CertifiedBadge({ testID }: { testID?: string }) {
  const { t } = useI18n();
  return (
    <View
      style={styles.pill}
      accessible
      accessibilityLabel={t('certified.a11y')}
      testID={testID}
    >
      <Ionicons name="shield-checkmark" size={12} color={washInk.orange} />
      <Text style={styles.text} numberOfLines={1} maxFontSizeMultiplier={1.3}>
        {t('certified.badge')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: wash.orange,
    borderWidth: 1,
    borderColor: '#D9B65A',
  },
  text: { fontFamily: font.sansBold, fontSize: 12, lineHeight: 16, color: washInk.orange },
});
