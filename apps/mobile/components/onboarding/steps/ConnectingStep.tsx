import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { EdgeSurface } from '@/components/EdgeSurface';
import { PrimaryButton } from '@/components/PrimaryButton';
import { PromiseRow } from '@/components/PromiseRow';
import type { CompanionAnimal } from '@/components/art/Companions';
import { Entrance } from '@/components/motion/Entrance';
import { SwapFade } from '@/components/motion/SwapFade';
import { ConnectOrbs } from '@/components/onboarding/ConnectOrbs';
import { StepScaffold } from '@/components/onboarding/StepScaffold';
import { capture, waitBucket } from '@/lib/analytics';
import { ApiError, api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { clearDraft, getDraft } from '@/lib/onboardingDraft';
import { getCompanionAnimal, getPersona, getSessionToken, saveCompanionAnimal, saveSession } from '@/lib/session';
import { useFrameSize } from '@/lib/useFrameSize';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { COMPANION_COLORS } from '@/theme/companion';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type, wash } from '@/theme/tokens';

// --- choreography cadences (intervals, not animation durations — those come from
// motion tokens). Tuned to the calm register; every fade below uses the tokens. ---
/** The story never cuts before one graceful beat, even when the API is instant. */
const MIN_STORY_BEAT_MS = 2200;
/** Busy retry cadence + attempts: ~24s of honest patience before asking for help. */
const RETRY_DELAY_MS = 8000;
const MAX_RETRIES = 3;
/** The found crescendo plays before the journey's own celebrate beat. Held long
 * enough (with the journey's FOUND_BEAT ≈ 2.1s total) that "we found your listener"
 * reads as one deliberate moment — never a sub-second flash into chat. */
const FOUND_CRESCENDO_MS = 1100;

export type MatchParams = { id: string; listener: string; channel: string };

type Phase = 'searching' | 'busy' | 'found' | 'error';

/** Matching step — board A19 + T03: the member's companion in an orb on the left, an empty
 * breathing orb on the right, five dots lighting in turn, "Finding a mentor who is free to
 * talk" and two quiet cards for the wait. On a match the right orb fills with the mentor's
 * persona avatar, the orbs drift together and "<Persona> is here with you" arrives — then
 * the journey's own hand-off carries us into the chat. Honest busy retries and the error
 * exits are unchanged. The onboarding + match API flow is unchanged; it fires when the step
 * becomes ACTIVE. Navigation belongs to the journey (the matched-moment beat). */
export function ConnectingStep({
  active,
  onInvalidDraft,
  onMatched,
  onBrowseMentors,
}: {
  active: boolean;
  onInvalidDraft: () => void;
  onMatched: (params: MatchParams) => void;
  /** No mentor free right now: the session exists, so let them in to browse
   * mentors and send a Personal request instead of a dead-end retry. */
  onBrowseMentors: () => void;
}) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const { width } = useFrameSize();
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState<Phase>('searching');
  const [hasSession, setHasSession] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [foundName, setFoundName] = useState<string | null>(null);
  // The member's own persona + companion, for the left orb (known once the account exists).
  const [memberName, setMemberName] = useState<string | null>(null);
  const [animal, setAnimal] = useState<CompanionAnimal | null>(
    () => (getDraft().companionAnimal as CompanionAnimal | null) ?? null
  );
  // The mentor's public line, if they wrote one — best-effort, only ever adds to the beat.
  const [mentorLine, setMentorLine] = useState<string | null>(null);
  // "Open the chat" and the timed hand-off share one latch: whichever comes first wins.
  const handOffRef = useRef<(() => void) | null>(null);
  // The member left for Browse mentors while a retry was pending — ignore what follows.
  const leftRef = useRef(false);
  const startedRef = useRef(false);
  const activeAtRef = useRef(0);
  const retriesRef = useRef(0);
  // Onboard-once latch: retries must never mint another anonymous account — the
  // session from a previous attempt is reused and only the match call re-runs.
  const onboardedRef = useRef(false);
  // One funnel event per journey — busy retries must not inflate the count.
  const matchRequestedRef = useRef(false);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const later = useCallback((fn: () => void, ms: number) => {
    const t = setTimeout(fn, ms);
    timersRef.current.push(t);
    return t;
  }, []);
  useEffect(() => () => timersRef.current.forEach(clearTimeout), []);

  // A returning account (mentor → talk) already has a persona and maybe a companion.
  useEffect(() => {
    let alive = true;
    void getPersona().then((p) => {
      if (alive && p) setMemberName((n) => n ?? p.persona_name);
    });
    void getCompanionAnimal().then((a) => {
      if (alive && a) setAnimal((cur) => cur ?? (a as CompanionAnimal));
    });
    return () => {
      alive = false;
    };
  }, []);

  const leaveToBrowse = useCallback(() => {
    leftRef.current = true;
    timersRef.current.forEach(clearTimeout);
    onBrowseMentors();
  }, [onBrowseMentors]);

  const connect = useCallback(async () => {
    setError(null);
    setPhase('searching');
    const draft = getDraft();
    if (!draft.dob && !draft.sessionBacked) {
      onInvalidDraft();
      return;
    }
    try {
      // Onboard exactly once. A session lingering from a previous attempt (or an
      // earlier retry in this run) is reused — only the match is retried.
      if (!onboardedRef.current && !(await getSessionToken())) {
        // No account yet and no DOB to make one with (a session-backed draft whose
        // session vanished): start over rather than mint an account without an age gate.
        if (!draft.dob) {
          onInvalidDraft();
          return;
        }
        const onboarding = await api.startOnboarding({
          dob: draft.dob,
          email: draft.email ?? null,
          companion_animal: draft.companionAnimal ?? null,
          companion_colour: draft.companionColour ?? null,
        });
        await saveSession(onboarding.session_token, onboarding.stream_token, onboarding.user);
        setMemberName(onboarding.user.persona_name);
        if (draft.companionAnimal) await saveCompanionAnimal(draft.companionAnimal);
        capture('onboarding_completed');
      } else if (draft.sessionBacked && draft.companionAnimal) {
        // Existing account (mentor → talk): nothing to mint, but the pick still has to stick.
        await saveCompanionAnimal(draft.companionAnimal);
        // …on the ACCOUNT too, not just this device (a new account carries it in
        // /onboarding/start; an existing one needs the PUT). Best-effort: a failure
        // never blocks the way to a mentor and shows nothing — the device copy stands.
        void api
          .saveCompanion({
            companion_animal: draft.companionAnimal,
            ...(draft.companionColour ? { companion_colour: draft.companionColour } : {}),
          })
          .catch(() => {
            /* reason: best-effort sync; the next companion/colour change retries */
          });
      }
      onboardedRef.current = true;
      setHasSession(true);
      if (leftRef.current) return;
      void getPersona().then((p) => {
        if (p) setMemberName((n) => n ?? p.persona_name);
      });

      if (!matchRequestedRef.current) {
        matchRequestedRef.current = true;
        capture('match_requested', { mode: 'general' });
      }
      const match = await api.match({ kind: 'general' });
      // The user's real wait (since the step went active), bucketed — never raw ms.
      capture('match_found', { wait_bucket: waitBucket(Date.now() - activeAtRef.current) });
      clearDraft();
      if (!reduced) {
        // The mentor's own line, if there is one and it arrives inside the beat.
        void api
          .mentorProfile(match.conversation_id)
          .then((m) => setMentorLine(m.public_line?.trim() || null))
          .catch(() => {
            /* reason: decorative — the found beat is complete without it */
          });
      }
      const finish = () => {
        setFoundName(match.listener_persona_name);
        setPhase('found');
        let handed = false;
        const handOff = () => {
          if (handed) return;
          handed = true;
          onMatched({
            id: match.conversation_id,
            listener: match.listener_persona_name,
            channel: match.stream_channel_id ?? '',
          });
        };
        handOffRef.current = handOff;
        // Crescendo: the orbs meet + the persona arrives, THEN the journey's celebrate
        // beat (haptic, sky lift) carries us into the chat.
        later(handOff, reduced ? 0 : FOUND_CRESCENDO_MS);
      };
      // Never cut the story mid-breath — pad to one graceful beat (skipped when
      // the user asked for reduced motion: their time wins over our theatre).
      const elapsed = Date.now() - activeAtRef.current;
      if (!reduced && elapsed < MIN_STORY_BEAT_MS) later(finish, MIN_STORY_BEAT_MS - elapsed);
      else finish();
    } catch (e) {
      if (e instanceof ApiError && e.status === 503 && retriesRef.current < MAX_RETRIES) {
        // Busy is not broken: stay honest, keep their place, retry quietly.
        retriesRef.current += 1;
        setPhase('busy');
        later(() => void connect(), RETRY_DELAY_MS);
        return;
      }
      const msg =
        e instanceof ApiError
          ? e.status === 503
            ? t('connecting.errorBusy')
            : e.message
          : t('common.networkError');
      setError(msg);
      setPhase('error');
    }
  }, [onInvalidDraft, onMatched, later, reduced, t]);

  useEffect(() => {
    if (active && !startedRef.current) {
      startedRef.current = true;
      activeAtRef.current = Date.now();
      void connect();
    }
  }, [active, connect]);

  const found = phase === 'found' && foundName !== null;
  const waiting = phase === 'searching' || phase === 'busy';
  const me = memberName ?? '';

  // Headline: a quiet sentence with one word in the accent (board A19).
  const headline =
    phase === 'found' && foundName ? (
      <>
        {t('connecting.foundA', { name: foundName })}
        <Text style={{ color: colors.accent }}>{t('connecting.foundAccent')}</Text>
        {t('connecting.foundB')}
      </>
    ) : phase === 'error' ? (
      t('connecting.headlineError')
    ) : phase === 'busy' ? (
      t('connecting.headlineBusy')
    ) : (
      <>
        {t('connecting.findingA')}
        <Text style={{ color: colors.accent }}>{t('connecting.findingAccent')}</Text>
        {t('connecting.findingB')}
      </>
    );

  const subline =
    phase === 'found'
      ? t('connecting.subFound')
      : phase === 'error'
        ? (error ?? '')
        : phase === 'busy'
          ? t('connecting.subBusy')
          : t('connecting.subFinding');

  return (
    <StepScaffold
      // An error's keys are simply there, still (T&S #11); the other footers arrive last.
      footerIndex={phase === 'error' ? undefined : 4}
      footer={
        phase === 'error' ? (
          <View style={styles.footerStack}>
            <PrimaryButton
              label={t('connecting.tryAgain')}
              shape="key"
              onPress={() => {
                retriesRef.current = 0;
                void connect();
              }}
              testID="retry"
            />
            {hasSession ? (
              <PrimaryButton
                variant="surface"
                shape="key"
                label={t('connecting.browseMentors')}
                onPress={onBrowseMentors}
                testID="browse-mentors"
              />
            ) : null}
          </View>
        ) : found ? (
          <PrimaryButton
            label={t('connecting.openChat')}
            shape="key"
            trailing="arrow"
            onPress={() => handOffRef.current?.()}
            testID="open-chat"
          />
        ) : phase === 'busy' && hasSession ? (
          // Nobody free right now: the account exists, so the question can go to a chosen
          // mentor instead. Offered only between retries — never while a match is in flight.
          <Pressable
            onPress={leaveToBrowse}
            accessibilityRole="link"
            accessibilityLabel={`${t('connecting.nobodyFree')} ${t('connecting.sendInstead')}`}
            testID="send-question"
            style={styles.exitLink}
          >
            <Text style={[type.note, { color: colors.inkMuted }]}>{t('connecting.nobodyFree')}</Text>
            <Text style={[type.label, styles.underline, { color: colors.ink }]}>{t('connecting.sendInstead')}</Text>
          </Pressable>
        ) : undefined
      }
    >
      <Entrance index={0}>
        <SwapFade swapKey={phase === 'found' ? `found:${foundName}` : phase} style={styles.head}>
          <Text style={[type.displayHeadline, { color: colors.ink }]} accessibilityRole="header">
            {headline}
          </Text>
          <Text style={[type.body, { color: colors.inkMuted }]}>{subline}</Text>
        </SwapFade>
      </Entrance>

      {/* The orbs have no arrival and never leave — they only move closer. */}
      <ConnectOrbs
        width={width - space.lg * 2}
        animal={animal}
        memberName={memberName}
        mentorName={found ? foundName : null}
        still={phase === 'error'}
      />

      {phase === 'error' ? null : (
        <Entrance index={2}>
          <SwapFade swapKey={found ? 'found' : 'waiting'}>
            {found ? (
              <View style={styles.foundBlock} testID="found-card">
                <View style={[styles.connected, { backgroundColor: wash.green }]}>
                  <Ionicons name="checkmark" size={16} color={COMPANION_COLORS.sage.accentEdge} />
                  <Text style={[type.caption, styles.connectedText, { color: COMPANION_COLORS.sage.accentEdge }]}>
                    {t('connecting.connectedPill')}
                  </Text>
                </View>
                {/* The mentor's own line, when they have written one (board A19). */}
                {mentorLine ? (
                  <EdgeSurface
                    edge={colors.edgeSurface}
                    travel={3}
                    radius={radius.lg}
                    containerStyle={styles.lineCardBox}
                    style={[styles.lineCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
                  >
                    <Text style={[styles.lineCaption, { color: colors.inkMuted }]}>
                      {t('connecting.lineTitle', { name: foundName ?? '' })}
                    </Text>
                    <Text style={[type.body, { color: colors.ink }]}>{`“${mentorLine}”`}</Text>
                  </EdgeSurface>
                ) : null}
              </View>
            ) : waiting ? (
              <View style={styles.waitBlock}>
                <Text style={[type.label, { color: colors.inkMuted }]}>{t('connecting.waitTitle')}</Text>
                <EdgeSurface
                  edge={colors.edgeSurface}
                  travel={3}
                  radius={radius.lg}
                  style={[styles.waitCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
                >
                  <PromiseRow
                    icon="chatbubble-outline"
                    tone="orange"
                    title={t('connecting.card2Title')}
                    body={t('connecting.card2Body')}
                  />
                </EdgeSurface>
                <EdgeSurface
                  edge={colors.edgeSurface}
                  travel={3}
                  radius={radius.lg}
                  style={[styles.waitCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
                >
                  <PromiseRow
                    icon="lock-closed-outline"
                    tone="indigo"
                    title={t('connecting.cardPrivateTitle')}
                    body={me ? t('connecting.cardPrivateBody', { name: me }) : t('connecting.cardPrivateBodyNoName')}
                  />
                </EdgeSurface>
              </View>
            ) : null}
          </SwapFade>
        </Entrance>
      )}
    </StepScaffold>
  );
}

const styles = StyleSheet.create({
  footerStack: { gap: space.sm },
  // Tall enough for the longest headline + sub, so the orbs never jump between phases.
  head: { gap: space.sm, minHeight: 136 },
  waitBlock: { gap: 12, marginTop: space.sm },
  waitCard: { paddingVertical: 12, paddingHorizontal: 14, borderWidth: 1 },
  foundBlock: { alignItems: 'center', gap: 14, marginTop: space.sm },
  connected: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 36,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
  },
  connectedText: { fontFamily: font.sansBold },
  lineCardBox: { alignSelf: 'stretch' },
  lineCard: { paddingVertical: 14, paddingHorizontal: space.md, gap: space.xs, borderWidth: 1 },
  lineCaption: {
    fontFamily: font.sansBold,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  exitLink: { minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingVertical: space.xs },
  underline: { textDecorationLine: 'underline' },
});
