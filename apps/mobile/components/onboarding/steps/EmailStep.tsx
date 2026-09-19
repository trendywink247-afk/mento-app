import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Keyboard, StyleSheet, Text, TextInput, View } from 'react-native';

import { IconBadge } from '@/components/IconBadge';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Entrance } from '@/components/motion/Entrance';
import { StepScaffold } from '@/components/onboarding/StepScaffold';
import { LogoLockup } from '@/components/art/Logo';
import { capture } from '@/lib/analytics';
import { useI18n } from '@/lib/i18n';
import { getDraft, setDraft } from '@/lib/onboardingDraft';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space, type } from '@/theme/tokens';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Optional email per mockup #4 (body unchanged from the old route). Skip and Continue
 * exit identically — no judgment in motion. Keyboard is dismissed before the step
 * transition so the crossfade never fights the keyboard. */
export function EmailStep({ onNext }: { onNext: () => void }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const [email, setEmail] = useState(() => getDraft().email ?? '');
  const valid = email.length === 0 || EMAIL_RE.test(email);

  const next = (withEmail: boolean) => {
    setDraft({ email: withEmail && email ? email.trim() : null });
    // Whether the step was skipped — never the address itself.
    capture('onboarding_email_step', { skipped: !(withEmail && email) });
    Keyboard.dismiss();
    onNext();
  };

  return (
    <StepScaffold
      footerIndex={4}
      footer={
        <>
          <PrimaryButton
            label={t('common.continue')}
            tone="ink"
            trailing="arrow"
            onPress={() => next(true)}
            disabled={email.length > 0 && !valid}
            testID="continue"
          />
          <View style={styles.orRow}>
            <View style={[styles.hairline, { backgroundColor: colors.border }]} />
            <Text style={[type.caption, { color: colors.inkMuted }]}>{t('onboarding.email.or')}</Text>
            <View style={[styles.hairline, { backgroundColor: colors.border }]} />
          </View>
          <PrimaryButton label={t('onboarding.email.skip')} variant="link" onPress={() => next(false)} testID="skip" />
        </>
      }
    >
      <Entrance index={0}>
        <View style={styles.logoZone}>
          <LogoLockup markSize={40} />
        </View>
      </Entrance>

      <Entrance index={1}>
        <Text style={[styles.headline, { color: colors.ink }]} accessibilityRole="header">
          {t('onboarding.email.headline')}
        </Text>
        <Text style={[type.body, styles.sub, { color: colors.inkMuted }]}>
          {t('onboarding.email.sub')}
        </Text>
      </Entrance>

      <Entrance index={2}>
        <View style={styles.badgeZone}>
          <IconBadge icon="mail-outline" size={64} />
        </View>
      </Entrance>

      <Entrance index={3}>
      <View
        style={[
          styles.field,
          { borderColor: valid ? colors.border : colors.danger, backgroundColor: colors.surface },
        ]}
      >
        <Ionicons name="mail-outline" size={20} color={colors.accentSoft} />
        <TextInput
          style={[styles.input, { color: colors.ink }]}
          placeholder={t('onboarding.email.placeholder')}
          placeholderTextColor={colors.inkMuted}
          autoCapitalize="none"
          keyboardType="email-address"
          autoCorrect={false}
          value={email}
          onChangeText={setEmail}
          accessibilityLabel={t('onboarding.email.inputA11y')}
          testID="email-input"
        />
      </View>
      {!valid ? (
        <Text style={[type.caption, styles.error, { color: colors.danger }]}>
          {t('onboarding.email.invalid')}
        </Text>
      ) : null}

      <View style={styles.lockRow}>
        <Ionicons name="lock-closed-outline" size={15} color={colors.accentSoft} />
        <Text style={[type.caption, styles.lockText, { color: colors.inkMuted }]}>
          {t('onboarding.email.privacy')}
        </Text>
      </View>
      </Entrance>
    </StepScaffold>
  );
}

const styles = StyleSheet.create({
  logoZone: { alignItems: 'center', marginTop: space.md, marginBottom: space.xl },
  headline: {
    ...type.displayHeadline,
    textAlign: 'center',
    marginBottom: space.md,
  },
  sub: { textAlign: 'center', marginBottom: space.xl, paddingHorizontal: space.sm },
  badgeZone: { alignItems: 'center', marginBottom: space.xl },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    height: 58,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: space.md,
  },
  input: { flex: 1, height: '100%', ...type.body },
  error: { marginTop: space.sm, textAlign: 'center' },
  lockRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'center',
    gap: space.xs,
    marginTop: space.md,
    paddingHorizontal: space.lg,
  },
  lockText: { textAlign: 'center', flexShrink: 1 },
  orRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginVertical: space.xs },
  hairline: { flex: 1, height: 1 },
});
