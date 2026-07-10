import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Keyboard, StyleSheet, Text, TextInput, View } from 'react-native';

import { IconBadge } from '@/components/IconBadge';
import { PrimaryButton } from '@/components/PrimaryButton';
import { StepScaffold } from '@/components/onboarding/StepScaffold';
import { LogoLockup } from '@/components/art/Logo';
import { getDraft, setDraft } from '@/lib/onboardingDraft';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type } from '@/theme/tokens';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Optional email per mockup #4 (body unchanged from the old route). Skip and Continue
 * exit identically — no judgment in motion. Keyboard is dismissed before the step
 * transition so the crossfade never fights the keyboard. */
export function EmailStep({ onNext }: { onNext: () => void }) {
  const { colors } = useTheme();
  const [email, setEmail] = useState(() => getDraft().email ?? '');
  const valid = email.length === 0 || EMAIL_RE.test(email);

  const next = (withEmail: boolean) => {
    setDraft({ email: withEmail && email ? email.trim() : null });
    Keyboard.dismiss();
    onNext();
  };

  return (
    <StepScaffold
      footer={
        <>
          <PrimaryButton
            label="Continue"
            tone="ink"
            trailing="arrow"
            onPress={() => next(true)}
            disabled={email.length > 0 && !valid}
            testID="continue"
          />
          <View style={styles.orRow}>
            <View style={[styles.hairline, { backgroundColor: colors.border }]} />
            <Text style={[type.caption, { color: colors.inkMuted }]}>or</Text>
            <View style={[styles.hairline, { backgroundColor: colors.border }]} />
          </View>
          <PrimaryButton label="Skip for now" variant="link" onPress={() => next(false)} testID="skip" />
        </>
      }
    >
      <View style={styles.logoZone}>
        <LogoLockup markSize={40} />
      </View>

      <Text style={[styles.headline, { color: colors.ink }]} accessibilityRole="header">
        Optional, but helpful.
      </Text>
      <Text style={[type.body, styles.sub, { color: colors.inkMuted }]}>
        Add an email only if you'd like a way to recover your space later. It's never required
        and never shown to other users.
      </Text>

      <View style={styles.badgeZone}>
        <IconBadge icon="mail-outline" size={64} />
      </View>

      <View
        style={[
          styles.field,
          { borderColor: valid ? colors.border : colors.danger, backgroundColor: colors.surface },
        ]}
      >
        <Ionicons name="mail-outline" size={20} color={colors.accentSoft} />
        <TextInput
          style={[styles.input, { color: colors.ink }]}
          placeholder="Enter your email"
          placeholderTextColor={colors.inkMuted}
          autoCapitalize="none"
          keyboardType="email-address"
          autoCorrect={false}
          value={email}
          onChangeText={setEmail}
          accessibilityLabel="Email address (optional)"
          testID="email-input"
        />
      </View>
      {!valid ? (
        <Text style={[type.caption, styles.error, { color: colors.danger }]}>
          That doesn't look like a valid email.
        </Text>
      ) : null}

      <View style={styles.lockRow}>
        <Ionicons name="lock-closed-outline" size={15} color={colors.accentSoft} />
        <Text style={[type.caption, styles.lockText, { color: colors.inkMuted }]}>
          We respect your privacy. Your email will never be shared with other users.
        </Text>
      </View>
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
