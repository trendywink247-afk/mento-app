import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { DobPicker, dobToISO, type Dob } from '@/components/DobPicker';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Screen } from '@/components/Screen';
import { setDraft } from '@/lib/onboardingDraft';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space, type } from '@/theme/tokens';

const MIN_AGE = 18; // mirrors the server gate (server is the source of truth)

function ageFrom(dob: Dob, today = new Date()): number {
  let age = today.getFullYear() - dob.year;
  const m = today.getMonth() + 1 - dob.month;
  if (m < 0 || (m === 0 && today.getDate() < dob.day)) age -= 1;
  return age;
}

export default function AgeScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const today = new Date();
  // Default to the youngest allowed DOB so the gate is obvious and the picker isn't empty.
  const [dob, setDob] = useState<Dob>({ day: 1, month: 1, year: today.getFullYear() - MIN_AGE });

  const age = ageFrom(dob, today);
  const future = new Date(dob.year, dob.month - 1, dob.day) > today;
  const underAge = !future && age < MIN_AGE;
  const canContinue = !future && !underAge;

  const onContinue = () => {
    if (!canContinue) return;
    setDraft({ dob: dobToISO(dob) });
    router.push('/onboarding/email');
  };

  return (
    <Screen
      onBack={() => router.back()}
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
          <PrimaryButton label="Continue" onPress={onContinue} disabled={!canContinue} testID="continue" />
        </>
      }
    >
      <View style={[styles.shieldRow, { backgroundColor: colors.brandTint }]}>
        <Ionicons name="shield-checkmark-outline" size={18} color={colors.accent} />
        <Text style={[type.caption, { color: colors.ink, flex: 1 }]}>
          Your age is never shown to other users.
        </Text>
      </View>

      <Text style={[type.title, styles.title, { color: colors.ink }]} accessibilityRole="header">
        How old are you?
      </Text>
      <Text style={[type.body, styles.sub, { color: colors.inkMuted }]}>
        Your date of birth helps us keep Mento safe, while keeping you anonymous.
      </Text>

      <DobPicker value={dob} onChange={setDob} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  shieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.sm,
    borderRadius: radius.md,
    marginBottom: space.lg,
  },
  title: { marginBottom: space.xs },
  sub: { marginBottom: space.lg },
  block: { ...type.caption, textAlign: 'center' },
});
