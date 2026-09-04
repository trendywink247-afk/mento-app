import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { ApplicationForm } from '@/components/ApplicationForm';
import { DobPicker, dobToISO, type Dob } from '@/components/DobPicker';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Screen } from '@/components/Screen';
import { Entrance } from '@/components/motion/Entrance';
import { ApiError, api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { saveSession } from '@/lib/session';
import { useTheme } from '@/theme/ThemeProvider';
import { font, space, type } from '@/theme/tokens';

const MIN_AGE = 18; // mirrors the server gate (server is the source of truth)

// Same DOB math as components/onboarding/steps/AgeStep.tsx, copied rather than
// imported — AgeStep is tangled into the onboarding step-machine/draft-persistence,
// which this standalone public page has no use for.
function ageFrom(dob: Dob, today = new Date()): number {
  let age = today.getFullYear() - dob.year;
  const m = today.getMonth() + 1 - dob.month;
  if (m < 0 || (m === 0 && today.getDate() < dob.day)) age -= 1;
  return age;
}

const WHY = [
  { icon: 'heart-outline', text: "You've been through a hard season and know what steadying company felt like." },
  { icon: 'time-outline', text: 'A few hours a week, on your schedule — evenings, weekends, whatever fits.' },
  { icon: 'shield-checkmark-outline', text: "You're not a therapist and never pretend to be — you just show up and listen." },
] as const;

/** Public listener-recruitment landing page (console.agentin.chat/apply) — no app
 * install, no member session required. Mints a throwaway anonymous member via the
 * existing onboarding/start age gate, then reuses the unmodified application flow. */
export default function Apply() {
  const { colors, elevation } = useTheme();
  const { t } = useI18n();
  const today = new Date();
  const [dob, setDob] = useState<Dob>({ day: 1, month: 1, year: today.getFullYear() - MIN_AGE });
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const age = ageFrom(dob, today);
  const future = new Date(dob.year, dob.month - 1, dob.day) > today;
  const underAge = !future && age < MIN_AGE;
  const canContinue = !future && !underAge;

  const startApplying = async () => {
    if (!canContinue || starting) return;
    setStarting(true);
    setStartError(null);
    try {
      const result = await api.startOnboarding({ dob: dobToISO(dob) });
      await saveSession(result.session_token, result.stream_token, result.user);
      setSessionReady(true);
    } catch (e) {
      setStartError(e instanceof ApiError ? e.message : 'Something went wrong — please try again.');
    } finally {
      setStarting(false);
    }
  };

  if (submitted) {
    return (
      <Screen bg="lavender">
        <View style={styles.successWrap}>
          <Ionicons name="checkmark-circle" size={56} color={colors.accent} />
          <Text style={[type.displaySerif, styles.center, { color: colors.ink, marginTop: space.md }]} testID="apply-success">
            Thank you.
          </Text>
          <Text style={[type.body, styles.center, { color: colors.inkMuted, marginTop: space.sm }]}>
            Your application is in review. If it's a fit, we'll reach out at the email you
            shared with your private listener link.
          </Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <View style={styles.page}>
        <Entrance index={0}>
          <Text style={[type.displaySerif, { color: colors.ink }]} accessibilityRole="header">
            Be the steady voice someone needs.
          </Text>
          <Text style={[type.body, { color: colors.inkMuted, marginTop: space.sm }]}>
            Mento connects people going through hard moments with real people who've been
            there — anonymously, without judgment. Listeners are the heart of it.
          </Text>
        </Entrance>

        <Entrance index={1}>
          <View style={styles.whyList}>
            {WHY.map((w) => (
              <View key={w.text} style={styles.whyRow}>
                <Ionicons name={w.icon} size={22} color={colors.accentSoft} />
                <Text style={[type.body, { color: colors.ink, flex: 1 }]}>{w.text}</Text>
              </View>
            ))}
          </View>
        </Entrance>

        <Entrance index={2}>
          <View style={[styles.card, { backgroundColor: colors.surface }, elevation.sm]}>
            {!sessionReady ? (
              <>
                <Text style={[styles.label, { color: colors.ink }]}>
                  First, a quick check — Mento is for people 18 and older.
                </Text>
                <DobPicker value={dob} onChange={setDob} />
                {underAge ? (
                  <Text style={[type.caption, styles.center, { color: colors.danger, marginTop: space.sm }]}>
                    {t('onboarding.age.underAge', { age: MIN_AGE })}
                  </Text>
                ) : null}
                {future ? (
                  <Text style={[type.caption, styles.center, { color: colors.danger, marginTop: space.sm }]}>
                    {t('onboarding.age.future')}
                  </Text>
                ) : null}
                {startError ? (
                  <Text style={[type.body, styles.center, { color: colors.danger, marginTop: space.sm }]}>
                    {startError}
                  </Text>
                ) : null}
                <View style={{ marginTop: space.md }}>
                  <PrimaryButton
                    label={t('common.continue')}
                    onPress={() => void startApplying()}
                    disabled={!canContinue}
                    loading={starting}
                    testID="apply-dob-continue"
                  />
                </View>
              </>
            ) : (
              <ApplicationForm onSuccess={() => setSubmitted(true)} />
            )}
          </View>
        </Entrance>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  page: { width: '100%', maxWidth: 720, alignSelf: 'center', paddingBottom: space.xl },
  center: { textAlign: 'center' },
  whyList: { gap: space.md, marginTop: space.lg, marginBottom: space.lg },
  whyRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  card: { borderRadius: 20, padding: space.lg },
  label: { fontFamily: font.sansBold, fontSize: 16, lineHeight: 23, marginBottom: space.sm },
  successWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.lg },
});
