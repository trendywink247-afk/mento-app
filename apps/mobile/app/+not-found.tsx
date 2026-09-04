import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { Companion } from '@/components/art/Companion';
import { Screen } from '@/components/Screen';
import { useI18n } from '@/lib/i18n';
import { useCompanionAnimal } from '@/lib/useCompanionAnimal';
import { useTheme } from '@/theme/ThemeProvider';
import { space, type } from '@/theme/tokens';

/** Branded unmatched-route screen. Without this file expo-router renders its own
 * black "Unmatched Route" page — a stale share link or a typo would drop a
 * struggling person onto a developer error. Calm copy, the member's companion,
 * one way back. `/` itself routes a live session straight on to /chats. */
export default function NotFound() {
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useI18n();
  const animal = useCompanionAnimal();

  return (
    <Screen bg="lavender">
      <View style={styles.center} testID="not-found">
        <Companion animal={animal ?? null} size={120} />
        <Text style={[styles.title, { color: colors.ink }]} accessibilityRole="header">
          {t('notFound.title')}
        </Text>
        <Text style={[type.body, styles.body, { color: colors.inkMuted }]}>{t('notFound.body')}</Text>
        <View style={styles.cta}>
          <PrimaryButton label={t('notFound.cta')} onPress={() => router.replace('/')} testID="not-found-home" />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.sm },
  title: { ...type.displayHeadline, textAlign: 'center', marginTop: space.sm },
  body: { textAlign: 'center' },
  cta: { alignSelf: 'stretch', marginTop: space.md },
});
