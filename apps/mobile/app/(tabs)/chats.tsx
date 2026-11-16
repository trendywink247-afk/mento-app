import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EdgeSurface } from '@/components/EdgeSurface';
import { FeedbackPill } from '@/components/FeedbackPill';
import { PrimaryButton } from '@/components/PrimaryButton';
import { CompanionPerches, CompanionSlot, useCompanionPlacement } from '@/components/art/PerchedCompanion';
import { PinPad } from '@/components/chat/options/bits';
import { ChatActionsSheet } from '@/components/chats/ChatActionsSheet';
import { ChatRow, type ChatRowState } from '@/components/chats/ChatRow';
import { SwipeRow } from '@/components/chats/SwipeRow';
import { useChatPrefs } from '@/lib/chatPrefs';
import { chatFaceKey } from '@/lib/originStore';
import { ChatsEmpty } from '@/components/chats/ChatsEmpty';
import { SettleBack, useSheetOpen } from '@/components/motion/BoardSheet';
import { Entrance } from '@/components/motion/Entrance';
import { PressKey } from '@/components/motion/PressKey';
import { useTabDockHeight } from '@/components/tabDock';
import { ApiError, api, type ConversationListItem, type InTouchItem, type InTouchList } from '@/lib/api';
import type { PlacementSlot } from '@/lib/companionPlacement';
import { relativeTime } from '@/lib/format';
import { requestLetter } from '@/lib/requestLetter';
import { useI18n } from '@/lib/i18n';
import { mentorFaces } from '@/lib/mentorFaces';
import { screenCache, type ChatPreview, type WaitingQuestion } from '@/lib/screenCache';
import { useLiveRefresh } from '@/lib/liveEvents';
import { rowUnread } from '@/lib/rowUnread';
import { getPersona, getStreamToken } from '@/lib/session';
import { ensureConnected } from '@/lib/streamClient';
import { useFlatSurfaces, useTheme } from '@/theme/ThemeProvider';
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

// DECISIONS T.1: All, In touch and Unread as one row of chips (In touch switches the view).
type Filter = 'all' | 'unread';
type View2 = 'all' | 'touch';
type Row =
  | { kind: 'convo'; key: string; at: number; convo: ConversationListItem }
  | { kind: 'waiting'; key: string; at: number; ask: WaitingQuestion }
  // "Archived · n" on top of the list when any chat is archived, and the way back from it.
  | { kind: 'archive'; key: string; at: number; count: number }
  | { kind: 'archiveBack'; key: string; at: number };

export default function ChatsTab() {
  const router = useRouter();
  const { colors, elevation } = useTheme();
  const flat = useFlatSurfaces();
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
  // Pin and Archive live on this phone; Mute is the chat's Quiet Pause; Delete is the real wipe.
  const { prefs: chatPrefs, pin: togglePinned, archive: toggleArchived, prune: pruneChatPrefs } = useChatPrefs();
  const [showArchived, setShowArchived] = useState(false);
  const [actionFor, setActionFor] = useState<{ convo: ConversationListItem; confirm: boolean } | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [mutedLocal, setMutedLocal] = useState<Record<string, boolean>>({});
  const [actionError, setActionError] = useState<string | null>(null);

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
      // The chat header paints this mentor's face at once when a row is opened.
      for (const c of list) {
        mentorFaces.remember({
          conversationId: c.id,
          animal: c.listener_companion_animal,
          colour: c.listener_companion_colour,
        });
      }
      setLoadError(null);
      screenCache.set('chats', { ...(screenCache.get('chats') ?? { previews: {} }), rows: list });

      // Open questions (unanswered Personal requests) joined with the mentor they went to,
      // and what was saved from each chat. Both best-effort.
      void Promise.all([api.myRequests(), api.listListeners()])
        .then(([requests, mentors]) => {
          const open: WaitingQuestion[] = [];
          for (const r of requests) {
            if (r.status !== 'pending') continue;
            if (!r.target_listener_id) {
              // Asked to everyone: no single mentor yet, so the row says so (the radio mark).
              if (!r.broadcast) continue;
              open.push({
                id: r.id,
                listenerId: '',
                name: t('audience.anyMentor'),
                avatar: '',
                animal: null,
                colour: null,
                intro: r.intro_message,
                createdAt: r.created_at,
                broadcast: true,
              });
              continue;
            }
            const m = mentors.find((x) => x.id === r.target_listener_id);
            if (!m) continue;
            open.push({
              id: r.id,
              listenerId: m.id,
              name: m.persona_name,
              avatar: m.persona_avatar,
              animal: m.companion_animal ?? r.listener_companion_animal,
              colour: m.companion_colour ?? r.listener_companion_colour,
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

  // A pushed change (a new line, an end, a wipe) or a reconnect re-reads only the list itself:
  // own rows carry their unread count and last line from the server; Stream rows keep their
  // client-side previews. Focus still does the full load above.
  const refreshRows = useCallback(async () => {
    const list = await api.listConversations();
    setRows(list);
    screenCache.set('chats', { ...(screenCache.get('chats') ?? { previews: {} }), rows: list });
  }, []);
  useLiveRefresh('member', ['conversation.changed'], refreshRows, { onFocus: false });

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

  /** An open question: its letter (board A04), painted at once from what the row holds. */
  const openQuestion = (w: WaitingQuestion) => {
    requestLetter.put({
      request: {
        id: w.id,
        status: 'pending',
        target_listener_id: w.broadcast ? null : w.listenerId,
        broadcast: Boolean(w.broadcast),
        intro_message: w.intro,
        conversation_id: null,
        created_at: w.createdAt,
      },
      mentor: w.broadcast ? null : { id: w.listenerId, name: w.name, avatar: w.avatar, animal: w.animal, colour: w.colour },
    });
    router.push({ pathname: '/request-sent/[id]', params: { id: w.id } });
  };

  const openNewChat = () => router.push('/new-chat');

  const needle = query.trim().toLowerCase();
  const merged: Row[] = useMemo(() => {
    const out: Row[] = [];
    for (const c of rows) {
      const isArchived = chatPrefs.archived.includes(c.id);
      if (showArchived ? !isArchived : isArchived) continue;
      const p = c.stream_channel_id ? previews[c.stream_channel_id] : undefined;
      if (filter === 'unread' && !(rowUnread(p, c) && c.status === 'active')) continue;
      if (
        needle &&
        !c.listener_persona_name.toLowerCase().includes(needle) &&
        !(c.first_met_as ?? '').toLowerCase().includes(needle)
      )
        continue;
      out.push({
        kind: 'convo',
        key: c.id,
        at: (p?.at ?? new Date(c.last_message_at ?? c.created_at)).getTime(),
        convo: c,
      });
    }
    if (filter === 'all' && !showArchived) {
      for (const w of waiting) {
        if (needle && !w.name.toLowerCase().includes(needle)) continue;
        out.push({ kind: 'waiting', key: `ask-${w.id}`, at: new Date(w.createdAt).getTime(), ask: w });
      }
    }
    // Open chats first, then open questions, then what is finished — newest first in each.
    const rank = (r: Row) => (r.kind === 'waiting' ? 1 : r.kind === 'convo' ? (r.convo.status === 'active' ? 0 : 2) : 3);
    // Pinned chats lead their group, the most recently pinned first.
    const pinRank = (r: Row) => (r.kind === 'convo' ? (chatPrefs.pinned.indexOf(r.convo.id) + 1 || Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER);
    const sorted = out.sort((a, b) => rank(a) - rank(b) || pinRank(a) - pinRank(b) || b.at - a.at);
    const archivedCount = rows.filter((c) => chatPrefs.archived.includes(c.id)).length;
    if (showArchived) return [{ kind: 'archiveBack', key: 'archive-back', at: 0 } as Row, ...sorted];
    if (archivedCount > 0 && filter === 'all' && !needle) return [{ kind: 'archive', key: 'archive-row', at: 0, count: archivedCount } as Row, ...sorted];
    return sorted;
  }, [rows, waiting, previews, filter, needle, chatPrefs, showArchived]);

  // A chat that is gone leaves no pin or archive behind.
  useEffect(() => {
    if (rows.length) pruneChatPrefs(rows.map((c) => c.id));
    // reason: only when the list of chats changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const doMute = async (c: ConversationListItem) => {
    const now = mutedLocal[c.id] ?? Boolean(c.is_paused);
    setActionBusy(true);
    setActionError(null);
    try {
      await api.setPause(c.id, !now);
      setMutedLocal((m) => ({ ...m, [c.id]: !now }));
      setActionFor(null);
    } catch {
      setActionError(t('chatActions.muteFailed'));
      setActionFor(null);
    } finally {
      setActionBusy(false);
    }
  };

  const doDelete = async (c: ConversationListItem) => {
    setActionBusy(true);
    setActionError(null);
    try {
      await api.wipeConversation(c.id);
      setRows((r) => r.filter((x) => x.id !== c.id));
      setActionFor(null);
    } catch {
      setActionError(t('chatActions.muteFailed'));
      setActionFor(null);
    } finally {
      setActionBusy(false);
    }
  };

  // The In touch badge's linked rings breathe on the first two badges only (motion budget).
  const breathingBadges = useMemo(
    () => new Set(merged.filter((r) => r.kind === 'convo' && r.convo.in_touch).slice(0, 2).map((r) => r.key)),
    [merged],
  );

  const chips: { key: Filter | 'touch'; label: string }[] = [
    { key: 'all', label: t('chats.filterAll') },
    { key: 'touch', label: t('inTouch.tabPlain') },
    { key: 'unread', label: t('chats.filterUnread') },
  ];
  const pickChip = (key: Filter | 'touch') => {
    if (key === 'touch') {
      setView('touch');
      return;
    }
    setView('all');
    setFilter(key);
  };

  const hasAnything = rows.length > 0 || waiting.length > 0;
  const showTools = hasAnything && view === 'all';
  const slots = touch?.slots ?? null;
  const touchFull = Boolean(slots && slots.in_touch >= slots.limit);
  const listLength = view === 'all' ? merged.length : (touch?.items.length ?? 0);

  const perches = useMemo(
    () => [...HOME_PERCHES, ...(!loading && hasAnything && listLength <= SHORT_LIST ? CARD_PERCHES : [])],
    [loading, hasAnything, listLength],
  );
  // Before the first conversation the empty state itself shows the companion, on its own
  // stage — so the perch stays empty (never two companions on one screen).
  const showEmpty = !loading && !hasAnything && view === 'all' && loadError === null;
  // An honest error is a still state; a sheet over the list hides the companion.
  const dock = useTabDockHeight();
  const perch = useCompanionPlacement('chats', perches, {
    still: loadError !== null,
    hidden: sheetOpen || gate !== null || actionFor !== null || showEmpty,
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
    if (item.kind === 'archive' || item.kind === 'archiveBack') {
      const back = item.kind === 'archiveBack';
      return (
        <Pressable
          onPress={() => setShowArchived(!back)}
          accessibilityRole="button"
          style={styles.archiveRow}
          testID={back ? 'archived-back' : 'archived-row'}
        >
          <Ionicons name={back ? 'chevron-back' : 'archive-outline'} size={22} color={colors.accent} />
          <Text style={[type.label, { color: colors.ink, flex: 1 }]}>{back ? t('chatActions.archivedBack') : t('chatActions.archivedRow')}</Text>
          {!back ? <Text style={[type.label, { color: colors.accent }]}>{item.count}</Text> : null}
        </Pressable>
      );
    }
    if (item.kind === 'waiting') {
      const w = item.ask;
      row = (
        <ChatRow
          testID={`waiting-${w.id}`}
          face={{ animal: w.animal, colour: w.colour }}
          name={w.name}
          state="waiting"
          stateLabel={stateLabel('waiting')}
          askedAs={w.broadcast ? 'everyone' : 'one'}
          secondLine={w.broadcast ? t('audience.toEveryone') : t('chatsList.waitingLine', { name: w.name })}
          lastLine=""
          quietLine={w.intro ? t('chatsList.youSaid', { text: w.intro }) : null}
          time={relativeTime(w.createdAt, t)}
          unreadLabel={t('chatsList.newMessageA11y')}
          accessibilityLabel={t('chatsList.waitingA11y', { name: w.name })}
          onPress={() => openQuestion(w)}
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
          // The chat's header avatar flies out of this row's face (board T05).
          faceOriginKey={chatFaceKey(c.id)}
          face={{ animal: c.listener_companion_animal, colour: c.listener_companion_colour }}
          name={c.listener_persona_name}
          state={s}
          stateLabel={stateLabel(s)}
          inTouch={Boolean(c.in_touch)}
          badgeStill={!breathingBadges.has(c.id)}
          secondLine={
            // The mentor snoozed this chat: the member reads only the kind half (board A10).
            s === 'active' && c.reply_within_a_day
              ? t('replyWindow.rowLine', { name: c.listener_persona_name })
              : c.first_met_as
                ? t('chatsList.firstTalkedAs', { name: c.first_met_as })
                : c.in_touch
                  ? t('chatsList.yourMentor')
                  : null
          }
          lastLine={s === 'wiped' ? t('chats.wiped') : c.is_locked ? t('chatsList.lockedLine') : p?.text || c.last_message || t('chats.sayHello')}
          time={relativeTime((p?.at ?? new Date(c.created_at)).toISOString(), t)}
          unread={rowUnread(p, c) && s === 'active'}
          unreadLabel={t('chatsList.newMessageA11y')}
          savedLabel={s !== 'wiped' && count > 0 ? t('chatsList.savedCount', { count }) : null}
          lockedLabel={c.is_locked ? t('chatsList.locked') : null}
          accessibilityLabel={t('chats.convoA11y', { name: c.listener_persona_name })}
          onPress={() => open(c)}
          onLongPress={() => setActionFor({ convo: c, confirm: false })}
          pinned={chatPrefs.pinned.includes(c.id)}
          muted={mutedLocal[c.id] ?? Boolean(c.is_paused)}
        />
      );
      row = (
        <SwipeRow
          archived={chatPrefs.archived.includes(c.id)}
          onArchive={() => toggleArchived(c.id)}
          onDelete={() => setActionFor({ convo: c, confirm: true })}
        >
          {row}
        </SwipeRow>
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
              {/* flex: 1 — a title sized to its own text is under-measured on Android in Hindi
                * and loses its accent word to a hidden second line (QA 2026-11-15). */}
              <Text style={[type.display, styles.title, { color: colors.ink }]} accessibilityRole="header">
                {t('chatsList.titleLead')} <Text style={{ color: colors.titleAccent }}>{t('chatsList.titleAccent')}</Text>
              </Text>
              <FeedbackPill testID="chats-feedback" />
            </View>
            <Text style={[type.bodySmall, { color: colors.inkMuted }]}>{t('chats.sub')}</Text>
          </Entrance>

          {/* Search, the switch and the filters: one block with a pillow underside, and the
              companion's home on its bottom edge. It is simply there — no arrival. */}
          <View style={[styles.tools, { borderBottomColor: colors.border }]}>
            {showTools ? (
              <EdgeSurface
                edge={colors.edgeSurface}
                travel={4}
                radius={flat ? radius.pill : radius.md}
                style={[styles.search, flat
                  ? { backgroundColor: colors.surfaceAlt, borderColor: colors.surfaceAlt }
                  : { backgroundColor: colors.surface, borderColor: colors.border }]}
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

            {hasAnything ? (
              <View style={styles.chips} accessibilityRole="tablist" accessibilityLabel={t('chatsList.filterA11y')}>
                {chips.map((c) => {
                  const selected = c.key === 'touch' ? view === 'touch' : view === 'all' && filter === c.key;
                  return (
                    <PressKey
                      key={c.key}
                      onPress={() => pickChip(c.key)}
                      edge={selected ? colors.accentEdge : colors.edgeSurface}
                      travel={3}
                      radius={radius.pill}
                      intent="select"
                      accessibilityRole="tab"
                      accessibilityState={{ selected }}
                      testID={c.key === 'touch' ? 'chats-view-touch' : `filter-${c.key}`}
                      style={[
                        styles.chip,
                        selected
                          ? { backgroundColor: colors.accentTint, borderColor: colors.accentTint }
                          : { backgroundColor: colors.surfaceAlt, borderColor: colors.surfaceAlt },
                      ]}
                    >
                      <Text style={[type.label, { color: selected ? colors.accentInk : colors.ink }]}>
                        {c.key === 'touch' && slots ? t('inTouch.tab', { used: slots.in_touch, limit: slots.limit }) : c.label}
                      </Text>
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
            ) : showEmpty ? null : (
              // Nothing to filter yet: the same room is kept for the companion. (Not before
              // the first conversation — the companion stands in the empty state then.)
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
              contentContainerStyle={[styles.list, flat && styles.listFlat, { paddingBottom: 110 + dock }]}
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
                      face={{ animal: item.companion_animal, colour: item.companion_colour }}
                      name={item.persona_name}
                      state={s}
                      stateLabel={stateLabel(s)}
                      inTouch
                      badgeStill={index > 1}
                      secondLine={
                        item.first_met_as
                          ? t('chatsList.firstTalkedAs', { name: item.first_met_as })
                          : t('chatsList.yourMentor')
                      }
                      lastLine={
                        c?.status === 'wiped'
                          ? t('chats.wiped')
                          : c?.is_locked
                            ? t('chatsList.lockedLine')
                            : p?.text || (item.status === 'online' ? t('inTouch.hereNow') : t('inTouch.away'))
                      }
                      time={relativeTime((p?.at ?? new Date(item.since ?? item.first_met_at)).toISOString(), t)}
                      unread={rowUnread(p, c) && live}
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
            // A failed first load shows only its honest note above — never "no conversations".
            showEmpty ? <ChatsEmpty onStart={openNewChat} /> : null
          ) : (
            <FlatList
              key="all"
              data={merged}
              keyExtractor={(r) => r.key}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={[styles.list, flat && styles.listFlat, { paddingBottom: 110 + dock }]}
              ListEmptyComponent={
                <Text style={[type.note, styles.centerText, { color: colors.inkMuted }]}>{t('chatsList.noMatches')}</Text>
              }
              ListHeaderComponent={
                actionError ? (
                  <Text style={[type.caption, styles.centerText, { color: colors.warning }]} testID="chat-action-error">
                    {actionError}
                  </Text>
                ) : null
              }
              ListFooterComponent={<View style={styles.footerGap}>{footer}</View>}
              renderItem={renderRow}
            />
          )}

          {!loading && hasAnything ? (
            <>
              {/* New chat: one round key, bottom right (DECISIONS T.1, as on WhatsApp). An open
                  question still opens the sheet — the server has no "one open question" rule. */}
              <View style={[styles.newChatWrap, { bottom: 20 + dock }]} pointerEvents="box-none">
                <CompanionSlot id="fabTop" size={52} align="right" inset={space.xs} />
                <CompanionSlot id="fabDangle" size={56} align="right" inset={space.xs} nudge={4} />
                <PressKey
                  onPress={openNewChat}
                  edge={colors.accentEdge}
                  radius={18}
                  accessibilityLabel={waitingOn ? `${t('chats.newChatA11y')}. ${t('chatsList.newChatWaiting', { name: waitingOn.name })}` : t('chats.newChatA11y')}
                  testID="new-chat-fab"
                  containerStyle={styles.fabBox}
                  style={[styles.fab, { backgroundColor: colors.accent }]}
                >
                  <Ionicons name="add" size={28} color={colors.onAccent} />
                </PressKey>
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
          {actionFor ? (
            <ChatActionsSheet
              key={actionFor.convo.id + String(actionFor.confirm)}
              name={actionFor.convo.listener_persona_name}
              startConfirming={actionFor.confirm}
              pinned={chatPrefs.pinned.includes(actionFor.convo.id)}
              archived={chatPrefs.archived.includes(actionFor.convo.id)}
              muted={mutedLocal[actionFor.convo.id] ?? Boolean(actionFor.convo.is_paused)}
              canMute={actionFor.convo.status === 'active'}
              busy={actionBusy}
              onPin={() => {
                togglePinned(actionFor.convo.id);
                setActionFor(null);
              }}
              onArchive={() => {
                toggleArchived(actionFor.convo.id);
                setActionFor(null);
              }}
              onMute={() => void doMute(actionFor.convo)}
              onDelete={() => void doDelete(actionFor.convo)}
              onClose={() => setActionFor(null)}
            />
          ) : null}
        </CompanionPerches>
      </SafeAreaView>
    </SettleBack>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  archiveRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingHorizontal: space.md },
  head: { paddingTop: space.xs, paddingHorizontal: space.lg, paddingBottom: 10 },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  title: { flex: 1, minWidth: 0 },
  tools: { zIndex: 3, paddingHorizontal: space.md, paddingBottom: 10, gap: 10, borderBottomWidth: 1 },
  toolsEdge: { position: 'absolute', left: 0, right: 0, bottom: -4, height: 3 },
  toolsFloor: { position: 'absolute', left: 0, right: 0, bottom: -1, height: 0 },
  search: {
    minHeight: 52,
    paddingHorizontal: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
  },
  searchInput: { flex: 1, minWidth: 0, minHeight: 44, paddingVertical: 4, ...type.body },
  chips: { flexDirection: 'row', gap: space.sm },
  touchLine: { minHeight: 48, justifyContent: 'center', paddingLeft: space.sm, paddingRight: 96 },
  touchLineText: {},
  chip: { height: 44, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  note: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.sm },
  noteBox: { marginHorizontal: space.md, marginTop: space.sm },
  list: { paddingTop: 14, paddingHorizontal: space.md, paddingBottom: 170, gap: 10 },
  // Flat looks: full-width rows divided by hairlines, as on WhatsApp (DECISIONS T.1).
  listFlat: { paddingTop: 4, paddingHorizontal: 0, gap: 0 },
  footerGap: { gap: 10 },
  // The ground fade ends where the floating tab bar's pill begins.
  peers: { textAlign: 'center', paddingTop: space.xs, paddingHorizontal: space.sm },
  calm: { padding: space.md, gap: 10, borderRadius: radius.lg, borderWidth: 1 },
  calmHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pips: { flexDirection: 'row', gap: 6 },
  pip: { width: 28, height: 10, borderRadius: radius.pill },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.sm, paddingHorizontal: space.lg },
  centerText: { textAlign: 'center' },
  newChatWrap: { position: 'absolute', right: space.md, bottom: 36, alignItems: 'flex-end' },
  fabBox: { alignSelf: 'flex-end' },
  fab: { width: 58, height: 58, alignItems: 'center', justifyContent: 'center' },
  gateBackdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 50,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.lg,
  },
  gateCard: { alignSelf: 'stretch', borderRadius: radius.lg, padding: space.lg, gap: space.sm },
});
