/**
 * ExamRedirectCard — what the member sees when their mentor suggests a certified exam mentor
 * (DECISIONS §O). Gentle and never a block: the chat stays open and they may keep talking here.
 * Two keys: choose a certified mentor (Browse, filtered), or not now (hides it for this visit).
 * Still (T&S #11): no entrance, no haptic, nothing red.
 */
import { StyleSheet, Text, View } from 'react-native';

import { EdgeSurface } from '@/components/EdgeSurface';
import { PrimaryButton } from '@/components/PrimaryButton';
import { PressKey } from '@/components/motion/PressKey';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type } from '@/theme/tokens';

export function ExamRedirectCard({
  name,
  onChoose,
  onLater,
}: {
  name: string;
  onChoose: () => void;
  onLater: () => void;
}) {
  const { colors } = useTheme();
  const { t } = useI18n();
  return (
    <EdgeSurface
      edge={colors.edgeAlt}
      travel={3}
      radius={radius.lg}
      style={[styles.card, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
      testID="exam-redirect-card"
    >
      <Text style={[type.keyDense, { color: colors.ink }]}>{t('certified.redirectTitle')}</Text>
      <Text style={[type.note, { color: colors.inkMuted }]}>{t('certified.redirectBody', { name })}</Text>
      <PrimaryButton
        label={t('certified.redirectChoose')}
        variant="surface"
        shape="key"
        dense
        trailing="arrow"
        onPress={onChoose}
        testID="exam-redirect-choose"
      />
      <PressKey
        onPress={onLater}
        edge="transparent"
        travel={2}
        haptic="none"
        accessibilityLabel={t('certified.redirectLater')}
        testID="exam-redirect-later"
        containerStyle={styles.linkBox}
        style={styles.link}
      >
        <Text style={[styles.linkText, { color: colors.accent }]}>{t('certified.redirectLater')}</Text>
      </PressKey>
    </EdgeSurface>
  );
}

const styles = StyleSheet.create({
  card: { padding: 14, gap: 10, borderWidth: 1, marginHorizontal: space.md, marginBottom: space.sm },
  linkBox: { alignSelf: 'center', marginTop: -4 },
  link: { minHeight: 44, paddingHorizontal: space.md, alignItems: 'center', justifyContent: 'center' },
  linkText: { fontFamily: font.sansBold, fontSize: 15, lineHeight: 20 },
});
