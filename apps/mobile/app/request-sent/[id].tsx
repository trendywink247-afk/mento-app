/**
 * Request sent — a letter on its way (board A04, the reply-when-free path).
 *
 * Reached after a Personal request is sent (Browse → a mentor → the intro), and from My Chats'
 * dashed "You have a question open with …" row. The member's OWN companion sits on the note
 * it just sent; a small envelope flies the dotted arc to the mentor's avatar; the note lands
 * tilted with the question quoted and "Sent just now · private"; the Sent · Seen · Replying
 * strip; the one-question line; the Meanwhile pair; Go to My Chats.
 *
 * The strip is REAL state, never staged progress: `GET /listeners/requests/mine` can say
 * pending (Sent), matched (the mentor said yes — so they saw it: Seen), or declined / expired.
 * The API has no "seen" or "replying" signal for a pending question, so a pending question
 * shows Sent and leaves the other two in the quiet not-yet state. "Replying" is never lit.
 * While the screen is focused it re-reads quietly; when the mentor accepts, the key becomes
 * "Open the chat" (a push also takes the member there — lib/notificationRoute `accepted`).
 *
 * Arrival (FINAL_SPEC): back key, Feedback pill and companion are already there; the
 * headline rises, the note lands (tilted, a beat later), then the strip, Meanwhile and the
 * key, 80 ms apart. Motion is transform / opacity only. Reduced motion: no breath, no
 * flight (the envelope rests at the top of the arc), no ripples, the note simply there.
 * A closed or failed question is a still state: nothing on it moves.
 */
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Line, Path } from 'react-native-svg';

import { BackKey } from '@/components/DeepHeader';
import { EdgeSurface } from '@/components/EdgeSurface';
import { FeedbackPill } from '@/components/FeedbackPill';
import { GroundFade } from '@/components/GroundFade';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Companion } from '@/components/art/Companion';
import { MentorFace } from '@/components/art/MentorFace';
import { Entrance } from '@/components/motion/Entrance';
import { PressKey } from '@/components/motion/PressKey';
import { useHeroBreath } from '@/components/motion/useHeroBreath';
import { api, type PersonalRequest } from '@/lib/api';
import { relativeTime } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { leaveToChats } from '@/lib/leaveToChats';
import { requestLetter, type LetterMentor } from '@/lib/requestLetter';
import { useCompanionAnimal } from '@/lib/useCompanionAnimal';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { useSessionGuard } from '@/lib/useSessionGuard';
import { letter as motionLetter } from '@/theme/motion';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type, wash, washInk } from '@/theme/tokens';

/** How often the focused letter re-reads its question (ms). Quiet: no spinner, no motion. */
const REFRESH_MS = 15000;
/** The scene's geometry (board A04): the arc starts right of the companion and ends left of
 * the mentor's avatar; the note's top edge sits `NOTE_TOP` below the scene's top. */
const NOTE_TOP = 84;
const ARC_LEFT = 76;
const ARC_RIGHT = 74;
const ENVELOPE = 28;

type Phase = 'pending' | 'accepted' | 'closed';

export default function RequestSentScreen() {
  const router = useRouter();
  useSessionGuard();
  const { colors } = useTheme();
  const { t } = useI18n();
  const reduced = useReducedMotion();
  const animal = useCompanionAnimal();
  const breath = useHeroBreath();
  const { id } = useLocalSearchParams<{ id: string }>();

  const first = id ? requestLetter.get(id) : undefined;
  const [request, setRequest] = useState<PersonalRequest | null>(first?.request ?? null);
  const [mentor, setMentor] = useState<LetterMentor | null>(first?.mentor ?? null);
  const [missing, setMissing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [channel, setChannel] = useState<string | null>(null);
  // The member closed this question themselves (one open question at a time — "You can
  // ask another once they reply or you close it"). Still, never red.
  const [closedByMe, setClosedByMe] = useState(false);
  const [closing, setClosing] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const mine = await api.myRequests();
      const found = mine.find((r) => r.id === id) ?? null;
      setLoadError(false);
      if (!found) {
        setMissing(true);
        return;
      }
      setMissing(false);
      setRequest(found);
      if (
        found.target_listener_id &&
        (!mentor || mentor.id !== found.target_listener_id || !mentor.animal)
      ) {
        const p = await api.listenerProfile(found.target_listener_id);
        const m = {
          id: p.id,
          name: p.persona_name,
          avatar: p.persona_avatar,
          animal: p.companion_animal ?? found.listener_companion_animal,
          colour: p.companion_colour ?? found.listener_companion_colour,
        };
        setMentor(m);
        requestLetter.put({ request: found, mentor: m });
      }
      if (found.status === 'matched' && found.conversation_id) {
        const convos = await api.listConversations();
        setChannel(convos.find((c) => c.id === found.conversation_id)?.stream_channel_id ?? null);
      }
    } catch {
      setLoadError(true);
    }
    // reason: `mentor` is read only to skip a repeat profile fetch; it must not re-trigger load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Read on focus, then quietly every REFRESH_MS while focused and still pending.
  const phaseRef = useRef<Phase>('pending');
  useFocusEffect(
    useCallback(() => {
      void load();
      const timer = setInterval(() => {
        if (phaseRef.current === 'pending') void load();
      }, REFRESH_MS);
      return () => clearInterval(timer);
    }, [load]),
  );

  const phase: Phase =
    request?.status === 'matched' ? 'accepted' : request && request.status !== 'pending' ? 'closed' : 'pending';
  phaseRef.current = phase;
  // A closed or failed question is a still state (T&S #11).
  const still = reduced || phase !== 'pending' || loadError || missing;

  const name = mentor?.name ?? '';
  const question = request?.intro_message ?? '';

  const openChat = () => {
    if (!request?.conversation_id) return;
    router.replace({
      pathname: '/chat/[id]',
      params: { id: request.conversation_id, listener: name, channel: channel ?? '' },
    });
  };

  const closeQuestion = () => {
    if (!id || closing) return;
    setClosing(true);
    void api
      .withdrawRequest(id)
      .then((r) => {
        setRequest(r);
        if (r.status !== 'matched') setClosedByMe(true);
      })
      .catch(() => setLoadError(true))
      .finally(() => setClosing(false));
  };

  const line =
    phase === 'accepted'
      ? t('requestSent.accepted', { name })
      : phase === 'closed'
        ? closedByMe
          ? t('askFlow.closedByYou')
          : t('requestSent.closed', { name })
        : t('requestSent.oneAtATime', { name });

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']} testID="request-sent">
      <View style={styles.body}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.top}>
            <BackKey onPress={() => (router.canGoBack() ? router.back() : leaveToChats(router))} />
            <FeedbackPill testID="request-sent-feedback" screen="request-sent/[id]" />
          </View>

          <Entrance index={1}>
            <Text style={[type.displayHeadline, styles.title, { color: colors.ink }]} accessibilityRole="header">
              {t('requestSent.titleLead')}
              <Text style={{ color: colors.accent }}>{t('requestSent.titleAccent')}</Text>
            </Text>
          </Entrance>

          {missing ? (
            <EdgeSurface
              edge={colors.edgeAlt}
              travel={3}
              radius={radius.lg}
              style={[styles.strip, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
              testID="request-sent-missing"
            >
              <Text style={[type.note, { color: colors.inkMuted }]}>{t('requestSent.notFound')}</Text>
            </EdgeSurface>
          ) : (
            <>
              <Scene
                still={still}
                reduced={reduced}
                breath={breath}
                animal={animal}
                mentor={mentor}
                name={name}
                question={question}
                sentAt={request?.created_at ?? null}
              />

              <Entrance index={4}>
                <EdgeSurface
                  edge={colors.edgeAlt}
                  travel={3}
                  radius={radius.lg}
                  style={[styles.strip, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
                >
                  <Steps seen={phase === 'accepted'} />
                  <Text style={[type.note, { color: colors.inkMuted }]} testID="request-sent-line">
                    {name ? line : ' '}
                  </Text>
                  {loadError ? (
                    <Text style={[type.caption, { color: colors.inkMuted }]} testID="request-sent-error">
                      {t('requestSent.loadError')}
                    </Text>
                  ) : null}
                </EdgeSurface>
              </Entrance>
            </>
          )}

          <Entrance index={5} style={styles.meanwhile}>
            <Text style={[type.label, { color: colors.inkMuted }]} accessibilityRole="header">
              {t('requestSent.meanwhile')}
            </Text>
            <View style={styles.pair}>
              <MeanwhileKey
                icon="book-outline"
                tint="green"
                label={t('requestSent.journal')}
                testID="request-sent-journal"
                onPress={() => router.push('/journal/write')}
              />
              <MeanwhileKey
                icon="chatbubble-outline"
                tint="orange"
                label={t('requestSent.prompt')}
                testID="request-sent-prompt"
                onPress={() => router.dismissTo('/path')}
              />
            </View>
          </Entrance>

        </ScrollView>
        <GroundFade height={space.lg} color={colors.bgLavender} />
      </View>

      {/* The key stays in reach on a short phone; on the board's 844 it sits where the
          spacer puts it. */}
      <Entrance index={6} style={styles.footer}>
        {phase === 'accepted' && request?.conversation_id ? (
          <PrimaryButton
            label={t('requestSent.openChat')}
            shape="key"
            trailing="arrow"
            onPress={openChat}
            testID="request-sent-open-chat"
          />
        ) : (
          <>
            <PrimaryButton
              label={t('requestSent.goChats')}
              shape="key"
              trailing="arrow"
              onPress={() => leaveToChats(router)}
              testID="request-sent-go-chats"
            />
            {phase === 'pending' && request && !missing ? (
              <PressKey
                onPress={closeQuestion}
                edge="transparent"
                travel={2}
                haptic="none"
                disabled={closing}
                accessibilityLabel={t('askFlow.closeThis')}
                testID="request-sent-close"
                containerStyle={styles.closeBox}
                style={styles.closeKey}
              >
                <Text style={[styles.closeText, { color: colors.inkMuted }]}>{t('askFlow.closeThis')}</Text>
              </PressKey>
            ) : null}
          </>
        )}
      </Entrance>
    </SafeAreaView>
  );
}

/** The companion, the arc and its envelope, the mentor, and the note that just landed. */
function Scene({
  still,
  reduced,
  breath,
  animal,
  mentor,
  name,
  question,
  sentAt,
}: {
  still: boolean;
  reduced: boolean;
  breath: ReturnType<typeof useHeroBreath>;
  animal: ReturnType<typeof useCompanionAnimal>;
  mentor: LetterMentor | null;
  name: string;
  question: string;
  sentAt: string | null;
}) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const [width, setWidth] = useState(342);
  const arcW = Math.max(120, width - ARC_LEFT - ARC_RIGHT);
  const travel = arcW - 4;

  // The note lands once (board `settle`): from above, tilted further, to its resting tilt.
  const land = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    if (reduced) {
      land.value = 1;
      return;
    }
    land.value = withDelay(
      motionLetter.land.delay,
      withTiming(1, { duration: motionLetter.land.duration, easing: motionLetter.landEase }),
    );
    // reason: the landing plays exactly once, on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const noteStyle = useAnimatedStyle(() => {
    const p = land.value;
    const { from, tilt } = motionLetter.land;
    return {
      opacity: interpolate(p, [0, 0.6, 1], [0, 1, 1]),
      transform: [{ translateY: from.rise * (1 - p) }, { rotate: `${from.tilt + (tilt - from.tilt) * p}deg` }],
    };
  });

  // The envelope's crossing (board `fly`): one pass per period, then a rest at the far end.
  const fly = useSharedValue(0);
  useEffect(() => {
    if (still) {
      cancelAnimation(fly);
      fly.value = 0;
      return;
    }
    fly.value = withDelay(
      motionLetter.fly.delay,
      withRepeat(withTiming(1, { duration: motionLetter.fly.period, easing: Easing.linear }), -1, false),
    );
    return () => cancelAnimation(fly);
  }, [still, fly]);

  const envelopeStyle = useAnimatedStyle(() => {
    if (still) {
      // At rest: the envelope waits at the top of the arc, as the board's still frame draws it.
      return { opacity: 1, transform: [{ translateX: travel * 0.5 }, { translateY: -22 }] };
    }
    const p = fly.value;
    const { flyStops, flyX, flyY, flyShow, flyFade, flyHide } = motionLetter;
    return {
      opacity: interpolate(p, [0, flyShow, flyFade, flyHide, 1], [0, 1, 1, 0, 0]),
      transform: [
        { translateX: travel * interpolate(p, flyStops as unknown as number[], flyX as unknown as number[]) },
        { translateY: interpolate(p, flyStops as unknown as number[], flyY as unknown as number[]) },
      ],
    };
  }, [still, travel]);

  return (
    <View style={styles.scene} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <Svg width={arcW} height={40} style={[styles.arc, { left: ARC_LEFT }]} pointerEvents="none">
        <Path
          d={`M2 34 C ${arcW * 0.26} 4, ${arcW * 0.74} 4, ${arcW - 2} 34`}
          stroke={colors.accent}
          strokeOpacity={0.5}
          strokeWidth={1.75}
          strokeLinecap="round"
          strokeDasharray="2 8"
          fill="none"
        />
      </Svg>

      <Animated.View
        pointerEvents="none"
        style={[styles.envelope, { backgroundColor: colors.surface, borderColor: colors.border }, envelopeStyle]}
        testID="request-sent-envelope"
      >
        <Ionicons name="mail-outline" size={16} color={colors.accent} />
      </Animated.View>

      <View style={styles.companion} accessible accessibilityLabel={t('requestSent.companionA11y')}>
        <Animated.View style={[styles.feet, breath]}>
          {animal !== undefined ? <Companion animal={animal} size={84} awake /> : null}
        </Animated.View>
      </View>

      {mentor ? (
        <View
          style={[styles.mentor, { borderColor: colors.bgLavender, backgroundColor: colors.bgLavender }]}
          accessible
          accessibilityLabel={t('requestSent.mentorA11y', { name })}
        >
          <MentorFace animal={mentor.animal} colour={mentor.colour} size={46} />
        </View>
      ) : null}

      <View style={[styles.underNote, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]} />
      <Animated.View style={noteStyle}>
        <EdgeSurface
          edge={colors.edgeSurface}
          travel={3}
          radius={radius.lg}
          style={[styles.note, { backgroundColor: colors.surface, borderColor: colors.border }]}
          testID="request-sent-note"
        >
          <Text style={[type.eyebrow, { color: colors.inkMuted }]} numberOfLines={2}>
            {name ? t('requestSent.eyebrow', { name }) : ' '}
          </Text>
          <Text style={[type.body, { color: colors.ink }]} testID="request-sent-question">
            {question ? `“${question}”` : ' '}
          </Text>
          <View style={styles.noteFoot}>
            <View style={styles.sentRow}>
              <Ionicons name="checkmark" size={16} color={colors.success} />
              <Text style={[type.caption, styles.shrink, { color: colors.inkMuted }]} testID="request-sent-when">
                {sentAt ? t('requestSent.sent', { when: relativeTime(sentAt, t) }) : ' '}
              </Text>
            </View>
            <View style={styles.postmark} accessible accessibilityLabel={t('requestSent.postmarkA11y')}>
              <Ripple still={still} delay={motionLetter.ripple.delays[0]} />
              <Ripple still={still} delay={motionLetter.ripple.delays[1]} />
              <View style={[styles.stampEdge, { backgroundColor: colors.accentEdge }]} />
              <View style={[styles.stamp, { backgroundColor: colors.accent }]}>
                <Text style={[styles.stampText, { color: colors.onAccent }]}>m</Text>
              </View>
            </View>
          </View>
        </EdgeSurface>
      </Animated.View>
    </View>
  );
}

/** One ring of the postmark's ripple (board `ripple`): it swells from the stamp and fades. */
function Ripple({ still, delay }: { still: boolean; delay: number }) {
  const { colors } = useTheme();
  const v = useSharedValue(0);
  useEffect(() => {
    if (still) {
      cancelAnimation(v);
      v.value = 0;
      return;
    }
    v.value = withDelay(
      delay,
      withRepeat(withTiming(1, { duration: motionLetter.ripple.period, easing: motionLetter.rippleEase }), -1, false),
    );
    return () => cancelAnimation(v);
  }, [still, delay, v]);
  const style = useAnimatedStyle(() => {
    if (still) return { opacity: 0, transform: [{ scale: 1 }] };
    const { grow, peak, peakAt } = motionLetter.ripple;
    return {
      opacity: interpolate(v.value, [0, peakAt, 1], [0, peak, 0]),
      transform: [{ scale: 1 + (grow - 1) * v.value }],
    };
  }, [still]);
  return <Animated.View pointerEvents="none" style={[styles.ring, { borderColor: colors.accent }, style]} />;
}

/** Sent · Seen · Replying. Lit only for what the server has actually said. */
function Steps({ seen }: { seen: boolean }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const done = (testID: string) => (
    <View style={[styles.dot, { backgroundColor: colors.accent }]} testID={testID}>
      <Ionicons name="checkmark" size={16} color={colors.onAccent} />
    </View>
  );
  const idle = (testID: string) => (
    <View style={[styles.dot, styles.dotIdle, { backgroundColor: colors.surface, borderColor: colors.dotIdle }]} testID={testID} />
  );
  const dash = (
    <Svg height={2} style={styles.dash} width="100%">
      <Line x1={0} y1={1} x2="100%" y2={1} stroke={colors.dotIdle} strokeWidth={2} strokeDasharray="4 4" />
    </Svg>
  );
  const label = (text: string, on: boolean, align: 'left' | 'center' | 'right') => (
    <Text
      style={[
        type.note,
        styles.stepLabel,
        { textAlign: align, color: on ? colors.ink : colors.inkMuted, fontFamily: on ? font.sansBold : font.sans },
      ]}
    >
      {text}
    </Text>
  );
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={seen ? t('requestSent.stripA11ySeen') : t('requestSent.stripA11ySent')}
      style={styles.steps}
      testID={seen ? 'request-sent-steps-seen' : 'request-sent-steps-sent'}
    >
      <View style={styles.track}>
        {done('step-sent-done')}
        {dash}
        {seen ? done('step-seen-done') : idle('step-seen-idle')}
        {dash}
        {idle('step-replying-idle')}
      </View>
      <View style={styles.labels}>
        {label(t('requestSent.stepSent'), true, 'left')}
        {label(t('requestSent.stepSeen'), seen, 'center')}
        {label(t('requestSent.stepReplying'), false, 'right')}
      </View>
    </View>
  );
}

function MeanwhileKey({
  icon,
  tint,
  label,
  testID,
  onPress,
}: {
  icon: 'book-outline' | 'chatbubble-outline';
  tint: 'green' | 'orange';
  label: string;
  testID: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <PressKey
      onPress={onPress}
      edge={colors.edgeSurface}
      radius={radius.md}
      intent="navigate"
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      containerStyle={styles.pairCell}
      style={[styles.pairFace, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <View style={[styles.pairIcon, { backgroundColor: wash[tint] }]}>
        <Ionicons name={icon} size={18} color={washInk[tint]} />
      </View>
      <Text style={[type.rowTitle, styles.shrink, { color: colors.ink }]}>{label}</Text>
    </PressKey>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  body: { flex: 1 },
  scroll: { flexGrow: 1, paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.md, gap: 12 },
  footer: { paddingHorizontal: space.lg, paddingTop: space.xs, paddingBottom: 28 },
  closeBox: { alignSelf: 'center', marginTop: space.xs },
  closeKey: { height: 44, paddingHorizontal: space.md, alignItems: 'center', justifyContent: 'center' },
  closeText: { fontFamily: font.sansBold, fontSize: 15, lineHeight: 20, textDecorationLine: 'underline' },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { lineHeight: 36 },
  scene: { paddingTop: NOTE_TOP },
  arc: { position: 'absolute', top: 30 },
  envelope: {
    position: 'absolute',
    left: 64,
    top: 50,
    zIndex: 3,
    width: ENVELOPE,
    height: ENVELOPE,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  companion: { position: 'absolute', left: 0, top: 4, width: 84, height: 88, zIndex: 3, alignItems: 'center', justifyContent: 'flex-end' },
  feet: { transformOrigin: 'bottom' },
  mentor: {
    position: 'absolute',
    right: 14,
    top: 54,
    zIndex: 3,
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    borderWidth: 3,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  underNote: {
    position: 'absolute',
    left: 6,
    right: 6,
    top: NOTE_TOP + 4,
    bottom: -2,
    borderRadius: radius.lg,
    borderWidth: 1,
    transform: [{ rotate: '1.6deg' }],
  },
  note: { padding: space.md, gap: space.sm, borderWidth: 1 },
  noteFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  sentRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  shrink: { flexShrink: 1 },
  postmark: { width: 40, height: 40, flexShrink: 0 },
  ring: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: radius.pill, borderWidth: 1.5, opacity: 0 },
  stampEdge: { position: 'absolute', left: 0, right: 0, top: 3, height: 40, borderRadius: radius.pill },
  stamp: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  stampText: { fontFamily: font.sansHeavy, fontSize: 20, lineHeight: 24 },
  strip: { paddingVertical: 14, paddingHorizontal: space.md, gap: space.sm, borderWidth: 1 },
  steps: { gap: space.xs },
  track: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  dot: { width: 28, height: 28, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  dotIdle: { borderWidth: 2 },
  dash: { flex: 1 },
  labels: { flexDirection: 'row' },
  stepLabel: { flex: 1 },
  meanwhile: { gap: space.sm },
  pair: { flexDirection: 'row', gap: 12 },
  pairCell: { flex: 1 },
  pairFace: {
    minHeight: 64,
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
  },
  pairIcon: { width: 34, height: 34, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
});
