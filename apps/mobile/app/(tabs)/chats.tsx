import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EdgeSurface } from '@/components/EdgeSurface';
import { GroundFade } from '@/components/GroundFade';
import { LinkedRings } from '@/components/InTouchBadge';
import { PrimaryButton } from '@/components/PrimaryButton';
import { LottieTile } from '@/components/art/LottieTile';
import { CompanionPerches, CompanionSlot, useCompanionPlacement } from '@/components/art/PerchedCompanion';
import { PinPad } from '@/components/chat/options/bits';
import { ChatRow, type ChatRowState } from '@/components/chats/ChatRow';
import { SettleBack, useSheetOpen } from '@/components/motion/BoardSheet';
import { Entrance } from '@/components/motion/Entrance';
import { PressKey } from '@/components/motion/PressKey';
import { ApiError, api, type ConversationListItem, type InTouchItem, type InTouchList } from '@/lib/api';
import type { PlacementSlot } from '@/lib/companionPlacement';
import { relativeTime } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { screenCache, type ChatPreview, type WaitingQuestion } from '@/lib/screenCache';
import { getPersona, getStreamToken } from '@/lib/session';
import { ensureConnected } from '@/lib/streamClient';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type } from '@/theme/tokens';

/** My Chats (board A06): the header with its quiet Feedback pill, search, the
 * All chats / In touch switch (In touch is a SEPARATE view: only mentors who said yes —
 * `GET /in-touch`), the filter chips, richer rows, and the New chat card floating over the
 * end of the list. Locked chats still open through the PIN gate. */

/** Where the companion can be on My Chats (lib/companionPlacement.ts). Home is where the
 * board draws it: sitting on the bottom edge of the search-and-filter block (the id keeps
 * its old name — specs and stored placements know it). The New chat card's top edge only
 * counts while the list is short enough that no row can be resting behind the card. */
const HOME_PERCHES: PlacementSlot[] = [{ id: 'titleCorner', type: 'top', level: 'high', home: true }];
const CARD_PERCHES: PlacementSlot[] = [
  { id: 'fabTop', type: 'top', level: 'low' },
  { id: 'fabDangle', type: 'dangle', level: 'low' },
];
/** Rows that fit above the New chat card on the smallest supported phone (360×740). */
const SHORT_LIST = 2;

// reason: the feedback sheet (board A11) belongs to another lane; this branch has no
// `/feedback` route yet, so the pill is drawn and leads nowhere until that route lands.
const FEEDBACK_ROUTE: Href | null = null;

type Filter = 'all' | 'active' | 'completed';
type View2 = 'all' | 'touch';
type Row =
  | { kind: 'convo'; key: string; at: number; convo: ConversationListItem }
  | { kind: 'waiting'; key: string; at: number; ask: WaitingQuestion };

export default function ChatsTab() {
  const router = useRouter();
  const { colors, elevation } = useTheme();
  const { t } = useI18n();
  const sheetOpen = useSheetOpen();
  // Coming back from a chat remounts this tab (see lib/screenCache.ts): start from what was
  // last on screen and refresh quietly. The spinner is for the very first load only.
  const cached = screenCache.get('chats');
  const [loading, setLoading] = useState(!cached);
  const [rows, setRows] = useState<ConversationListItem[]>(cached?.rows ?? []);
  const [previews, setPreviews] = useState<Record<string, ChatPreview>>(cached?.previews ?? {});
  const [waiting, setWaiting] = useState<WaitingQuestion[]>(cached?.waiting ?? []);
  const [saved, setSaved] = useState<Record<string, number>>(cached?.saved ?? {});
  const [touch, setTouch] = useState<InTouchList | null>(screenCache.get('inTouch') ?? null);
  const [touchError, setTouchError] = useState(false);
  const [view, setView] = useState<View2>('all');
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  // Locked-chat gate: which row is awaiting a PIN.
  const [gate, setGate] = useState<ConversationListItem | null>(null);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinBusy, setPinBusy] = useState(false);

  const load = useCallback(async () => {
    const remember = (patch: Partial<NonNullable<ReturnType<typeof screenCache.get<'chats'>>>>) => {
      const now = screenCache.get('chats');
      if (now) screenCache.set('chats', { ...now, ...patch });
    };

    // In touch is its own read; its failure never blocks the list.
    void api
      .inTouch()
      .then((list) => {
        setTouch(list);
        setTouchError(false);
        screenCache.set('inTouch', list);
      })
      .catch(() => setTouchError(true));

    try {
      const list = await api.listConversations();
      setRows(list);
      setLoadError(null);
      screenCache.set('chats', { ...(screenCache.get('chats') ?? { previews: {} }), rows: list });

      // Open questions (unanswered Personal requests) joined with the mentor they went to,
      // and what was saved from each chat. Both best-effort.
      void Promise.all([api.myRequests(), api.listListeners()])
        .then(([requests, mentors]) => {
          const open: WaitingQuestion[] = [];
          for (const r of requests) {
            if (r.status !== 'pending' || !r.target_listener_id) continue;
            const m = mentors.find((x) => x.id === r.target_listener_id);
            if (!m) continue;
            open.push({
              id: r.id,
              listenerId: m.id,
              name: m.persona_name,
              avatar: m.persona_avatar,
              intro: r.intro_message,
              createdAt: r.created_at,
            });
          }
          setWaiting(open);
          remember({ waiting: open });
        })
        .catch(() => {});
      void api
        .listMentorNotes()
        .then((notes) => {
          const counts: Record<string, number> = {};
          for (const n of notes) {
            const id = n.meta?.conversation_id;
            if (id) counts[id] = (counts[id] ?? 0) + 1;
          }
          setSaved(counts);
          remember({ saved: counts });
        })
        .catch(() => {});

      // Last message + unread per channel, straight from Stream client-side.
      // Previews are best-effort: their failure never blocks the list.
      try {
        const [persona, token] = await Promise.all([getPersona(), getStreamToken()]);
        // Stream caps $in filters at 30 ids; the API list is newest-first, so keep the
        // 30 most recent — older rows just fall back to their backend-only preview.
        const channelIds = (list.map((c) => c.stream_channel_id).filter(Boolean) as string[]).slice(0, 30);
        if (persona && token && channelIds.length) {
          const client = await ensureConnected({ id: persona.id, name: persona.persona_name }, token);
          const channels = await client.queryChannels(
            { type: 'messaging', id: { $in: channelIds } },
            { last_message_at: -1 },
            { watch: false, state: true },
          );
          const map: Record<string, ChatPreview> = {};
          for (const ch of channels) {
            const last = ch.state.messages[ch.state.messages.length - 1];
            if (ch.id) {
              map[ch.id] = {
                text: last?.text ?? '',
                at: last?.created_at ? new Date(last.created_at) : null,
                unread: ch.countUnread(),
              };
            }
          }
          setPreviews(map);
          remember({ previews: map });
        }
      } catch {
        // Best-effort previews — the list stays usable from backend data alone.
      }
    } catch {
      // The conversation list itself failed — show an honest note instead of
      // silently rendering an empty screen.
      setLoadError(t('chats.loadError'));
    } finally {
      setLoading(false);
    }
    // reason: `t` is intentionally not a trigger — a locale flip must not refetch the list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // Clean Wipe happens in a chat stacked over this (still mounted) list: the moment the wipe
  // is asked for, the row becomes its "wiped" marker and its message preview is dropped — the
  // last message is never on screen when the member lands back here.
  useEffect(
    () =>
      screenCache.onConversationForgotten(() => {
        const next = screenCache.get('chats');
        if (!next) return;
        setRows(next.rows);
        setPreviews(next.previews);
      }),
    [],
  );

  const pushChat = (c: { id: string; listener_persona_name: string; stream_channel_id: string | null }) =>
    router.push({
      pathname: '/chat/[id]',
      params: { id: c.id, listener: c.listener_persona_name, channel: c.stream_channel_id ?? '' },
    });

  const open = (c: ConversationListItem) => {
    if (c.is_locked) {
      setGate(c);
      setPin('');
      setPinError(null);
      return;
    }
    pushChat(c);
  };

  /** An in-touch mentor: the open chat if there is one, otherwise a new question to them. */
  const openTouch = (item: InTouchItem) => {
    const live = item.conversation_status === 'active' ? rows.find((c) => c.id === item.conversation_id) : undefined;
    if (live) return open(live);
    router.push({ pathname: '/mentor/[id]', params: { id: item.listener_id } });
  };

  const submitPin = async () => {
    if (!gate || pin.length !== 4 || pinBusy) return;
    setPinBusy(true);
    try {
      await api.verifyPin(gate.id, pin);
      const target = gate;
      setGate(null);
      pushChat(target);
    } catch (e) {
      setPin('');
      setPinError(e instanceof ApiError && e.status === 403 ? t('chats.pinWrong') : t('common.somethingWrong'));
    } finally {
      setPinBusy(false);
    }
  };

  const openNewChat = () => router.push('/new-chat');

  const needle = query.trim().toLowerCase();
  const merged: Row[] = useMemo(() => {
    const out: Row[] = [];
    for (const c of rows) {
      if (filter === 'active' && c.status !== 'active') continue;
      if (filter === 'completed' && c.status === 'active') continue;
      if (
        needle &&
        !c.listener_persona_name.toLowerCase().includes(needle) &&
        !(c.first_met_as ?? '').toLowerCase().includes(needle)
      )
        continue;
      const p = c.stream_channel_id ? previews[c.stream_channel_id] : undefined;
      out.push({ kind: 'convo', key: c.id, at: (p?.at ?? new Date(c.created_at)).getTime(), convo: c });
    }
    if (filter !== 'completed') {
      for (const w of waiting) {
        if (needle && !w.name.toLowerCase().includes(needle)) continue;
        out.push({ kind: 'waiting', key: `ask-${w.id}`, at: new Date(w.createdAt).getTime(), ask: w });
      }
    }
    // Open chats first, then open questions, then what is finished — newest first in each.
    const rank = (r: Row) => (r.kind === 'waiting' ? 1 : r.convo.status === 'active' ? 0 : 2);
    return out.sort((a, b) => rank(a) - rank(b) || b.at - a.at);
  }, [rows, waiting, previews, filter, needle]);

  const chips: { key: Filter; label: string }[] = [
    { key: 'all', label: t('chats.filterAll') },
    { key: 'active', label: t('chats.filterActive') },
    { key: 'completed', label: t('chats.filterCompleted') },
  ];

  const hasAnything = rows.length > 0 || waiting.length > 0;
  const showTools = hasAnything && view === 'all';
  const slots = touch?.slots ?? null;
  const touchFull = Boolean(slots && slots.in_touch >= slots.limit);
  const listLength = view === 'all' ? merged.length : (touch?.items.length ?? 0);

  const perches = useMemo(
    () => [...HOME_PERCHES, ...(!loading && hasAnything && listLength <= SHORT_LIST ? CARD_PERCHES : [])],
    [loading, hasAnything, listLength],
  );
  // An honest error is a still state; a sheet over the list hides the companion.
  const perch = useCompanionPlacement('chats', perches, {
    still: loadError !== null,
    hidden: sheetOpen || gate !== null,
  });

  const stateOf = (c: ConversationListItem): ChatRowState =>
    c.status === 'active' ? 'active' : c.status === 'wiped' ? 'wiped' : 'completed';
  const stateLabel = (s: ChatRowState) =>
    s === 'active'
      ? t('chats.statusActive')
      : s === 'waiting'
        ? t('chatsList.waiting')
        : s === 'wiped'
          ? t('chatsList.wipedChip')
          : t('chats.statusCompleted');

  const renderRow = ({ item, index }: { item: Row; index: number }) => {
    let row;
    if (item.kind === 'waiting') {
      const w = item.ask;
      row = (
        <ChatRow
          testID={`waiting-${w.id}`}
          avatarSeed={w.avatar}
          name={w.name}
          state="waiting"
          stateLabel={stateLabel('waiting')}
          secondLine={t('chatsList.waitingLine', { name: w.name })}
          lastLine=""
          quietLine={w.intro ? t('chatsList.youSaid', { text: w.intro }) : null}
          time={relativeTime(w.createdAt, t)}
          unreadLabel={t('chatsList.newMessageA11y')}
          accessibilityLabel={t('chatsList.waitingA11y', { name: w.name })}
          onPress={() => router.push({ pathname: '/mentor/[id]', params: { id: w.listenerId } })}
        />
      );
    } else {
      const c = item.convo;
      const p = c.stream_channel_id ? previews[c.stream_channel_id] : undefined;
      const s = stateOf(c);
      const count = saved[c.id] ?? 0;
      row = (
        <ChatRow
          testID={`convo-${c.id}`}
          avatarSeed={c.listener_persona_avatar}
          name={c.listener_persona_name}
          state={s}
          stateLabel={stateLabel(s)}
          inTouch={Boolean(c.in_touch)}
          secondLine={
            c.first_met_as
              ? t('chatsList.firstTalkedAs', { name: c.first_met_as })
              : c.in_touch
                ? t('chatsList.yourMentor')
                : null
          }
          lastLine={s === 'wiped' ? t('chats.wiped') : p?.text || t('chats.sayHello')}
          time={relativeTime((p?.at ?? new Date(c.created_at)).toISOString(), t)}
          unread={Boolean(p && p.unread > 0) && s === 'active'}
          unreadLabel={t('chatsList.newMessageA11y')}
          savedLabel={s !== 'wiped' && count > 0 ? t('chatsList.savedCount', { count }) : null}
          lockedLabel={c.is_locked ? t('chatsList.locked') : null}
          accessibilityLabel={t('chats.convoA11y', { name: c.listener_persona_name })}
          onPress={() => open(c)}
        />
      );
    }
    // Reading-order arrival for the first screenful only; later rows are simply there.
    return index < 5 ? <Entrance index={index + 1}>{row}</Entrance> : row;
  };

  const footer = (
    <Text style={[type.caption, styles.peers, { color: colors.inkMuted }]}>{t('chatsList.peersLine')}</Text>
  );

  const waitingOn = waiting[0] ?? null;

  return (
    <SettleBack>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <CompanionPerches placement={perch}>
          <Entrance style={styles.head}>
            <View style={styles.headRow}>
              <Text style={[type.display, { color: colors.ink }]} accessibilityRole="header">
                {t('chatsList.titleLead')} <Text style={{ color: colors.accent }}>{t('chatsList.titleAccent')}</Text>
              </Text>
              <PressKey
                onPress={() => {
                  if (FEEDBACK_ROUTE) router.push(FEEDBACK_ROUTE);
                }}
                edge={colors.edgeSurface}
                travel={3}
                radius={radius.pill}
                accessibilityLabel={t('chatsList.feedbackA11y')}
                testID="chats-feedback"
                style={[styles.feedback, { backgroundColor: colors.surface, borderColor: colors.border }]}
              >
                <Ionicons name="chatbox-outline" size={16} color={colors.inkMuted} />
                <Text style={[styles.feedbackText, { color: colors.inkMuted }]}>{t('chatsList.feedback')}</Text>
              </PressKey>
            </View>
            <Text style={[type.bodySmall, { color: colors.inkMuted }]}>{t('chats.sub')}</Text>
          </Entrance>

          {/* Search, the switch and the filters: one block with a pillow underside, and the
              companion's home on its bottom edge. It is simply there — no arrival. */}
          <View style={[styles.tools, { backgroundColor: colors.bg, borderBottomColor: colors.border }]}>
            {showTools ? (
              <EdgeSurface
                edge={colors.edgeSurface}
                travel={4}
                radius={radius.md}
                style={[styles.search, { backgroundColor: colors.surface, borderColor: colors.border }]}
              >
                <Ionicons name="search-outline" size={20} color={colors.inkMuted} />
                <TextInput
                  style={[styles.searchInput, { color: colors.ink }]}
                  placeholder={t('chats.searchPlaceholder')}
                  placeholderTextColor={colors.inkMuted}
                  value={query}
                  onChangeText={setQuery}
                  accessibilityLabel={t('chats.searchA11y')}
                  testID="chats-search"
                />
              </EdgeSurface>
            ) : null}

            <View
              style={[styles.switch, { backgroundColor: colors.bgLavender }]}
              accessibilityRole="tablist"
              accessibilityLabel={t('chatsList.switchA11y')}
            >
              {(['all', 'touch'] as const).map((v) => {
                const on = view === v;
                return (
                  <PressKey
                    key={v}
                    onPress={() => setView(v)}
                    edge={on ? colors.edgeAlt : 'transparent'}
                    travel={3}
                    radius={radius.pill}
                    intent="select"
                    accessibilityRole="tab"
                    accessibilityState={{ selected: on }}
                    testID={`chats-view-${v}`}
                    containerStyle={styles.switchCell}
                    style={[styles.switchFace, on && { backgroundColor: colors.surface }]}
                  >
                    {v === 'touch' ? <LinkedRings color={on ? colors.ink : colors.inkMuted} size={14} /> : null}
                    <Text style={[styles.switchText, { color: on ? colors.ink : colors.inkMuted }]} numberOfLines={1}>
                      {v === 'all'
                        ? t('chatsList.allChats')
                        : slots
                          ? t('inTouch.tab', { used: slots.in_touch, limit: slots.limit })
                          : t('inTouch.tabPlain')}
                    </Text>
                  </PressKey>
                );
              })}
            </View>

            {showTools ? (
              <View style={styles.chips} accessibilityLabel={t('chatsList.filterA11y')}>
                {chips.map((c) => {
                  const selected = filter === c.key;
                  return (
                    <PressKey
                      key={c.key}
                      onPress={() => setFilter(c.key)}
                      edge={selected ? colors.edgeInk : colors.edgeSurface}
                      travel={4}
                      radius={radius.pill}
                      intent="select"
                      accessibilityState={{ selected }}
                      testID={`filter-${c.key}`}
                      style={[
                        styles.chip,
                        selected
                          ? { backgroundColor: colors.ink, borderColor: colors.ink }
                          : { backgroundColor: colors.surface, borderColor: colors.border },
                      ]}
                    >
                      <Text style={[type.label, { color: selected ? colors.onBrand : colors.ink }]}>{c.label}</Text>
                    </PressKey>
                  );
                })}
              </View>
            ) : view === 'touch' ? (
              // Where the filters were: one quiet line, so the block keeps its height and the
              // companion on its edge never stands in front of the switch.
              <View style={styles.touchLine}>
                <Text style={[type.caption, styles.touchLineText, { color: colors.inkMuted }]}>{t('inTouch.viewLine')}</Text>
              </View>
            ) : (
              // Nothing to filter yet: the same room is kept for the companion.
              <View style={styles.touchLine} />
            )}
            <View style={[styles.toolsEdge, { backgroundColor: colors.edgeSurface }]} pointerEvents="none" />
            <View style={styles.toolsFloor} pointerEvents="none">
              <CompanionSlot id="titleCorner" size={54} inset={26} attach="floor" />
            </View>
          </View>

          {loadError ? (
            <EdgeSurface
              edge={colors.edgeAlt}
              travel={2}
              radius={radius.md}
              style={[styles.note, { backgroundColor: colors.surfaceAlt }]}
              containerStyle={styles.noteBox}
              testID="chats-load-error"
            >
              <Text style={[type.caption, { color: colors.ink, flex: 1 }]}>{loadError}</Text>
              <Pressable
                onPress={() => {
                  setLoadError(null);
                  // Retry with a list on screen stays still; only an empty screen spins.
                  if (rows.length === 0) setLoading(true);
                  void load();
                }}
                accessibilityRole="button"
                accessibilityLabel={t('chats.retryA11y')}
                testID="chats-load-retry"
                hitSlop={8}
              >
                <Text style={[type.label, { color: colors.accent }]}>{t('chats.retry')}</Text>
              </Pressable>
            </EdgeSurface>
          ) : null}

          {loading ? (
            <View style={styles.center} testID="chats-loading">
              <ActivityIndicator size="large" color={colors.accent} />
            </View>
          ) : view === 'touch' ? (
            <FlatList
              key="touch"
              data={touch?.items ?? []}
              keyExtractor={(i) => i.link_id}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.list}
              testID="in-touch-list"
              ListEmptyComponent={
                // Still on purpose: an empty or failed view is a limit state.
                <View style={[styles.calm, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]} testID="in-touch-empty">
                  <Text style={[type.rowTitle, { color: colors.ink }]}>
                    {touchError && !touch ? t('inTouch.loadError') : t('inTouch.emptyTitle')}
                  </Text>
                  {touchError && !touch ? null : (
                    <Text style={[type.note, { color: colors.inkMuted }]}>{t('inTouch.emptyBody')}</Text>
                  )}
                </View>
              }
              ListFooterComponent={
                <View style={styles.footerGap}>
                  {touchFull && slots ? (
                    // A limit state: nothing on it animates.
                    <View style={[styles.calm, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]} testID="in-touch-full">
                      <View style={styles.calmHead}>
                        <View style={styles.pips}>
                          {Array.from({ length: slots.limit }).map((_, i) => (
                            <View key={i} style={[styles.pip, { backgroundColor: colors.accent }]} />
                          ))}
                        </View>
                        <Text style={[type.rowTitle, { color: colors.ink }]}>{t('inTouch.fullTitle')}</Text>
                      </View>
                      <Text style={[type.note, { color: colors.inkMuted }]}>{t('inTouch.fullBody')}</Text>
                    </View>
                  ) : null}
                  {footer}
                </View>
              }
              renderItem={({ item, index }) => {
                const live = item.conversation_status === 'active';
                const c = rows.find((r) => r.id === item.conversation_id);
                const p = item.stream_channel_id ? previews[item.stream_channel_id] : undefined;
                const s: ChatRowState = live ? 'active' : 'completed';
                return (
                  <Entrance index={index + 1}>
                    <ChatRow
                      testID={`in-touch-row-${item.link_id}`}
                      avatarSeed={item.persona_avatar}
                      name={item.persona_name}
                      state={s}
                      stateLabel={stateLabel(s)}
                      inTouch
                      secondLine={
                        item.first_met_as
                          ? t('chatsList.firstTalkedAs', { name: item.first_met_as })
                          : t('chatsList.yourMentor')
                      }
                      lastLine={
                        c?.status === 'wiped'
                          ? t('chats.wiped')
                          : p?.text || (item.status === 'online' ? t('inTouch.hereNow') : t('inTouch.away'))
                      }
                      time={relativeTime((p?.at ?? new Date(item.since ?? item.first_met_at)).toISOString(), t)}
                      unread={Boolean(p && p.unread > 0) && live}
                      unreadLabel={t('chatsList.newMessageA11y')}
                      lockedLabel={c?.is_locked ? t('chatsList.locked') : null}
                      accessibilityLabel={t('inTouch.rowA11y', { name: item.persona_name })}
                      onPress={() => openTouch(item)}
                    />
                  </Entrance>
                );
              }}
            />
          ) : !hasAnything ? (
            <View style={styles.center}>
              <LottieTile name="chatDots" fallback="chatsEmpty" size={140} />
              <Text style={[type.title, { color: colors.ink }]}>{t('chats.emptyTitle')}</Text>
              <Text style={[type.body, styles.centerText, { color: colors.inkMuted }]}>{t('chats.emptyBody')}</Text>
              <View style={styles.emptyCta}>
                <PrimaryButton
                  label={t('chats.startCta')}
                  icon="chatbubble-ellipses"
                  onPress={openNewChat}
                  testID="start-from-chats"
                />
              </View>
            </View>
          ) : (
            <FlatList
              key="all"
              data={merged}
              keyExtractor={(r) => r.key}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.list}
              ListEmptyComponent={
                <Text style={[type.note, styles.centerText, { color: colors.inkMuted }]}>{t('chatsList.noMatches')}</Text>
              }
              ListFooterComponent={<View style={styles.footerGap}>{footer}</View>}
              renderItem={renderRow}
            />
          )}

          {!loading && hasAnything ? (
            <>
              <GroundFade height={136} />
              <View style={styles.newChatWrap} pointerEvents="box-none">
                <CompanionSlot id="fabTop" size={52} align="left" inset={space.lg} />
                <CompanionSlot id="fabDangle" size={56} align="left" inset={space.lg} nudge={4} />
                <View
                  style={[styles.newChatCard, elevation.md, { backgroundColor: colors.surface, borderColor: colors.border }]}
                >
                  <Text style={[type.caption, styles.newChatHelp, { color: colors.ink }]} testID="new-chat-help">
                    {waitingOn ? t('chatsList.newChatWaiting', { name: waitingOn.name }) : t('chatsList.newChatFree')}
                  </Text>
                  {waitingOn ? (
                    // A question is already open: the board draws the key dashed and quiet.
                    // reason: it still opens the sheet — the server has no "one open question"
                    // rule and no way to close a question, so locking it would be a dead end.
                    <PressKey
                      onPress={openNewChat}
                      edge="transparent"
                      travel={2}
                      radius={radius.md}
                      haptic="none"
                      accessibilityLabel={t('chats.newChatA11y')}
                      testID="new-chat-fab"
                      style={[styles.newChatKey, styles.newChatDashed, { backgroundColor: colors.bgLavender, borderColor: colors.dotIdle }]}
                    >
                      <Ionicons name="add" size={18} color={colors.inkMuted} />
                      <Text style={[styles.newChatText, { color: colors.inkMuted }]}>{t('chats.newChat')}</Text>
                    </PressKey>
                  ) : (
                    <PressKey
                      onPress={openNewChat}
                      edge={colors.accentEdge}
                      radius={radius.md}
                      accessibilityLabel={t('chats.newChatA11y')}
                      testID="new-chat-fab"
                      style={[styles.newChatKey, { backgroundColor: colors.accent }]}
                    >
                      <Ionicons name="add" size={18} color={colors.onAccent} />
                      <Text style={[styles.newChatText, { color: colors.onAccent }]}>{t('chats.newChat')}</Text>
                    </PressKey>
                  )}
                </View>
              </View>
              <View style={styles.privacy} pointerEvents="none">
                <Ionicons name="lock-closed-outline" size={15} color={colors.inkMuted} />
                <Text style={[type.caption, { color: colors.inkMuted }]}>{t('chats.privacyFooter')}</Text>
              </View>
            </>
          ) : null}

          {gate ? (
            <View style={[styles.gateBackdrop, { backgroundColor: colors.scrim }]}>
              <View style={[styles.gateCard, { backgroundColor: colors.surface }, elevation.md]}>
                <Text style={[type.sheetTitle, styles.centerText, { color: colors.ink }]}>{t('chats.gateTitle')}</Text>
                <Text style={[type.body, styles.centerText, { color: colors.inkMuted }]}>{t('chats.gateBody')}</Text>
                <PinPad
                  value={pin}
                  onChange={(v) => {
                    setPin(v);
                    setPinError(null);
                  }}
                  error={pinError}
                />
                <PrimaryButton
                  label={t('chats.open')}
                  onPress={() => void submitPin()}
                  disabled={pin.length !== 4}
                  loading={pinBusy}
                  testID="gate-open"
                />
                <PrimaryButton label={t('common.cancel')} variant="link" onPress={() => setGate(null)} testID="gate-cancel" />
              </View>
            </View>
          ) : null}
        </CompanionPerches>
      </SafeAreaView>
    </SettleBack>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  head: { paddingTop: space.xs, paddingHorizontal: space.lg, paddingBottom: 10 },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  feedback: {
    height: 44,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
  },
  feedbackText: { fontFamily: font.sansBold, fontSize: 13, lineHeight: 18 },
  tools: { zIndex: 3, paddingHorizontal: space.md, paddingBottom: 10, gap: 10, borderBottomWidth: 1 },
  toolsEdge: { position: 'absolute', left: 0, right: 0, bottom: -4, height: 3 },
  toolsFloor: { position: 'absolute', left: 0, right: 0, bottom: -1, height: 0 },
  search: {
    height: 52,
    paddingHorizontal: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
  },
  searchInput: { flex: 1, minWidth: 0, height: 44, ...type.body },
  switch: { flexDirection: 'row', padding: 4, borderRadius: radius.pill },
  switchCell: { flex: 1 },
  switchFace: { height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  switchText: { fontFamily: font.sansBold, fontSize: 15, lineHeight: 20 },
  chips: { flexDirection: 'row', gap: space.sm },
  touchLine: { minHeight: 48, justifyContent: 'center', paddingLeft: space.sm, paddingRight: 96 },
  touchLineText: {},
  chip: { height: 44, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  note: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.sm },
  noteBox: { marginHorizontal: space.md, marginTop: space.sm },
  list: { paddingTop: 14, paddingHorizontal: space.md, paddingBottom: 170, gap: 10 },
  footerGap: { gap: 10 },
  peers: { textAlign: 'center', paddingTop: space.xs, paddingHorizontal: space.sm },
  calm: { padding: space.md, gap: 10, borderRadius: radius.lg, borderWidth: 1 },
  calmHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pips: { flexDirection: 'row', gap: 6 },
  pip: { width: 28, height: 10, borderRadius: radius.pill },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.sm, paddingHorizontal: space.lg },
  centerText: { textAlign: 'center' },
  emptyCta: { alignSelf: 'stretch', marginTop: space.sm },
  newChatWrap: { position: 'absolute', left: space.md, right: space.md, bottom: 36 },
  newChatCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingRight: 10,
    paddingLeft: 14,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  newChatHelp: { flex: 1, minWidth: 0 },
  newChatKey: {
    height: 48,
    paddingLeft: 10,
    paddingRight: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.md,
  },
  newChatDashed: { borderWidth: 1, borderStyle: 'dashed' },
  newChatText: { fontFamily: font.sansBold, fontSize: 15, lineHeight: 20 },
  privacy: {
    position: 'absolute',
    left: space.md,
    right: space.md,
    bottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  gateBackdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 50,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.lg,
  },
  gateCard: { alignSelf: 'stretch', borderRadius: radius.lg, padding: space.lg, gap: space.sm },
});
