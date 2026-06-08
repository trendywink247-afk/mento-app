import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { Screen } from '@/components/Screen';
import { setDraft } from '@/lib/onboardingDraft';
import { colors, radius, space, type } from '@/theme/tokens';

const MIN_AGE = 18; // mirrors server gate; server is the source of truth
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

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
  const isWeb = Platform.OS === 'web';

  const [dob, setDob] = useState<Date | null>(null);
  const [webText, setWebText] = useState(''); // YYYY-MM-DD on web
  const [show, setShow] = useState(Platform.OS === 'ios');

  // Resolve the effective DOB from whichever input the platform uses.
  let effectiveDob: Date | null = dob;
  if (isWeb) {
    effectiveDob =
      ISO_RE.test(webText) && !Number.isNaN(Date.parse(webText)) ? new Date(`${webText}T00:00:00`) : null;
  }

  const age = effectiveDob ? ageFrom(effectiveDob, today) : null;
  const underAge = age !== null && age < MIN_AGE;
  const future = effectiveDob !== null && effectiveDob > today;
  const canContinue = effectiveDob !== null && !underAge && !future;

  const onNativeChange = (_: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === 'android') setShow(false);
    if (selected) setDob(selected);
  };

  const onContinue = () => {
    if (!effectiveDob || !canContinue) return;
    setDraft({ dob: isoDate(effectiveDob) });
    router.push('/onboarding/email');
  };

  return (
    <Screen
      footer={
        <>
          {underAge ? (
            <Text style={styles.block}>Mento is available to people {MIN_AGE} and older.</Text>
          ) : null}
          {future ? <Text style={styles.block}>That date is in the future.</Text> : null}
          <PrimaryButton label="Continue" onPress={onContinue} disabled={!canContinue} />
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

      {isWeb ? (
        <TextInput
          testID="dob-input"
          style={styles.dateField}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={colors.inkMuted}
          autoCapitalize="none"
          value={webText}
          onChangeText={setWebText}
        />
      ) : Platform.OS === 'android' ? (
        <Pressable style={styles.dateFieldRow} onPress={() => setShow(true)}>
          <Text style={[type.body, { color: dob ? colors.ink : colors.inkMuted }]}>
            {dob ? isoDate(dob) : 'Select your date of birth'}
          </Text>
          <Ionicons name="calendar-outline" size={20} color={colors.inkMuted} />
        </Pressable>
      ) : null}

      {!isWeb && show ? (
        <DateTimePicker
          value={dob ?? new Date(today.getFullYear() - MIN_AGE, today.getMonth(), today.getDate())}
          mode="date"
          display="spinner"
          maximumDate={today}
          onChange={onNativeChange}
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
    ...type.body,
    color: colors.ink,
  },
  dateFieldRow: {
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
