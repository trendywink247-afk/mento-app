import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Channel as ChannelType, Event } from 'stream-chat';

import { CrisisCard, type CrisisPayload } from '@/components/chat/CrisisCard';
import { ConsolePressable } from '@/components/console/ConsolePressable';
import { PersonaAvatar } from '@/components/art/PersonaAvatar';
import { MentorRail } from '@/components/mentor/MentorRail';
import { PressKey } from '@/components/motion/PressKey';
import { useI18n } from '@/lib/i18n';
import { useListenerHeartbeat } from '@/lib/useListenerHeartbeat';
import { listenerApi } from '@/lib/listenerApi';
import { getListenerStreamClient, ensureListenerConnected } from '@/lib/listenerStreamClient';
import { getSessionToken } from '@/lib/session';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space, type } from '@/theme/tokens';

/**
 * Mentor-side chat, web console (in-app web at /mentor/chat/[id] AND the token-link
 * console at /listener/chat/[id]). A trimmed sibling of ChatScreen.web: same
 * bubbles/day-pills/read-state/composer, but the header shows the MEMBER's persona,
 * plus the same rail + report/end menu as the native stream-chat-expo thread
 * (components/mentor/MentorChatScreen.tsx) for parity across platforms.
 * The CrisisCard renders here too — the listener sees exactly which helplines the
 * member was shown (the payload is server-injected; the client never scans).
 */

type CrisisCarrier = { id?: string; crisis?: CrisisPayload };
type Msg = { id: string; text: string; mine: boolean; at: string };
type RawMsg = { id?: string; text?: string; user?: { id?: string }; created_at?: string | Date };
type MenuState = 'closed' | 'open' | 'confirmEnd';

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

export default function MentorChatScreenWeb() {
  const router = useRouter();
  const { colors, elevation } = useTheme();
  const { t } = useI18n();
  const { id, channel: channelId, member, masked } = useLocalSearchParams<{
    id: string;
    channel?: string;
    member?: string;
    masked?: string;
  }>();
  const memberName = member ?? 'Anonymous member';

  const [ready, setReady] = useState(false);
  const [online, setOnline] = useState(false);
  useListenerHeartbeat(online);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(false);
  const [typing, setTyping] = useState<string | null>(null); // member's persona name
  const [crisis, setCrisis] = useState<CrisisPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [readTick, setReadTick] = useState(0);
  const [menu, setMenu] = useState<MenuState>('closed');
  const [ending, setEnding] = useState(false);
  const channelRef = useRef<ChannelType | null>(null);
  const shownRef = useRef<Set<string>>(new Set());

  // A device with a member session open is the in-app console (back → Mentor Home);
  // a bare token-link browser (the standalone console) goes back to the console list.
  const [home, setHome] = useState<'/listener' | '/mentor-home'>('/listener');
  useEffect(() => {
    void getSessionToken().then((tok) => {
      if (tok) setHome('/mentor-home');
    });
  }, []);

  const surfaceCrisis = useCallback((m: CrisisCarrier | undefined) => {
    if (m?.crisis && m.id && !shownRef.current.has(m.id)) {
      shownRef.current.add(m.id);
      setCrisis(m.crisis);
    }
  }, []);

  const toMsg = useCallback((m: RawMsg): Msg => {
    const client = getListenerStreamClient();
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

    const setup = async () => {
      try {
        if (!channelId) throw new Error('Missing channel.');
        // /listener/me returns a fresh Stream token for this listener identity.
        const me = await listenerApi.me();
        setOnline(me.status === 'online');
        const client = await ensureListenerConnected(
          { id: me.id, name: me.persona_name },
          me.stream_token,
        );
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
          if (e.user && e.user.id !== client.userID) setTyping(e.user.name ?? memberName);
        });
        ch.on('typing.stop', (e: Event) => {
          if (e.user && e.user.id !== client.userID) setTyping(null);
        });
        setReady(true);
      } catch {
        // Never surface raw error internals to the listener — one calm, actionable line.
        if (!cancelled) setError(t('mentor.chat.errOpen'));
      }
    };

    void setup();
    return () => {
      cancelled = true;
    };
  }, [channelId, appendMessage, surfaceCrisis, memberName, attempt]);

  const onTyping = useCallback(() => {
    // stream-chat throttles keystroke() internally; guard anyway — typing signals
    // are best-effort and must never surface an error in the composer.
    try {
      void channelRef.current?.keystroke().catch(() => {});
    } catch {
      /* best-effort typing signal */
    }
  }, []);

  const send = async () => {
    const body = draft.trim();
    if (!body || !channelRef.current || sending) return;
    setSending(true);
    try {
      // Listener messages pass through the same server-side crisis scan (sender-agnostic).
      const resp = await channelRef.current.sendMessage({ text: body });
      appendMessage(resp.message as RawMsg);
      surfaceCrisis(resp.message as CrisisCarrier);
      // Clear only after the server accepted it — a failed send keeps their words.
      setDraft('');
      setSendError(false);
    } catch {
      setSendError(true);
    } finally {
      setSending(false);
    }
  };

  const isRead = useCallback(
    (m: Msg): boolean => {
      void readTick;
      const ch = channelRef.current;
      const me = getListenerStreamClient().userID;
      if (!ch) return false;
      return Object.values(ch.state.read).some(
        (r) => r.user.id !== me && new Date(r.last_read).getTime() >= new Date(m.at).getTime(),
      );
    },
    [readTick],
  );

  const endNow = async () => {
    if (ending) return;
    setEnding(true);
    try {
      await listenerApi.end(id);
      router.replace(home);
    } catch {
      // Stay still and silent (T&S: no shaking/buzzing at a struggling user) —
      // release the spinner and fold the menu back rather than surface an error.
      setEnding(false);
      setMenu('closed');
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={['top', 'bottom']}>
      {/* Member header — persona only, anonymity holds both ways. */}
      <View style={[styles.header, { backgroundColor: colors.surface }, elevation.sm]}>
        <ConsolePressable
          onPress={() => router.replace(home)}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={t('mentor.chat.back')}
          testID="mentor-chat-back"
        >
          <Ionicons name="chevron-back" size={26} color={colors.ink} />
        </ConsolePressable>
        <PersonaAvatar name={memberName} size={52} online={masked !== '1'} />
        <View style={{ flex: 1 }} accessible accessibilityRole="header">
          <Text style={[styles.personaName, { color: colors.ink }]} numberOfLines={1}>
            {memberName}
          </Text>
          {masked === '1' ? (
            <Text style={[type.caption, { color: colors.inkMuted }]} numberOfLines={1}>
              {t('mentor.masked')}
            </Text>
          ) : null}
        </View>
        <ConsolePressable
          onPress={() => setMenu((m) => (m === 'closed' ? 'open' : 'closed'))}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={t('mentor.chat.menu')}
          testID="mentor-chat-menu"
        >
          <Ionicons name="ellipsis-vertical" size={20} color={colors.inkMuted} />
        </ConsolePressable>
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
                  style={[styles.menuItem, { backgroundColor: colors.accent }]}
                  containerStyle={{ flex: 1 }}
                  testID="mentor-end-confirm"
                >
                  <Text style={[type.label, { color: colors.onAccent }]}>{t('mentor.chat.endConfirm')}</Text>
                </PressKey>
                <PressKey
                  onPress={() => setMenu('closed')}
                  edge={colors.edgeSurface}
                  radius={radius.md}
                  disabled={ending}
                  style={[styles.menuItem, { backgroundColor: colors.surface }]}
                  containerStyle={{ flex: 1 }}
                  testID="mentor-end-cancel"
                >
                  <Text style={[type.label, { color: colors.ink }]}>{t('mentor.chat.keep')}</Text>
                </PressKey>
              </View>
            </>
          )}
        </View>
      ) : null}

      <View style={[styles.privacy, { backgroundColor: colors.brandTint }]}>
        <Ionicons name="heart" size={13} color={colors.accent} />
        <Text style={[type.caption, { color: colors.ink, flex: 1 }]}>
          You're supporting an anonymous member — be kind, never ask for personal details.
        </Text>
      </View>

      {error ? (
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={36} color={colors.inkMuted} />
          <Text style={[type.body, { color: colors.danger, textAlign: 'center' }]}>{error}</Text>
          <ConsolePressable
            onPress={() => {
              setError(null);
              setAttempt((a) => a + 1);
            }}
            accessibilityRole="button"
            accessibilityLabel="Retry opening the conversation"
            testID="chat-retry"
            style={styles.retryBtn}
          >
            <Text style={[type.label, { color: colors.accent }]}>{t('mentor.chat.retry')}</Text>
          </ConsolePressable>
        </View>
      ) : !ready ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={[type.body, { color: colors.inkMuted }]}>{t('mentor.chat.opening')}</Text>
        </View>
      ) : (
        <View style={{ flex: 1 }} testID="mentor-chat-ready">
        <View style={{ flex: 1 }} testID="listener-chat-ready">
          <FlatList
            data={messages}
            keyExtractor={(m) => m.id}
            contentContainerStyle={styles.list}
            ListEmptyComponent={
              <View style={styles.emptyChat}>
                <Ionicons name="chatbubble-ellipses-outline" size={32} color={colors.inkMuted} />
                <Text style={[type.body, { color: colors.inkMuted, textAlign: 'center' }]}>
                  No messages yet — say hello.
                </Text>
              </View>
            }
            renderItem={({ item, index }) => {
              const prev = index > 0 ? messages[index - 1] : null;
              const showDay = !prev || dayLabel(prev.at) !== dayLabel(item.at);
              return (
                <View>
                  {showDay ? (
                    <View style={styles.dayRow}>
                      <View style={[styles.hairline, { backgroundColor: colors.border }]} />
                      <View style={[styles.dayPill, { backgroundColor: colors.surfaceAlt }]}>
                        <Text style={[type.caption, { color: colors.inkMuted }]}>
                          {dayLabel(item.at)}
                        </Text>
                      </View>
                      <View style={[styles.hairline, { backgroundColor: colors.border }]} />
                    </View>
                  ) : null}

                  {item.mine ? (
                    <View style={styles.mineWrap}>
                      <View
                        style={[styles.bubble, styles.mine, { backgroundColor: colors.accentTint }]}
                      >
                        <Text style={[type.body, { color: colors.ink }]}>{item.text}</Text>
                      </View>
                      <View style={styles.metaRow}>
                        <Text style={[type.caption, styles.tnum, { color: colors.inkMuted }]}>
                          {timeLabel(item.at)}
                        </Text>
                        <Ionicons
                          name="checkmark-done"
                          size={15}
                          color={isRead(item) ? colors.accent : colors.inkMuted}
                        />
                      </View>
                    </View>
                  ) : (
                    <View style={styles.theirsWrap}>
                      <View style={styles.theirsRow}>
                        <PersonaAvatar name={memberName} size={34} />
                        <View
                          style={[
                            styles.bubble,
                            styles.theirs,
                            { backgroundColor: colors.surface },
                            elevation.sm,
                          ]}
                        >
                          <Text style={[type.body, { color: colors.ink }]}>{item.text}</Text>
                        </View>
                      </View>
                      <Text
                        style={[type.caption, styles.theirsTime, styles.tnum, { color: colors.inkMuted }]}
                      >
                        {timeLabel(item.at)}
                      </Text>
                    </View>
                  )}
                </View>
              );
            }}
          />
          {crisis ? <CrisisCard crisis={crisis} onDismiss={() => setCrisis(null)} /> : null}

          {/* Presence-only typing line — calm register, no animation needed. */}
          {typing ? (
            <Text
              style={[type.caption, styles.typingLine, { color: colors.inkMuted }]}
              testID="listener-typing-indicator"
            >
              {t('chat.typing', { name: typing })}
            </Text>
          ) : null}

          <MentorRail
            onHelplines={() => router.push('/mentor/helplines')}
            onReport={() => router.push({ pathname: '/mentor/report', params: { id } })}
          />

          <View style={styles.composer}>
            <View style={{ flex: 1 }}>
              {sendError ? (
                <Text
                  style={[type.caption, styles.sendErrorLine, { color: colors.danger }]}
                  testID="listener-send-error"
                >
                  {t('chat.sendFailed')}
                </Text>
              ) : null}
              <View style={[styles.inputPill, { backgroundColor: colors.surface }, elevation.sm]}>
              <TextInput
                style={[styles.input, { color: colors.ink }]}
                placeholder={t('mentor.chat.reply')}
                placeholderTextColor={colors.inkMuted}
                value={draft}
                onChangeText={(text) => {
                  setDraft(text);
                  onTyping();
                }}
                onSubmitEditing={() => void send()}
                testID="listener-composer-input"
                accessibilityLabel="Reply"
                multiline
              />
              </View>
            </View>
            <ConsolePressable
              style={[styles.sendBtn, { backgroundColor: colors.accent }, elevation.sm]}
              onPress={() => void send()}
              disabled={!draft.trim() || sending}
              testID="listener-composer-send"
              accessibilityRole="button"
              accessibilityLabel="Send reply"
            >
              <Ionicons name="paper-plane" size={19} color={colors.onAccent} />
            </ConsolePressable>
          </View>
        </View>
        </View>
      )}
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
  personaName: { ...type.titleSmSerif },
  tnum: { fontVariant: ['tabular-nums'] },
  menuSheet: {
    margin: space.md,
    padding: space.sm,
    borderRadius: radius.lg,
    gap: space.sm,
  },
  menuItem: { padding: space.sm, alignItems: 'center' },
  menuRow: { flexDirection: 'row', gap: space.sm },
  retryBtn: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.md,
  },
  emptyChat: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.sm, padding: space.xl },
  privacy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingVertical: space.xs,
    paddingHorizontal: space.md,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, padding: space.lg },
  list: { padding: space.md, gap: space.xs },
  dayRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginVertical: space.md },
  hairline: { flex: 1, height: 1 },
  dayPill: { borderRadius: radius.pill, paddingVertical: 4, paddingHorizontal: space.md },
  bubble: {
    maxWidth: '80%',
    borderRadius: radius.lg,
    paddingHorizontal: space.md,
    paddingVertical: space.sm + 2,
  },
  mineWrap: { alignItems: 'flex-end', marginVertical: space.xs },
  mine: { borderBottomRightRadius: radius.sm },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: 3 },
  theirsWrap: { marginVertical: space.xs },
  theirsRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  theirs: { borderBottomLeftRadius: radius.sm },
  theirsTime: { marginLeft: 34 + space.sm + space.xs, marginTop: 3 },
  typingLine: { paddingHorizontal: space.md, paddingTop: space.xs },
  sendErrorLine: { paddingBottom: space.xs },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm, padding: space.md },
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
