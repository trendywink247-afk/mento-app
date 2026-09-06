/**
 * OnboardingJourney — the whole onboarding as ONE route: an internal step machine
 * (role → age → email → companion → ready → connecting, or role → age → email →
 * primer → handoff for mentors) rendered over a stage that never
 * unmounts. This is what makes filmic continuity possible: shared-element transitions
 * are not production-viable on SDK 52 + expo-router, so instead of five route
 * mounts the ambient background (and later the mascot) persist across every step.
 *
 * The step is mirrored into the URL (?step=…, replace semantics) for web refresh and
 * deep links; anything past `age` requires a DOB in the draft (same guard the old
 * connecting route applied), so invalid deep links snap safely back to the start.
 * Browser back exits to the landing rather than stepping — web is best-effort.
 */
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, View } from 'react-native';
import { withTiming } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { CompanionAnimal } from '@/components/art/Companions';
import { AmbientBackground } from '@/components/motion/AmbientBackground';
import { ambientLift } from '@/components/motion/ambientLift';
import { PandaStage } from '@/components/motion/PandaStage';
import { StepTransition } from '@/components/motion/StepTransition';
import { AgeStep } from '@/components/onboarding/steps/AgeStep';
import { CompanionStep } from '@/components/onboarding/steps/CompanionStep';
import { ConnectingStep, type MatchParams } from '@/components/onboarding/steps/ConnectingStep';
import { EmailStep } from '@/components/onboarding/steps/EmailStep';
import { HandoffStep } from '@/components/onboarding/steps/HandoffStep';
import { PrimerStep } from '@/components/onboarding/steps/PrimerStep';
import { ReadyStep } from '@/components/onboarding/steps/ReadyStep';
import { RoleStep } from '@/components/onboarding/steps/RoleStep';
import { haptic } from '@/lib/haptics';
import { useI18n } from '@/lib/i18n';
import { clearDraft, getDraft } from '@/lib/onboardingDraft';
import type { Role } from '@/lib/session';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { duration, easing } from '@/theme/motion';
import { useTheme } from '@/theme/ThemeProvider';
import { space } from '@/theme/tokens';

/** The hard cap on the "found someone" beat — theatre never spends the <30s promise.
 * Paired with ConnectingStep's FOUND_CRESCENDO (~1.1s) so the celebrate + hand-off is
 * a clear, unhurried beat (~2.1s total), not a flicker. */
const FOUND_BEAT_MS = 1000;

type Step = 'role' | 'age' | 'email' | 'companion' | 'ready' | 'connecting' | 'primer' | 'handoff';

/** Two orders, one machine (DECISIONS §K.7). The role step is shared; the mentee
 * branch is byte-identical to the pre-fork journey. */
const MENTEE_ORDER: Step[] = ['role', 'age', 'email', 'companion', 'ready', 'connecting'];
const MENTOR_ORDER: Step[] = ['role', 'age', 'email', 'primer', 'handoff'];
const ALL_STEPS: Step[] = ['role', 'age', 'email', 'companion', 'ready', 'connecting', 'primer', 'handoff'];

/** Steps that show the back chevron. ready / connecting / handoff are forward-only. */
const BACKABLE: Step[] = ['role', 'age', 'email', 'companion', 'primer'];

/** The mockups' "ritual" steps (companion + ready) keep their white-circle chevron
 * styling; the background mood itself is now carried by the ambient aurora. */
const LAVENDER: Step[] = ['companion', 'ready'];

export function OnboardingJourney() {
  const router = useRouter();
  const params = useLocalSearchParams<{ step?: string }>();
  const { colors } = useTheme();
  const { t } = useI18n();
  const reduced = useReducedMotion();
  const [celebrate, setCelebrate] = useState(0);
  // The chosen animal — the star from the moment of choice (DECISIONS §I.5).
  const [companionAnimal, setCompanionAnimal] = useState<CompanionAnimal | null>(
    () => (getDraft().companionAnimal as CompanionAnimal | null) ?? null
  );

  const [role, setRole] = useState<Role>(() => getDraft().role ?? 'mentee');
  const order = role === 'mentor' ? MENTOR_ORDER : MENTEE_ORDER;

  const [step, setStep] = useState<Step>(() => {
    const requested = params.step as Step | undefined;
    if (!requested || !ALL_STEPS.includes(requested) || requested === 'role') return 'role';
    if (requested === 'age') return 'age';
    // Anything past the age gate needs a DOB in the (in-memory) draft; a cold deep
    // link has none, so it snaps to the very first step. It also must belong to
    // the order for the draft's role — a mentee deep-linking into 'handoff' (or
    // vice versa) is not a valid resume point.
    const requestedOrder = (getDraft().role ?? 'mentee') === 'mentor' ? MENTOR_ORDER : MENTEE_ORDER;
    return getDraft().dob && requestedOrder.includes(requested) ? requested : 'role';
  });

  // Mirror the step into the URL — replace semantics, so no history spam / remounts.
  // Skipped on first render: navigating before the root layout mounts throws (the
  // deep-link-guard case), and a cold URL corrects itself at the first step change.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (params.step !== step) router.setParams({ step });
    // reason: params.step is intentionally not a trigger — journey state is the source of truth
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const goNext = useCallback(() => {
    haptic.advance();
    setStep((s) => order[Math.min(order.indexOf(s) + 1, order.length - 1)]);
  }, [order]);

  const goBack = useCallback(() => {
    const i = order.indexOf(step);
    if (i <= 0) router.back();
    else setStep(order[i - 1]);
  }, [step, router, order]);

  // The fork: remember the branch, then advance to the age gate (shared by both).
  const onRolePicked = useCallback((r: Role) => {
    haptic.advance();
    setRole(r);
    setStep('age');
  }, []);

  // Mentor hand-off: the session exists, no match was made — Mentor Home replaces
  // the landing so hardware back never returns to a pre-session screen.
  const onMentorReady = useCallback(() => {
    router.dismissAll();
    router.replace('/mentor-home');
  }, [router]);

  // No mentor free (503 after the honest retries): the session already exists, so
  // the member enters the app on Browse mentors and can send a Personal request.
  // Same stack rebuild as the matched path — hardware back lands on My Chats.
  const onBrowseMentors = useCallback(() => {
    clearDraft();
    router.dismissAll();
    router.replace('/chats');
    router.push('/(tabs)/mentors');
  }, [router]);

  // The matched moment: success haptic, panda celebrates, the sky lifts toward the
  // accent for a hard-capped beat — then the route crossfade carries us into chat.
  const onMatched = useCallback(
    (match: MatchParams) => {
      haptic.success();
      const go = () => {
        // Rebuild the stack so the app's home sits under the chat: pop to the
        // root, replace the landing with the Chats tab, then push the chat.
        // Hardware back from the first chat must land on My Chats — never on
        // the pre-session landing (which would read as a broken flow).
        router.dismissAll();
        router.replace('/chats');
        router.push({
          pathname: '/chat/[id]',
          params: { id: match.id, listener: match.listener, channel: match.channel },
        });
      };
      if (reduced) {
        go();
        return;
      }
      setCelebrate((n) => n + 1);
      ambientLift.value = withTiming(0.3, { duration: duration.gentle, easing: easing.settle });
      setTimeout(() => {
        ambientLift.value = withTiming(0, { duration: duration.slow });
        go();
      }, FOUND_BEAT_MS);
    },
    [router, reduced]
  );

  // Never leave the sky lifted if the journey unmounts mid-beat.
  useEffect(() => () => {
    ambientLift.value = 0;
  }, []);

  // Android hardware back steps backward through the journey (old behaviour: it
  // popped the previous route); on the first step it pops to the landing as usual.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      const i = order.indexOf(step);
      if (i <= 0) return false;
      setStep(order[i - 1]);
      return true;
    });
    return () => sub.remove();
  }, [step, order]);

  const renderStep = useCallback(
    (key: Step) => {
      switch (key) {
        case 'role':
          return <RoleStep onPick={onRolePicked} />;
        case 'age':
          return <AgeStep onNext={goNext} />;
        case 'email':
          return <EmailStep onNext={goNext} />;
        case 'companion':
          return <CompanionStep onNext={goNext} onAnimalPicked={setCompanionAnimal} />;
        case 'ready':
          return <ReadyStep onNext={goNext} />;
        case 'connecting':
          return (
            <ConnectingStep
              active={key === step}
              onInvalidDraft={() => setStep('role')}
              onMatched={onMatched}
              onBrowseMentors={onBrowseMentors}
            />
          );
        case 'primer':
          return <PrimerStep onNext={goNext} />;
        case 'handoff':
          return (
            <HandoffStep
              active={key === step}
              onInvalidDraft={() => setStep('role')}
              onDone={onMentorReady}
            />
          );
      }
    },
    [goNext, step, onMatched, onRolePicked, onMentorReady]
  );

  const lavender = LAVENDER.includes(step);
  const backable = BACKABLE.includes(step);

  return (
    <View style={styles.root}>
      {/* The persistent sky — never unmounts across steps. */}
      <AmbientBackground />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.header}>
          {backable ? (
            <Pressable
              onPress={goBack}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={t('common.goBack')}
              testID="back"
              // Ritual screens float the chevron in a white circle (mockup #58).
              style={lavender && [styles.backCircle, { backgroundColor: colors.surface }]}
            >
              <Ionicons name="chevron-back" size={26} color={lavender ? colors.accent : colors.ink} />
            </Pressable>
          ) : null}
        </View>
        <View style={styles.stage}>
          <StepTransition activeKey={step} render={renderStep} />
        </View>
        {/* The guide mascot — mounted once, glides between per-step anchors. */}
        <PandaStage step={step} celebrate={celebrate} animal={companionAnimal} />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1, backgroundColor: 'transparent' },
  header: {
    minHeight: 44 + space.sm + space.xs,
    paddingHorizontal: space.md,
    paddingTop: space.sm,
    paddingBottom: space.xs,
    justifyContent: 'center',
  },
  backCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  stage: { flex: 1 },
});
