import { Linking, StyleSheet, Text, View } from 'react-native';

import { IconBadge } from '@/components/IconBadge';
import { PrimaryButton } from '@/components/PrimaryButton';
import { PressKey } from '@/components/motion/PressKey';
import { useI18n, type TKey } from '@/lib/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type } from '@/theme/tokens';

/** Verified India crisis helplines (T&S #1) — re-verified session 29, see
 * docs/PRIVACY.md sourcing. Mentors reach this from the chat rail so a listener
 * who hears real danger can hand over a number immediately. */
const HELPLINES = [
  { key: 'teleManas', number: '14416' },
  { key: 'kiran', number: '1800-599-0019' },
] as const;

export function HelplinesSheet({ onClose }: { onClose: () => void }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  return (
    <View style={[styles.card, { backgroundColor: colors.surface }]} testID="helplines-sheet">
      <Text style={[styles.title, { color: colors.ink }]}>{t('mentor.helplines.title')}</Text>
      <Text style={[type.body, { color: colors.inkMuted }]}>{t('mentor.helplines.body')}</Text>
      <View style={{ gap: space.sm }}>
        {HELPLINES.map(({ key, number }) => (
          <PressKey
            key={key}
            onPress={() => void Linking.openURL(`tel:${number.replace(/-/g, '')}`).catch(() => {})}
            edge={colors.edgeSurface}
            radius={radius.md}
            style={[styles.helpline, { backgroundColor: colors.surfaceAlt }]}
            testID={`helpline-${key}`}
          >
            <IconBadge icon="call-outline" size={36} tone="green" />
            <View style={{ flex: 1 }}>
              <Text style={[type.label, { color: colors.ink }]}>{t(`mentor.helplines.${key}` as TKey)}</Text>
              <Text style={[type.caption, { color: colors.inkMuted }]}>
                {number} · {t('mentor.helplines.hours')}
              </Text>
            </View>
          </PressKey>
        ))}
      </View>
      <PrimaryButton
        label={t('mentor.helplines.close')}
        variant="link"
        onPress={onClose}
        testID="helplines-close"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    padding: space.lg,
    width: '100%',
    maxWidth: 420,
    gap: space.md,
  },
  title: { fontFamily: font.sansHeavy, fontSize: 20, lineHeight: 26 },
  helpline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.sm,
  },
});
