import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { Screen } from '@/components/Screen';
import { PersonaAvatar } from '@/components/art/PersonaAvatar';
import { ChatBubblesScene } from '@/components/art/Scenes';
import { PinPad } from '@/components/chat/options/bits';
import { ApiError, api, type ConversationListItem } from '@/lib/api';
import { getPersona, getStreamToken } from '@/lib/session';
import { getStreamClient } from '@/lib/streamClient';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type } from '@/theme/tokens';

/** My Chats (#54/55): search, status chips, conversation rows with Stream previews
 * + unread badges, locked-chat PIN gate, and the New Chat FAB (re-match without
 * re-onboarding). Archived is not a real state yet, so the chip set is honest:
 * All / Active / Completed. */

type Preview = { text: string; at: Date | null; unread: number };
type Filter = 'all' | 'active' | 'completed';

function timeLabel(d: Date | null): string {
  if (!d) return '';
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString())
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function ChatsTab() {
  const router = useRouter();
  const { colors, elevation } = useTheme();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<ConversationListItem[]>([]);
  const [previews, setPreviews] = useState<Record<string, Preview>>({});
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [matching, setMatching] = useState(false);
  // Locked-chat gate: which row is awaiting a PIN.
  const [gate, setGate] = useState<ConversationListItem | null>(null);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinBusy, setPinBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await api.listConversations();
      setRows(list);

      // Last message + unread per channel, straight from Stream client-side.
      const [persona, token] = await Promise.all([getPersona(), getStreamToken()]);
      const channelIds = list.map((c) => c.stream_channel_id).filter(Boolean) as string[];
      if (persona && token && channelIds.length) {
        const client = getStreamClient();
        if (client.userID !== persona.id) {
          await client.connectUser({ id: persona.id, name: persona.persona_name }, token);
        }
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
      }
    } catch {
      // List view stays usable from backend data alone; previews are best-effort.
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
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
          ? "That PIN doesn't look quite right."
          : 'Something went wrong. Please try again.',
      );
    } finally {
      setPinBusy(false);
    }
  };

  const newChat = async () => {
    if (matching) return;
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
          ? 'All listeners are busy right now. Please try again in a moment. 💜'
          : 'We had trouble connecting. Please check your network and try again.',
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
    { key: 'all', label: 'All' },
    { key: 'active', label: 'Active' },
    { key: 'completed', label: 'Completed' },
  ];

  return (
    <Screen>
      <Text style={[type.displaySerif, { color: colors.ink }]} accessibilityRole="header">
        My Chats
      </Text>
      <Text style={[type.body, { color: colors.inkMuted, marginBottom: space.sm }]}>
        Your conversations with mentors
      </Text>

      <View style={[styles.search, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Ionicons name="search-outline" size={18} color={colors.inkMuted} />
        <TextInput
          style={[styles.searchInput, { color: colors.ink }]}
          placeholder="Search conversations…"
          placeholderTextColor={colors.inkMuted}
          value={query}
          onChangeText={setQuery}
          accessibilityLabel="Search conversations"
          testID="chats-search"
        />
      </View>

      <View style={styles.chips}>
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

      {note ? (
        <View style={[styles.note, { backgroundColor: colors.surfaceAlt }]} testID="chats-note">
          <Text style={[type.caption, { color: colors.ink }]}>{note}</Text>
        </View>
      ) : null}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      ) : rows.length === 0 ? (
        <View style={styles.center}>
          <ChatBubblesScene size={140} />
          <Text style={[styles.emptyTitle, { color: colors.ink }]}>No conversations yet</Text>
          <Text style={[type.body, styles.centerText, { color: colors.inkMuted }]}>
            When you start talking with a mentor, your conversations will live here — anonymous,
            always.
          </Text>
          <View style={{ alignSelf: 'stretch', marginTop: space.sm }}>
            <PrimaryButton
              label="Start a Conversation"
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
            <View style={[styles.privacyCard, { backgroundColor: colors.surfaceAlt }]}>
              <Ionicons name="lock-closed-outline" size={18} color={colors.accentSoft} />
              <Text style={[type.caption, { color: colors.inkMuted, flex: 1 }]}>
                Your conversations are private and secure. We're here to support your journey.
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const p = item.stream_channel_id ? previews[item.stream_channel_id] : undefined;
            const statusColor =
              item.status === 'active'
                ? colors.success
                : colors.accentSoft;
            return (
              <Pressable
                onPress={() => open(item)}
                accessibilityRole="button"
                accessibilityLabel={`Conversation with ${item.listener_persona_name}`}
                testID={`convo-${item.id}`}
                style={[styles.row, { backgroundColor: colors.surface }, elevation.sm]}
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
                      ? 'Messages wiped — gone from both sides.'
                      : (p?.text ?? "Say hello when you're ready.")}
                  </Text>
                  <Text style={[styles.statusLabel, { color: statusColor }]}>
                    {item.status === 'active' ? 'Active' : 'Completed'}
                    {item.is_locked ? '  ·  🔒' : ''}
                  </Text>
                </View>
                <View style={styles.rowRight}>
                  <Text style={[type.caption, { color: colors.inkMuted }]}>
                    {timeLabel(p?.at ?? new Date(item.created_at))}
                  </Text>
                  {p && p.unread > 0 ? (
                    <View style={[styles.unread, { backgroundColor: colors.accent }]}>
                      <Text style={[styles.unreadText, { color: colors.onAccent }]}>{p.unread}</Text>
                    </View>
                  ) : (
                    <Ionicons name="chevron-forward" size={16} color={colors.accentSoft} />
                  )}
                </View>
              </Pressable>
            );
          }}
        />
      )}

      {rows.length > 0 ? (
        <Pressable
          onPress={() => void newChat()}
          accessibilityRole="button"
          accessibilityLabel="Start a new chat"
          testID="new-chat-fab"
          style={[styles.fab, { backgroundColor: colors.accent }, elevation.md]}
        >
          {matching ? (
            <ActivityIndicator color={colors.onAccent} />
          ) : (
            <>
              <Ionicons name="chatbubble-ellipses" size={22} color={colors.onAccent} />
              <Text style={[styles.fabText, { color: colors.onAccent }]}>New Chat</Text>
            </>
          )}
        </Pressable>
      ) : null}

      {gate ? (
        <View style={[styles.gateBackdrop, { backgroundColor: colors.scrim }]}>
          <View style={[styles.gateCard, { backgroundColor: colors.surface }, elevation.md]}>
            <Text style={[styles.gateTitle, { color: colors.ink }]}>Enter your PIN</Text>
            <Text style={[type.body, styles.centerText, { color: colors.inkMuted }]}>
              This conversation is locked.
            </Text>
            <PinPad value={pin} onChange={(v) => { setPin(v); setPinError(null); }} error={pinError} />
            <PrimaryButton
              label="Open"
              onPress={() => void submitPin()}
              disabled={pin.length !== 4}
              loading={pinBusy}
              testID="gate-open"
            />
            <PrimaryButton label="Cancel" variant="link" onPress={() => setGate(null)} testID="gate-cancel" />
          </View>
        </View>
      ) : null}
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
  note: { borderRadius: radius.md, padding: space.sm, marginBottom: space.sm },
  privacyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.md,
    padding: space.sm,
    marginTop: space.sm,
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
  fab: {
    position: 'absolute',
    right: space.lg,
    bottom: space.lg,
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
});
