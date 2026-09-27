import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { PressKey } from '@/components/motion/PressKey';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, type } from '@/theme/tokens';

/** The clickwrap line under an age step's Continue (WS3 T3.9): continuing IS agreeing to
 * the house rules, and "Read them" opens them (app/terms.tsx) without leaving the step.
 * Both age steps (member journey, public /apply) carry it; each sends
 * `terms_accepted: true` with the signup it makes. */
export function TermsNotice() {
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useI18n();
  return (
    <View style={styles.row} testID="terms-notice">
      <Text style={[type.caption, styles.text, { color: colors.inkMuted }]}>{t('terms.notice')}</Text>
      <PressKey
        onPress={() => router.push('/terms')}
        edge="transparent"
        travel={2}
        radius={radius.sm}
        accessibilityRole="link"
        accessibilityLabel={t('terms.noticeLink')}
        testID="terms-read"
        containerStyle={styles.linkBox}
        style={styles.link}
      >
        <Text style={[type.caption, { color: colors.accentEdge }]}>{t('terms.noticeLink')}</Text>
      </PressKey>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', columnGap: 6 },
  text: { textAlign: 'center' },
  linkBox: { minHeight: 44, justifyContent: 'center' },
  link: { paddingHorizontal: 4, paddingVertical: 2 },
});
