import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { ComponentProps } from 'react';
import type { Channel as ChannelType, Event } from 'stream-chat';
import { Channel, Chat, MessageComposer, MessageList } from 'stream-chat-expo';

// stream-chat-expo's star re-exports collide on the name `Theme` (the kit's UI theme vs
// a stream-chat type), so derive the exact prop type from the component instead.
type StreamChatStyle = ComponentProps<typeof Chat>['style'];

import { CrisisCard, type CrisisPayload } from '@/components/chat/CrisisCard';
import { PersonaAvatar } from '@/components/art/PersonaAvatar';
import { MentorRail } from '@/components/mentor/MentorRail';
import { PressKey } from '@/components/motion/PressKey';
import { useI18n } from '@/lib/i18n';
import { listenerApi } from '@/lib/listenerApi';
import { ensureListenerConnected, getListenerStreamClient } from '@/lib/listenerStreamClient';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type } from '@/theme/tokens';

/**
 * The mentor's real-time 1:1 chat, on the same stream-chat-expo kit as the member
 * side (components/chat/ChatScreen.tsx) — a distinct listener identity/token, no
 * message-menu "save to notes" (that's a member-only affordance), and its own
 * conversation menu (report / end) plus the standing MentorRail safety strip.
 *
 * Safety: as on the member side, the crisis scan runs server-side in the Stream
 * before-message-send webhook, never here — this screen only renders the
 * server-provided `crisis` payload.
 */

/** Any Stream message shape can carry the server-injected `crisis` field. */
type CrisisCarrier = { id?: string; crisis?: CrisisPayload };

type MenuState = 'closed' | 'open' | 'confirmEnd';

export default function MentorChatScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useI18n();
  const { id, channel: channelId, member, masked } = useLocalSearchParams<{
    id: string;
    channel: string;
    member: string;
    masked: string;
  }>();

  const [channel, setChannel] = useState<ChannelType | null>(null);
  const [crisis, setCrisis] = useState<CrisisPayload | null>(null);
  const [error, setError] = useState(false);
  const [menu, setMenu] = useState<MenuState>('closed');
  const [ending, setEnding] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // Surface each crisis message once, so dismissing it isn't undone by later events.
  const shownRef = useRef<Set<string>>(new Set());

  // Theme the Stream kit (v9 semantics tokens) — identical mapping to ChatScreen.tsx
  // so the two sides of a conversation read as the same product.
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
    const msgId = message?.id;
    if (payload && msgId && !shownRef.current.has(msgId)) {
      shownRef.current.add(msgId);
      setCrisis(payload);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const setup = async () => {
      try {
        setError(false);
        const me = await listenerApi.me();
        const client = await ensureListenerConnected({ id: me.id, name: me.persona_name }, me.stream_token);
        const ch = client.channel('messaging', channelId);
        await ch.watch();
        if (cancelled) return;

        setChannel(ch);
        ch.state.messages.forEach((m) => surfaceCrisis(m as CrisisCarrier));
        ch.on('message.new', (e: Event) => surfaceCrisis(e.message as CrisisCarrier));
      } catch {
        if (!cancelled) setError(true);
      }
    };

    void setup();
    return () => {
      cancelled = true;
    };
  }, [channelId, surfaceCrisis, attempt]);

  const endNow = async () => {
    if (ending) return;
    setEnding(true);
    try {
      await listenerApi.end(id);
      router.replace('/mentor-home');
    } catch {
      // Stay still and silent (T&S: no shaking/buzzing at a struggling user) —
      // release the spinner and fold the menu back rather than surface an error.
      setEnding(false);
      setMenu('closed');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']} testID="mentor-chat-screen">
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <View style={[styles.header, { backgroundColor: colors.surface }]}>
          <Pressable
            onPress={() => router.replace('/mentor-home')}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={t('mentor.chat.back')}
            testID="mentor-chat-back"
          >
            <Ionicons name="chevron-back" size={26} color={colors.ink} />
          </Pressable>
          <PersonaAvatar name={member} size={44} online={masked !== '1'} />
          <View style={{ flex: 1 }} accessible accessibilityRole="header">
            <Text style={[styles.personaName, { color: colors.ink }]} numberOfLines={1}>
              {member}
            </Text>
            {masked === '1' ? (
              <Text style={[type.caption, { color: colors.inkMuted }]} numberOfLines={1}>
                {t('mentor.masked')}
              </Text>
            ) : null}
          </View>
          <Pressable
            onPress={() => setMenu((m) => (m === 'closed' ? 'open' : 'closed'))}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={t('mentor.chat.menu')}
            testID="mentor-chat-menu"
          >
            <Ionicons name="ellipsis-vertical" size={20} color={colors.inkMuted} />
          </Pressable>
        </View>

        {menu !== 'closed' ? (
          <View style={[styles.menuSheet, { backgroundColor: colors.surfaceAlt }]} testID="mentor-chat-menu-sheet">
            {menu === 'open' ? (
              <>
                <PressKey
                  onPress={() => {
                    setMenu('closed');
                    router.push({ pathname: '/mentor/report', params: { id } });
                  }}
                  edge={colors.edgeSurface}
                  radius={radius.md}
                  style={[styles.menuItem, { backgroundColor: colors.surface }]}
                  testID="mentor-menu-report"
                >
                  <Text style={[type.label, { color: colors.ink }]}>{t('mentor.chat.report')}</Text>
                </PressKey>
                <PressKey
                  onPress={() => setMenu('confirmEnd')}
                  edge={colors.edgeSurface}
                  radius={radius.md}
                  style={[styles.menuItem, { backgroundColor: colors.surface }]}
                  testID="mentor-menu-end"
                >
                  <Text style={[type.label, { color: colors.danger }]}>{t('mentor.chat.end')}</Text>
                </PressKey>
              </>
            ) : (
              <>
                <Text style={[type.label, { color: colors.ink }]}>{t('mentor.chat.endTitle')}</Text>
                <Text style={[type.caption, { color: colors.inkMuted }]}>{t('mentor.chat.endBody')}</Text>
                <View style={styles.menuRow}>
                  <PressKey
                    onPress={() => void endNow()}
                    edge={colors.accentEdge}
                    radius={radius.md}
                    disabled={ending}
                    style={[styles.menuItem, styles.menuRowItem, { backgroundColor: colors.accent }]}
                    testID="mentor-end-confirm"
                  >
                    <Text style={[type.label, { color: colors.onAccent }]}>{t('mentor.chat.endConfirm')}</Text>
                  </PressKey>
                  <PressKey
                    onPress={() => setMenu('closed')}
                    edge={colors.edgeSurface}
                    radius={radius.md}
                    disabled={ending}
                    style={[styles.menuItem, styles.menuRowItem, { backgroundColor: colors.surface }]}
                    testID="mentor-end-cancel"
                  >
                    <Text style={[type.label, { color: colors.ink }]}>{t('mentor.chat.keep')}</Text>
                  </PressKey>
                </View>
              </>
            )}
          </View>
        ) : null}

        {crisis ? <CrisisCard crisis={crisis} onDismiss={() => setCrisis(null)} /> : null}

        {error ? (
          <View style={styles.center}>
            <Text style={[type.body, { color: colors.danger, textAlign: 'center' }]}>{t('mentor.chat.errOpen')}</Text>
            <PressKey
              onPress={() => setAttempt((a) => a + 1)}
              edge={colors.accentEdge}
              radius={radius.pill}
              style={[styles.retry, { backgroundColor: colors.accent }]}
              testID="mentor-chat-retry"
            >
              <Text style={[type.label, { color: colors.onAccent }]}>{t('mentor.chat.retry')}</Text>
            </PressKey>
          </View>
        ) : channel ? (
          <View style={{ flex: 1 }} testID="mentor-chat-ready">
            <Chat client={getListenerStreamClient()} style={streamTheme}>
              <Channel channel={channel}>
                <MessageList />
                <MentorRail
                  onHelplines={() => router.push('/mentor/helplines')}
                  onReport={() => router.push({ pathname: '/mentor/report', params: { id } })}
                />
                <MessageComposer />
              </Channel>
            </Chat>
          </View>
        ) : (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={colors.accent} />
            <Text style={[type.body, { color: colors.inkMuted }]}>{t('mentor.chat.opening')}</Text>
          </View>
        )}
      </View>
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
  personaName: { fontFamily: font.sansBold, fontSize: 18, lineHeight: 24 },
  menuSheet: {
    margin: space.md,
    padding: space.sm,
    borderRadius: radius.lg,
    gap: space.sm,
  },
  menuItem: { padding: space.sm, alignItems: 'center' },
  menuRow: { flexDirection: 'row', gap: space.sm },
  menuRowItem: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md },
  retry: { paddingHorizontal: space.lg, paddingVertical: space.sm },
});
