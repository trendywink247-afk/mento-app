import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DeepHeader } from '@/components/DeepHeader';
import { GroundFade } from '@/components/GroundFade';
import { OpenQuestionNote } from '@/components/OpenQuestionNote';
import { InTouchBadge } from '@/components/InTouchBadge';
import { MentorFace } from '@/components/art/MentorFace';
import { CompanionPerches, CompanionSlot, useCompanionPlacement } from '@/components/art/PerchedCompanion';
import { DeepArrival } from '@/components/motion/DeepArrival';
import { Entrance } from '@/components/motion/Entrance';
import { PressKey } from '@/components/motion/PressKey';
import { ApiError, api, type Listener, type ListenerProfile } from '@/lib/api';
import type { PlacementSlot } from '@/lib/companionPlacement';
import { formatTopic } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { leaveToChats } from '@/lib/leaveToChats';
import { openQuestionFrom, type OpenQuestion } from '@/lib/openQuestion';
import { screenCache } from '@/lib/screenCache';
import { topicLabelKey } from '@/lib/topics';
import { useSessionGuard } from '@/lib/useSessionGuard';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type, washInk } from '@/theme/tokens';

/**
 * Browse mentors (board A25) — a deeper page (root stack, no tab bar): the pinned
 * "Next available mentor" key, working filters, and one card per mentor. In-touch mentors
 * come first — the API already sorts (in touch → favourites → available → rank); this
 * screen never re-orders. No ratings, counts, badges, real names or photos.
 *
 * The list endpoint carries no public line / availability note / community, so each card's
 * profile is read once (`GET /listeners/{id}`) and kept in memory for this session. A card
 * shows only what has arrived — never a guessed reply time.
 */
type Filter = 'all' | 'online' | 'upsc' | 'life' | 'touch';
type Detail = Pick<ListenerProfile, 'public_line' | 'availability_note' | 'community_slug'>;

const PERCHES: PlacementSlot[] = [{ id: 'nextTop', type: 'top', level: 'high', home: true }];
/** Memory only; the rotating NAME is never read from here (the list is the truth for it). */
const details = new Map<string, Detail>();

export default function BrowseMentors() {
  useSessionGuard();
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useI18n();
  // `question`: a draft carried from the first-question builder when nobody was free — it
  // travels on to the mentor page's question step, never sent by itself.
  const { topic, question } = useLocalSearchParams<{ topic?: string; question?: string }>();
  // Last-loaded list first, quiet refresh on focus; spinner only with nothing to show yet
  // (lib/screenCache.ts). Presence moves, so the refresh always runs.
  const cachedMentors = screenCache.get('mentors');
  const [loading, setLoading] = useState(!cachedMentors);
  const [listeners, setListeners] = useState<Listener[]>(cachedMentors ?? []);
  const [, setDetailTick] = useState(0);
  const [filter, setFilter] = useState<Filter>('all');
  const [note, setNote] = useState<string | null>(null);
  /** One open question at a time (server 409 `question_open`): a still note, never a dead end. */
  const [openQ, setOpenQ] = useState<OpenQuestion | null>(null);
  const [matching, setMatching] = useState(false);
  const perch = useCompanionPlacement('mentors', PERCHES, { still: note !== null });

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void api
        .listListeners()
        .then((l) => {
          screenCache.set('mentors', l);
          if (!active) return;
          setListeners(l);
          const missing = l.filter((m) => !details.has(m.id)).slice(0, 40);
          void Promise.all(
            missing.map((m) =>
              api
                .listenerProfile(m.id)
                .then((p) => {
                  details.set(m.id, {
                    public_line: p.public_line,
                    availability_note: p.availability_note,
                    community_slug: p.community_slug,
                  });
                })
                .catch(() => {}),
            ),
          ).then(() => {
            if (active && missing.length) setDetailTick((n) => n + 1);
          });
        })
        .catch(() => {})
        .finally(() => {
          if (active) setLoading(false);
        });
      return () => {
        active = false;
      };
    }, []),
  );

  const nextAvailable = async () => {
    if (matching) return;
    setMatching(true);
    setNote(null);
    setOpenQ(null);
    try {
      const match = await api.match({ kind: 'general', issue_category: topic ?? null });
      router.push({
        pathname: '/chat/[id]',
        params: {
          id: match.conversation_id,
          listener: match.listener_persona_name,
          channel: match.stream_channel_id ?? '',
        },
      });
    } catch (e) {
      const open = openQuestionFrom(e);
      if (open) setOpenQ(open);
      // Nobody free: the list below IS the other way (board A19 "Send your question instead").
      else setNote(e instanceof ApiError && e.status === 503 ? t('askFlow.busyBody') : t('common.networkError'));
    } finally {
      setMatching(false);
    }
  };

  const shown = useMemo(
    () =>
      listeners.filter((l) => {
        const community = details.get(l.id)?.community_slug ?? null;
        if (filter === 'online') return l.available;
        if (filter === 'touch') return Boolean(l.in_touch);
        if (filter === 'upsc') return community === 'upsc';
        if (filter === 'life') return community === 'life' || l.categories.includes('life');
        return true;
      }),
    // reason: `details` is a module map; the tick state re-renders when it fills
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [listeners, filter, details.size],
  );

  const filters: { key: Filter; label: string }[] = [
    { key: 'all', label: t('chats.filterAll') },
    { key: 'online', label: t('browse.filterOnline') },
    { key: 'upsc', label: t('browse.filterUpsc') },
    { key: 'life', label: t('browse.filterLife') },
    { key: 'touch', label: t('inTouch.badge') },
  ];

  const communityTag = (slug: string | null | undefined): string | null =>
    !slug ? null : slug === 'life' ? t('browse.filterLife') : slug === 'exams' ? t('browse.tagExams') : slug.toUpperCase();
  const topicTag = (slug: string): string => {
    const key = topicLabelKey(slug);
    return key ? t(key) : formatTopic(slug);
  };

  const back = () => (router.canGoBack() ? router.back() : leaveToChats(router));

  const renderCard = ({ item: l, index }: { item: Listener; index: number }) => {
    const d = details.get(l.id);
    const tags = [communityTag(d?.community_slug), ...l.categories.map(topicTag)]
      .filter((x): x is string => Boolean(x))
      .filter((x, i, all) => all.indexOf(x) === i)
      .slice(0, 3);
    const availability = l.available
      ? t('inTouch.hereNow')
      : d?.availability_note
        ? t('browse.usuallyHere', { note: d.availability_note })
        : t('inTouch.away');
    const second = l.first_met_as
      ? t('chatsList.firstTalkedAs', { name: l.first_met_as })
      : l.in_touch
        ? t('chatsList.yourMentor')
        : null;
    const card = (
      <PressKey
        onPress={() =>
          router.push({
            pathname: '/mentor/[id]',
            params: { id: l.id, ...(topic ? { topic } : {}), ...(question ? { question } : {}) },
          })
        }
        edge={colors.edgeSurface}
        radius={radius.lg}
        accessibilityLabel={[l.persona_name, second, availability].filter(Boolean).join('. ')}
        testID={`mentor-${l.id}`}
        style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
      >
        <MentorFace animal={l.companion_animal} colour={l.companion_colour} size={52} presence={l.available} />
        <View style={styles.cardBody}>
          <View style={styles.cardHead}>
            <Text style={[styles.cardName, { color: colors.ink }]} numberOfLines={1}>
              {l.persona_name}
            </Text>
            {l.in_touch ? <InTouchBadge flat testID={`mentor-in-touch-${l.id}`} /> : null}
            <View style={styles.grow} />
            <Ionicons name="chevron-forward" size={18} color={colors.inkMuted} />
          </View>
          {second ? (
            <Text style={[type.micro, { color: colors.inkMuted }]} numberOfLines={1}>
              {second}
            </Text>
          ) : null}
          <Text style={[styles.availability, { color: l.available ? washInk.green : colors.inkMuted }]} numberOfLines={1}>
            {availability}
          </Text>
          {d?.public_line ? (
            <Text style={[type.note, styles.line, { color: colors.ink }]} numberOfLines={3}>
              {t('browse.quoted', { line: d.public_line })}
            </Text>
          ) : null}
          {tags.length ? (
            <View style={styles.tags}>
              {tags.map((tag) => (
                <View key={tag} style={[styles.tag, { backgroundColor: colors.bgLavender }]}>
                  <Text style={[type.chip, { color: colors.inkMuted }]}>{tag}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      </PressKey>
    );
    return index < 4 ? <Entrance index={index + 3}>{card}</Entrance> : card;
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={['top', 'bottom']}>
      <CompanionPerches placement={perch}>
        <DeepHeader title={t('browse.title')} sub={t('browse.sub')} onBack={back} backLabel={t('browse.backA11y')} />

        <View style={[styles.pinned, { backgroundColor: colors.bg, borderBottomColor: colors.border }]}>
          <DeepArrival style={styles.pinnedCol}>
            <Entrance index={1}>
              <View>
                <CompanionSlot id="nextTop" size={54} inset={18} />
                <PressKey
                  onPress={() => void nextAvailable()}
                  edge={colors.accentEdge}
                  radius={radius.md}
                  intent="commit"
                  accessibilityLabel={t('chats.newChatNow')}
                  accessibilityHint={t('browse.nextSub')}
                  testID="next-available"
                  style={[styles.next, { backgroundColor: colors.accent }]}
                >
                  <View style={[styles.nextIcon, { backgroundColor: colors.surface }]}>
                    <Ionicons name="flash-outline" size={22} color={colors.accent} />
                  </View>
                  <View style={styles.cardBody}>
                    <Text style={[type.keyDense, styles.nextTitle, { color: colors.onAccent }]}>{t('chats.newChatNow')}</Text>
                    <Text style={[type.caption, { color: colors.onAccent }]}>{t('browse.nextSub')}</Text>
                  </View>
                  {matching ? (
                    <ActivityIndicator color={colors.onAccent} />
                  ) : (
                    <Ionicons name="arrow-forward" size={20} color={colors.onAccent} />
                  )}
                </PressKey>
              </View>
            </Entrance>
            <Entrance index={2} style={styles.filters}>
              {filters.map((f) => {
                const on = filter === f.key;
                return (
                  <PressKey
                    key={f.key}
                    onPress={() => setFilter(f.key)}
                    edge={on ? colors.edgeInk : colors.edgeSurface}
                    travel={4}
                    radius={radius.pill}
                    intent="select"
                    accessibilityState={{ selected: on }}
                    testID={`browse-filter-${f.key}`}
                    containerStyle={styles.filterCell}
                    style={[
                      styles.filter,
                      on
                        ? { backgroundColor: colors.ink, borderColor: colors.ink }
                        : { backgroundColor: colors.surface, borderColor: colors.border },
                    ]}
                  >
                    <Text style={[styles.filterText, { color: on ? colors.onBrand : colors.ink }]} numberOfLines={1}>
                      {f.label}
                    </Text>
                  </PressKey>
                );
              })}
            </Entrance>
          </DeepArrival>
          <View style={[styles.pinnedEdge, { backgroundColor: colors.edgeSurface }]} pointerEvents="none" />
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={colors.accent} />
          </View>
        ) : (
          <FlatList
            data={shown}
            keyExtractor={(l) => l.id}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.list}
            testID="browse-list"
            ListHeaderComponent={
              openQ ? (
                <OpenQuestionNote
                  question={openQ}
                  onClosed={() => {
                    setOpenQ(null);
                    setNote(t('askFlow.openClosed'));
                  }}
                  testID="browse-open"
                />
              ) : note ? (
                // Still on purpose (T&S #11).
                <Text style={[type.note, styles.note, { color: colors.ink, backgroundColor: colors.surfaceAlt, borderColor: colors.border }]} testID="browse-note">
                  {note}
                </Text>
              ) : null
            }
            ListEmptyComponent={
              <Text style={[type.note, styles.empty, { color: colors.inkMuted }]} testID="browse-empty">
                {filter === 'touch' ? t('inTouch.emptyBody') : t('browse.empty')}
              </Text>
            }
            ListFooterComponent={
              <View style={[styles.foot, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
                <Ionicons name="shield-outline" size={18} color={colors.accent} />
                <Text style={[type.caption, styles.footText, { color: colors.inkMuted }]}>{t('browse.namesNote')}</Text>
              </View>
            }
            renderItem={renderCard}
          />
        )}
        <GroundFade height={84} />
      </CompanionPerches>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  pinned: { zIndex: 3, paddingTop: 12, paddingHorizontal: space.md, paddingBottom: 10, borderBottomWidth: 1 },
  pinnedCol: { gap: 12 },
  pinnedEdge: { position: 'absolute', left: 0, right: 0, bottom: -4, height: 3 },
  next: { height: 60, paddingLeft: 10, paddingRight: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  nextIcon: { width: 40, height: 40, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  nextTitle: { lineHeight: 22 },
  filters: { flexDirection: 'row', gap: 6 },
  filterCell: { flexGrow: 1, flexShrink: 1 },
  filter: { height: 44, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  filterText: { fontFamily: font.sansBold, fontSize: 13, lineHeight: 18 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { paddingTop: 14, paddingHorizontal: space.md, paddingBottom: 104, gap: 10 },
  note: { padding: 12, borderRadius: radius.md, borderWidth: 1 },
  empty: { textAlign: 'center', paddingVertical: space.lg },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 12,
    paddingLeft: 10,
    paddingRight: 14,
    borderWidth: 1,
  },
  cardBody: { flex: 1, minWidth: 0, gap: 1 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardName: { fontFamily: font.sansBold, fontSize: 16, lineHeight: 22, flexShrink: 1 },
  grow: { flexGrow: 1 },
  availability: { fontFamily: font.sansBold, fontSize: 12, lineHeight: 16 },
  line: { paddingTop: 3 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingTop: 6 },
  tag: { height: 20, paddingHorizontal: 8, justifyContent: 'center', borderRadius: radius.pill },
  foot: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  footText: { flex: 1 },
});
