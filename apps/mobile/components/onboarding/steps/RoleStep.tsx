import { StyleSheet, Text, View } from 'react-native';

import { IconBadge } from '@/components/IconBadge';
import { LogoLockup } from '@/components/art/Logo';
import { Entrance } from '@/components/motion/Entrance';
import { TiltCard } from '@/components/motion/TiltCard';
import { StepScaffold } from '@/components/onboarding/StepScaffold';
import { capture } from '@/lib/analytics';
import { useI18n } from '@/lib/i18n';
import { setDraft } from '@/lib/onboardingDraft';
import { saveRole, type Role } from '@/lib/session';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type, wash } from '@/theme/tokens';

/** Step zero of the journey (DECISIONS §K.7, "two doors"): one tap picks a role
 * and advances — no Continue button, so a mentee spends exactly one tap here.
 * The talk door is larger and accent-tinted (the default-safe path); the listen
 * door is smaller and sage. Role is written to device + draft before advancing.
 * No haptic fires here — this one tap is both the choice and the step forward,
 * so the journey's own `advance` haptic (fired by `onPick`) is the only one. */
export function RoleStep({ onPick }: { onPick: (role: Role) => void }) {
  const { colors } = useTheme();
  const { t } = useI18n();

  const pick = (role: Role) => {
    setDraft({ role });
    void saveRole(role);
    capture('role_chosen', { role });
    onPick(role);
  };

  return (
    <StepScaffold
      footer={
        <Text style={[type.caption, styles.footer, { color: colors.inkMuted }]}>
          {t('onboarding.role.footer')}
        </Text>
      }
    >
      <Entrance index={0}>
        <View style={styles.logoZone}>
          <LogoLockup markSize={40} />
        </View>
      </Entrance>

      <Entrance index={1}>
        <Text style={[styles.headline, { color: colors.ink }]} accessibilityRole="header">
          {t('onboarding.role.headline')}
        </Text>
        <Text style={[type.body, styles.sub, { color: colors.inkMuted }]}>
          {t('onboarding.role.sub')}
        </Text>
      </Entrance>

      <Entrance index={2}>
        <TiltCard
          onPress={() => pick('mentee')}
          maxTilt={5}
          edge={colors.accentEdge}
          accessibilityRole="button"
          accessibilityLabel={t('onboarding.role.talkTitle')}
          testID="role-talk"
          style={[styles.door, styles.doorBig, { backgroundColor: colors.accentTint }]}
        >
          <IconBadge icon="chatbubble-ellipses-outline" tone="accent" size={52} />
          <View style={styles.doorText}>
            <Text style={[styles.doorTitle, { color: colors.ink }]}>{t('onboarding.role.talkTitle')}</Text>
            <Text style={[type.caption, { color: colors.inkMuted }]}>{t('onboarding.role.talkBody')}</Text>
          </View>
        </TiltCard>
      </Entrance>

      <Entrance index={3}>
        <TiltCard
          onPress={() => pick('mentor')}
          maxTilt={3}
          edge={colors.edgeSurface}
          accessibilityRole="button"
          accessibilityLabel={t('onboarding.role.listenTitle')}
          testID="role-listen"
          style={[styles.door, { backgroundColor: wash.green }]}
        >
          <IconBadge icon="ear-outline" tone="green" size={44} />
          <View style={styles.doorText}>
            <Text style={[styles.doorTitleSmall, { color: colors.ink }]}>{t('onboarding.role.listenTitle')}</Text>
            <Text style={[type.caption, { color: colors.inkMuted }]}>{t('onboarding.role.listenBody')}</Text>
          </View>
        </TiltCard>
      </Entrance>
    </StepScaffold>
  );
}

const styles = StyleSheet.create({
  logoZone: { alignItems: 'center', marginTop: space.md, marginBottom: space.xl },
  headline: {
    fontFamily: font.sansHeavy,
    fontSize: 30,
    lineHeight: 38,
    textAlign: 'center',
    marginBottom: space.sm,
  },
  sub: { textAlign: 'center', marginBottom: space.xl, paddingHorizontal: space.sm },
  door: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderRadius: radius.lg,
    padding: space.md,
    marginBottom: space.md,
  },
  doorBig: { paddingVertical: space.lg },
  doorText: { flex: 1, gap: 2 },
  doorTitle: { fontFamily: font.sansHeavy, fontSize: 20, lineHeight: 26 },
  doorTitleSmall: { fontFamily: font.sansBold, fontSize: 17, lineHeight: 22 },
  footer: { textAlign: 'center' },
});
