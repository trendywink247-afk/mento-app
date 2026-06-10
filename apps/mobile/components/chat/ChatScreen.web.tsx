import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Channel as ChannelType, Event } from 'stream-chat';

import { ConversationOptions } from '@/components/chat/ConversationOptions';
import { getPersona, getStreamToken } from '@/lib/session';
import { getStreamClient } from '@/lib/streamClient';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space, type } from '@/theme/tokens';

/**
 * WEB chat (best-effort surface). Uses the stream-chat JS client directly with a custom
 * UI, because stream-chat-expo's RN UI kit doesn't bundle under react-native-web. Native
 * uses the kit (ChatScreen.tsx). Safety behaviour is identical: the crisis scan is
 * enforced server-side in the Stream before-send webhook; this screen only renders the
 * server-provided `crisis` payload.
 *
 * This is a RE-SKIN pass: visual only (theme accent, persona header, privacy banner,
 * empty state, bubbles). The connect/watch/send/crisis logic is unchanged.
 */

type CrisisPayload = {
  support: string;
  signal: string;
  helplines: { name: string; number: string; hours: string }[];
};
type CrisisCarrier = { id?: string; crisis?: CrisisPayload };
type Msg = { id: string; text: string; mine: boolean };

export default function ChatScreenWeb() {
  const router = useRouter();
  const { colors, elevation } = useTheme();
  const { id: conversationId, listener, channel: channelId } = useLocalSearchParams<{
    id: string;
    listener?: string;
    channel?: string;
  }>();
  const listenerName = listener ?? 'Your listener';
  const [optionsOpen, setOptionsOpen] = useState(false);

  const [ready, setReady] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState('');
  const [crisis, setCrisis] = useState<CrisisPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const channelRef = useRef<ChannelType | null>(null);
  const shownRef = useRef<Set<string>>(new Set());

  const surfaceCrisis = useCallback((m: CrisisCarrier | undefined) => {
    if (m?.crisis && m.id && !shownRef.current.has(m.id)) {
      shownRef.current.add(m.id);
      setCrisis(m.crisis);
    }
  }, []);

  const toMsg = useCallback((m: { id?: string; text?: string; user?: { id?: string } }): Msg => {
    const client = getStreamClient();
    return { id: m.id ?? Math.random().toString(36), text: m.text ?? '', mine: m.user?.id === client.userID };
  }, []);

  const appendMessage = useCallback(
    (raw: { id?: string; text?: string; user?: { id?: string } }) => {
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
          appendMessage(m as { id?: string; text?: string; user?: { id?: string } });
          surfaceCrisis(m as CrisisCarrier);
        });
        ch.on('message.new', (e: Event) => {
          if (e.message) {
            appendMessage(e.message as { id?: string; text?: string; user?: { id?: string } });
            surfaceCrisis(e.message as CrisisCarrier);
          }
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
  }, [channelId, appendMessage, surfaceCrisis]);

  const send = async () => {
    const body = draft.trim();
    if (!body || !channelRef.current) return;
    setDraft('');
    // Server scans this in the before-send webhook and augments crisis messages; the
    // augmented message comes back on the response (no message.new fires for our own).
    const resp = await channelRef.current.sendMessage({ text: body });
    appendMessage(resp.message as { id?: string; text?: string; user?: { id?: string } });
    surfaceCrisis(resp.message as CrisisCarrier);
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={['top', 'bottom']}>
      {/* Persona header card */}
      <View style={[styles.header, { borderBottomColor: colors.border, backgroundColor: colors.surface }]}>
        <Pressable
          onPress={() => router.replace('/')}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Leave conversation"
        >
          <Ionicons name="chevron-back" size={26} color={colors.ink} />
        </Pressable>
        <View style={[styles.avatar, { backgroundColor: colors.brandTint }]}>
          <Ionicons name="leaf-outline" size={20} color={colors.accent} />
        </View>
        <View style={{ flex: 1 }} accessible accessibilityRole="header">
          <Text style={[type.label, { color: colors.ink }]} numberOfLines={1}>
            {listenerName}
          </Text>
          <View style={styles.statusRow}>
            <View style={[styles.dot, { backgroundColor: colors.success }]} />
            <Text style={[type.caption, { color: colors.inkMuted }]}>Connected · Here to listen</Text>
          </View>
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

      {/* Privacy banner */}
      <View style={[styles.privacy, { backgroundColor: colors.brandTint }]}>
        <Ionicons name="lock-closed" size={13} color={colors.accent} />
        <Text style={[type.caption, { color: colors.ink }]}>
          This conversation is private. You're anonymous here.
        </Text>
      </View>

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
                <View style={[styles.emptyEmblem, { backgroundColor: colors.brandTint }]}>
                  <Ionicons name="sparkles-outline" size={30} color={colors.accent} />
                </View>
                <Text style={[type.title, { color: colors.ink, textAlign: 'center' }]}>
                  You're connected!
                </Text>
                <Text style={[type.body, { color: colors.inkMuted, textAlign: 'center' }]}>
                  This is a safe space to share, reflect and grow. Take your time.
                </Text>
              </View>
            }
            renderItem={({ item }) => (
              <View
                style={[
                  styles.bubble,
                  item.mine
                    ? [styles.mine, { backgroundColor: colors.accent }]
                    : [styles.theirs, { backgroundColor: colors.surface }, elevation.sm],
                ]}
                accessibilityRole="text"
              >
                <Text style={[type.body, { color: item.mine ? colors.onAccent : colors.ink }]}>
                  {item.text}
                </Text>
              </View>
            )}
          />
          {crisis ? (
            <CrisisCard crisis={crisis} onDismiss={() => setCrisis(null)} colors={colors} />
          ) : null}
          <View style={[styles.composer, { borderTopColor: colors.border, backgroundColor: colors.surface }]}>
            <TextInput
              style={[styles.input, { borderColor: colors.border, backgroundColor: colors.bg, color: colors.ink }]}
              placeholder="Type a message…"
              placeholderTextColor={colors.inkMuted}
              value={draft}
              onChangeText={setDraft}
              onSubmitEditing={() => void send()}
              testID="composer-input"
              accessibilityLabel="Message"
              multiline
            />
            <Pressable
              style={[styles.sendBtn, { backgroundColor: colors.accent }]}
              onPress={() => void send()}
              testID="composer-send"
              accessibilityRole="button"
              accessibilityLabel="Send message"
            >
              <Ionicons name="arrow-up" size={20} color={colors.onAccent} />
            </Pressable>
          </View>
        </View>
      )}

      <ConversationOptions
        conversationId={conversationId}
        visible={optionsOpen}
        onClose={() => setOptionsOpen(false)}
        onLeft={() => router.replace('/')}
      />
    </SafeAreaView>
  );
}

function CrisisCard({
  crisis,
  onDismiss,
  colors,
}: {
  crisis: CrisisPayload;
  onDismiss: () => void;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  return (
    <View
      style={[styles.crisis, { backgroundColor: colors.brandTint, borderColor: colors.accent }]}
      testID="crisis-card"
    >
      <Text style={[type.body, { color: colors.ink }]}>{crisis.support}</Text>
      <View style={{ gap: space.sm }}>
        {crisis.helplines.map((h) => (
          <Pressable
            key={h.number}
            style={[styles.helpline, { backgroundColor: colors.surface }]}
            onPress={() => void Linking.openURL(`tel:${h.number}`)}
            accessibilityRole="button"
            accessibilityLabel={`Call ${h.name} at ${h.number}, available ${h.hours}`}
          >
            <Ionicons name="call-outline" size={18} color={colors.accent} />
            <Text style={[type.label, { color: colors.ink }]}>
              {h.name} · {h.number}
            </Text>
            <Text style={[type.caption, { color: colors.inkMuted, marginLeft: 'auto' }]}>{h.hours}</Text>
          </Pressable>
        ))}
      </View>
      <Pressable onPress={onDismiss} hitSlop={8} style={styles.crisisDismiss} accessibilityRole="button">
        <Text style={[type.caption, { color: colors.accent }]}>Close</Text>
      </Pressable>
    </View>
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
    borderBottomWidth: 1,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  dot: { width: 7, height: 7, borderRadius: radius.pill },
  privacy: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    paddingVertical: space.xs,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, padding: space.lg },
  list: { padding: space.md, gap: space.sm },
  listEmpty: { flexGrow: 1, justifyContent: 'center' },
  emptyWrap: { alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg },
  emptyEmblem: {
    width: 72,
    height: 72,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.sm,
  },
  bubble: { maxWidth: '80%', borderRadius: radius.lg, paddingHorizontal: space.md, paddingVertical: space.sm },
  mine: { alignSelf: 'flex-end', borderBottomRightRadius: radius.sm },
  theirs: { alignSelf: 'flex-start', borderBottomLeftRadius: radius.sm },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.sm,
    padding: space.md,
    borderTopWidth: 1,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    minHeight: 46,
    borderRadius: radius.lg,
    borderWidth: 1,
    paddingHorizontal: space.md,
    paddingTop: space.sm,
    ...type.body,
  },
  sendBtn: {
    width: 46,
    height: 46,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  crisis: {
    margin: space.md,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: space.sm,
  },
  helpline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.sm,
    padding: space.sm,
  },
  crisisDismiss: { alignSelf: 'flex-end' },
});
