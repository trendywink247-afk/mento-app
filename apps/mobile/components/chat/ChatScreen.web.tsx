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
import { colors, radius, space, type } from '@/theme/tokens';

/**
 * WEB chat (best-effort surface). Uses the stream-chat JS client directly with a custom
 * UI, because stream-chat-expo's RN UI kit doesn't bundle under react-native-web. Native
 * uses the kit ([id].native.tsx). Safety behaviour is identical: the crisis scan is
 * enforced server-side in the Stream before-send webhook; this screen only renders the
 * server-provided `crisis` payload.
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

      {error ? (
        <View style={styles.center}>
          <Text style={[type.body, { color: colors.danger, textAlign: 'center' }]}>{error}</Text>
        </View>
      ) : !ready ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.brand} />
          <Text style={[type.body, { color: colors.inkMuted }]}>Opening your conversation…</Text>
        </View>
      ) : (
        <View style={{ flex: 1 }} testID="chat-ready">
          <FlatList
            data={messages}
            keyExtractor={(m) => m.id}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => (
              <View style={[styles.bubble, item.mine ? styles.mine : styles.theirs]}>
                <Text style={[type.body, { color: item.mine ? colors.onBrand : colors.ink }]}>
                  {item.text}
                </Text>
              </View>
            )}
          />
          {crisis ? <CrisisCard crisis={crisis} onDismiss={() => setCrisis(null)} /> : null}
          <View style={styles.composer}>
            <TextInput
              style={styles.input}
              placeholder="Type a message…"
              placeholderTextColor={colors.inkMuted}
              value={draft}
              onChangeText={setDraft}
              onSubmitEditing={() => void send()}
              testID="composer-input"
              multiline
            />
            <Pressable style={styles.sendBtn} onPress={() => void send()} testID="composer-send">
              <Ionicons name="arrow-up" size={20} color={colors.onBrand} />
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
  list: { padding: space.md, gap: space.sm },
  bubble: { maxWidth: '80%', borderRadius: radius.lg, padding: space.md },
  mine: { alignSelf: 'flex-end', backgroundColor: colors.brand, borderBottomRightRadius: radius.sm },
  theirs: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderBottomLeftRadius: radius.sm,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.sm,
    padding: space.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    minHeight: 44,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: space.md,
    paddingTop: space.sm,
    ...type.body,
    color: colors.ink,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
