import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { dobToISO, type Dob } from '@/components/DobPicker';
import { DobWheels } from '@/components/DobWheels';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Companion } from '@/components/art/Companion';
import type { CompanionAnimal } from '@/components/art/Companions';
import { Entrance } from '@/components/motion/Entrance';
import { useBreathing } from '@/components/motion/useBreathing';
import { StepScaffold } from '@/components/onboarding/StepScaffold';
import { capture } from '@/lib/analytics';
import { haptic } from '@/lib/haptics';
import { useI18n } from '@/lib/i18n';
import { getDraft, setDraft } from '@/lib/onboardingDraft';
import { useFrameSize } from '@/lib/useFrameSize';
import { useTheme } from '@/theme/ThemeProvider';
import { space, type } from '@/theme/tokens';

const MIN_AGE = 18; // mirrors the server gate (server is the source of truth)
/** How much of the companion shows above the tray (board: 64 of its 110). */
const PEEK = 64;
const PEEK_SIZE = 110;
const COMPACT_BELOW = 780;

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

/** Age gate — board A16: "How old are you?", the date tray with three pillow wheels and a
 * live readout, the companion peeking over the tray, the true privacy line, Continue.
 * The server contract is unchanged (it receives the ISO date and works the age out
 * itself). Restores a previously-picked DOB from the draft when stepping back. */
export function AgeStep({ onNext }: { onNext: () => void }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const breathing = useBreathing();
  // The board is drawn for an 844-tall phone; on a short one the wheels get shallower
  // targets so the privacy line and Continue still fit without scrolling.
  const compact = useFrameSize().height < COMPACT_BELOW;
  const today = new Date();
  const [dob, setDob] = useState<Dob>(() => {
    const saved = getDraft().dob;
    const restored = saved ? isoToDob(saved) : null;
    // Default to the youngest allowed DOB so the gate is obvious and the wheels aren't empty.
    return restored ?? { day: 1, month: 1, year: today.getFullYear() - MIN_AGE };
  });
  // Before the pick there is no chosen animal yet — the panda keeps them company.
  const animal = (getDraft().companionAnimal as CompanionAnimal | null) ?? null;

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
      footerIndex={6}
      footer={
        <>
          {/* A limit state is still: plain text, no motion, no haptic (T&S #11). */}
          {underAge ? (
            <Text style={[type.caption, styles.block, { color: colors.danger }]}>
              {t('onboarding.age.underAge', { age: MIN_AGE })}
            </Text>
          ) : null}
          {future ? (
            <Text style={[type.caption, styles.block, { color: colors.danger }]}>{t('onboarding.age.future')}</Text>
          ) : null}
          <PrimaryButton
            label={t('common.continue')}
            shape="key"
            trailing="arrow"
            onPress={onContinue}
            disabled={!canContinue}
            testID="continue"
          />
        </>
      }
    >
      <View style={styles.head}>
        <Entrance index={0}>
          <Text style={[type.displayHeadline, { color: colors.ink }]} accessibilityRole="header">
            {t('onboarding.age.headline')}
            <Text style={{ color: colors.accent }}>{t('onboarding.age.headlineAccent')}</Text>
          </Text>
        </Entrance>
        <Entrance index={1}>
          <Text style={[type.body, { color: colors.inkMuted }]}>{t('onboarding.age.sub')}</Text>
        </Entrance>
      </View>

      <View style={styles.grow} />

      <View style={styles.trayZone}>
        {/* Drawn BEFORE the tray, so it stands behind it and only peeks over the top. */}
        <View
          style={styles.peek}
          accessible
          accessibilityRole="image"
          accessibilityLabel={t('onboarding.age.companionA11y')}
          pointerEvents="none"
        >
          <Animated.View style={[styles.originBottom, breathing]}>
            <Companion animal={animal} size={PEEK_SIZE} awake />
          </Animated.View>
        </View>
        <DobWheels value={dob} onChange={changeDob} entranceFrom={2} compact={compact} />
      </View>

      <Entrance index={5} style={styles.privacy}>
        <View style={styles.lock}>
          <Ionicons name="lock-closed-outline" size={18} color={colors.accent} />
        </View>
        <Text style={[type.note, styles.privacyText, { color: colors.inkMuted }]}>{t('onboarding.age.privacy')}</Text>
      </Entrance>
    </StepScaffold>
  );
}

const styles = StyleSheet.create({
  head: { gap: space.sm },
  grow: { flexGrow: 1, minHeight: space.sm },
  trayZone: { paddingTop: PEEK },
  peek: { position: 'absolute', right: space.sm, top: 0, width: PEEK_SIZE, height: PEEK_SIZE },
  originBottom: { transformOrigin: 'bottom' },
  privacy: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: space.md },
  lock: { height: 20, justifyContent: 'center' },
  privacyText: { flex: 1 },
  block: { textAlign: 'center', marginBottom: space.xs },
});
