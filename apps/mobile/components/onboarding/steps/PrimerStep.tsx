import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { IconBadge } from '@/components/IconBadge';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Entrance } from '@/components/motion/Entrance';
import { StepScaffold } from '@/components/onboarding/StepScaffold';
import { useI18n, type TKey } from '@/lib/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space, type } from '@/theme/tokens';

const LINES: { icon: keyof typeof Ionicons.glyphMap; key: TKey }[] = [
  { icon: 'person-outline', key: 'onboarding.primer.line1' },
  { icon: 'heart-outline', key: 'onboarding.primer.line2' },
  { icon: 'shield-checkmark-outline', key: 'onboarding.primer.line3' },
];

/** Mentor branch, one screen: what listening here means, in plain words. The
 * "not therapists" pledge checkbox is NOT here — it stays a hard gate on the
 * application form (T&S #2). */
export function PrimerStep({ onNext }: { onNext: () => void }) {
  const { colors, elevation } = useTheme();
  const { t } = useI18n();

  return (
    <StepScaffold
      footer={
        <PrimaryButton
          label={t('onboarding.primer.cta')}
          tone="ink"
          trailing="arrow"
          onPress={onNext}
          testID="primer-continue"
        />
      }
    >
      <Entrance index={0}>
        <View style={styles.badgeZone}>
          <IconBadge icon="ear-outline" tone="green" size={64} />
        </View>
        <Text style={[styles.headline, { color: colors.ink }]} accessibilityRole="header">
          {t('onboarding.primer.headline')}
        </Text>
      </Entrance>

      {LINES.map((line, i) => (
        <Entrance key={line.key} index={1 + i}>
          <View style={[styles.line, elevation.sm, { backgroundColor: colors.surface }]}>
            <Ionicons name={line.icon} size={22} color={colors.accent} />
            <Text style={[type.body, styles.lineText, { color: colors.ink }]}>{t(line.key)}</Text>
          </View>
        </Entrance>
      ))}
    </StepScaffold>
  );
}

const styles = StyleSheet.create({
  badgeZone: { alignItems: 'center', marginTop: space.lg, marginBottom: space.md },
  headline: {
    ...type.displayHeadline,
    textAlign: 'center',
    marginBottom: space.xl,
    paddingHorizontal: space.sm,
  },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderRadius: radius.md,
    padding: space.md,
    marginBottom: space.sm,
  },
  lineText: { flex: 1 },
});
