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
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';
import { withTiming } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import type { CompanionAnimal } from '@/components/art/Companions';
import { AmbientBackground } from '@/components/motion/AmbientBackground';
import { Entrance } from '@/components/motion/Entrance';
import { ambientLift } from '@/components/motion/ambientLift';
import { PandaStage } from '@/components/motion/PandaStage';
import { JourneyHeader } from '@/components/onboarding/JourneyHeader';
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
import { clearDraft, getDraft } from '@/lib/onboardingDraft';
import { saveRole, type Role } from '@/lib/session';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { duration, easing, forkArrival } from '@/theme/motion';
import { space } from '@/theme/tokens';

/** The hard cap on the "found someone" beat — theatre never spends the <30s promise.
 * Paired with ConnectingStep's FOUND_CRESCENDO (~1.4s) so the celebrate + hand-off is
 * a clear, unhurried beat (~2.4s total), not a flicker. */
const FOUND_BEAT_MS = 1000;

type Step = 'role' | 'age' | 'email' | 'companion' | 'ready' | 'connecting' | 'primer' | 'handoff';

/** Two orders, one machine (DECISIONS §K.7). The role step is shared; the mentee
 * branch is byte-identical to the pre-fork journey. */
const MENTEE_ORDER: Step[] = ['role', 'age', 'email', 'companion', 'ready', 'connecting'];
const MENTOR_ORDER: Step[] = ['role', 'age', 'email', 'primer', 'handoff'];
const ALL_STEPS: Step[] = ['role', 'age', 'email', 'companion', 'ready', 'connecting', 'primer', 'handoff'];

/** Steps that show the back key. connecting / handoff are forward-only; `ready` shows it
 * (board A18) — hardware back already stepped from ready to the pick. */
const BACKABLE: Step[] = ['role', 'age', 'email', 'companion', 'ready', 'primer'];

/** The step dots (board A16–A18, A33–A34). A member's four steps start after the fork;
 * the mentor board counts the fork too ("Step 4 of 5" on the primer). The fork itself and
 * the connecting step show no dots. */
const MENTEE_DOTS: Step[] = ['age', 'email', 'companion', 'ready'];
const MENTOR_DOTS: Step[] = ['role', 'age', 'email', 'primer', 'handoff'];

/** The board's 44 of air above the header doubles as the status-bar allowance. */
const HEADER_TOP = 44;

export function OnboardingJourney() {
  const router = useRouter();
  const params = useLocalSearchParams<{ step?: string }>();
  const insets = useSafeAreaInsets();
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
    const pastAgeGate = Boolean(getDraft().dob) || Boolean(getDraft().sessionBacked);
    return pastAgeGate && requestedOrder.includes(requested) ? requested : 'role';
  });

  // Which way the flow last moved — the hand-over plays in reverse going back (board T02).
  const lastIndex = useRef(order.indexOf(step));
  const direction = useRef<'forward' | 'back'>('forward');
  const stepIndex = order.indexOf(step);
  if (stepIndex !== lastIndex.current) {
    direction.current = stepIndex < lastIndex.current ? 'back' : 'forward';
    lastIndex.current = stepIndex;
  }

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

  // One press, one haptic: the key that calls this already fired its own on press-in
  // (PressKey intent) — a second one here made every Continue buzz twice.
  const goNext = useCallback(() => {
    // A mentor switching to talk becomes a mentee the moment they confirm a companion.
    if (getDraft().sessionBacked && step === 'companion') void saveRole('mentee');
    setStep((s) => order[Math.min(order.indexOf(s) + 1, order.length - 1)]);
  }, [order, step]);

  const goBack = useCallback(() => {
    // Session-backed resume: there is no email/age step behind the pick — back means
    // "never mind", and they are still a mentor.
    if (getDraft().sessionBacked && step === 'companion') {
      clearDraft();
      router.replace('/mentor-home');
      return;
    }
    const i = order.indexOf(step);
    if (i <= 0) router.back();
    else setStep(order[i - 1]);
  }, [step, router, order]);

  // The fork: remember the branch, then advance to the age gate (shared by both).
  const onRolePicked = useCallback((r: Role) => {
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
    router.push('/mentors');
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

  const backable = BACKABLE.includes(step);
  const dots = role === 'mentor' ? MENTOR_DOTS : MENTEE_DOTS;
  const dotIndex = step === 'role' ? -1 : dots.indexOf(step);

  return (
    <View style={styles.root}>
      {/* The persistent sky — never unmounts across steps. */}
      <AmbientBackground />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={{ paddingTop: Math.max(insets.top + space.sm, HEADER_TOP) - insets.top }}>
          {/* The header arrives once, with the fork (board T01: the back key eases up from
            * 0.9 as the doors rise) — after that it is simply there from step to step. */}
          <Entrance from="none" delay={forkArrival.backKey} scaleFrom={0.9} duration={duration.base}>
            <JourneyHeader
              onBack={backable ? goBack : undefined}
              progress={dotIndex >= 0 ? { index: dotIndex + 1, total: dots.length } : undefined}
            />
          </Entrance>
        </View>
        <View style={styles.stage}>
          <StepTransition activeKey={step} render={renderStep} direction={direction.current} />
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
  stage: { flex: 1 },
});
