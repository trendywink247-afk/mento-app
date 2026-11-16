import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { AppearancePicker } from '@/components/AppearancePicker';
import { EdgeSurface } from '@/components/EdgeSurface';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Screen } from '@/components/Screen';
import { ColourSwatches } from '@/components/profile/ColourSwatches';
import { CompanionNameRow } from '@/components/profile/CompanionNameRow';
import { CompanionSwitch } from '@/components/profile/CompanionSwitch';
import { useI18n } from '@/lib/i18n';
import { setDraft } from '@/lib/onboardingDraft';
import { useCompanionAnimal } from '@/lib/useCompanionAnimal';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space, type } from '@/theme/tokens';

/** Theme (DECISIONS S.7): companion, colour and appearance on one page, opened from one
 * Profile row, so Profile keeps only what people reach for. */
export default function Theme() {
  const router = useRouter();
  const { colors, setCompanionShown } = useTheme();
  const { t } = useI18n();
  const animal = useCompanionAnimal() ?? null;

  // "Show my companion" (DECISIONS R.3). Turning it on with none chosen yet (skipped at
  // signup) opens the companion pick, which ends on My Chats with it shown.
  const openPicker = () => {
    setDraft({ role: 'mentee', sessionBacked: true });
    router.push({ pathname: '/onboarding', params: { step: 'companion' } });
  };
  const changeCompanionShown = (next: boolean) => {
    if (next && !animal) {
      openPicker();
      return;
    }
    setCompanionShown(next);
  };

  return (
    <Screen onBack={() => router.back()} scroll>
      <View style={styles.page}>
        <Text style={[type.displayHeadline, { color: colors.ink }]} accessibilityRole="header">
          {t('theme.title')}
        </Text>

        <EdgeSurface
          edge={colors.edgeAlt}
          travel={3}
          radius={radius.lg}
          style={[styles.card, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
        >
          <Text style={[type.rowTitle, styles.pad, { color: colors.ink }]}>{t('profile.companionTitle')}</Text>
          <CompanionNameRow animal={animal} />
          <ColourSwatches />
          <Text style={[type.caption, styles.pad, { color: colors.inkMuted }]}>{t('profile.recolour')}</Text>
          <PrimaryButton
            label={animal ? t('theme.changeCompanion') : t('theme.pickCompanion')}
            variant="link"
            onPress={openPicker}
            testID="theme-change-companion"
          />
        </EdgeSurface>

        <CompanionSwitch onChange={changeCompanionShown} testID="profile-companion-shown" />

        <View style={styles.section}>
          <Text style={[type.rowTitle, { color: colors.ink }]}>{t('appearance.title')}</Text>
          <Text style={[type.body, { color: colors.inkMuted }]}>{t('appearance.sub')}</Text>
          <AppearancePicker />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  page: { gap: space.md, paddingBottom: space.xl },
  card: { paddingTop: 14, paddingHorizontal: 14, paddingBottom: 12, gap: space.sm, borderWidth: 1 },
  pad: { paddingHorizontal: 2 },
  section: { gap: space.sm, marginTop: space.sm },
});
