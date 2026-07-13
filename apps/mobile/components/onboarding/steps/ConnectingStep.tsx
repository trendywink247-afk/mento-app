import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { IconBadge } from '@/components/IconBadge';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Entrance } from '@/components/motion/Entrance';
import {
  ConnectionConstellation,
  type ConstellationState,
} from '@/components/motion/ConnectionConstellation';
import { StepScaffold } from '@/components/onboarding/StepScaffold';
import { ApiError, api } from '@/lib/api';
import { clearDraft, getDraft } from '@/lib/onboardingDraft';
import { saveCompanionAnimal, saveSession } from '@/lib/session';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { breathe, duration, easing } from '@/theme/motion';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type } from '@/theme/tokens';

// --- choreography cadences (intervals, not animation durations — those come from
// motion tokens). Tuned to the calm register; every fade below uses the tokens. ---
/** The story never cuts before one graceful beat, even when the API is instant. */
const MIN_STORY_BEAT_MS = 2200;
/** Searching copy rotates at a read-comfortable pace. */
const COPY_ROTATE_MS = 3400;
/** Cards auto-advance slower than copy — they're the deeper read. */
const CARD_ADVANCE_MS = 4200;
/** Breathe-with-me fades in only when the wait is real. */
const BREATHE_AFTER_MS = 6000;
/** Busy retry cadence + attempts: ~24s of honest patience before asking for help. */
const RETRY_DELAY_MS = 8000;
const MAX_RETRIES = 3;
/** The found crescendo plays before the journey's own celebrate beat. */
const FOUND_CRESCENDO_MS = 700;

const SEARCH_LINES = [
  'Reaching out to our listeners…',
  'A few kind people are nearby…',
  'Finding someone right for this moment…',
];

type Card = { icon: keyof typeof Ionicons.glyphMap; title: string; body: string };

/** Safety guidelines (mockup #5) interleaved with conversation warm-ups — the
 * founder's ruling: "they won't know how to ask — give them sample questions." */
const CARDS: Card[] = [
  { icon: 'shield-checkmark-outline', title: 'This is a safe place', body: "We're here to listen and support, without judgment." },
  { icon: 'chatbubble-outline', title: 'Not sure how to start?', body: '"Today felt heavy" is more than enough for a first message.' },
  { icon: 'lock-closed-outline', title: "Don't share personal information", body: 'Keep your identity and details private.' },
  { icon: 'compass-outline', title: 'You set the pace', body: 'Ask for advice, or just be heard — both are welcome here.' },
  { icon: 'person-outline', title: 'Reflect for better understanding', body: 'Use this space to reflect and grow.' },
  { icon: 'happy-outline', title: "You're anonymous. So are they.", body: 'Just two people, personas on, walls down.' },
  { icon: 'heart-outline', title: 'Be yourself', body: 'Honesty helps build meaningful conversations.' },
  { icon: 'people-outline', title: 'Respect each other', body: "Let's create a kind and respectful space together." },
];

export type MatchParams = { id: string; listener: string; channel: string };

type Phase = 'searching' | 'busy' | 'found' | 'error';

/** Crossfading single line — manual shared values (never `entering=`), reduced = hard swap. */
function CrossfadeLine({ text, style }: { text: string; style: object }) {
  const reduced = useReducedMotion();
  const opacity = useSharedValue(1);
  const [shown, setShown] = useState(text);
  const pending = useRef(text);

  useEffect(() => {
    if (text === pending.current && shown === text) return;
    pending.current = text;
    if (reduced) {
      setShown(text);
      return;
    }
    opacity.value = withTiming(0, { duration: duration.fast, easing: easing.exit });
    const t = setTimeout(() => {
      setShown(pending.current);
      opacity.value = withTiming(1, { duration: duration.base, easing: easing.enter });
    }, duration.fast);
    return () => clearTimeout(t);
    // reason: `shown` is the crossfade's own state, not a trigger
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, reduced]);

  const anim = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View style={anim}>
      <Text style={style}>{shown}</Text>
    </Animated.View>
  );
}

/** Matching step — the wait is a story: a searching constellation, staged copy,
 * warm-up cards, breathe-with-me on real waits, honest busy retries, and a found
 * crescendo. The onboarding + match API flow is unchanged; it fires when the step
 * becomes ACTIVE. Navigation belongs to the journey (the matched-moment beat). */
export function ConnectingStep({
  active,
  onInvalidDraft,
  onMatched,
}: {
  active: boolean;
  onInvalidDraft: () => void;
  onMatched: (params: MatchParams) => void;
}) {
  const { colors, elevation } = useTheme();
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState<Phase>('searching');
  const [error, setError] = useState<string | null>(null);
  const [foundName, setFoundName] = useState<string | null>(null);
  const [line, setLine] = useState(0);
  const [card, setCard] = useState(0);
  const [breathing, setBreathing] = useState(false);
  const [breathIn, setBreathIn] = useState(true);
  const startedRef = useRef(false);
  const activeAtRef = useRef(0);
  const retriesRef = useRef(0);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const later = useCallback((fn: () => void, ms: number) => {
    const t = setTimeout(fn, ms);
    timersRef.current.push(t);
    return t;
  }, []);
  useEffect(() => () => timersRef.current.forEach(clearTimeout), []);

  const connect = useCallback(async () => {
    setError(null);
    setPhase('searching');
    const draft = getDraft();
    if (!draft.dob) {
      onInvalidDraft();
      return;
    }
    try {
      const onboarding = await api.startOnboarding({
        dob: draft.dob,
        email: draft.email ?? null,
        companion_animal: draft.companionAnimal ?? null,
        companion_colour: draft.companionColour ?? null,
      });
      await saveSession(onboarding.session_token, onboarding.stream_token, onboarding.user);
      if (draft.companionAnimal) await saveCompanionAnimal(draft.companionAnimal);

      const match = await api.match({ kind: 'general' });
      clearDraft();
      const finish = () => {
        setFoundName(match.listener_persona_name);
        setPhase('found');
        // Crescendo: orbs meet + persona card lands, THEN the journey's celebrate
        // beat (haptic, companion hop, sky lift) carries us into the chat.
        later(
          () =>
            onMatched({
              id: match.conversation_id,
              listener: match.listener_persona_name,
              channel: match.stream_channel_id ?? '',
            }),
          reduced ? 0 : FOUND_CRESCENDO_MS
        );
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
            ? "It's a very busy moment — all our listeners are with someone. Please try again shortly."
            : e.message
          : 'We had trouble connecting. Please check your network and try again.';
      setError(msg);
      setPhase('error');
    }
  }, [onInvalidDraft, onMatched, later, reduced]);

  useEffect(() => {
    if (active && !startedRef.current) {
      startedRef.current = true;
      activeAtRef.current = Date.now();
      void connect();
    }
  }, [active, connect]);

  // Searching copy rotation.
  useEffect(() => {
    if (phase !== 'searching') return;
    const t = setInterval(() => setLine((n) => (n + 1) % SEARCH_LINES.length), COPY_ROTATE_MS);
    return () => clearInterval(t);
  }, [phase]);

  // Card carousel (reduced motion renders the full static list instead).
  useEffect(() => {
    if (reduced || (phase !== 'searching' && phase !== 'busy')) return;
    const t = setInterval(() => setCard((n) => (n + 1) % CARDS.length), CARD_ADVANCE_MS);
    return () => clearInterval(t);
  }, [phase, reduced]);

  // Breathe-with-me: only when the wait is real; text flips at the breathing tempo,
  // the ring in the constellation shares the same token so they stay in sync.
  useEffect(() => {
    if (phase !== 'searching' && phase !== 'busy') {
      setBreathing(false);
      return;
    }
    const start = later(() => setBreathing(true), BREATHE_AFTER_MS);
    return () => clearTimeout(start);
  }, [phase, later]);
  useEffect(() => {
    if (!breathing) return;
    const t = setInterval(() => setBreathIn((b) => !b), breathe.period / 2);
    return () => clearInterval(t);
  }, [breathing]);

  const constellation: ConstellationState =
    phase === 'found' ? 'found' : phase === 'error' ? 'still' : 'searching';

  const headline =
    phase === 'found'
      ? 'Found someone\nfor you 💜'
      : phase === 'error'
        ? "We couldn't connect just yet"
        : phase === 'busy'
          ? "It's a busy moment —\nyou're next in line"
          : 'Connecting you to an\navailable mentor…';

  const subline =
    phase === 'found'
      ? 'Taking you to your conversation…'
      : phase === 'error'
        ? (error ?? '')
        : phase === 'busy'
          ? "Everyone's with someone right now. We're holding your place and retrying."
          : SEARCH_LINES[line];

  const activeCard = CARDS[card];

  return (
    <StepScaffold
      footer={
        phase === 'error' ? (
          <PrimaryButton
            label="Try again"
            onPress={() => {
              retriesRef.current = 0;
              void connect();
            }}
            testID="retry"
          />
        ) : undefined
      }
    >
      <Entrance index={0}>
        <View style={styles.head}>
          <Text style={[styles.headline, { color: colors.ink }]} accessibilityRole="header">
            {headline}
          </Text>
          <CrossfadeLine text={subline} style={[type.body, styles.center, { color: colors.inkMuted }]} />
        </View>
      </Entrance>

      <Entrance index={1}>
        <View style={styles.scene}>
          <ConnectionConstellation state={constellation} breatheActive={breathing} />
          {breathing && (phase === 'searching' || phase === 'busy') ? (
            <CrossfadeLine
              text={breathIn ? 'Breathe in with your companion…' : '…and slowly out'}
              style={[type.caption, styles.center, { color: colors.accentSoft }]}
            />
          ) : null}
        </View>
      </Entrance>

      {phase === 'found' && foundName ? (
        <Entrance index={2} from="up">
          <View style={[styles.foundCard, elevation.sm, { backgroundColor: colors.surface }]} testID="found-card">
            <Ionicons name="heart-circle" size={28} color={colors.accent} />
            <Text style={[styles.foundName, { color: colors.ink }]}>
              {foundName} is here for you
            </Text>
          </View>
        </Entrance>
      ) : null}

      {phase === 'searching' || phase === 'busy' ? (
        <>
          <Entrance index={2}>
            <Text style={[styles.waitTitle, { color: colors.ink }]}>
              While you wait — what makes{'\n'}Mento a safe, supportive space
            </Text>
          </Entrance>

          {reduced ? (
            // Reduced motion: no carousel — the full list, still and readable.
            <View>
              {CARDS.map((g, i) => (
                <View key={g.title}>
                  {i > 0 ? <View style={[styles.divider, { backgroundColor: colors.border }]} /> : null}
                  <View style={styles.row}>
                    <IconBadge icon={g.icon} size={48} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.rowTitle, { color: colors.ink }]}>{g.title}</Text>
                      <Text style={[type.caption, { color: colors.inkMuted }]}>{g.body}</Text>
                    </View>
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <Entrance index={3}>
              <View style={[styles.card, elevation.sm, { backgroundColor: colors.surface }]}>
                <IconBadge icon={activeCard.icon} size={48} />
                <View style={{ flex: 1 }}>
                  <CrossfadeLine text={activeCard.title} style={[styles.rowTitle, { color: colors.ink }]} />
                  <CrossfadeLine text={activeCard.body} style={[type.caption, { color: colors.inkMuted }]} />
                </View>
              </View>
              <View style={styles.dots}>
                {CARDS.map((c, i) => (
                  <Pressable key={c.title} onPress={() => setCard(i)} hitSlop={6}>
                    <View
                      style={[
                        styles.dot,
                        { backgroundColor: i === card ? colors.accent : colors.border },
                      ]}
                    />
                  </Pressable>
                ))}
              </View>
            </Entrance>
          )}

          <Entrance index={4}>
            <View style={[styles.footerCard, { backgroundColor: colors.accentTint }]}>
              <Ionicons name="sparkles-outline" size={18} color={colors.accentSoft} />
              <Text style={[styles.footerTitle, { color: colors.ink }]}>
                Let's begin a conversation{'\n'}
                <Text style={{ color: colors.accent }}>that brings you peace of mind.</Text>
              </Text>
              <Text style={[type.body, { color: colors.accent }]}>💜</Text>
            </View>
          </Entrance>
        </>
      ) : null}

      {phase === 'error' ? (
        <Entrance index={2}>
          <View style={styles.errorArt}>
            <Ionicons name="cloud-offline-outline" size={40} color={colors.inkMuted} />
          </View>
        </Entrance>
      ) : null}
    </StepScaffold>
  );
}

const styles = StyleSheet.create({
  head: { alignItems: 'center', gap: space.sm, marginTop: space.md, marginBottom: space.sm },
  headline: { fontFamily: font.sansHeavy, fontSize: 27, lineHeight: 36, textAlign: 'center' },
  center: { textAlign: 'center' },
  scene: { alignItems: 'center', gap: space.xs, marginBottom: space.md },
  foundCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    borderRadius: radius.lg,
    padding: space.md,
    marginTop: space.sm,
  },
  foundName: { fontFamily: font.sansBold, fontSize: 17, lineHeight: 24 },
  waitTitle: {
    fontFamily: font.sansBold,
    fontSize: 18,
    lineHeight: 26,
    textAlign: 'center',
    marginBottom: space.md,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderRadius: radius.lg,
    padding: space.md,
    minHeight: 92,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    marginTop: space.sm,
    marginBottom: space.xs,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  rowTitle: { fontFamily: font.sansBold, fontSize: 16, lineHeight: 23 },
  divider: { height: 1, marginLeft: 48 + space.md },
  footerCard: {
    alignItems: 'center',
    gap: space.xs,
    borderRadius: radius.lg,
    padding: space.md,
    marginTop: space.md,
  },
  footerTitle: { fontFamily: font.sansBold, fontSize: 17, lineHeight: 25, textAlign: 'center' },
  errorArt: { alignItems: 'center', marginTop: space.lg },
});
