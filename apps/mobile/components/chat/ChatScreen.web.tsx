import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Channel as ChannelType, Event } from 'stream-chat';

import { IconBadge } from '@/components/IconBadge';
import { ConversationOptions } from '@/components/chat/ConversationOptions';
import { CrisisCard, type CrisisPayload } from '@/components/chat/CrisisCard';
import { PersonaAvatar } from '@/components/art/PersonaAvatar';
import { SceneTile } from '@/components/art/SceneTile';
import { api } from '@/lib/api';
import { getPersona, getStreamToken } from '@/lib/session';
import { getStreamClient } from '@/lib/streamClient';
import { useSessionGuard } from '@/lib/useSessionGuard';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type } from '@/theme/tokens';

/**
 * WEB chat (best-effort surface). Uses the stream-chat JS client directly with a custom
 * UI, because stream-chat-expo's RN UI kit doesn't bundle under react-native-web. Native
 * uses the kit (ChatScreen.tsx). Safety behaviour is identical: the crisis scan is
 * enforced server-side in the Stream before-send webhook; this screen only renders the
 * server-provided `crisis` payload.
 *
 * Pixel pass per mockups #7/#8 + the save-to-Mentor-Notes core loop. The
 * connect/watch/send/crisis logic is unchanged.
 */

type CrisisCarrier = { id?: string; crisis?: CrisisPayload };
type Msg = { id: string; text: string; mine: boolean; at: string };

type RawMsg = { id?: string; text?: string; user?: { id?: string }; created_at?: string | Date };

function timeLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

type MessageRowProps = {
  item: Msg;
  /** Day-pill text when this row starts a new day, else null. */
  dayText: string | null;
  read: boolean;
  actionsOpen: boolean;
  isHelpful: boolean;
  isSaved: boolean;
  listenerName: string;
  onToggleActions: (id: string) => void;
  onToggleHelpful: (id: string) => void;
  onSave: (m: Msg) => void;
  onCopy: (text: string) => void;
};

/** One transcript row, memoized so composer keystrokes and typing events never
 * re-render the whole message list. Display state arrives as primitives so
 * React.memo's shallow compare stays cheap and correct. */
const MessageRow = memo(function MessageRow({
  item,
  dayText,
  read,
  actionsOpen,
  isHelpful,
  isSaved,
  listenerName,
  onToggleActions,
  onToggleHelpful,
  onSave,
  onCopy,
}: MessageRowProps) {
  const { colors, elevation } = useTheme();
  return (
    <View>
      {dayText ? (
        <View style={styles.dayRow}>
          <View style={[styles.hairline, { backgroundColor: colors.border }]} />
          <View style={[styles.dayPill, { backgroundColor: colors.surfaceAlt }]}>
            <Text style={[type.caption, { color: colors.inkMuted }]}>{dayText}</Text>
          </View>
          <View style={[styles.hairline, { backgroundColor: colors.border }]} />
        </View>
      ) : null}

      {item.mine ? (
        <View style={styles.mineWrap}>
          <View style={[styles.bubble, styles.mine, { backgroundColor: colors.accentTint }]}>
            <Text style={[type.body, { color: colors.ink }]}>{item.text}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={[type.caption, { color: colors.inkMuted }]}>{timeLabel(item.at)}</Text>
            <Ionicons
              name="checkmark-done"
              size={15}
              color={read ? colors.accent : colors.inkMuted}
            />
          </View>
        </View>
      ) : (
        <View style={styles.theirsWrap}>
          <View style={styles.theirsRow}>
            <PersonaAvatar name={listenerName} size={34} />
            <Pressable
              onPress={() => onToggleActions(item.id)}
              accessibilityRole="button"
              accessibilityHint="Shows message actions like save to Mentor Notes"
              testID={`msg-${item.id}`}
              style={[styles.bubble, styles.theirs, { backgroundColor: colors.surface }, elevation.sm]}
            >
              <Text style={[type.body, { color: colors.ink }]}>{item.text}</Text>
            </Pressable>
          </View>
          <Text style={[type.caption, styles.theirsTime, { color: colors.inkMuted }]}>
            {timeLabel(item.at)}
          </Text>

          {actionsOpen ? (
            <View style={styles.actionsZone}>
              <View style={[styles.actionsRow, { backgroundColor: colors.surface }, elevation.sm]}>
                <Text style={[type.caption, { color: colors.inkMuted }]}>Was this helpful?</Text>
                <Pressable
                  onPress={() => onToggleHelpful(item.id)}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel="Mark as helpful"
                  style={[styles.heartWrap, { backgroundColor: colors.brandTint }]}
                >
                  <Ionicons
                    name={isHelpful ? 'heart' : 'heart-outline'}
                    size={16}
                    color={colors.accent}
                  />
                </Pressable>
                <Pressable
                  onPress={() => onSave(item)}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel="Save to Mentor Notes"
                  testID={`save-${item.id}`}
                >
                  <Ionicons
                    name={isSaved ? 'bookmark' : 'bookmark-outline'}
                    size={18}
                    color={isSaved ? colors.accent : colors.inkMuted}
                  />
                </Pressable>
                <Pressable
                  onPress={() => onCopy(item.text)}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel="Copy message"
                >
                  <Ionicons name="copy-outline" size={17} color={colors.inkMuted} />
                </Pressable>
              </View>

              <Pressable
                onPress={() => onSave(item)}
                accessibilityRole="button"
                accessibilityLabel={isSaved ? 'Saved to Mentor Notes' : 'Save to Mentor Notes'}
                testID={`save-card-${item.id}`}
                style={[styles.saveCard, { backgroundColor: colors.surfaceAlt }]}
              >
                <IconBadge icon="book-outline" size={40} />
                <View style={{ flex: 1 }}>
                  <Text style={[type.label, { color: colors.ink }]}>
                    {isSaved ? 'Saved to Mentor Notes ✓' : 'Save to Mentor Notes'}
                  </Text>
                  <Text style={[type.caption, { color: colors.inkMuted }]}>
                    {isSaved
                      ? 'Find it in Journals → Mentor Notes.'
                      : 'Add this to your journal under "Mentor Notes"'}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.inkMuted} />
              </Pressable>
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
});

type ComposerProps = {
  /** Path warm-up prompt — lands in the input ready to edit/send, never auto-sent. */
  initialDraft?: string;
  onSend: (body: string) => void;
  onTyping: () => void;
};

/** Composer pill + send FAB (mockup #8). Owns the draft locally so every keystroke
 * re-renders only this leaf — never the transcript above it. */
const Composer = memo(function Composer({ onSend, onTyping, initialDraft }: ComposerProps) {
  const { colors, elevation } = useTheme();
  const [draft, setDraft] = useState(initialDraft ?? '');

  const submit = () => {
    const body = draft.trim();
    if (!body) return;
    setDraft('');
    onSend(body);
  };

  return (
    <View style={styles.composer}>
      <View style={[styles.inputPill, { backgroundColor: colors.surface }, elevation.sm]}>
        <Ionicons name="add-circle-outline" size={24} color={colors.inkMuted} />
        <TextInput
          style={[styles.input, { color: colors.ink }]}
          placeholder="Type a message…"
          placeholderTextColor={colors.inkMuted}
          value={draft}
          onChangeText={(text) => {
            setDraft(text);
            onTyping();
          }}
          onSubmitEditing={submit}
          testID="composer-input"
          accessibilityLabel="Message"
          multiline
        />
      </View>
      <Pressable
        style={[styles.sendBtn, { backgroundColor: colors.accent }, elevation.sm]}
        onPress={submit}
        testID="composer-send"
        accessibilityRole="button"
        accessibilityLabel="Send message"
      >
        <Ionicons name="paper-plane" size={19} color={colors.onAccent} />
      </Pressable>
    </View>
  );
});

export default function ChatScreenWeb() {
  const router = useRouter();
  // If the session vanishes (Start-fresh elsewhere), every conversation option would
  // 403 with only a small inline error — route back to landing instead.
  useSessionGuard();
  const { colors, elevation } = useTheme();
  const { id: conversationId, listener, channel: channelId, starter } = useLocalSearchParams<{
    id: string;
    listener?: string;
    channel?: string;
    starter?: string;
  }>();
  const listenerName = listener ?? 'Your listener';
  const [optionsOpen, setOptionsOpen] = useState(false);

  const [ready, setReady] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [typing, setTyping] = useState<string | null>(null); // other side's persona name
  const [crisis, setCrisis] = useState<CrisisPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [privacyNote, setPrivacyNote] = useState(true);
  // Message-actions state (mentor messages): which row is open, helpful ♥s, saved ids.
  const [actionsFor, setActionsFor] = useState<string | null>(null);
  const [helpful, setHelpful] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [readTick, setReadTick] = useState(0); // bumps on message.read to refresh ✓✓
  const channelRef = useRef<ChannelType | null>(null);
  const shownRef = useRef<Set<string>>(new Set());

  const surfaceCrisis = useCallback((m: CrisisCarrier | undefined) => {
    if (m?.crisis && m.id && !shownRef.current.has(m.id)) {
      shownRef.current.add(m.id);
      setCrisis(m.crisis);
    }
  }, []);

  const toMsg = useCallback((m: RawMsg): Msg => {
    const client = getStreamClient();
    return {
      id: m.id ?? Math.random().toString(36),
      text: m.text ?? '',
      mine: m.user?.id === client.userID,
      at: m.created_at ? new Date(m.created_at).toISOString() : new Date().toISOString(),
    };
  }, []);

  const appendMessage = useCallback(
    (raw: RawMsg) => {
      const msg = toMsg(raw);
      setMessages((prev) => (prev.some((p) => p.id === msg.id) ? prev : [...prev, msg]));
    },
    [toMsg],
  );

  useEffect(() => {
    let cancelled = false;
    const client = getStreamClient();

    const setup = async () => {
      try {
        const [persona, token] = await Promise.all([getPersona(), getStreamToken()]);
        if (!persona || !token) throw new Error('Missing session — please start again.');
        if (!channelId) throw new Error('Missing channel.');

        if (client.userID !== persona.id) {
          await client.connectUser({ id: persona.id, name: persona.persona_name }, token);
        }
        const ch = client.channel('messaging', channelId);
        await ch.watch();
        if (cancelled) return;

        channelRef.current = ch;
        ch.state.messages.forEach((m) => {
          appendMessage(m as RawMsg);
          surfaceCrisis(m as CrisisCarrier);
        });
        ch.on('message.new', (e: Event) => {
          if (e.message) {
            appendMessage(e.message as RawMsg);
            surfaceCrisis(e.message as CrisisCarrier);
          }
        });
        ch.on('message.read', () => setReadTick((t) => t + 1));
        ch.on('typing.start', (e: Event) => {
          if (e.user && e.user.id !== client.userID) setTyping(e.user.name ?? listenerName);
        });
        ch.on('typing.stop', (e: Event) => {
          if (e.user && e.user.id !== client.userID) setTyping(null);
        });
        setReady(true);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not open the chat.');
      }
    };

    void setup();
    return () => {
      cancelled = true;
    };
  }, [channelId, appendMessage, surfaceCrisis, listenerName]);

  const send = useCallback(
    async (body: string) => {
      if (!channelRef.current) return;
      // Server scans this in the before-send webhook and augments crisis messages; the
      // augmented message comes back on the response (no message.new fires for our own).
      const resp = await channelRef.current.sendMessage({ text: body });
      appendMessage(resp.message as RawMsg);
      surfaceCrisis(resp.message as CrisisCarrier);
    },
    [appendMessage, surfaceCrisis],
  );

  const onTyping = useCallback(() => {
    // stream-chat throttles keystroke() internally; guard anyway — typing signals
    // are best-effort and must never surface an error in the composer.
    try {
      void channelRef.current?.keystroke().catch(() => {});
    } catch {
      /* best-effort typing signal */
    }
  }, []);

  /** ✓✓ when any other member's last_read is at/after this message. */
  const isRead = useCallback(
    (m: Msg): boolean => {
      void readTick; // re-evaluate when a read event arrives
      const ch = channelRef.current;
      const me = getStreamClient().userID;
      if (!ch) return false;
      return Object.values(ch.state.read).some(
        (r) => r.user.id !== me && new Date(r.last_read).getTime() >= new Date(m.at).getTime(),
      );
    },
    [readTick],
  );

  const saveToNotes = useCallback(
    (m: Msg) => {
      void (async () => {
        try {
          await api.saveMentorNote({
            body: m.text,
            conversation_id: conversationId ?? null,
            listener_persona: listenerName,
            stream_message_id: m.id,
          });
          setSaved((prev) => new Set(prev).add(m.id));
        } catch {
          // Soft-fail: keep the tooltip open so the user can retry.
        }
      })();
    },
    [conversationId, listenerName],
  );

  const toggleActions = useCallback(
    (id: string) => setActionsFor((cur) => (cur === id ? null : id)),
    [],
  );

  const toggleHelpful = useCallback(
    (id: string) =>
      setHelpful((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    [],
  );

  const copyText = useCallback((text: string) => {
    void globalThis.navigator?.clipboard?.writeText(text);
  }, []);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={['top', 'bottom']}>
      {/* Mentor header card (mockup #7) */}
      <View style={[styles.header, { backgroundColor: colors.surface }, elevation.sm]}>
        <Pressable
          onPress={() => router.replace('/chats')}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Leave conversation"
        >
          <Ionicons name="chevron-back" size={26} color={colors.ink} />
        </Pressable>
        <PersonaAvatar name={listenerName} size={52} online />
        <View style={{ flex: 1 }} accessible accessibilityRole="header">
          <Text style={[styles.personaName, { color: colors.ink }]} numberOfLines={1}>
            {listenerName}
          </Text>
          <Text style={[type.caption, { color: colors.inkMuted }]}>Mentor</Text>
          <View style={styles.statusRow}>
            <Ionicons name="shield-checkmark" size={12} color={colors.accentSoft} />
            <Text style={[type.caption, { color: colors.inkMuted }]}>
              Here to listen and support
            </Text>
          </View>
        </View>
        <View style={[styles.connectedPill, { backgroundColor: colors.surfaceAlt }]}>
          <Text style={[type.caption, { color: colors.ink }]}>Connected</Text>
          <View style={[styles.dot, { backgroundColor: colors.success }]} />
        </View>
        <Pressable
          onPress={() => setOptionsOpen(true)}
          hitSlop={12}
          testID="open-options"
          accessibilityRole="button"
          accessibilityLabel="Conversation options"
        >
          <Ionicons name="ellipsis-vertical" size={20} color={colors.inkMuted} />
        </Pressable>
      </View>

      {/* Dismissible first-run privacy line (mockup #20 shows it collapsed) */}
      {privacyNote ? (
        <View style={[styles.privacy, { backgroundColor: colors.brandTint }]}>
          <Ionicons name="lock-closed" size={13} color={colors.accent} />
          <Text style={[type.caption, { color: colors.ink, flex: 1 }]}>
            This conversation is private. You're anonymous here.
          </Text>
          <Pressable
            onPress={() => setPrivacyNote(false)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Dismiss privacy note"
          >
            <Ionicons name="close" size={16} color={colors.inkMuted} />
          </Pressable>
        </View>
      ) : null}

      {error ? (
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={36} color={colors.inkMuted} />
          <Text style={[type.body, { color: colors.danger, textAlign: 'center' }]}>{error}</Text>
        </View>
      ) : !ready ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={[type.body, { color: colors.inkMuted }]}>Opening your conversation…</Text>
        </View>
      ) : (
        <View style={{ flex: 1 }} testID="chat-ready">
          <FlatList
            data={messages}
            keyExtractor={(m) => m.id}
            contentContainerStyle={[styles.list, messages.length === 0 && styles.listEmpty]}
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <SceneTile name="chatConnected" size={140} />
                <Text style={[styles.emptyTitle, { color: colors.ink }]}>You're connected!</Text>
                <Text style={[type.body, { color: colors.inkMuted, textAlign: 'center' }]}>
                  This is a safe space to share, reflect and grow. Take your time.
                </Text>
              </View>
            }
            renderItem={({ item, index }) => {
              const prev = index > 0 ? messages[index - 1] : null;
              const showDay = !prev || dayLabel(prev.at) !== dayLabel(item.at);
              return (
                <MessageRow
                  item={item}
                  dayText={showDay ? dayLabel(item.at) : null}
                  read={item.mine ? isRead(item) : false}
                  actionsOpen={actionsFor === item.id}
                  isHelpful={helpful.has(item.id)}
                  isSaved={saved.has(item.id)}
                  listenerName={listenerName}
                  onToggleActions={toggleActions}
                  onToggleHelpful={toggleHelpful}
                  onSave={saveToNotes}
                  onCopy={copyText}
                />
              );
            }}
          />
          {crisis ? <CrisisCard crisis={crisis} onDismiss={() => setCrisis(null)} /> : null}

          {/* Presence-only typing line — calm register, no animation needed. */}
          {typing ? (
            <Text
              style={[type.caption, styles.typingLine, { color: colors.inkMuted }]}
              testID="typing-indicator"
            >
              {typing} is typing…
            </Text>
          ) : null}

          <Composer onSend={send} onTyping={onTyping} initialDraft={starter} />
        </View>
      )}

      <ConversationOptions
        conversationId={conversationId}
        visible={optionsOpen}
        onClose={() => setOptionsOpen(false)}
        onLeft={() => router.replace('/chats')}
        listenerName={listenerName}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
  },
  personaName: { fontFamily: font.serifBold, fontSize: 19, lineHeight: 24 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  connectedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    borderRadius: radius.pill,
    paddingVertical: 4,
    paddingHorizontal: space.sm,
  },
  dot: { width: 8, height: 8, borderRadius: radius.pill },
  privacy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingVertical: space.xs,
    paddingHorizontal: space.md,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, padding: space.lg },
  list: { padding: space.md, gap: space.xs },
  listEmpty: { flexGrow: 1, justifyContent: 'center' },
  emptyWrap: { alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg },
  emptyTitle: { fontFamily: font.serifBold, fontSize: 24, lineHeight: 30, textAlign: 'center' },
  dayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginVertical: space.md,
  },
  hairline: { flex: 1, height: 1 },
  dayPill: { borderRadius: radius.pill, paddingVertical: 4, paddingHorizontal: space.md },
  bubble: { maxWidth: '80%', borderRadius: radius.lg, paddingHorizontal: space.md, paddingVertical: space.sm + 2 },
  mineWrap: { alignItems: 'flex-end', marginVertical: space.xs },
  mine: { borderBottomRightRadius: radius.sm },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: 3 },
  theirsWrap: { marginVertical: space.xs },
  theirsRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  theirs: { borderBottomLeftRadius: radius.sm },
  theirsTime: { marginLeft: 34 + space.sm + space.xs, marginTop: 3 },
  actionsZone: { marginLeft: 34 + space.sm, marginTop: space.sm, gap: space.sm, maxWidth: '85%' },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    alignSelf: 'flex-start',
    borderRadius: radius.md,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
  },
  heartWrap: {
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.md,
    padding: space.sm,
  },
  typingLine: { paddingHorizontal: space.md, paddingTop: space.xs },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.sm,
    padding: space.md,
  },
  inputPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    minHeight: 50,
  },
  input: { flex: 1, maxHeight: 120, paddingVertical: space.sm, ...type.body },
  sendBtn: {
    width: 50,
    height: 50,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
