import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Channel as ChannelType, Event } from 'stream-chat';

import { EdgeSurface } from '@/components/EdgeSurface';
import { IconBadge } from '@/components/IconBadge';
import { PressKey } from '@/components/motion/PressKey';
import { ChatHeaderCard } from '@/components/chat/ChatHeaderCard';
import { ComposerField } from '@/components/chat/ComposerField';
import { ConversationOptions } from '@/components/chat/ConversationOptions';
import { CrisisCard, type CrisisPayload } from '@/components/chat/CrisisCard';
import { TypingDots } from '@/components/chat/TypingDots';
import { PersonaAvatar } from '@/components/art/PersonaAvatar';
import { SceneTile } from '@/components/art/SceneTile';
import { capture } from '@/lib/analytics';
import { api } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { useI18n, type TFunc } from '@/lib/i18n';
import { pendingOption } from '@/lib/pendingOption';
import { getPersona, getStreamToken } from '@/lib/session';
import { ensureConnected, getStreamClient } from '@/lib/streamClient';
import { useChatHeader } from '@/lib/useChatHeader';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { useSessionGuard } from '@/lib/useSessionGuard';
import { duration, easing } from '@/theme/motion';
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

function dayLabel(iso: string, t: TFunc): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return t('chat.today');
  if (d.toDateString() === yesterday.toDateString()) return t('chat.yesterday');
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

type MessageRowProps = {
  item: Msg;
  /** Day-pill text when this row starts a new day, else null. */
  dayText: string | null;
  read: boolean;
  /** True only for messages that arrived after the initial history load — these
   * rise in; history renders still. */
  fresh: boolean;
  actionsOpen: boolean;
  isHelpful: boolean;
  isSaved: boolean;
  listenerName: string;
  onToggleActions: (id: string) => void;
  onToggleHelpful: (id: string) => void;
  onSave: (m: Msg) => void;
  onCopy: (text: string) => void;
  onRisen: (id: string) => void;
};

/** One transcript row, memoized so composer keystrokes and typing events never
 * re-render the whole message list. Display state arrives as primitives so
 * React.memo's shallow compare stays cheap and correct. */
const MessageRow = memo(function MessageRow({
  item,
  dayText,
  read,
  fresh,
  actionsOpen,
  isHelpful,
  isSaved,
  listenerName,
  onToggleActions,
  onToggleHelpful,
  onSave,
  onCopy,
  onRisen,
}: MessageRowProps) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const reduced = useReducedMotion();
  // Rise-in for messages that arrive live; history renders still.
  const rise = useSharedValue(fresh && !reduced ? 1 : 0);
  useEffect(() => {
    if (rise.value === 1) {
      rise.value = withTiming(0, { duration: duration.gentle, easing: easing.settle });
      onRisen(item.id);
    }
  }, [rise, onRisen, item.id]);
  const riseStyle = useAnimatedStyle(() => ({
    opacity: 1 - rise.value,
    transform: [{ translateY: 10 * rise.value }],
  }));
  return (
    <Animated.View style={riseStyle}>
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
          <EdgeSurface
            edge={colors.accentEdge}
            travel={3}
            radius={radius.lg}
            faceRadiusStyle={{ borderBottomRightRadius: radius.sm }}
            style={[styles.bubble, { backgroundColor: colors.accentTint }]}
            containerStyle={styles.bubbleWrap}
          >
            <Text style={[type.body, { color: colors.ink }]}>{item.text}</Text>
          </EdgeSurface>
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
            <PressKey
              onPress={() => onToggleActions(item.id)}
              edge={colors.edgeSurface}
              travel={3}
              radius={radius.lg}
              haptic="none"
              faceRadiusStyle={{ borderBottomLeftRadius: radius.sm }}
              accessibilityHint={t('chat.actionsHintA11y')}
              testID={`msg-${item.id}`}
              style={[styles.bubble, { backgroundColor: colors.surface }]}
              containerStyle={styles.bubbleWrap}
            >
              <Text style={[type.body, { color: colors.ink }]}>{item.text}</Text>
            </PressKey>
          </View>
          <Text style={[type.caption, styles.theirsTime, { color: colors.inkMuted }]}>
            {timeLabel(item.at)}
          </Text>

          {actionsOpen ? (
            <View style={styles.actionsZone}>
              <EdgeSurface
                edge={colors.edgeSurface}
                travel={2}
                radius={radius.md}
                style={[styles.actionsRow, { backgroundColor: colors.surface }]}
              >
                <Text style={[type.caption, { color: colors.inkMuted }]}>{t('chat.wasHelpful')}</Text>
                <Pressable
                  onPress={() => onToggleHelpful(item.id)}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel={t('chat.helpfulA11y')}
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
                  accessibilityLabel={t('chat.saveToNotes')}
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
                  accessibilityLabel={t('chat.copyA11y')}
                >
                  <Ionicons name="copy-outline" size={17} color={colors.inkMuted} />
                </Pressable>
              </EdgeSurface>

              <Pressable
                onPress={() => onSave(item)}
                accessibilityRole="button"
                accessibilityLabel={isSaved ? t('chat.savedA11y') : t('chat.saveToNotes')}
                testID={`save-card-${item.id}`}
                style={[styles.saveCard, { backgroundColor: colors.surfaceAlt }]}
              >
                <IconBadge icon="book-outline" size={40} />
                <View style={{ flex: 1 }}>
                  <Text style={[type.label, { color: colors.ink }]}>
                    {isSaved ? t('chat.savedToNotes') : t('chat.saveToNotes')}
                  </Text>
                  <Text style={[type.caption, { color: colors.inkMuted }]}>
                    {isSaved
                      ? t('chat.savedHint')
                      : t('chat.saveHint')}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.inkMuted} />
              </Pressable>
            </View>
          ) : null}
        </View>
      )}
    </Animated.View>
  );
});

type ComposerProps = {
  /** Path warm-up prompt — lands in the input ready to edit/send, never auto-sent. */
  initialDraft?: string;
  /** Resolves when the message is accepted by the server; rejects on failure. */
  onSend: (body: string) => Promise<void>;
  onTyping: () => void;
  /** "Edit in chat" from the first-question builder: open with the field focused. */
  autoFocus?: boolean;
};

/** Pillow-key composer (spec §5.2 — same anatomy/tokens as the native
 * components/chat/Composer.tsx, via the shared components/chat/ComposerField.tsx).
 * Owns the draft locally so every keystroke re-renders only this leaf — never the
 * transcript above it. The draft is cleared only AFTER the send resolves; on
 * failure it stays put with an honest retry line. Enter sends, Shift+Enter
 * newlines: react-native-web only invokes `onSubmitEditing` on a multiline
 * TextInput when `blurOnSubmit` is set (see TextInput/index.js's handleKeyDown),
 * so Enter-to-send is wired through `onKeyPress` instead, reading the DOM
 * KeyboardEvent's `shiftKey` off `nativeEvent` (present at runtime; not in RN's
 * official TextInputKeyPressEventData type, hence the narrow cast below). */
const Composer = memo(function Composer({ onSend, onTyping, initialDraft, autoFocus }: ComposerProps) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const [draft, setDraft] = useState(initialDraft ?? '');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(false);
  const isEmpty = !draft.trim();

  const submit = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await onSend(body);
      setDraft('');
      setSendError(false);
    } catch {
      // Keep their words — the draft stays; one calm line invites a retry.
      setSendError(true);
    } finally {
      setSending(false);
    }
  };

  const handleKeyPress = (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
    // reason: react-native-web's key event carries `shiftKey` on `nativeEvent`
    // (verified against its TextInput source) — RN's official
    // TextInputKeyPressEventData type only declares `key`.
    const shiftKey = (e.nativeEvent as unknown as { shiftKey?: boolean }).shiftKey;
    if (e.nativeEvent.key === 'Enter' && !shiftKey) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <View>
      {sendError ? (
        <Text
          style={[type.caption, styles.sendErrorLine, { color: colors.danger }]}
          testID="composer-send-error"
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
        onSubmit={() => void submit()}
        onKeyPress={handleKeyPress}
        disabled={isEmpty || sending}
        sending={sending}
        placeholder={t('chat.placeholder')}
        testIDPrefix="composer"
        autoFocus={autoFocus}
      />
    </View>
  );
});

export default function ChatScreenWeb() {
  const router = useRouter();
  // If the session vanishes (Start-fresh elsewhere), every conversation option would
  // 403 with only a small inline error — route back to landing instead.
  useSessionGuard();
  const { colors } = useTheme();
  const { t } = useI18n();
  const { id: conversationId, listener, channel: channelId, starter, edit } = useLocalSearchParams<{
    id: string;
    listener?: string;
    channel?: string;
    starter?: string;
    /** '1' = arrive with the composer focused (first-question builder, "Edit in chat"). */
    edit?: string;
  }>();
  const listenerName = listener ?? t('chat.yourListener');
  // Presence, community and the saved count for the header card. The header may know
  // the mentor's name even when the route did not carry it (a notification tap).
  const header = useChatHeader(conversationId);
  const { refreshSaved } = header;
  const headerName = listener ?? header.profile?.persona_name ?? listenerName;
  const [optionsOpen, setOptionsOpen] = useState(false);
  // Set right before pendingOption.take() opens the sheet with the Report flow
  // pre-selected (the mentor-profile screen's "Report or block" hand-off) — cleared
  // on close so a later, ordinary open of the sheet starts fresh.
  const [pendingInitial, setPendingInitial] = useState<'report' | undefined>(undefined);

  useFocusEffect(
    useCallback(() => {
      const opt = pendingOption.take(conversationId ?? '');
      if (opt === 'report') {
        setPendingInitial('report');
        setOptionsOpen(true);
      }
    }, [conversationId]),
  );

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
  // Funnel: chat_first_message_sent fires once per screen mount.
  const firstSentRef = useRef(false);
  // Timestamp the initial history load finished — anything appended after this
  // (live messages) rises in; history itself renders still.
  const loadedAtRef = useRef<number>(0);
  // ids that arrived after load; pruned by the row once its rise-in has played, so a
  // recycled row never replays it.
  const freshIds = useRef<Set<string>>(new Set());

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
      if (loadedAtRef.current) freshIds.current.add(msg.id);
      setMessages((prev) => (prev.some((p) => p.id === msg.id) ? prev : [...prev, msg]));
    },
    [toMsg],
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

        channelRef.current = ch;
        ch.state.messages.forEach((m) => {
          appendMessage(m as RawMsg);
          surfaceCrisis(m as CrisisCarrier);
        });
        loadedAtRef.current = Date.now();
        ch.on('message.new', (e: Event) => {
          if (e.message) {
            appendMessage(e.message as RawMsg);
            surfaceCrisis(e.message as CrisisCarrier);
          }
          if (e.user && e.user.id !== client.userID) haptic.nudge();
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
        if (!cancelled) setError(e instanceof Error ? e.message : t('chat.errOpen'));
      }
    };

    void setup();
    return () => {
      cancelled = true;
    };
    // reason: `t` is intentionally not a trigger — a locale flip must not re-run channel setup
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId, appendMessage, surfaceCrisis, listenerName]);

  const send = useCallback(
    async (body: string) => {
      if (!channelRef.current) return;
      // Server scans this in the before-send webhook and augments crisis messages; the
      // augmented message comes back on the response (no message.new fires for our own).
      const resp = await channelRef.current.sendMessage({ text: body });
      if (!firstSentRef.current) {
        firstSentRef.current = true;
        capture('chat_first_message_sent'); // funnel tail — no content, ever
      }
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
          refreshSaved(); // the "Saved N" chip follows the server, not the tap
        } catch {
          // Soft-fail: keep the tooltip open so the user can retry.
        }
      })();
    },
    [conversationId, listenerName, refreshSaved],
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

  const markRisen = useCallback((id: string) => {
    freshIds.current.delete(id);
  }, []);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={['top', 'bottom']}>
      {/* Header card + "In this chat" strip (DECISIONS §L.8) — shared with the native chat. */}
      <ChatHeaderCard
        name={headerName}
        status={header.profile?.status ?? null}
        community={header.community}
        savedCount={header.savedCount}
        onBack={() => router.replace('/chats')}
        onOpenProfile={() =>
          router.push({
            pathname: '/mentor-profile/[id]',
            params: { id: conversationId ?? '', name: headerName },
          })
        }
        onOpenOptions={() => setOptionsOpen(true)}
      />

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

      {error ? (
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={36} color={colors.inkMuted} />
          <Text style={[type.body, { color: colors.danger, textAlign: 'center' }]}>{error}</Text>
        </View>
      ) : !ready ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={[type.body, { color: colors.inkMuted }]}>{t('chat.opening')}</Text>
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
                <Text style={[styles.emptyTitle, { color: colors.ink }]}>{t('chat.emptyTitle')}</Text>
                <Text style={[type.body, { color: colors.inkMuted, textAlign: 'center' }]}>
                  {t('chat.emptyBody')}
                </Text>
              </View>
            }
            renderItem={({ item, index }) => {
              const prev = index > 0 ? messages[index - 1] : null;
              const showDay = !prev || dayLabel(prev.at, t) !== dayLabel(item.at, t);
              return (
                <MessageRow
                  item={item}
                  dayText={showDay ? dayLabel(item.at, t) : null}
                  read={item.mine ? isRead(item) : false}
                  fresh={freshIds.current.has(item.id)}
                  actionsOpen={actionsFor === item.id}
                  isHelpful={helpful.has(item.id)}
                  isSaved={saved.has(item.id)}
                  listenerName={listenerName}
                  onToggleActions={toggleActions}
                  onToggleHelpful={toggleHelpful}
                  onSave={saveToNotes}
                  onCopy={copyText}
                  onRisen={markRisen}
                />
              );
            }}
          />
          {crisis ? <CrisisCard crisis={crisis} onDismiss={() => setCrisis(null)} /> : null}

          {/* Presence-only typing bubble — Focus physics: three dots breathing. */}
          {typing ? <TypingDots testID="typing-indicator" /> : null}

          <Composer onSend={send} onTyping={onTyping} initialDraft={starter} autoFocus={edit === '1'} />
        </View>
      )}

      <ConversationOptions
        conversationId={conversationId}
        visible={optionsOpen}
        onClose={() => {
          setOptionsOpen(false);
          setPendingInitial(undefined);
        }}
        onLeft={() => router.replace('/chats')}
        listenerName={listenerName}
        initial={pendingInitial}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  // Inset + rounded to sit under the floating header card (same 12px gutter).
  privacy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    marginHorizontal: space.sm + 4,
    marginTop: space.xs,
    borderRadius: radius.md,
    paddingVertical: space.xs + 2,
    paddingHorizontal: space.sm + 4,
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
  bubble: { borderRadius: radius.lg, paddingHorizontal: space.md, paddingVertical: space.sm + 2 },
  bubbleWrap: { maxWidth: '80%', flexShrink: 1 },
  mineWrap: { alignItems: 'flex-end', marginVertical: space.xs },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: 3 },
  theirsWrap: { marginVertical: space.xs },
  theirsRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
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
  sendErrorLine: { paddingHorizontal: space.md, paddingTop: space.xs },
});
