import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  View,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Channel as ChannelType, Event } from 'stream-chat';

import { ComposerField } from '@/components/chat/ComposerField';
import { CrisisCard, type CrisisPayload } from '@/components/chat/CrisisCard';
import { ConsolePressable } from '@/components/console/ConsolePressable';
import { EdgeSurface } from '@/components/EdgeSurface';
import type { CompanionAnimal } from '@/components/art/Companions';
import { HelplinesSheet } from '@/components/mentor/HelplinesSheet';
import { MemberDisc } from '@/components/mentor/MemberDisc';
import { MentorChatHeader } from '@/components/mentor/MentorChatHeader';
import { MentorComposerHint } from '@/components/mentor/MentorComposerHint';
import { MentorPeek, mentorPeekRoom } from '@/components/mentor/MentorPeek';
import { MentorOptionsMenu } from '@/components/mentor/MentorOptionsMenu';
import { SageSky } from '@/components/motion/SageSky';
import { useI18n } from '@/lib/i18n';
import { useListenerHeartbeat } from '@/lib/useListenerHeartbeat';
import { listenerApi, type MemberBrief } from '@/lib/listenerApi';
import { getListenerStreamClient, ensureListenerConnected } from '@/lib/listenerStreamClient';
import { mentorFaces } from '@/lib/mentorFaces';
import { getSessionToken } from '@/lib/session';
import { leaveToMentorHome } from '@/lib/leaveToChats';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space, type } from '@/theme/tokens';

/** Where the options card sits: under the header card's first row (board: top 104). */
const MENU_TOP = 96;

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
  const memberName = member ?? t('mentor.chat.anonymous');

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
  const [helplines, setHelplines] = useState(false);
  // The member as the brief carries them (companion in their colour, path lens) — best-effort.
  const [brief, setBrief] = useState<MemberBrief | null>(null);
  const [here, setHere] = useState(false);
  // The mentor's OWN face — the same animal members see for them (server mentor_face).
  const [mine, setMine] = useState<CompanionAnimal | null>(
    () => (mentorFaces.self()?.animal as CompanionAnimal | undefined) ?? null,
  );
  useEffect(() => {
    let live = true;
    if (id) {
      void listenerApi
        .brief(id)
        .then((b) => {
          if (live) setBrief(b);
        })
        .catch(() => {});
    }
    return () => {
      live = false;
    };
  }, [id]);
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
        mentorFaces.setSelf(me.companion_animal, me.companion_colour);
        setMine((me.companion_animal as CompanionAnimal | undefined) ?? 'Owl');
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
        // Reading a thread marks it read. On native the kit's MessageList does this for us;
        // the hand-rolled thread had nobody doing it, so on web the row's "new" dot never
        // cleared (app/(tabs)/chats.tsx + lib/useMentorConsole.ts read `countUnread`) and the
        // other side never saw their message turn to Read. Fire-and-forget: a failed markRead
        // must never break the conversation.
        const markRead = () => {
          void ch.markRead().catch(() => {});
        };
        markRead();
        ch.on('message.new', (e: Event) => {
          if (e.message) {
            appendMessage(e.message as RawMsg);
            surfaceCrisis(e.message as CrisisCarrier);
          }
          if (e.user && e.user.id !== client.userID) markRead();
        });
        ch.on('message.read', () => setReadTick((t) => t + 1));
        // "here now" = the member is watching this channel (presence only, never content).
        const others = () => Object.values(ch.state.watchers ?? {}).some((u) => u?.id && u.id !== client.userID);
        setHere(others());
        ch.on('user.watching.start', () => setHere(others()));
        ch.on('user.watching.stop', () => setHere(others()));
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

  // Enter sends, Shift+Enter newlines: react-native-web only invokes
  // `onSubmitEditing` on a multiline TextInput when `blurOnSubmit` is set (see
  // TextInput/index.js's handleKeyDown), so Enter-to-send is wired through
  // `onKeyPress` instead, reading the DOM KeyboardEvent's `shiftKey` off
  // `nativeEvent` (present at runtime; not in RN's official
  // TextInputKeyPressEventData type, hence the narrow cast below).
  const handleComposerKeyPress = (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
    const shiftKey = (e.nativeEvent as unknown as { shiftKey?: boolean }).shiftKey;
    if (e.nativeEvent.key === 'Enter' && !shiftKey) {
      e.preventDefault();
      void send();
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
      leaveToMentorHome(router, home);
    } catch {
      // Stay still and silent (T&S: no shaking/buzzing at a struggling user) —
      // release the spinner and fold the menu back rather than surface an error.
      setEnding(false);
      setMenu('closed');
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={['top', 'bottom']}>
      <SageSky shape="top" />
      <View style={styles.headerWrap}>
        <MentorChatHeader
          memberName={memberName}
          brief={brief}
          here={here}
          masked={masked === '1' || !!brief?.member_masked}
          onBack={() => leaveToMentorHome(router, home)}
          onOpenBrief={() => router.push({ pathname: '/mentor/member/[id]', params: { id, member: memberName, masked } })}
          onOptions={() => setMenu((m) => (m === 'closed' ? 'open' : 'closed'))}
          onHelplines={() => setHelplines(true)}
        />
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
            contentContainerStyle={[styles.list, { paddingBottom: mentorPeekRoom(mine) }]}
            ListEmptyComponent={
              <View style={styles.emptyChat}>
                <Ionicons name="chatbubble-ellipses-outline" size={32} color={colors.inkMuted} />
                <Text style={[type.body, { color: colors.inkMuted, textAlign: 'center' }]}>
                  {t('mentor.chat.empty')}
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
                      <Text style={[type.caption, styles.dayText, { color: colors.inkMuted }]}>{dayLabel(item.at)}</Text>
                    </View>
                  ) : null}

                  {item.mine ? (
                    <View style={styles.mineWrap}>
                      <EdgeSurface
                        edge={colors.accentEdge}
                        travel={3}
                        faceRadiusStyle={styles.mineCorners}
                        style={[styles.bubble, { backgroundColor: colors.accent }]}
                        containerStyle={styles.bubbleBox}
                      >
                        <Text style={[type.body, { color: colors.onAccent }]}>{item.text}</Text>
                      </EdgeSurface>
                      <View style={styles.metaRow}>
                        <Text style={[type.caption, styles.tnum, { color: colors.inkMuted }]}>
                          {isRead(item) ? t('mentorChatPage.read') : timeLabel(item.at)}
                        </Text>
                      </View>
                    </View>
                  ) : (
                    <View style={styles.theirsWrap}>
                      <EdgeSurface
                        edge={colors.edgeSurface}
                        travel={3}
                        faceRadiusStyle={styles.theirsCorners}
                        style={[styles.bubble, styles.theirsFace, { backgroundColor: colors.surface, borderColor: colors.border }]}
                        containerStyle={styles.bubbleBox}
                      >
                        <Text style={[type.body, { color: colors.ink }]}>{item.text}</Text>
                      </EdgeSurface>
                    </View>
                  )}
                </View>
              );
            }}
          />
          {crisis ? <CrisisCard crisis={crisis} audience="mentor" onDismiss={() => setCrisis(null)} /> : null}

          {/* Presence-only typing line — calm register, no animation needed. */}
          {typing ? (
            <View style={styles.typingRow} testID="listener-typing-indicator">
              <View style={[styles.typingPill, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                {[1, 0.6, 0.35].map((o) => (
                  <View key={o} style={[styles.typingDot, { backgroundColor: colors.inkMuted, opacity: o }]} />
                ))}
              </View>
              <Text style={[type.caption, { color: colors.inkMuted }]}>{t('mentorChatPage.typing', { name: typing })}</Text>
            </View>
          ) : null}

          {/* Your companion over the message field (board A35), seated on the footer's edge. */}
          <MentorPeek animal={mine} label={t('mentorChatPage.companionA11y')} />
          <View style={[styles.footer, { backgroundColor: colors.bg, borderTopColor: colors.border }]}>
            <MentorComposerHint />
            {sendError ? (
              <Text
                style={[type.caption, styles.sendErrorLine, { color: colors.danger }]}
                testID="listener-send-error"
              >
                {t('chat.sendFailed')}
              </Text>
            ) : null}
            <ComposerField
              value={draft}
              onChangeText={(text) => {
                setDraft(text);
                onTyping();
              }}
              onSubmit={() => void send()}
              onKeyPress={handleComposerKeyPress}
              disabled={!draft.trim() || sending}
              sending={sending}
              placeholder={t('mentorChatPage.placeholder', { name: memberName })}
              testIDPrefix="listener-composer"
            />
          </View>
        </View>
        </View>
      )}

      {menu !== 'closed' ? (
        <MentorOptionsMenu
          state={menu === 'open' ? 'open' : 'confirmEnd'}
          top={MENU_TOP}
          ending={ending}
          onReport={() => {
            setMenu('closed');
            router.push({ pathname: '/mentor/report', params: { id } });
          }}
          onAskEnd={() => setMenu('confirmEnd')}
          onConfirmEnd={() => void endNow()}
          onClose={() => setMenu('closed')}
        />
      ) : null}

      {/* The still helplines panel over a 0.35 scrim — nothing in it moves (T&S #11). */}
      {helplines ? (
        <View style={[StyleSheet.absoluteFill, styles.helpLayer]}>
          <ConsolePressable
            onPress={() => setHelplines(false)}
            accessibilityRole="button"
            accessibilityLabel={t('mentorChatPage.close')}
            style={[StyleSheet.absoluteFill, styles.helpScrim, { backgroundColor: colors.ink }]}
            testID="mentor-helplines-backdrop"
          />
          <View style={[styles.helpCard, elevation.md]}>
            <HelplinesSheet onClose={() => setHelplines(false)} />
          </View>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  headerWrap: { paddingHorizontal: 12, paddingTop: space.sm, zIndex: 3 },
  tnum: { fontVariant: ['tabular-nums'] },
  retryBtn: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.md,
  },
  emptyChat: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.sm, padding: space.xl },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, padding: space.lg },
  list: { paddingHorizontal: space.md, paddingTop: 12, paddingBottom: 64, gap: 10, flexGrow: 1, justifyContent: 'flex-end' },
  dayRow: { alignItems: 'center', marginVertical: space.sm },
  dayText: { fontFamily: type.label.fontFamily },
  bubbleBox: { maxWidth: 288 },
  bubble: { paddingHorizontal: 14, paddingVertical: 10 },
  mineCorners: { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.sm },
  theirsCorners: { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, borderBottomRightRadius: radius.lg, borderBottomLeftRadius: radius.sm },
  theirsFace: { borderWidth: 1 },
  mineWrap: { alignItems: 'flex-end', marginVertical: 5, gap: space.xs },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingRight: 6 },
  theirsWrap: { alignItems: 'flex-start', marginVertical: 5 },
  typingRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingBottom: space.sm },
  typingPill: { height: 28, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, borderWidth: 1, borderRadius: radius.pill },
  typingDot: { width: 6, height: 6, borderRadius: radius.pill },
  footer: { paddingTop: space.sm, paddingBottom: space.md, gap: space.sm, borderTopWidth: 1 },
  // A zero-height band on the footer's top edge; the companion hangs 30px into the footer
  // (drawn after it, so hidden there) and shows 60px above it.
  sendErrorLine: { paddingBottom: space.xs, paddingHorizontal: space.md },
  helpLayer: { zIndex: 6 },
  helpScrim: { opacity: 0.35 },
  helpCard: { position: 'absolute', left: 12, right: 12, top: 186, alignItems: 'center' },
});
