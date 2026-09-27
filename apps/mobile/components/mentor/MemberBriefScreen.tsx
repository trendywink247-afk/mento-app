import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ReactNode, useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EdgeSurface } from '@/components/EdgeSurface';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Companion } from '@/components/art/Companion';
import type { CompanionAnimal } from '@/components/art/Companions';
import { MemberDisc } from '@/components/mentor/MemberDisc';
import { MentorPageHeader } from '@/components/mentor/MentorPageHeader';
import { StayInTouchRow } from '@/components/mentor/StayInTouchRow';
import { Entrance } from '@/components/motion/Entrance';
import { PressKey } from '@/components/motion/PressKey';
import { SageSky } from '@/components/motion/SageSky';
import { useBreathing } from '@/components/motion/useBreathing';
import { relativeTime } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { listenerApi, onListenerSessionLost, type MemberBrief, type StayInTouchAsk } from '@/lib/listenerApi';
import { leaveToMentorHome } from '@/lib/leaveToChats';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { accentFor, COMPANION_COLORS } from '@/theme/companion';
import { duration, easing } from '@/theme/motion';
import { useTheme } from '@/theme/ThemeProvider';
import { colors as base, radius, space, type, wash, washEdge } from '@/theme/tokens';

/** A deeper page comes in from the side (FINAL_SPEC: 48px, 0.5 s); reduced: a short fade. */
function DeepArrival({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion();
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withTiming(1, reduced ? { duration: duration.fast * 0.75 } : { duration: duration.gentle, easing: easing.settle });
  }, [p, reduced]);
  const style = useAnimatedStyle(() =>
    reduced ? { opacity: p.value } : { opacity: p.value, transform: [{ translateX: (1 - p.value) * 48 }] }
  );
  return <Animated.View style={[styles.deep, style]}>{children}</Animated.View>;
}

/**
 * Member brief (board A36) — "Only what a mentor may know". Reached by tapping the member
 * header in the mentor chat (`member-header`). The member's companion in THEIR colour over
 * a tint disc, their persona and presence, the name they know you by today; the 2×2 facts;
 * the open safety flags as a calm, neutral, still block; the care prompt; a pending
 * stay-in-touch ask; and the promise that a mentor never sees age, email or identity
 * (T&S #7 — this screen never shows them, and the API never sends them).
 */
export default function MemberBriefScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useI18n();
  const breathing = useBreathing();
  const { id, member, masked } = useLocalSearchParams<{ id: string; member?: string; masked?: string }>();
  const memberName = member ?? '';

  const [brief, setBrief] = useState<MemberBrief | null>(null);
  const [myName, setMyName] = useState<string | null>(null);
  const [ask, setAsk] = useState<StayInTouchAsk | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [ending, setEnding] = useState(false);
  const [ended, setEnded] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(false);
    try {
      setBrief(await listenerApi.brief(id));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
    void listenerApi
      .me()
      .then((me) => setMyName(me.persona_name))
      .catch(() => {});
    void listenerApi
      .stayInTouchAsks()
      .then((asks) => setAsk(asks.find((a) => a.conversation_id === id) ?? null))
      .catch(() => {});
  }, [id]);

  useEffect(() => {
    void load();
  }, [load, attempt]);

  // Suspension / expired token mid-read — fall back to Mentor Home (same guard as the console).
  useEffect(() => onListenerSessionLost(() => leaveToMentorHome(router)), [router]);

  const endInTouch = async () => {
    if (ending || !id) return;
    setEnding(true);
    try {
      await listenerApi.endStayInTouch(id);
      setEnded(true);
    } catch {
      // Still and silent (T&S #11): the row simply stays.
    } finally {
      setEnding(false);
    }
  };

  const name = brief?.persona_name ?? memberName;
  const words = name.split(' ');
  const last = words.length > 1 ? words.pop() : null;
  const away = brief ? brief.member_masked : masked === '1';
  const animal = brief?.companion_animal ?? null;
  const tint = accentFor(brief?.companion_colour);
  const started = brief ? new Date(brief.created_at) : null;
  const startedText = started
    ? started.toDateString() === new Date().toDateString()
      ? t('memberBrief.todayAt', { time: started.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) })
      : started.toLocaleDateString([], { day: 'numeric', month: 'short' })
    : '';
  const path = [brief?.community_label, brief?.journey_stage_label].filter(Boolean).join(' · ');
  const facts: [string, string][] = brief
    ? [
        [t('memberBrief.pathStage'), path || t('memberBrief.notShared')],
        [t('memberBrief.cameWith'), brief.issue_category_label ?? t('memberBrief.notShared')],
        [t('memberBrief.started'), startedText],
        [t('memberBrief.lastMessage'), brief.last_message_at ? relativeTime(brief.last_message_at, t) : t('mentor.brief.unavailable')],
      ]
    : [];

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={['top', 'bottom']}>
      <SageSky shape="top" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <MentorPageHeader
          eyebrow={t('memberBrief.eyebrow')}
          title={t('memberBrief.title')}
          onBack={() => router.back()}
          backLabel={t('memberBrief.back')}
        />

        <DeepArrival>
          {/* Who: their companion in their colour, standing over a tint disc, on the card. */}
          <View style={styles.whoZone}>
            <View style={[styles.tintDisc, { backgroundColor: tint.accentTint, borderColor: tint.accentTintEdge }]} />
            <View
              style={styles.whoArt}
              pointerEvents="none"
              accessible
              accessibilityRole="image"
              accessibilityLabel={t('memberBrief.companionA11y', { name })}
            >
              {animal ? (
                <Animated.View style={[styles.originBottom, breathing]}>
                  <Companion animal={animal as CompanionAnimal} size={112} awake />
                </Animated.View>
              ) : (
                <MemberDisc name={name} size={80} />
              )}
            </View>
            <EdgeSurface
              edge={colors.edgeSurface}
              style={[styles.whoCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              <Text style={[styles.name, { color: colors.ink }]} accessibilityRole="header" numberOfLines={2}>
                {last ? `${words.join(' ')} ` : name}
                {last ? <Text style={{ color: colors.accent }}>{last}</Text> : null}
              </Text>
              {/* The brief carries no live presence, so it says only what it knows. */}
              <View style={styles.presence}>
                {away ? <View style={[styles.dot, { backgroundColor: colors.inkMuted }]} /> : null}
                <Text style={[type.note, { color: colors.inkMuted }]}>
                  {away ? t('mentor.masked') : t('mentorChatPage.member')}
                </Text>
              </View>
              {myName ? (
                <Text style={[type.caption, { color: colors.inkMuted }]}>{t('memberBrief.knowYou', { name: myName })}</Text>
              ) : null}
            </EdgeSurface>
          </View>

          {loading && !brief ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.accent} />
            </View>
          ) : error ? (
            <View style={styles.center} testID="brief-error">
              <Text style={[type.body, { color: colors.ink, textAlign: 'center' }]}>{t('memberBrief.loadError')}</Text>
              <PrimaryButton label={t('common.retry')} variant="surface" shape="key" dense onPress={() => setAttempt((a) => a + 1)} testID="brief-retry" />
            </View>
          ) : brief ? (
            <View testID="brief-ready" style={styles.stack}>
              <Entrance index={1}>
                <EdgeSurface
                  edge={colors.edgeSurface}
                  style={[styles.facts, { backgroundColor: colors.surface, borderColor: colors.border }]}
                >
                  {facts.map(([label, value]) => (
                    <View key={label} style={styles.fact}>
                      <Text style={[styles.eyebrow, { color: colors.inkMuted }]}>{label}</Text>
                      <Text style={[type.rowTitle, { color: colors.ink }]}>{value}</Text>
                    </View>
                  ))}
                </EdgeSurface>
              </Entrance>

              {/* Open safety flags: neutral and still — never red, never moving (T&S #11). */}
              {brief.safety_flags_open > 0 ? (
                <View
                  style={[styles.flags, { backgroundColor: base.bgLavender, borderColor: colors.edgeSurface }]}
                  testID="brief-safety"
                >
                  <View style={[styles.flagChip, { backgroundColor: colors.surface, borderColor: colors.edgeAlt }]}>
                    <Ionicons name="flag-outline" size={15} color={colors.ink} />
                    <Text style={[type.caption, styles.bold, { color: colors.ink }]}>
                      {brief.safety_flags_open === 1
                        ? t('memberBrief.flagsOne')
                        : t('memberBrief.flagsMany', { count: brief.safety_flags_open })}
                    </Text>
                  </View>
                  <Text style={[type.note, { color: colors.ink }]}>{t('memberBrief.flagsBody')}</Text>
                </View>
              ) : null}

              <Entrance index={2}>
                <EdgeSurface
                  edge={washEdge.green}
                  style={[styles.care, { backgroundColor: wash.green, borderColor: washEdge.green }]}
                >
                  <View style={[styles.careBadge, { backgroundColor: colors.surface }]}>
                    <Ionicons name="heart-outline" size={20} color={COMPANION_COLORS.sage.accentEdge} />
                  </View>
                  <View style={styles.grow}>
                    <Text style={[styles.eyebrow, { color: COMPANION_COLORS.sage.accentEdge }]}>{t('memberBrief.carePrompt')}</Text>
                    <Text style={[styles.prompt, { color: colors.ink }]}>{brief.care_prompt}</Text>
                  </View>
                </EdgeSurface>
              </Entrance>

              {ask ? (
                <Entrance index={3}>
                  <StayInTouchRow
                    id={ask.id}
                    name={ask.member_persona_name}
                    onPress={() => router.dismissTo({ pathname: '/mentor-home', params: { ask: ask.id } })}
                  />
                </Entrance>
              ) : null}

              {brief.in_touch ? (
                <Entrance index={3}>
                  <View style={[styles.inTouch, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]} testID="brief-in-touch">
                    <Ionicons name="link-outline" size={18} color={colors.inkMuted} />
                    <Text style={[type.note, styles.grow, { color: colors.ink }]}>
                      {ended ? t('memberBrief.endedInTouch') : t('memberBrief.inTouch', { name })}
                    </Text>
                    {ended ? null : (
                      <PressKey
                        onPress={() => void endInTouch()}
                        edge={colors.edgeSurface}
                        travel={3}
                        radius={radius.md}
                        disabled={ending}
                        testID="brief-end-in-touch"
                        style={[styles.endKey, { backgroundColor: colors.surface, borderColor: colors.border }]}
                      >
                        <Text style={[type.label, { color: colors.ink }]}>{t('memberBrief.endInTouch')}</Text>
                      </PressKey>
                    )}
                  </View>
                </Entrance>
              ) : null}
            </View>
          ) : null}

          <View style={styles.spacer} />
          <Entrance index={4} style={styles.never}>
            <Ionicons name="lock-closed-outline" size={18} color={COMPANION_COLORS.sage.accentEdge} style={styles.lock} />
            <Text style={[type.note, styles.grow, styles.semi, { color: colors.ink }]}>{t('memberBrief.never')}</Text>
          </Entrance>
        </DeepArrival>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.lg, gap: 12 },
  deep: { flexGrow: 1, gap: 12 },
  whoZone: { paddingTop: 64 },
  tintDisc: { position: 'absolute', left: 12, top: 6, width: 104, height: 104, borderRadius: radius.pill, borderWidth: 1 },
  whoArt: { position: 'absolute', left: 24, top: 0, width: 80, height: 112, zIndex: 2, alignItems: 'center', justifyContent: 'flex-end' },
  originBottom: { transformOrigin: 'bottom' },
  whoCard: { minHeight: 96, paddingTop: 14, paddingBottom: space.md, paddingLeft: 128, paddingRight: 18, justifyContent: 'center', gap: 2, borderWidth: 1 },
  name: { fontSize: 24, lineHeight: 30, fontFamily: type.displayHeadline.fontFamily },
  presence: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: radius.pill },
  center: { alignItems: 'center', justifyContent: 'center', gap: space.md, paddingVertical: space.xl },
  stack: { gap: 12 },
  facts: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 12, columnGap: space.md, paddingVertical: 14, paddingHorizontal: space.md, borderWidth: 1 },
  fact: { width: '46%', flexGrow: 1, gap: 2 },
  eyebrow: { fontSize: 12, lineHeight: 16, fontFamily: type.label.fontFamily, letterSpacing: 0.5, textTransform: 'uppercase' },
  flags: { paddingVertical: 12, paddingHorizontal: 14, gap: 6, alignItems: 'flex-start', borderWidth: 1, borderRadius: radius.lg },
  flagChip: { height: 28, flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: space.sm, paddingRight: 12, borderWidth: 1, borderRadius: radius.pill },
  bold: { fontFamily: type.label.fontFamily },
  care: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 14, paddingHorizontal: space.md, borderWidth: 1 },
  careBadge: { width: 40, height: 40, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  prompt: { fontSize: 17, lineHeight: 24, fontFamily: type.label.fontFamily },
  grow: { flex: 1, minWidth: 0 },
  inTouch: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: 12, borderWidth: 1, borderRadius: radius.md },
  endKey: { height: 40, paddingHorizontal: 14, justifyContent: 'center', borderWidth: 1 },
  spacer: { flexGrow: 1, minHeight: space.sm },
  never: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingHorizontal: space.xs },
  lock: { marginTop: 1 },
  semi: { fontFamily: type.bodySemi.fontFamily },
});
