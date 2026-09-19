/**
 * Nobody free right now — the honest exits (board A19's busy state, carried into the
 * New chat sheet A24, Browse A25 and the first-question builder A27). The same two ways on
 * that onboarding offers: send the question to one mentor instead (they reply when free →
 * Browse → a mentor → the letter, A04), or a calm try again.
 *
 * A busy state is STILL (T&S #11): no arrival, no haptic, never red. "Try again" is a quiet
 * link, never a countdown.
 */
import { StyleSheet, Text, View } from 'react-native';

import { EdgeSurface } from '@/components/EdgeSurface';
import { PrimaryButton } from '@/components/PrimaryButton';
import { PressKey } from '@/components/motion/PressKey';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type } from '@/theme/tokens';

export function BusyExits({
  onSendInstead,
  onRetry,
  retrying = false,
  testID = 'busy',
}: {
  onSendInstead: () => void;
  onRetry: () => void;
  retrying?: boolean;
  testID?: string;
}) {
  const { colors } = useTheme();
  const { t } = useI18n();
  return (
    <EdgeSurface
      edge={colors.edgeAlt}
      travel={3}
      radius={radius.lg}
      style={[styles.card, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
      testID={testID}
    >
      <View accessible accessibilityLabel={t('askFlow.busyA11y')} style={styles.words}>
        <Text style={[type.keyDense, styles.title, { color: colors.ink }]}>{t('connecting.nobodyFree')}</Text>
        <Text style={[type.note, { color: colors.inkMuted }]}>{t('askFlow.busyBody')}</Text>
      </View>
      <PrimaryButton
        label={t('connecting.sendInstead')}
        variant="surface"
        shape="key"
        dense
        trailing="arrow"
        onPress={onSendInstead}
        testID={`${testID}-send-instead`}
      />
      <PressKey
        onPress={onRetry}
        edge="transparent"
        travel={2}
        haptic="none"
        disabled={retrying}
        accessibilityLabel={t('connecting.tryAgain')}
        testID={`${testID}-retry`}
        containerStyle={styles.linkBox}
        style={styles.link}
      >
        <Text style={[styles.linkText, { color: colors.accent }]}>{t('connecting.tryAgain')}</Text>
      </PressKey>
    </EdgeSurface>
  );
}

const styles = StyleSheet.create({
  card: { padding: 14, gap: 10, borderWidth: 1 },
  words: { gap: 2 },
  title: { lineHeight: 22 },
  linkBox: { alignSelf: 'center', marginTop: -4 },
  link: { height: 44, paddingHorizontal: space.md, alignItems: 'center', justifyContent: 'center' },
  linkText: { fontFamily: font.sansBold, fontSize: 15, lineHeight: 20 },
});
