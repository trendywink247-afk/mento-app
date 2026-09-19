import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackKey } from '@/components/DeepHeader';
import { EdgeSurface } from '@/components/EdgeSurface';
import { InTouchBadge } from '@/components/InTouchBadge';
import { OpenQuestionNote } from '@/components/OpenQuestionNote';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Companion } from '@/components/art/Companion';
import { MentorAvatar, MentorFigure } from '@/components/art/MentorAvatar';
import { DeepArrival } from '@/components/motion/DeepArrival';
import { Entrance } from '@/components/motion/Entrance';
import { PressKey } from '@/components/motion/PressKey';
import { useBreathing } from '@/components/motion/useBreathing';
import { ApiError, api, type ListenerProfile, type PathTree } from '@/lib/api';
import { cachedPathTree, communityLabel } from '@/lib/communityLabel';
import { useI18n, type TKey } from '@/lib/i18n';
import { leaveToChats } from '@/lib/leaveToChats';
import { openQuestionFrom, type OpenQuestion } from '@/lib/openQuestion';
import { requestLetter } from '@/lib/requestLetter';
import { TOPICS, topicLabelKey } from '@/lib/topics';
import { useCompanionAnimal } from '@/lib/useCompanionAnimal';
import { useSessionGuard } from '@/lib/useSessionGuard';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type } from '@/theme/tokens';

/** The question's bound — the server's `PersonalRequestIn.intro_message` max (160). */
const QUESTION_MAX = 160;
const GUTTER = space.lg; // 24 — the board's side margin on A14
const COMPANION = 60;
const COMPANION_TUCK = 30;
/** The server's categories (services/api/app/services/categories.py) the locale words. */
const TOPIC_WORDS = [
  'exam_stress',
  'loneliness',
  'family',
  'career_doubt',
  'relationships',
  'life',
  'feeling_stuck',
  'motivation',
] as const;

/**
 * A mentor, before you ask (reached from Browse, board A25 → A14's language) and the
 * question step that follows (board A27's calm step), ending on the letter (A04,
 * app/request-sent/[id].tsx).
 *
 * The page reads like A14: the mentor's figure and the member's companion standing on the
 * card's top edge, the persona, "Mentor · online now · <community>", their own line, "A real
 * person, not a therapist. Reviewed and approved by the Mento team." — never "listener" —
 * then what they can help with in the server's words (`category_labels`, never a slug).
 *
 * The question step: one bounded field (160, the builder's counter), the optional topic
 * chips, the honest "One question goes to one mentor at a time. They reply when they are
 * free.", and "Send my question". One open question at a time is the SERVER's rule: a 409
 * `question_open` keeps the draft and shows the still note that names the waiting question,
 * with "See your question" and "Close it" (components/OpenQuestionNote.tsx).
 *
 * `topic` arrives from the New chat sheet via Browse (already lit here); `question` from the
 * first-question builder when nobody was free (pre-filled, never sent for them).
 */
export default function MentorBeforeAsk() {
  useSessionGuard();
  const router = useRouter();
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const animal = useCompanionAnimal();
  const mentorBreath = useBreathing(true);
  const params = useLocalSearchParams<{ id: string; topic?: string; question?: string }>();
  const id = params.id;

  const [mentor, setMentor] = useState<ListenerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [tree, setTree] = useState<PathTree | null>(null);
  const [step, setStep] = useState<'profile' | 'compose'>(params.question ? 'compose' : 'profile');
  const [intro, setIntro] = useState((params.question ?? '').slice(0, QUESTION_MAX));
  const [topic, setTopic] = useState<string | null>(params.topic ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openQ, setOpenQ] = useState<OpenQuestion | null>(null);
  const [closedNote, setClosedNote] = useState(false);

  useEffect(() => {
    let active = true;
    if (!id) return;
    void api
      .listenerProfile(id)
      .then((p) => {
        if (active) setMentor(p);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id]);

  // Community names are polish, never a blocker (falls back to the title-cased slug).
  useEffect(() => {
    void cachedPathTree().then(setTree).catch(() => {});
  }, []);

  const back = () => (router.canGoBack() ? router.back() : leaveToChats(router));

  const send = async () => {
    const text = intro.trim();
    if (!mentor || !text || busy) return;
    setBusy(true);
    setError(null);
    setOpenQ(null);
    setClosedNote(false);
    try {
      const sent = await api.requestListener(mentor.id, text, topic);
      // The letter (board A04) paints from what we already hold, then re-reads the server.
      requestLetter.put({
        request: sent,
        mentor: { id: mentor.id, name: mentor.persona_name, avatar: mentor.persona_avatar },
      });
      // `replace`: back from the letter returns to Browse, never to a sent question.
      router.replace({ pathname: '/request-sent/[id]', params: { id: sent.id } });
    } catch (e) {
      // Still (T&S #11): the draft stays exactly as it was.
      const open = openQuestionFrom(e);
      if (open) setOpenQ(open);
      else setError(e instanceof ApiError && e.status !== 0 ? e.message : t('common.somethingWrong'));
    } finally {
      setBusy(false);
    }
  };

  if (loading || !mentor) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={['top', 'bottom']}>
        <View style={styles.page}>
          <BackKey onPress={back} label={t('askFlow.mentorBackA11y')} />
          <View style={styles.center}>
            {loading ? (
              <ActivityIndicator size="large" color={colors.accent} />
            ) : (
              <Text style={[type.body, styles.centered, { color: colors.inkMuted }]} testID="mentor-not-found">
                {t('askFlow.notFound')}
              </Text>
            )}
          </View>
        </View>
      </SafeAreaView>
    );
  }

  const name = mentor.persona_name;
  const online = mentor.available;
  // English reads the server's own words (`category_labels`); Hindi reads the same eight
  // categories from the locale (services/categories.py has no Hindi), falling back to the
  // server's word for a category the app does not know yet. Never a raw slug.
  const labels = mentor.categories.map((slug, i) => {
    const server = mentor.category_labels?.[i];
    const known = (TOPIC_WORDS as readonly string[]).includes(slug)
      ? // reason: `slug` is one of TOPIC_WORDS here, each a key under askFlow.topics
        t(`askFlow.topics.${slug}` as TKey)
      : null;
    if (locale === 'hi' && known) return known;
    if (server) return server;
    const key = topicLabelKey(slug);
    return known ?? (key ? t(key) : slug.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()));
  });

  if (step === 'compose') {
    const count = intro.length;
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={['top', 'bottom']}>
        <View style={styles.top}>
          <PressKey
            onPress={() => setStep('profile')}
            edge={colors.edgeSurface}
            intent="navigate"
            radius={radius.pill}
            accessibilityLabel={t('askFlow.composeBackA11y', { name })}
            testID="compose-back"
            style={[styles.roundKey, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <Ionicons name="chevron-back" size={22} color={colors.ink} />
          </PressKey>
          <DeepArrival style={styles.topText}>
            <View style={styles.topMentor}>
              <MentorAvatar seed={mentor.persona_avatar} size={40} presence={online} />
              <View style={styles.topWords}>
                <Text style={[styles.lens, { color: colors.inkMuted }]} numberOfLines={1}>
                  {t('askFlow.composeLens', { name })}
                </Text>
                <Text style={[styles.topTitle, { color: colors.ink }]} numberOfLines={1}>
                  {name}
                </Text>
              </View>
            </View>
          </DeepArrival>
        </View>

        <DeepArrival style={styles.fill}>
          <ScrollView
            style={styles.fill}
            contentContainerStyle={styles.composeBody}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <Entrance index={1}>
              <Text style={[styles.headline, { color: colors.ink }]} accessibilityRole="header">
                {t('askFlow.composeTitle')}
              </Text>
            </Entrance>

            <Entrance index={2} style={styles.fieldBlock}>
              <View style={styles.groupHead}>
                <Text style={[styles.groupTitle, { color: colors.ink }]}>{t('askFlow.fieldLabel')}</Text>
                <Text
                  style={[type.caption, { color: count >= QUESTION_MAX ? colors.warning : colors.inkMuted }]}
                  testID="intro-count"
                >
                  {t('pathQuestion.count', { used: count, max: QUESTION_MAX })}
                </Text>
              </View>
              <View>
                {/* The member's companion peeks over the field (decor only). */}
                <View style={styles.peek} pointerEvents="none">
                  <Companion animal={animal ?? null} size={COMPANION} />
                </View>
                <EdgeSurface
                  edge={colors.edgeSurface}
                  travel={3}
                  radius={radius.lg}
                  containerStyle={styles.fieldBox}
                  style={[styles.field, { backgroundColor: colors.surface, borderColor: colors.border }]}
                >
                  <TextInput
                    value={intro}
                    onChangeText={(v) => setIntro(v.slice(0, QUESTION_MAX))}
                    placeholder={t('askFlow.placeholder')}
                    placeholderTextColor={colors.inkMuted}
                    multiline
                    maxLength={QUESTION_MAX}
                    maxFontSizeMultiplier={1.3}
                    accessibilityLabel={t('askFlow.fieldLabel')}
                    testID="intro-input"
                    style={[type.body, styles.input, { color: colors.ink }]}
                  />
                </EdgeSurface>
              </View>
            </Entrance>

            <Entrance index={3}>
              <View style={styles.groupHead}>
                <Text style={[styles.groupTitle, { color: colors.ink }]}>{t('newChat.aboutTitle')}</Text>
                <Text style={[type.caption, { color: colors.inkMuted }]}>{t('newChat.aboutHint')}</Text>
              </View>
              <View style={styles.chips} accessibilityLabel={t('newChat.aboutA11y')}>
                {TOPICS.map(({ slug, label }) => {
                  const on = topic === slug;
                  return (
                    <PressKey
                      key={slug}
                      onPress={() => setTopic(on ? null : slug)}
                      edge={on ? colors.accentTintEdge : colors.edgeSurface}
                      intent="select"
                      radius={radius.pill}
                      disabled={busy}
                      accessibilityLabel={t(label)}
                      accessibilityState={{ selected: on }}
                      testID={`topic-${slug}`}
                      style={[
                        styles.chip,
                        on
                          ? { backgroundColor: colors.accentTint, borderColor: colors.accent, borderWidth: 2, paddingHorizontal: 13 }
                          : { backgroundColor: colors.surface, borderColor: colors.border },
                      ]}
                    >
                      <Text style={[styles.chipText, { color: on ? colors.accentEdge : colors.ink }]}>{t(label)}</Text>
                    </PressKey>
                  );
                })}
              </View>
            </Entrance>

            <View style={styles.grow} />

            <Entrance index={4} style={styles.promises}>
              <View style={styles.promise}>
                <Ionicons name="chatbubble-outline" size={15} color={colors.inkMuted} style={styles.promiseIcon} />
                <Text style={[type.caption, styles.promiseText, { color: colors.inkMuted }]} testID="compose-one-at-a-time">
                  {t('askFlow.oneAtATime')}
                </Text>
              </View>
              <View style={styles.promise}>
                <Ionicons name="lock-closed-outline" size={15} color={colors.inkMuted} style={styles.promiseIcon} />
                <Text style={[type.caption, styles.promiseText, { color: colors.inkMuted }]}>
                  {t('askFlow.private', { name })}
                </Text>
              </View>
            </Entrance>
          </ScrollView>
        </DeepArrival>

        <View style={styles.footer}>
          {openQ ? (
            <View style={styles.footNote}>
              <OpenQuestionNote
                question={openQ}
                onClosed={() => {
                  setOpenQ(null);
                  setClosedNote(true);
                }}
                testID="compose-open"
              />
            </View>
          ) : null}
          {closedNote ? (
            <Text style={[type.caption, styles.footLine, { color: colors.ink }]} testID="compose-closed">
              {t('askFlow.openClosed')}
            </Text>
          ) : null}
          {error ? (
            <Text style={[type.caption, styles.footLine, { color: colors.inkMuted }]} testID="compose-error">
              {error}
            </Text>
          ) : null}
          <Entrance index={5}>
            <View style={styles.actions}>
              <PressKey
                onPress={() => setStep('profile')}
                edge={colors.edgeSurface}
                intent="navigate"
                radius={radius.md}
                disabled={busy}
                accessibilityLabel={t('askFlow.cancel')}
                testID="cancel-request"
                containerStyle={styles.cancelBox}
                style={[styles.action, { backgroundColor: colors.surface, borderColor: colors.border }]}
              >
                <Text style={[styles.cancelText, { color: colors.ink }]} numberOfLines={1}>
                  {t('askFlow.cancel')}
                </Text>
              </PressKey>
              <PressKey
                onPress={() => void send()}
                edge={colors.accentEdge}
                intent="commit"
                radius={radius.md}
                disabled={busy || !intro.trim()}
                accessibilityLabel={t('askFlow.sendA11y', { name })}
                testID="send-request"
                containerStyle={styles.sendBox}
                style={[styles.action, styles.actionFilled, { backgroundColor: colors.accent }]}
              >
                {busy ? (
                  <ActivityIndicator size="small" color={colors.onAccent} />
                ) : (
                  <>
                    <Text style={[styles.sendText, { color: colors.onAccent }]} numberOfLines={1}>
                      {t('askFlow.send')}
                    </Text>
                    <Ionicons name="arrow-forward" size={20} color={colors.onAccent} />
                  </>
                )}
              </PressKey>
            </View>
          </Entrance>
        </View>
      </SafeAreaView>
    );
  }

  const statusLine = [
    online ? t('mentorProfile.online') : t('mentorProfile.away'),
    mentor.community_slug ? t('inTouch.community', { name: communityLabel(tree, mentor.community_slug) }) : null,
    !online && mentor.availability_note ? t('mentorProfile.usually', { note: mentor.availability_note }) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
        <BackKey onPress={back} label={t('askFlow.mentorBackA11y')} />

        <DeepArrival style={styles.column}>
          {/* Two in the room (A14): the mentor's figure and, beside it, the member's
              companion, both standing on the card's top edge. They are simply there. */}
          <View style={styles.hero}>
            <View style={styles.figures} pointerEvents="none">
              <Animated.View style={[styles.mentorFigure, mentorBreath]}>
                <MentorFigure seed={mentor.persona_avatar} width={96} height={110} />
              </Animated.View>
              {animal ? (
                <View style={styles.memberFigure}>
                  <Companion animal={animal} size={84} awake />
                </View>
              ) : null}
            </View>
            <Entrance index={1}>
              <EdgeSurface
                edge={colors.edgeSurface}
                travel={3}
                radius={radius.lg}
                style={[styles.heroCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
              >
                <View style={styles.nameRow}>
                  <Text style={[styles.name, { color: colors.ink }]} accessibilityRole="header" testID="mentor-name">
                    {name}
                  </Text>
                  {mentor.in_touch ? <InTouchBadge flat testID="mentor-in-touch" /> : null}
                </View>
                <View style={styles.statusRow}>
                  <View style={[styles.statusDot, { backgroundColor: online ? colors.success : colors.dotIdle }]} />
                  <Text style={[type.note, styles.statusText, { color: colors.inkMuted }]} testID="mentor-status">
                    {statusLine}
                  </Text>
                </View>
                {mentor.public_line ? (
                  <Text style={[type.body, styles.publicLine, { color: colors.ink }]} testID="public-line">
                    {mentor.public_line}
                  </Text>
                ) : null}
                <Text style={[type.caption, { color: colors.inkMuted }]} testID="mentor-pledge">
                  {t('mentorProfile.pledge')}
                </Text>
              </EdgeSurface>
            </Entrance>
          </View>

          {labels.length ? (
            <Entrance index={2}>
              <EdgeSurface
                edge={colors.edgeSurface}
                travel={3}
                radius={radius.lg}
                style={[styles.helps, { backgroundColor: colors.surface, borderColor: colors.border }]}
              >
                <Text style={[type.eyebrow, { color: colors.inkMuted }]}>{t('askFlow.helpsWith')}</Text>
                <View style={styles.tags} testID="mentor-topics">
                  {labels.map((label) => (
                    <View key={label} style={[styles.tag, { backgroundColor: colors.bgLavender }]}>
                      <Text style={[styles.tagText, { color: colors.inkMuted }]}>{label}</Text>
                    </View>
                  ))}
                </View>
              </EdgeSurface>
            </Entrance>
          ) : null}

          <Entrance index={3}>
            <View style={[styles.quiet, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
              <Ionicons name="heart-outline" size={16} color={colors.inkMuted} />
              <Text style={[type.caption, styles.promiseText, { color: colors.inkMuted }]}>{t('askFlow.noRatings')}</Text>
            </View>
          </Entrance>

          <View style={styles.grow} />

          <Entrance index={4} style={styles.askBlock}>
            <Text style={[type.caption, styles.centered, { color: colors.inkMuted }]}>{t('askFlow.askSub', { name })}</Text>
            <PrimaryButton
              label={t('askFlow.ask')}
              shape="key"
              trailing="arrow"
              onPress={() => setStep('compose')}
              testID="start-conversation"
            />
          </Entrance>
        </DeepArrival>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  fill: { flex: 1 },
  page: { flexGrow: 1, paddingTop: space.xs, paddingHorizontal: GUTTER, paddingBottom: space.lg, gap: 14 },
  column: { flexGrow: 1, gap: 14 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md },
  centered: { textAlign: 'center' },
  hero: { paddingTop: 86 },
  figures: { position: 'absolute', left: 0, right: 0, top: 0, height: 116, zIndex: 2 },
  mentorFigure: { position: 'absolute', left: 18, top: 0 },
  memberFigure: { position: 'absolute', left: 104, top: 26 },
  heroCard: { paddingTop: 30, paddingHorizontal: 20, paddingBottom: 18, gap: 6, borderWidth: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  name: { fontFamily: font.sansHeavy, fontSize: 26, lineHeight: 34, flexShrink: 1 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusDot: { width: 8, height: 8, borderRadius: radius.pill },
  statusText: { flex: 1 },
  publicLine: { marginTop: 4 },
  helps: { paddingVertical: 14, paddingHorizontal: space.md, gap: space.sm, borderWidth: 1 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: { minHeight: 28, paddingHorizontal: 10, justifyContent: 'center', borderRadius: radius.pill },
  tagText: { fontFamily: font.sansBold, fontSize: 13, lineHeight: 18 },
  quiet: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: 12, borderRadius: radius.md, borderWidth: 1 },
  grow: { flexGrow: 1 },
  askBlock: { gap: space.sm },
  // --- the question step (board A27's calm step) ---
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm + 4,
    paddingHorizontal: space.md + space.xs,
    paddingTop: space.xs,
    paddingBottom: space.xs,
    minHeight: 50,
  },
  roundKey: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  topText: { flex: 1, minWidth: 0 },
  topMentor: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  topWords: { flex: 1, minWidth: 0 },
  lens: { fontFamily: font.sansBold, fontSize: 13, lineHeight: 18 },
  topTitle: { fontFamily: font.sansBold, fontSize: 17, lineHeight: 24 },
  composeBody: { flexGrow: 1, paddingHorizontal: space.md + space.xs, paddingTop: space.sm, paddingBottom: space.sm, gap: 12 },
  headline: { fontFamily: font.sansHeavy, fontSize: 24, lineHeight: 30 },
  fieldBlock: { marginTop: space.xs },
  groupHead: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: space.sm, marginBottom: space.xs + 2 },
  groupTitle: { fontFamily: font.sansBold, fontSize: 14, lineHeight: 18 },
  peek: { position: 'absolute', right: 18, top: -(COMPANION - COMPANION_TUCK), zIndex: 0 },
  fieldBox: { zIndex: 1 },
  field: { borderWidth: 1, paddingHorizontal: space.md, paddingVertical: space.sm + 2 },
  input: { minHeight: 5 * 24, textAlignVertical: 'top', padding: 0, margin: 0 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: { height: 44, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  chipText: { fontFamily: font.sansBold, fontSize: 14, lineHeight: 20 },
  promises: { gap: 6 },
  promise: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  promiseIcon: { marginTop: 1 },
  promiseText: { flex: 1, minWidth: 0 },
  footer: { paddingHorizontal: space.md + space.xs, paddingTop: space.sm, paddingBottom: space.md },
  footNote: { marginBottom: space.sm },
  footLine: { textAlign: 'center', marginBottom: space.sm },
  actions: { flexDirection: 'row', gap: 12 },
  cancelBox: { flex: 1 },
  sendBox: { flex: 1.6 },
  action: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingHorizontal: space.sm,
    borderWidth: 1,
  },
  actionFilled: { borderWidth: 0 },
  cancelText: { fontFamily: font.sansBold, fontSize: 15, lineHeight: 20, flexShrink: 1 },
  sendText: { fontFamily: font.sansBold, fontSize: 16, lineHeight: 24, flexShrink: 1 },
});
