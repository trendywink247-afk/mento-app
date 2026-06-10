import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { ComponentProps } from 'react';
import type { Channel as ChannelType, Event } from 'stream-chat';
import { Channel, Chat, MessageComposer, MessageList } from 'stream-chat-expo';

// stream-chat-expo's star re-exports collide on the name `Theme` (the kit's UI theme vs
// a stream-chat type), so derive the exact prop type from the component instead.
type StreamChatStyle = ComponentProps<typeof Chat>['style'];

import { ConversationOptions } from '@/components/chat/ConversationOptions';
import { getPersona, getStreamToken } from '@/lib/session';
import { getStreamClient } from '@/lib/streamClient';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space, type } from '@/theme/tokens';

/**
 * Real-time 1:1 chat backed by a live Stream channel (stream-chat-expo).
 *
 * Safety: the crisis scan is NOT run here. It is enforced server-side in the Stream
 * before-message-send webhook (services/api), which can't be bypassed by the client.
 * When that webhook detects a crisis it augments the message with a `crisis` payload;
 * this screen simply renders the helpline card from that server-provided field.
 *
 * Re-skin pass: header/crisis migrated to the theme accent and the Stream kit's primary
 * accent is themed to the companion colour. Message/crisis logic is unchanged.
 */

type CrisisPayload = {
  support: string;
  signal: string;
  helplines: { name: string; number: string; hours: string }[];
};

/** Any Stream message shape can carry the server-injected `crisis` field. */
type CrisisCarrier = { id?: string; crisis?: CrisisPayload };

export default function ChatScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { id: conversationId, listener, channel: channelId } = useLocalSearchParams<{
    id: string;
    listener?: string;
    channel?: string;
  }>();
  const listenerName = listener ?? 'Your listener';

  const [channel, setChannel] = useState<ChannelType | null>(null);
  const [crisis, setCrisis] = useState<CrisisPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  // Surface each crisis message once, so dismissing it isn't undone by later events.
  const shownRef = useRef<Set<string>>(new Set());

  // Theme the Stream kit (v9 semantics tokens) to the mockup chat language: cream app
  // bg, white incoming bubbles, lavender-tint outgoing bubbles with ink text, and the
  // companion accent on primary controls (send button, links).
  const streamTheme = useMemo<StreamChatStyle>(
    () => ({
      semantics: {
        accentPrimary: colors.accent,
        backgroundCoreApp: colors.bg,
        chatBgIncoming: colors.surface,
        chatTextIncoming: colors.ink,
        chatBgOutgoing: colors.accentTint,
        chatTextOutgoing: colors.ink,
        chatTextTimestamp: colors.inkMuted,
        buttonPrimaryBg: colors.accent,
      },
    }),
    [colors],
  );

  const surfaceCrisis = useCallback((message: CrisisCarrier | undefined) => {
    const payload = message?.crisis;
    const id = message?.id;
    if (payload && id && !shownRef.current.has(id)) {
      shownRef.current.add(id);
      setCrisis(payload);
    }
  }, []);

  // The server augments crisis messages with a `crisis` field. It reaches us two ways:
  //   - our OWN message: on the sendMessage response (see doSendMessageRequest below),
  //   - a RECEIVED message: on the message.new websocket event.
  const doSendMessageRequest = useCallback(
    async (_channelId: string, messageData: Parameters<ChannelType['sendMessage']>[0]) => {
      const resp = await channel!.sendMessage(messageData);
      surfaceCrisis(resp.message as CrisisCarrier);
      return resp;
    },
    [channel, surfaceCrisis],
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

        setChannel(ch);
        ch.state.messages.forEach((m) => surfaceCrisis(m as CrisisCarrier));
        ch.on('message.new', (e: Event) => surfaceCrisis(e.message as CrisisCarrier));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not open the chat.');
      }
    };

    void setup();
    return () => {
      cancelled = true;
    };
  }, [channelId, surfaceCrisis]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={['top', 'bottom']}>
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

      <View style={[styles.privacy, { backgroundColor: colors.brandTint }]}>
        <Ionicons name="lock-closed" size={13} color={colors.accent} />
        <Text style={[type.caption, { color: colors.ink }]}>
          This conversation is private. You're anonymous here.
        </Text>
      </View>

      {crisis ? <CrisisCard crisis={crisis} onDismiss={() => setCrisis(null)} colors={colors} /> : null}

      {error ? (
        <View style={styles.center}>
          <Text style={[type.body, { color: colors.danger, textAlign: 'center' }]}>{error}</Text>
        </View>
      ) : channel ? (
        <View style={{ flex: 1 }} testID="chat-ready">
          <Chat client={getStreamClient()} style={streamTheme}>
            <Channel channel={channel} doSendMessageRequest={doSendMessageRequest}>
              <MessageList />
              <MessageComposer />
            </Channel>
          </Chat>
        </View>
      ) : (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={[type.body, { color: colors.inkMuted }]}>Opening your conversation…</Text>
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md },
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
