import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Channel as ChannelType, Event } from 'stream-chat';
import { Channel, Chat, MessageComposer, MessageList } from 'stream-chat-expo';

import { ConversationOptions } from '@/components/chat/ConversationOptions';
import { getPersona, getStreamToken } from '@/lib/session';
import { getStreamClient } from '@/lib/streamClient';
import { colors, radius, space, type } from '@/theme/tokens';

/**
 * Real-time 1:1 chat backed by a live Stream channel (stream-chat-expo).
 *
 * Safety: the crisis scan is NOT run here. It is enforced server-side in the Stream
 * before-message-send webhook (services/api), which can't be bypassed by the client.
 * When that webhook detects a crisis it augments the message with a `crisis` payload;
 * this screen simply renders the helpline card from that server-provided field.
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
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.replace('/')} hitSlop={12}>
          <Ionicons name="chevron-back" size={24} color={colors.ink} />
        </Pressable>
        <View style={styles.avatar}>
          <Ionicons name="leaf-outline" size={18} color={colors.brand} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={type.label}>{listenerName}</Text>
          <Text style={styles.status}>● Connected</Text>
        </View>
        <Pressable onPress={() => setOptionsOpen(true)} hitSlop={12} testID="open-options">
          <Ionicons name="ellipsis-vertical" size={20} color={colors.inkMuted} />
        </Pressable>
      </View>

      {crisis ? <CrisisCard crisis={crisis} onDismiss={() => setCrisis(null)} /> : null}

      {error ? (
        <View style={styles.center}>
          <Text style={[type.body, { color: colors.danger, textAlign: 'center' }]}>{error}</Text>
        </View>
      ) : channel ? (
        <View style={{ flex: 1 }} testID="chat-ready">
          <Chat client={getStreamClient()}>
            <Channel channel={channel} doSendMessageRequest={doSendMessageRequest}>
              <MessageList />
              <MessageComposer />
            </Channel>
          </Chat>
        </View>
      ) : (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.brand} />
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

function CrisisCard({ crisis, onDismiss }: { crisis: CrisisPayload; onDismiss: () => void }) {
  return (
    <View style={styles.crisis} testID="crisis-card">
      <Text style={styles.crisisText}>{crisis.support}</Text>
      <View style={{ gap: space.sm }}>
        {crisis.helplines.map((h) => (
          <Pressable
            key={h.number}
            style={styles.helpline}
            onPress={() => void Linking.openURL(`tel:${h.number}`)}
          >
            <Ionicons name="call-outline" size={18} color={colors.brand} />
            <Text style={type.label}>
              {h.name} · {h.number}
            </Text>
            <Text style={styles.hours}>{h.hours}</Text>
          </Pressable>
        ))}
      </View>
      <Pressable onPress={onDismiss} hitSlop={8} style={styles.crisisDismiss}>
        <Text style={[type.caption, { color: colors.brand }]}>Close</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.brandTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  status: { ...type.caption, color: colors.success },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md },
  crisis: {
    margin: space.md,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.brandTint,
    borderWidth: 1,
    borderColor: colors.brand,
    gap: space.sm,
  },
  crisisText: { ...type.body, color: colors.ink },
  helpline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    padding: space.sm,
  },
  hours: { ...type.caption, marginLeft: 'auto' },
  crisisDismiss: { alignSelf: 'flex-end' },
});
