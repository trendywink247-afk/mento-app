import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { ComponentProps } from 'react';
import type { Channel as ChannelType, Event } from 'stream-chat';
import { Channel, Chat, MessageComposer, MessageList, useMessageComposer } from 'stream-chat-expo';

// stream-chat-expo's star re-exports collide on the name `Theme` (the kit's UI theme vs
// a stream-chat type), so derive the exact prop type from the component instead.
type StreamChatStyle = ComponentProps<typeof Chat>['style'];

import { IconBadge } from '@/components/IconBadge';
import { ConversationOptions } from '@/components/chat/ConversationOptions';
import { PersonaAvatar } from '@/components/art/PersonaAvatar';
import { capture } from '@/lib/analytics';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { getPersona, getStreamToken } from '@/lib/session';
import { ensureConnected, getStreamClient } from '@/lib/streamClient';
import { useSessionGuard } from '@/lib/useSessionGuard';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type } from '@/theme/tokens';

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

/** Seeds a Path warm-up prompt into the composer — ready to edit/send, never
 * auto-sent (the user must own the first message). Runs once per mount. */
function StarterSeed({ text }: { text?: string }) {
  const composer = useMessageComposer();
  const seeded = useRef(false);
  useEffect(() => {
    if (text && !seeded.current) {
      seeded.current = true;
      composer.textComposer.setText(text);
    }
  }, [text, composer]);
  return null;
}

export default function ChatScreen() {
  const router = useRouter();
  // If the session vanishes (Start-fresh elsewhere), every conversation option would
  // 403 with only a small inline error — route back to landing instead.
  useSessionGuard();
  const { colors } = useTheme();
  const { t } = useI18n();
  const { id: conversationId, listener, channel: channelId, starter } = useLocalSearchParams<{
    id: string;
    listener?: string;
    channel?: string;
    starter?: string;
  }>();
  const listenerName = listener ?? t('chat.yourListener');

  const [channel, setChannel] = useState<ChannelType | null>(null);
  const [crisis, setCrisis] = useState<CrisisPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [privacyNote, setPrivacyNote] = useState(true);
  // Surface each crisis message once, so dismissing it isn't undone by later events.
  const shownRef = useRef<Set<string>>(new Set());
  // Funnel: chat_first_message_sent fires once per screen mount.
  const firstSentRef = useRef(false);

  // The core talk→action loop (SCOPE §7): long-press a mentor message → message menu →
  // "Save to Mentor Notes" persists it to the journal.
  const customMessageActions = useCallback(
    ({
      copyMessage,
      quotedReply,
      isMyMessage,
      message,
      dismissOverlay,
    }: {
      copyMessage: { action: () => void; actionType: string; title: string; type: 'standard' | 'destructive' };
      quotedReply: { action: () => void; actionType: string; title: string; type: 'standard' | 'destructive' };
      isMyMessage: boolean;
      message: { id: string; text?: string };
      dismissOverlay: () => void;
    }) => {
      if (isMyMessage || !message.text) return [copyMessage, quotedReply];
      return [
        {
          action: () => {
            void api.saveMentorNote({
              body: message.text ?? '',
              conversation_id: conversationId ?? null,
              listener_persona: listenerName,
              stream_message_id: message.id,
            });
            dismissOverlay();
          },
          actionType: 'saveToMentorNotes',
          title: t('chat.saveToNotes'),
          type: 'standard' as const,
        },
        copyMessage,
        quotedReply,
      ];
    },
    [conversationId, listenerName, t],
  );

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
      if (!firstSentRef.current) {
        firstSentRef.current = true;
        capture('chat_first_message_sent'); // funnel tail — no content, ever
      }
      try {
        surfaceCrisis(resp.message as CrisisCarrier);
      } catch (err) {
        // A crisis-surface rendering failure must never reject an already-sent
        // message — log it and still return the send result to the kit.
        console.error('crisis surface failed', err);
      }
      return resp;
    },
    [channel, surfaceCrisis],
  );

  useEffect(() => {
    let cancelled = false;

    const setup = async () => {
      try {
        const [persona, token] = await Promise.all([getPersona(), getStreamToken()]);
        if (!persona || !token) throw new Error(t('chat.errMissingSession'));
        if (!channelId) throw new Error(t('chat.errMissingChannel'));

        const client = await ensureConnected(
          { id: persona.id, name: persona.persona_name },
          token,
        );

        const ch = client.channel('messaging', channelId);
        await ch.watch();
        if (cancelled) return;

        setChannel(ch);
        ch.state.messages.forEach((m) => surfaceCrisis(m as CrisisCarrier));
        ch.on('message.new', (e: Event) => surfaceCrisis(e.message as CrisisCarrier));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : t('chat.errOpen'));
      }
    };

    void setup();
    return () => {
      cancelled = true;
    };
    // reason: `t` is intentionally not a trigger — a locale flip must not re-run channel setup
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId, surfaceCrisis]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={['top', 'bottom']}>
      {/* Mentor header card (mockup #7) */}
      <View style={[styles.header, { backgroundColor: colors.surface }]}>
        <Pressable
          onPress={() => router.replace('/chats')}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={t('chat.leaveA11y')}
        >
          <Ionicons name="chevron-back" size={26} color={colors.ink} />
        </Pressable>
        <PersonaAvatar name={listenerName} size={52} online />
        <View style={{ flex: 1 }} accessible accessibilityRole="header">
          <Text style={[styles.personaName, { color: colors.ink }]} numberOfLines={1}>
            {listenerName}
          </Text>
          <View style={styles.statusRow}>
            <Ionicons name="shield-checkmark" size={12} color={colors.accentSoft} />
            <Text style={[type.caption, { color: colors.inkMuted }]} numberOfLines={1}>
              {t('chat.statusLine')}
            </Text>
          </View>
        </View>
        <View
          style={[styles.connectedDot, { backgroundColor: colors.surfaceAlt }]}
          accessibilityLabel={t('chat.connectedA11y')}
        >
          <View style={[styles.dot, { backgroundColor: colors.success }]} />
        </View>
        <Pressable
          onPress={() => setOptionsOpen(true)}
          hitSlop={12}
          testID="open-options"
          accessibilityRole="button"
          accessibilityLabel={t('chat.optionsA11y')}
        >
          <Ionicons name="ellipsis-vertical" size={20} color={colors.inkMuted} />
        </Pressable>
      </View>

      {/* Dismissible first-run privacy line (mockup #20 shows it collapsed) */}
      {privacyNote ? (
        <View style={[styles.privacy, { backgroundColor: colors.brandTint }]}>
          <Ionicons name="lock-closed" size={13} color={colors.accent} />
          <Text style={[type.caption, { color: colors.ink, flex: 1 }]}>
            {t('chat.privacy')}
          </Text>
          <Pressable
            onPress={() => setPrivacyNote(false)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('chat.privacyDismissA11y')}
          >
            <Ionicons name="close" size={16} color={colors.inkMuted} />
          </Pressable>
        </View>
      ) : null}

      {crisis ? <CrisisCard crisis={crisis} onDismiss={() => setCrisis(null)} colors={colors} /> : null}

      {error ? (
        <View style={styles.center}>
          <Text style={[type.body, { color: colors.danger, textAlign: 'center' }]}>{error}</Text>
        </View>
      ) : channel ? (
        <View style={{ flex: 1 }} testID="chat-ready">
          <Chat client={getStreamClient()} style={streamTheme}>
            <Channel
              channel={channel}
              doSendMessageRequest={doSendMessageRequest}
              messageActions={customMessageActions}
            >
              <StarterSeed text={starter} />
              <MessageList />
              <MessageComposer />
            </Channel>
          </Chat>
        </View>
      ) : (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={[type.body, { color: colors.inkMuted }]}>{t('chat.opening')}</Text>
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

function CrisisCard({
  crisis,
  onDismiss,
  colors,
}: {
  crisis: CrisisPayload;
  onDismiss: () => void;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  const { t } = useI18n();
  return (
    <View style={[styles.crisis, { backgroundColor: colors.brandTint }]} testID="crisis-card">
      <Text style={[styles.crisisTitle, { color: colors.ink }]}>{t('crisis.title')}</Text>
      <Text style={[type.body, { color: colors.ink }]}>{crisis.support}</Text>
      <View style={{ gap: space.sm }}>
        {crisis.helplines.map((h) => (
          <Pressable
            key={h.number}
            style={[styles.helpline, { backgroundColor: colors.surface }]}
            onPress={() => void Linking.openURL(`tel:${h.number}`)}
            accessibilityRole="button"
            accessibilityLabel={t('crisis.callA11y', { name: h.name, number: h.number, hours: h.hours })}
          >
            <IconBadge icon="call-outline" size={36} tone="green" />
            <View style={{ flex: 1 }}>
              <Text style={[type.label, { color: colors.ink }]}>{h.name}</Text>
              <Text style={[type.caption, { color: colors.inkMuted }]}>{h.number}</Text>
            </View>
            <Text style={[type.caption, { color: colors.inkMuted }]}>{h.hours}</Text>
          </Pressable>
        ))}
      </View>
      <Pressable onPress={onDismiss} hitSlop={8} style={styles.crisisDismiss} accessibilityRole="button">
        <Text style={[type.caption, { color: colors.accent }]}>{t('crisis.close')}</Text>
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
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
  },
  personaName: { fontFamily: font.serifBold, fontSize: 19, lineHeight: 24 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  connectedDot: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    padding: 6,
  },
  dot: { width: 8, height: 8, borderRadius: radius.pill },
  privacy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingVertical: space.xs,
    paddingHorizontal: space.md,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md },
  crisis: {
    margin: space.md,
    padding: space.md,
    borderRadius: radius.lg,
    gap: space.sm,
  },
  crisisTitle: { fontFamily: font.serifBold, fontSize: 18, lineHeight: 24 },
  helpline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.md,
    padding: space.sm,
  },
  crisisDismiss: { alignSelf: 'flex-end' },
});
