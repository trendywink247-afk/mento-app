import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { dobToISO, type Dob } from '@/components/DobPicker';
import { DobWheels } from '@/components/DobWheels';
import { PrimaryButton } from '@/components/PrimaryButton';
import { MentorPageHeader } from '@/components/mentor/MentorPageHeader';
import { Entrance } from '@/components/motion/Entrance';
import { ApiError, api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { saveSession } from '@/lib/session';
import { useTheme } from '@/theme/ThemeProvider';
import { space, type } from '@/theme/tokens';

const MIN_AGE = 18; // mirrors the server gate (server is the source of truth)

// Same DOB math as components/onboarding/steps/AgeStep.tsx, copied rather than imported —
// AgeStep is tangled into the onboarding step machine / draft persistence.
function ageFrom(dob: Dob, today = new Date()): number {
  let age = today.getFullYear() - dob.year;
  const m = today.getMonth() + 1 - dob.month;
  if (m < 0 || (m === 0 && today.getDate() < dob.day)) age -= 1;
  return age;
}

/** The mentor path's age gate — ONLY for a visitor with no session (the public `/apply`
 * page). The server decides (`POST /onboarding/start`, the same 18+ gate as the member
 * journey) and mints the anonymous session the application then rides on; a member who
 * already has a session never sees this step (they passed it at sign-up). */
export function AgeGateStep({ onBack, onPassed }: { onBack: () => void; onPassed: () => void }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const today = new Date();
  const [dob, setDob] = useState<Dob>({ day: 1, month: 1, year: today.getFullYear() - MIN_AGE });
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const age = ageFrom(dob, today);
  const future = new Date(dob.year, dob.month - 1, dob.day) > today;
  const underAge = !future && age < MIN_AGE;
  const canContinue = !future && !underAge;

  const start = async () => {
    if (!canContinue || starting) return;
    setStarting(true);
    setStartError(null);
    try {
      const result = await api.startOnboarding({ dob: dobToISO(dob) });
      await saveSession(result.session_token, result.stream_token, result.user, result.refresh_token);
      onPassed();
    } catch (e) {
      setStartError(e instanceof ApiError ? e.message : t('mentorApply.error'));
      setStarting(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <MentorPageHeader eyebrow={t('publicApply.forMentors')} title={t('mentorApply.title')} onBack={onBack} />
      <View style={styles.stack}>
        <Entrance index={0}>
          <Text style={[type.displayHeadline, { color: colors.ink }]} accessibilityRole="header">
            {t('publicApply.ageHeadline')}
            <Text style={{ color: colors.accent }}>{t('publicApply.ageHeadlineAccent')}</Text>
          </Text>
        </Entrance>
        <Entrance index={1}>
          <Text style={[type.body, { color: colors.inkMuted }]}>{t('publicApply.ageSub')}</Text>
        </Entrance>
        <DobWheels value={dob} onChange={setDob} entranceFrom={2} />
        {/* A limit state is still: plain text, no motion, no haptic (T&S #11). */}
        {underAge ? (
          <Text style={[type.caption, styles.center, { color: colors.danger }]}>
            {t('onboarding.age.underAge', { age: MIN_AGE })}
          </Text>
        ) : null}
        {future ? <Text style={[type.caption, styles.center, { color: colors.danger }]}>{t('onboarding.age.future')}</Text> : null}
        {startError ? <Text style={[type.note, styles.center, { color: colors.ink }]}>{startError}</Text> : null}
        <Entrance index={5}>
          <PrimaryButton
            label={t('common.continue')}
            shape="key"
            trailing="arrow"
            onPress={() => void start()}
            disabled={!canContinue}
            loading={starting}
            testID="apply-dob-continue"
          />
        </Entrance>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  inner: { paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.lg, gap: 14 },
  stack: { gap: 14 },
  center: { textAlign: 'center' },
});
