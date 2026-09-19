import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { EdgeSurface } from '@/components/EdgeSurface';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Screen } from '@/components/Screen';
import { PressKey } from '@/components/motion/PressKey';
import { CompanionPerches, CompanionSlot, useCompanionPlacement } from '@/components/art/PerchedCompanion';
import { PersonaAvatar } from '@/components/art/PersonaAvatar';
import { LottieTile } from '@/components/art/LottieTile';
import { SceneTile } from '@/components/art/SceneTile';
import { PinPad } from '@/components/chat/options/bits';
import { ApiError, api, type ConversationListItem } from '@/lib/api';
import type { PlacementSlot } from '@/lib/companionPlacement';
import { useI18n, type TFunc } from '@/lib/i18n';
import { screenCache, type ChatPreview } from '@/lib/screenCache';
import { getPersona, getStreamToken } from '@/lib/session';
import { ensureConnected } from '@/lib/streamClient';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type } from '@/theme/tokens';

/** My Chats (#54/55): search, status chips, conversation rows with Stream previews
 * + unread badges, locked-chat PIN gate, and the New Chat FAB (re-match without
 * re-onboarding). Archived is not a real state yet, so the chip set is honest:
 * All / Active / Completed. */

/** Where the companion can be on My Chats (lib/companionPlacement.ts) — a screen that had no
 * companion before. The header corner is home (the heading keeps that corner free). The low
 * places — on the New Chat key, on the tab bar's edge, under the privacy card — only count
 * while the list is short enough that no row can be resting behind them; the filter row's
 * free end only while the filters are showing. */
const HEADER_PERCHES: PlacementSlot[] = [{ id: 'titleCorner', type: 'top', level: 'high', home: true }];
const FLOOR_PERCHES: PlacementSlot[] = [
  { id: 'tabBarLeft', type: 'top', level: 'low' },
  { id: 'tabBarNap', type: 'nap', level: 'low' },
  { id: 'tabBarPeek', type: 'peek', level: 'low' },
];
const FAB_PERCHES: PlacementSlot[] = [
  { id: 'fabTop', type: 'top', level: 'low' },
  { id: 'fabDangle', type: 'dangle', level: 'low' },
  { id: 'footerHang', type: 'hang', level: 'mid' },
];
const TOOLS_PERCHES: PlacementSlot[] = [{ id: 'chipsEnd', type: 'lean', level: 'high' }];
/** Rows that fit above the low perches on the smallest supported phone (360×740). */
const SHORT_LIST = 3;

type Preview = ChatPreview;
type Filter = 'all' | 'active' | 'completed';

function timeLabel(d: Date | null, t: TFunc): string {
  if (!d) return '';
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString())
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === yesterday.toDateString()) return t('chat.yesterday');
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function ChatsTab() {
  const router = useRouter();
  const { colors, elevation } = useTheme();
  const { t } = useI18n();
  // Coming back from a chat remounts this tab (see lib/screenCache.ts): start from what was
  // last on screen and refresh quietly. The spinner is for the very first load only.
  const cached = screenCache.get('chats');
  const [loading, setLoading] = useState(!cached);
  const [rows, setRows] = useState<ConversationListItem[]>(cached?.rows ?? []);
  const [previews, setPreviews] = useState<Record<string, Preview>>(cached?.previews ?? {});
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [matching, setMatching] = useState(false);
  // New-chat picker: the FAB never mints a conversation on its own — the member
  // chooses "whoever's free" (General match) or "choose a mentor" (browse) first.
  const [picker, setPicker] = useState(false);
  // Locked-chat gate: which row is awaiting a PIN.
  const [gate, setGate] = useState<ConversationListItem | null>(null);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinBusy, setPinBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await api.listConversations();
      setRows(list);
      setLoadError(null);
      screenCache.set('chats', { rows: list, previews: screenCache.get('chats')?.previews ?? {} });

      // Last message + unread per channel, straight from Stream client-side.
      // Previews are best-effort: their failure never blocks the list.
      try {
        const [persona, token] = await Promise.all([getPersona(), getStreamToken()]);
        // Stream caps $in filters at 30 ids; the API list is newest-first, so keep the
        // 30 most recent — older rows just fall back to their backend-only preview.
        const channelIds = (list.map((c) => c.stream_channel_id).filter(Boolean) as string[]).slice(
          0,
          30,
        );
        if (persona && token && channelIds.length) {
          const client = await ensureConnected(
            { id: persona.id, name: persona.persona_name },
            token,
          );
          const channels = await client.queryChannels(
            { type: 'messaging', id: { $in: channelIds } },
            { last_message_at: -1 },
            { watch: false, state: true },
          );
          const map: Record<string, Preview> = {};
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
          screenCache.set('chats', { rows: list, previews: map });
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

  const open = (c: ConversationListItem) => {
    if (c.is_locked) {
      setGate(c);
      setPin('');
      setPinError(null);
      return;
    }
    router.push({
      pathname: '/chat/[id]',
      params: { id: c.id, listener: c.listener_persona_name, channel: c.stream_channel_id ?? '' },
    });
  };

  const submitPin = async () => {
    if (!gate || pin.length !== 4 || pinBusy) return;
    setPinBusy(true);
    try {
      await api.verifyPin(gate.id, pin);
      const target = gate;
      setGate(null);
      router.push({
        pathname: '/chat/[id]',
        params: {
          id: target.id,
          listener: target.listener_persona_name,
          channel: target.stream_channel_id ?? '',
        },
      });
    } catch (e) {
      setPin('');
      setPinError(
        e instanceof ApiError && e.status === 403
          ? t('chats.pinWrong')
          : t('common.somethingWrong'),
      );
    } finally {
      setPinBusy(false);
    }
  };

  const newChat = async () => {
    if (matching) return;
    setPicker(false);
    setMatching(true);
    setNote(null);
    try {
      const match = await api.match({ kind: 'general' });
      router.push({
        pathname: '/chat/[id]',
        params: {
          id: match.conversation_id,
          listener: match.listener_persona_name,
          channel: match.stream_channel_id ?? '',
        },
      });
    } catch (e) {
      setNote(
        e instanceof ApiError && e.status === 503
          ? t('common.allBusy')
          : t('common.networkError'),
      );
    } finally {
      setMatching(false);
    }
  };

  const visible = rows.filter((c) => {
    if (filter === 'active' && c.status !== 'active') return false;
    if (filter === 'completed' && c.status === 'active') return false;
    if (query && !c.listener_persona_name.toLowerCase().includes(query.toLowerCase()))
      return false;
    return true;
  });

  const chips: { key: Filter; label: string }[] = [
    { key: 'all', label: t('chats.filterAll') },
    { key: 'active', label: t('chats.filterActive') },
    { key: 'completed', label: t('chats.filterCompleted') },
  ];

  // Search + filters earn their place only once there's something to sift through
  // (UX review 2026-07-13 #5): below ~5 conversations they're noise before utility.
  const showTools = rows.length >= 5;

  const perches = useMemo(
    () => [
      ...HEADER_PERCHES,
      ...(!loading && rows.length <= SHORT_LIST ? FLOOR_PERCHES : []),
      ...(!loading && rows.length > 0 && rows.length <= SHORT_LIST ? FAB_PERCHES : []),
      ...(showTools ? TOOLS_PERCHES : []),
    ],
    [loading, rows.length, showTools],
  );
  // An honest error or "everyone is busy" note is a still state; a sheet over the list hides it.
  const perch = useCompanionPlacement('chats', perches, {
    still: note !== null || loadError !== null,
    hidden: picker || gate !== null,
  });

  return (
    <Screen>
      <CompanionPerches placement={perch}>
      {/* The heading keeps its right corner free: that corner is the companion's home here. */}
      <View style={styles.head}>
        <Text style={[type.displaySerif, { color: colors.ink }]} accessibilityRole="header">
          {t('chats.title')}
        </Text>
        <Text style={[type.body, { color: colors.inkMuted }]}>{t('chats.sub')}</Text>
        <CompanionSlot id="titleCorner" size={60} attach="floor" />
      </View>

      {showTools ? (
        <>
          <View style={[styles.search, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Ionicons name="search-outline" size={18} color={colors.inkMuted} />
            <TextInput
              style={[styles.searchInput, { color: colors.ink }]}
              placeholder={t('chats.searchPlaceholder')}
              placeholderTextColor={colors.inkMuted}
              value={query}
              onChangeText={setQuery}
              accessibilityLabel={t('chats.searchA11y')}
              testID="chats-search"
            />
          </View>

          <View style={styles.chips}>
            <CompanionSlot id="chipsEnd" size={44} attach="floor" />
            {chips.map((c) => {
              const selected = filter === c.key;
              return (
                <Pressable
                  key={c.key}
                  onPress={() => setFilter(c.key)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  testID={`filter-${c.key}`}
                  style={[
                    styles.chip,
                    selected
                      ? { backgroundColor: colors.accent }
                      : { borderWidth: 1, borderColor: colors.accentSoft },
                  ]}
                >
                  <Text style={[type.label, { color: selected ? colors.onAccent : colors.accent }]}>
                    {c.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </>
      ) : null}

      {note ? (
        <EdgeSurface
          edge={colors.edgeAlt}
          travel={2}
          radius={radius.md}
          style={[styles.note, { backgroundColor: colors.surfaceAlt }]}
          containerStyle={{ marginBottom: space.sm }}
          testID="chats-note"
        >
          <Text style={[type.caption, { color: colors.ink }]}>{note}</Text>
        </EdgeSurface>
      ) : null}

      {loadError ? (
        <EdgeSurface
          edge={colors.edgeAlt}
          travel={2}
          radius={radius.md}
          style={[styles.note, { backgroundColor: colors.surfaceAlt }]}
          containerStyle={{ marginBottom: space.sm }}
          testID="chats-load-error"
        >
          <Text style={[type.caption, { color: colors.ink }]}>{loadError}</Text>
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
      ) : rows.length === 0 ? (
        <View style={styles.center}>
          <LottieTile name="chatDots" fallback="chatsEmpty" size={140} />
          <Text style={[styles.emptyTitle, { color: colors.ink }]}>{t('chats.emptyTitle')}</Text>
          <Text style={[type.body, styles.centerText, { color: colors.inkMuted }]}>
            {t('chats.emptyBody')}
          </Text>
          <View style={{ alignSelf: 'stretch', marginTop: space.sm }}>
            <PrimaryButton
              label={t('chats.startCta')}
              icon="chatbubble-ellipses"
              onPress={() => void newChat()}
              loading={matching}
              testID="start-from-chats"
            />
          </View>
        </View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(c) => c.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ gap: space.sm, paddingBottom: 96 }}
          ListFooterComponent={
            <View style={styles.privacyWrap}>
              <CompanionSlot id="footerHang" size={56} align="left" inset={space.lg} />
              <View style={[styles.privacyCard, { backgroundColor: colors.surfaceAlt }]}>
                <Ionicons name="lock-closed-outline" size={18} color={colors.accentSoft} />
                <Text style={[type.caption, { color: colors.inkMuted, flex: 1 }]}>
                  {t('chats.privacyFooter')}
                </Text>
              </View>
            </View>
          }
          renderItem={({ item }) => {
            const p = item.stream_channel_id ? previews[item.stream_channel_id] : undefined;
            const statusColor =
              item.status === 'active'
                ? colors.success
                : colors.accentSoft;
            return (
              <PressKey
                onPress={() => open(item)}
                edge={colors.edgeSurface}
                accessibilityRole="button"
                accessibilityLabel={t('chats.convoA11y', { name: item.listener_persona_name })}
                testID={`convo-${item.id}`}
                style={[styles.row, { backgroundColor: colors.surface }]}
              >
                <PersonaAvatar
                  name={item.listener_persona_name}
                  size={56}
                  online={item.status === 'active'}
                />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowName, { color: colors.ink }]} numberOfLines={1}>
                    {item.listener_persona_name}
                  </Text>
                  <Text style={[type.caption, { color: colors.inkMuted }]} numberOfLines={2}>
                    {item.status === 'wiped'
                      ? t('chats.wiped')
                      : (p?.text ?? t('chats.sayHello'))}
                  </Text>
                  <Text style={[styles.statusLabel, { color: statusColor }]}>
                    {item.status === 'active' ? t('chats.statusActive') : t('chats.statusCompleted')}
                    {item.is_locked ? '  ·  🔒' : ''}
                  </Text>
                </View>
                <View style={styles.rowRight}>
                  <Text style={[type.caption, { color: colors.inkMuted }]}>
                    {timeLabel(p?.at ?? new Date(item.created_at), t)}
                  </Text>
                  {p && p.unread > 0 ? (
                    <View style={[styles.unread, { backgroundColor: colors.accent }]}>
                      <Text style={[styles.unreadText, { color: colors.onAccent }]}>{p.unread}</Text>
                    </View>
                  ) : (
                    <Ionicons name="chevron-forward" size={16} color={colors.accentSoft} />
                  )}
                </View>
              </PressKey>
            );
          }}
        />
      )}

      {/* The tab bar's top edge is this screen's floor. */}
      <View style={styles.floor} pointerEvents="none">
        <CompanionSlot id="tabBarLeft" size={56} align="left" inset={space.lg} attach="floor" />
        <CompanionSlot id="tabBarNap" size={56} align="left" inset={space.lg} attach="floor" />
        <CompanionSlot id="tabBarPeek" size={46} align="left" inset={space.xl} attach="floor" />
      </View>

      {rows.length > 0 ? (
        <View style={styles.fabWrap} pointerEvents="box-none">
          <CompanionSlot id="fabTop" size={52} align="center" nudge={4} />
          <CompanionSlot id="fabDangle" size={56} align="center" nudge={4} />
          <Pressable
            onPress={() => setPicker(true)}
            accessibilityRole="button"
            accessibilityLabel={t('chats.newChatA11y')}
            testID="new-chat-fab"
            style={[styles.fab, { backgroundColor: colors.accent }, elevation.md]}
          >
            {matching ? (
              <ActivityIndicator color={colors.onAccent} />
            ) : (
              <>
                <Ionicons name="chatbubble-ellipses" size={22} color={colors.onAccent} />
                <Text style={[styles.fabText, { color: colors.onAccent }]}>{t('chats.newChat')}</Text>
              </>
            )}
          </Pressable>
        </View>
      ) : null}

      {picker ? (
        <View style={[styles.gateBackdrop, { backgroundColor: colors.scrim }]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setPicker(false)}
            accessibilityLabel={t('chats.newChatCancel')}
            testID="new-chat-backdrop"
          />
          <View style={[styles.gateCard, { backgroundColor: colors.surface }, elevation.md]} testID="new-chat-sheet">
            <Text style={[styles.gateTitle, { color: colors.ink }]}>{t('chats.newChatTitle')}</Text>
            <Text style={[type.body, styles.centerText, { color: colors.inkMuted }]}>
              {t('chats.newChatBody')}
            </Text>
            {(
              [
                { key: 'now', icon: 'flash-outline', title: 'chats.newChatNow', sub: 'chats.newChatNowSub', go: () => void newChat() },
                { key: 'pick', icon: 'people-outline', title: 'chats.newChatPick', sub: 'chats.newChatPickSub', go: () => { setPicker(false); router.push('/(tabs)/mentors'); } },
              ] as const
            ).map((o) => (
              <PressKey
                key={o.key}
                onPress={o.go}
                edge={colors.edgeAlt}
                travel={3}
                radius={radius.md}
                accessibilityLabel={t(o.title)}
                testID={`new-chat-${o.key}`}
                style={[styles.pickRow, { backgroundColor: colors.surfaceAlt }]}
              >
                <View style={[styles.pickIcon, { backgroundColor: colors.accentTint }]}>
                  <Ionicons name={o.icon} size={20} color={colors.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[type.label, { color: colors.ink }]}>{t(o.title)}</Text>
                  <Text style={[type.caption, { color: colors.inkMuted }]}>{t(o.sub)}</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.accentSoft} />
              </PressKey>
            ))}
            <PrimaryButton
              label={t('chats.newChatCancel')}
              variant="link"
              onPress={() => setPicker(false)}
              testID="new-chat-cancel"
            />
          </View>
        </View>
      ) : null}

      {gate ? (
        <View style={[styles.gateBackdrop, { backgroundColor: colors.scrim }]}>
          <View style={[styles.gateCard, { backgroundColor: colors.surface }, elevation.md]}>
            <Text style={[styles.gateTitle, { color: colors.ink }]}>{t('chats.gateTitle')}</Text>
            <Text style={[type.body, styles.centerText, { color: colors.inkMuted }]}>
              {t('chats.gateBody')}
            </Text>
            <PinPad value={pin} onChange={(v) => { setPin(v); setPinError(null); }} error={pinError} />
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
    </Screen>
  );
}

const styles = StyleSheet.create({
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    height: 48,
    marginBottom: space.sm,
  },
  searchInput: { flex: 1, height: '100%', ...type.body },
  chips: { flexDirection: 'row', gap: space.sm, marginBottom: space.sm },
  chip: {
    borderRadius: radius.pill,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
  },
  note: { borderRadius: radius.md, padding: space.sm },
  head: { paddingRight: 68, marginBottom: space.sm },
  floor: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 0 },
  privacyWrap: { marginTop: space.sm },
  privacyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.md,
    padding: space.sm,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.sm },
  centerText: { textAlign: 'center' },
  emptyTitle: { fontFamily: font.serifBold, fontSize: 24, lineHeight: 30 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.lg,
    padding: space.sm + 2,
  },
  rowName: { fontFamily: font.serifBold, fontSize: 18, lineHeight: 24 },
  statusLabel: { fontFamily: font.sansBold, fontSize: 12, lineHeight: 18, marginTop: 2 },
  rowRight: { alignItems: 'flex-end', gap: space.xs },
  unread: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  unreadText: { fontFamily: font.sansBold, fontSize: 12 },
  fabWrap: { position: 'absolute', right: space.lg, bottom: space.lg },
  fab: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  fabText: { fontFamily: font.sansBold, fontSize: 11 },
  gateBackdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 50,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.lg,
  },
  gateCard: {
    alignSelf: 'stretch',
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.sm,
  },
  gateTitle: { fontFamily: font.serifBold, fontSize: 24, lineHeight: 30, textAlign: 'center' },
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.md,
    padding: space.md,
  },
  pickIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
