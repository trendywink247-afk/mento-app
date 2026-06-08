import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { Screen } from '@/components/Screen';
import { setDraft } from '@/lib/onboardingDraft';
import { colors, radius, space, type } from '@/theme/tokens';

const MIN_AGE = 18; // mirrors server gate; server is the source of truth

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

function ageFrom(dob: Date, today = new Date()): number {
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age -= 1;
  return age;
}

export default function AgeScreen() {
  const router = useRouter();
  const today = new Date();
  const [dob, setDob] = useState<Date | null>(null);
  const [show, setShow] = useState(Platform.OS === 'ios');

  const age = dob ? ageFrom(dob, today) : null;
  const underAge = age !== null && age < MIN_AGE;

  const onChange = (_: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === 'android') setShow(false);
    if (selected) setDob(selected);
  };

  const onContinue = () => {
    if (!dob || underAge) return;
    setDraft({ dob: isoDate(dob) });
    router.push('/onboarding/email');
  };

  return (
    <Screen
      footer={
        <>
          {underAge ? (
            <Text style={styles.block}>Mento is available to people {MIN_AGE} and older.</Text>
          ) : null}
          <PrimaryButton label="Continue" onPress={onContinue} disabled={!dob || underAge} />
        </>
      }
    >
      <View style={styles.lockRow}>
        <Ionicons name="shield-checkmark-outline" size={20} color={colors.brand} />
        <Text style={type.caption}>Your age is never shown to other users.</Text>
      </View>

      <Text style={styles.title}>How old are you?</Text>
      <Text style={styles.sub}>
        Your date of birth helps us keep Mento safe, while keeping you anonymous.
      </Text>

      {Platform.OS === 'android' ? (
        <Pressable style={styles.dateField} onPress={() => setShow(true)}>
          <Text style={[type.body, { color: dob ? colors.ink : colors.inkMuted }]}>
            {dob ? isoDate(dob) : 'Select your date of birth'}
          </Text>
          <Ionicons name="calendar-outline" size={20} color={colors.inkMuted} />
        </Pressable>
      ) : null}

      {show ? (
        <DateTimePicker
          value={dob ?? new Date(today.getFullYear() - MIN_AGE, today.getMonth(), today.getDate())}
          mode="date"
          display="spinner"
          maximumDate={today}
          onChange={onChange}
          textColor={colors.ink}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  lockRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.lg },
  title: { ...type.title, color: colors.ink, marginBottom: space.sm },
  sub: { ...type.body, color: colors.inkMuted, marginBottom: space.lg },
  dateField: {
    height: 54,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  block: { ...type.caption, color: colors.danger, textAlign: 'center' },
});
