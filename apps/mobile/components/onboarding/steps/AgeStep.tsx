import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { DobPicker, dobToISO, type Dob } from '@/components/DobPicker';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Entrance } from '@/components/motion/Entrance';
import { StepScaffold } from '@/components/onboarding/StepScaffold';
import { LogoLockup } from '@/components/art/Logo';
import { capture } from '@/lib/analytics';
import { haptic } from '@/lib/haptics';
import { getDraft, setDraft } from '@/lib/onboardingDraft';
import { useTheme } from '@/theme/ThemeProvider';
import { font, space, type } from '@/theme/tokens';

const MIN_AGE = 18; // mirrors the server gate (server is the source of truth)

function ageFrom(dob: Dob, today = new Date()): number {
  let age = today.getFullYear() - dob.year;
  const m = today.getMonth() + 1 - dob.month;
  if (m < 0 || (m === 0 && today.getDate() < dob.day)) age -= 1;
  return age;
}

function isoToDob(iso: string): Dob | null {
  const [y, m, d] = iso.split('-').map(Number);
  return y && m && d ? { day: d, month: m, year: y } : null;
}

/** Age gate per mockup #3 (body unchanged from the old route; navigation is now the
 * journey's). Restores a previously-picked DOB from the draft when stepping back. */
export function AgeStep({ onNext }: { onNext: () => void }) {
  const { colors } = useTheme();
  const today = new Date();
  const [dob, setDob] = useState<Dob>(() => {
    const saved = getDraft().dob;
    const restored = saved ? isoToDob(saved) : null;
    // Default to the youngest allowed DOB so the gate is obvious and the picker isn't empty.
    return restored ?? { day: 1, month: 1, year: today.getFullYear() - MIN_AGE };
  });

  const age = ageFrom(dob, today);
  const future = new Date(dob.year, dob.month - 1, dob.day) > today;
  const underAge = !future && age < MIN_AGE;
  const canContinue = !future && !underAge;

  const onContinue = () => {
    if (!canContinue) return;
    setDraft({ dob: dobToISO(dob) });
    capture('onboarding_age_passed');
    onNext();
  };

  const changeDob = (next: Dob) => {
    haptic.tick();
    setDob(next);
  };

  return (
    <StepScaffold
      footer={
        <>
          {underAge ? (
            <Text style={[styles.block, { color: colors.danger }]}>
              Mento is available to people {MIN_AGE} and older.
            </Text>
          ) : null}
          {future ? (
            <Text style={[styles.block, { color: colors.danger }]}>That date is in the future.</Text>
          ) : null}
          <PrimaryButton
            label="Continue"
            tone="ink"
            trailing="arrow"
            onPress={onContinue}
            disabled={!canContinue}
            testID="continue"
          />
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
          Your age helps us{'\n'}keep Mento safe,{'\n'}while keeping you{'\n'}
          <Text style={{ color: colors.accentSoft }}>anonymous.</Text>
        </Text>
      </Entrance>

      <Entrance index={2}>
        <View style={styles.reassure}>
          <Ionicons name="shield-checkmark-outline" size={34} color={colors.accentSoft} />
          <Text style={[type.body, styles.center, { color: colors.inkMuted }]}>
            We use your age to create appropriate conversations and maintain a safe space for
            everyone.
          </Text>
          <View style={styles.lockRow}>
            <Ionicons name="lock-closed-outline" size={15} color={colors.accentSoft} />
            <Text style={[type.caption, { color: colors.inkMuted }]}>
              Your age is never shown to other users.
            </Text>
          </View>
        </View>
      </Entrance>

      <Entrance index={3}>
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <Text style={[styles.question, { color: colors.ink }]}>How old are you?</Text>
        <DobPicker value={dob} onChange={changeDob} />
      </Entrance>
    </StepScaffold>
  );
}

const styles = StyleSheet.create({
  logoZone: { alignItems: 'center', marginTop: space.md, marginBottom: space.lg },
  headline: {
    fontFamily: font.sansHeavy,
    fontSize: 28,
    lineHeight: 38,
    textAlign: 'center',
    marginBottom: space.lg,
  },
  reassure: { alignItems: 'center', gap: space.md, paddingHorizontal: space.md },
  center: { textAlign: 'center' },
  lockRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  divider: { height: 1, marginVertical: space.lg },
  question: {
    fontFamily: font.sansBold,
    fontSize: 17,
    lineHeight: 24,
    textAlign: 'center',
    marginBottom: space.md,
  },
  block: { ...type.caption, textAlign: 'center' },
});
