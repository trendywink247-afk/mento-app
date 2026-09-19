import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ApplicationForm } from '@/components/ApplicationForm';
import { EdgeSurface } from '@/components/EdgeSurface';
import { PrimaryButton } from '@/components/PrimaryButton';
import type { CompanionAnimal } from '@/components/art/Companions';
import { ApplicationStatusCard } from '@/components/mentor/ApplicationStatusCard';
import { MentorPageHeader } from '@/components/mentor/MentorPageHeader';
import { AgeGateStep } from '@/components/mentorPath/AgeGateStep';
import { StoryStep } from '@/components/mentorPath/StoryStep';
import { AmbientBackground } from '@/components/motion/AmbientBackground';
import { Entrance } from '@/components/motion/Entrance';
import { SageSky } from '@/components/motion/SageSky';
import { StepTransition } from '@/components/motion/StepTransition';
import { JourneyHeader } from '@/components/onboarding/JourneyHeader';
import { PrimerStep } from '@/components/onboarding/steps/PrimerStep';
import { api, type ListenerApplication } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { listenerApi } from '@/lib/listenerApi';
import { getListenerToken, saveListenerToken } from '@/lib/listenerSession';
import {
  canReapply,
  continueAsMember,
  firstStep,
  nextStep,
  previousStep,
  reapplyAt,
  stateOf,
  useMentorPath,
  type MentorPathStep,
} from '@/lib/mentorPath';
import { getCompanionAnimal, getSessionToken, saveRole } from '@/lib/session';
import { useTheme } from '@/theme/ThemeProvider';
import { space, type } from '@/theme/tokens';

const ORDER: MentorPathStep[] = ['story', 'age', 'primer', 'form', 'status'];

/** Today's rotating name for an approved member: the console credential carries it (the
 * same mint Mentor Home makes), or `GET /listener/me` when a token is already here. */
async function todaysName(): Promise<string | null> {
  try {
    if (await getListenerToken()) return (await listenerApi.me()).persona_name;
    const cs = await api.consoleSession();
    await saveListenerToken(cs.listener_token);
    return cs.persona_name;
  } catch {
    return null;
  }
}

/** "19 October" / "19 अक्टूबर" — the day the server's cooldown ends. */
function dayLabel(at: Date, locale: string): string {
  try {
    return at.toLocaleDateString(locale === 'hi' ? 'hi-IN' : 'en-IN', { day: 'numeric', month: 'long' });
  } catch {
    return at.toDateString();
  }
}

/**
 * The ONE mentor path (founder 2026-09-19; DECISIONS §L.12) — every mentor door lands here
 * unless the member is already approved (`lib/mentorPath.openMentorSide` sends them to Mentor
 * Home). What shows is the SERVER's application state:
 *
 *   none     → story (A38) → [age gate: a visitor with no session only] → primer (A33)
 *              → the application (A37) → In review
 *   review   → In review (A37) — "already applied"
 *   declined → the calm note + when they may apply again → the application once allowed
 *   approved → Approved (A37) with the way into Mentor Home
 *
 * `surface="public"` is the web page `/apply` (no app, maybe no session: the wordmark heads
 * the story, no animal art anywhere); `surface="member"` is inside the app (Profile's row, the
 * role fork's mentor branch, Mentor Home for someone not approved yet, an old link).
 * One persistent sky across the steps; steps hand over like the onboarding journey.
 */
export function MentorPathFlow({ surface }: { surface: 'public' | 'member' }) {
  const router = useRouter();
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  // undefined = still looking; the public page may have no session at all.
  const [hasSession, setHasSession] = useState<boolean | undefined>(undefined);
  const path = useMentorPath(hasSession === true);
  const [step, setStep] = useState<MentorPathStep | null>(null);
  const [animal, setAnimal] = useState<CompanionAnimal | null>(null);
  const [persona, setPersona] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const bare = surface === 'public';

  useEffect(() => {
    let live = true;
    void getSessionToken().then((tok) => {
      if (live) setHasSession(Boolean(tok));
    });
    void getCompanionAnimal()
      .then((a) => {
        if (live) setAnimal((a as CompanionAnimal | null) ?? null);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  // Where the door lands: decided once, from the server's state (or "none" for a visitor
  // with no session — there is nothing on file to ask about).
  const known = hasSession === false ? null : path.application;
  const knownState = hasSession === false ? 'none' : path.state;
  // Already approved when a door opened this (an old link, a reload, the role fork with a
  // reused session): the door leads to the mentor side itself — no form, no primer. An
  // approval that arrives while the status is on screen shows A37's "Approved" instead.
  const forwarded = useRef(false);
  useEffect(() => {
    if (step !== null || knownState === undefined) return;
    if (knownState === 'approved') {
      if (!forwarded.current) {
        forwarded.current = true;
        void saveRole('mentor').then(() => router.dismissTo('/mentor-home'));
      }
      return;
    }
    setStep(firstStep(knownState));
  }, [knownState, step, router]);

  // Which way the flow last moved — the hand-over plays in reverse going back (board T02).
  const lastIndex = useRef(step ? ORDER.indexOf(step) : 0);
  const direction = useRef<'forward' | 'back'>('forward');
  if (step) {
    const i = ORDER.indexOf(step);
    if (i !== lastIndex.current) {
      direction.current = i < lastIndex.current ? 'back' : 'forward';
      lastIndex.current = i;
    }
  }

  const status = known ? stateOf(known) : 'none';
  useEffect(() => {
    if (status !== 'approved' || bare) return;
    let live = true;
    void todaysName().then((name) => {
      if (live) setPersona(name);
    });
    return () => {
      live = false;
    };
  }, [status, bare]);

  /** Out of the loop, back to the member side: the screen behind when there is one
   * (Profile), otherwise the member sign-up continues with only what is missing. */
  const toMemberSide = useCallback(async () => {
    if (leaving) return;
    if (router.canGoBack()) {
      router.back();
      return;
    }
    setLeaving(true);
    try {
      await continueAsMember(router);
    } finally {
      setLeaving(false);
    }
  }, [leaving, router]);
  const backLabel = router.canGoBack() ? t('mentorApply.backToProfile') : t('mentorHome.switchTalk');

  const goBack = useCallback(
    (from: MentorPathStep) => {
      const prev = previousStep(from);
      if (prev) setStep(prev);
      else if (surface === 'public') setStep('story');
      else void toMemberSide();
    },
    [surface, toMemberSide],
  );

  const openHome = useCallback(async () => {
    // The device becomes a mentor's; Mentor Home is popped to if it is beneath, else opens
    // here (lib/leaveToChats rule — never a second Mentor Home).
    await saveRole('mentor');
    router.dismissTo('/mentor-home');
  }, [router]);

  const onSubmitted = useCallback(
    (result: ListenerApplication) => {
      path.setApplication(result);
      setStep('status');
    },
    [path],
  );

  const renderStatus = () => {
    if (!known) return null;
    const s = stateOf(known);
    if (s === 'declined') {
      const at = reapplyAt(known);
      const now = canReapply(known);
      return (
        <View style={styles.body}>
          <ApplicationStatusCard state="declined" application={known} animal={animal} bare={bare} />
          <Entrance index={1}>
            <Text style={[type.body, { color: colors.inkMuted }]} testID="mentor-path-cooldown">
              {now || !at ? t('mentorPath.cooldownNow') : t('mentorPath.cooldownLater', { date: dayLabel(at, locale) })}
            </Text>
          </Entrance>
          {now ? (
            <Entrance index={2}>
              <PrimaryButton
                label={t('mentorPath.applyAgain')}
                shape="key"
                trailing="arrow"
                onPress={() => setStep('form')}
                testID="mentor-path-reapply"
              />
            </Entrance>
          ) : null}
          {bare ? null : (
            <PrimaryButton label={backLabel} variant="link" onPress={() => void toMemberSide()} loading={leaving} testID="apply-back-profile" />
          )}
        </View>
      );
    }
    return (
      <ApplicationStatusCard
        state={s === 'approved' ? 'approved' : 'review'}
        application={known}
        animal={animal}
        persona={persona}
        bare={bare}
        onRead={bare ? undefined : () => router.push('/mentor/reading')}
        onBackToProfile={bare ? undefined : () => void toMemberSide()}
        backLabel={backLabel}
        onOpenHome={() => void openHome()}
      />
    );
  };

  const renderStep = (key: MentorPathStep) => {
    switch (key) {
      case 'story':
        return (
          <StoryStep
            surface={surface}
            onBack={surface === 'member' ? () => void toMemberSide() : undefined}
            // Someone with an application on file never re-applies from the story.
            onApply={() => setStep(status !== 'none' ? 'status' : nextStep('story', hasSession === true))}
          />
        );
      case 'age':
        return (
          <AgeGateStep
            onBack={() => goBack('age')}
            onPassed={() => {
              setHasSession(true);
              setStep('primer');
            }}
          />
        );
      case 'primer':
        return (
          <View style={styles.fill}>
            <View style={styles.primerHead}>
              <JourneyHeader onBack={() => goBack('primer')} />
            </View>
            <View style={styles.fill}>
              <PrimerStep onNext={() => setStep('form')} animal={animal} companion={!bare} />
            </View>
          </View>
        );
      case 'form':
        return (
          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.content}
          >
            <MentorPageHeader eyebrow={t('mentorApply.eyebrow')} title={t('mentorApply.title')} onBack={() => goBack('form')} />
            <ApplicationForm onSuccess={onSubmitted} />
          </ScrollView>
        );
      case 'status':
        return (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
            <MentorPageHeader
              eyebrow={t('mentorApply.eyebrow')}
              title={t('mentorApply.title')}
              onBack={() => goBack('status')}
            />
            {renderStatus()}
          </ScrollView>
        );
    }
  };

  const loading = step === null;
  const loadFailed = loading && path.failed && hasSession === true;
  const sage = step === 'form' || step === 'status';

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]} testID="mentor-path">
      {/* One sky for the whole loop (A38's landing sky); the mentor pages' sage wash over it. */}
      <AmbientBackground />
      <SageSky on={sage} shape="top" />
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        {loadFailed ? (
          <View style={styles.content}>
            <EdgeSurface edge={colors.edgeSurface} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]} testID="mentor-path-error">
              <Text style={[type.body, { color: colors.ink }]}>{t('mentorPath.loadError')}</Text>
            </EdgeSurface>
            <PrimaryButton label={t('connecting.tryAgain')} variant="ghost" onPress={() => void path.refresh()} testID="mentor-path-retry" />
          </View>
        ) : loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : (
          <View style={styles.fill}>
            <StepTransition activeKey={step ?? 'story'} render={renderStep} direction={direction.current} />
          </View>
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  fill: { flex: 1 },
  primerHead: { paddingTop: space.sm },
  content: { flexGrow: 1, paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.lg, gap: 12 },
  body: { gap: 14 },
  card: { padding: space.md, borderWidth: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
