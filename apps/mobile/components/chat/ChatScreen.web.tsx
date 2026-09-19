import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  View,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Channel as ChannelType, Event } from 'stream-chat';

import { AllowanceNote } from '@/components/chat/AllowanceNote';
import { AllowanceRow } from '@/components/chat/AllowanceRow';
import { ChatHeaderCard } from '@/components/chat/ChatHeaderCard';
import {
  ComposerChromeContext,
  ComposerField,
  ComposerPerchContext,
  type ComposerChrome,
} from '@/components/chat/ComposerField';
import { ConversationOptions } from '@/components/chat/ConversationOptions';
import { CrisisCard, type CrisisPayload } from '@/components/chat/CrisisCard';
import { ThreadRow, type ThreadMsg } from '@/components/chat/ThreadRow';
import { TypingDots } from '@/components/chat/TypingDots';
import { CompanionPerches, CompanionSlot, useCompanionPlacement } from '@/components/art/PerchedCompanion';
import { SceneTile } from '@/components/art/SceneTile';
import { useSheetDepth } from '@/components/motion/useSheetDepth';
import { capture } from '@/lib/analytics';
import { api } from '@/lib/api';
import type { PlacementSlot } from '@/lib/companionPlacement';
import { haptic } from '@/lib/haptics';
import { useI18n, type TFunc } from '@/lib/i18n';
import { leaveToChats } from '@/lib/leaveToChats';
import { pendingOption } from '@/lib/pendingOption';
import { getPersona, getStreamToken } from '@/lib/session';
import { ensureConnected, getStreamClient } from '@/lib/streamClient';
import { CRISIS_EXEMPT_MS, noteFor, useAllowance, type HeldAllowance } from '@/lib/useAllowance';
import { useChatHeader } from '@/lib/useChatHeader';
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

type CrisisCarrier = { id?: string; crisis?: CrisisPayload; created_at?: string | Date };

/** Inside a live conversation the companion does not roam: ONE fixed place, on the composer
 * footer's top edge (board A05) — or, while the three-in-a-row note shows, on the note's
 * (board A22; components/chat/AllowanceNote.tsx carries that seat). It is not drawn at all
 * while the crisis card, an error or a failed send is showing, or while the options sheet is
 * up (T&S #11). */
const CHAT_PERCH: PlacementSlot[] = [{ id: 'composerTop', type: 'top', level: 'low', home: true }];
const COMPOSER_PERCH = <CompanionSlot id="composerTop" size={72} inset={space.lg} />;

/** How many of the rows on screen take a step in the opening arrival (FINAL_SPEC: six). */
const ARRIVAL_STEPS = 6;

type Msg = ThreadMsg;

type RawMsg = {
  id?: string;
  text?: string;
  type?: string;
  user?: { id?: string };
  created_at?: string | Date;
  allowance?: HeldAllowance;
};

/** A send the allowance is holding: the words stay in the field and nothing reads as an
 * error — the note above the field is the whole answer. */
class HeldSend extends Error {}

function dayLabel(iso: string, t: TFunc): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return t('chat.today');
  if (d.toDateString() === yesterday.toDateString()) return t('chat.yesterday');
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

type ComposerProps = {
  /** Path warm-up prompt — lands in the input ready to edit/send, never auto-sent. */
  initialDraft?: string;
  /** Resolves when the message is accepted by the server; rejects on failure. */
  onSend: (body: string) => Promise<void>;
  onTyping: () => void;
  /** "Edit in chat" from the first-question builder: open with the field focused. */
  autoFocus?: boolean;
  /** A failed send is showing (or has cleared) — the screen goes still around it. */
  onSendFailed?: (failed: boolean) => void;
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
const Composer = memo(function Composer({ onSend, onTyping, initialDraft, autoFocus, onSendFailed }: ComposerProps) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const { held } = useContext(ComposerChromeContext);
  const [draft, setDraft] = useState(initialDraft ?? '');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(false);
  const isEmpty = !draft.trim();

  const submit = async () => {
    const body = draft.trim();
    // The allowance's pause rests the send key AND Enter — the field itself stays live.
    if (!body || sending || held) return;
    setSending(true);
    try {
      await onSend(body);
      setDraft('');
      setSendError(false);
      onSendFailed?.(false);
    } catch (e) {
      // Keep their words either way. A held send is not an error: the note says it all.
      const failed = !(e instanceof HeldSend);
      setSendError(failed);
      onSendFailed?.(failed);
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
  const { refreshSaved, savedMessageIds } = header;
  const headerName = listener ?? header.profile?.persona_name ?? listenerName;
  const [optionsOpen, setOptionsOpen] = useState(false);
  // The options sheet rises over a chat that settles back (board A20) — one shared value.
  const depth = useSheetDepth(optionsOpen);
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
  // The card belongs to the message that raised it (board A21): it sits in the thread right
  // under that message and scrolls away with it — no dismiss, nothing to tap it shut.
  const [crisis, setCrisis] = useState<{ payload: CrisisPayload; messageId: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sendFailed, setSendFailed] = useState(false);
  // An older mentor bubble the member tapped: its save key is open too (the mentor's
  // latest message always carries one). `saved` = kept during this visit (the chip settles
  // in); what was kept before comes from the header's notes read.
  const [actionsFor, setActionsFor] = useState<string | null>(null);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  // When the crisis scan last flagged something in this thread — the allowance's exempt
  // window is read off the same payload the card renders (lib/useAllowance.ts).
  const [crisisAt, setCrisisAt] = useState(0);
  const listRef = useRef<FlatList<Msg>>(null);
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
      setCrisis({ payload: m.crisis, messageId: m.id });
      const at = m.created_at ? new Date(m.created_at).getTime() : Date.now();
      setCrisisAt((prev) => Math.max(prev, at));
    }
  }, []);

  const crisisRecent = crisisAt > 0 && Date.now() - crisisAt < CRISIS_EXEMPT_MS;
  const { allowance, note, exempt, refresh: refreshAllowance, applyHeld } = useAllowance(
    conversationId,
    crisisRecent,
  );
  // Read inside `send` without making it a dependency (the composer is memoized on it).
  const exemptRef = useRef(exempt);
  exemptRef.current = exempt;

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
          if (e.user && e.user.id !== client.userID) {
            haptic.nudge();
            void refreshAllowance(); // the mentor wrote: the member's run starts over
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
        if (!cancelled) setError(e instanceof Error ? e.message : t('chat.errOpen'));
      }
    };

    void setup();
    return () => {
      cancelled = true;
    };
    // reason: `t` is intentionally not a trigger — a locale flip must not re-run channel setup
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId, appendMessage, surfaceCrisis, listenerName, refreshAllowance]);

  const send = useCallback(
    async (body: string) => {
      if (!channelRef.current) return;
      // Server scans this in the before-send webhook and augments crisis messages; the
      // augmented message comes back on the response (no message.new fires for our own).
      const resp = await channelRef.current.sendMessage({ text: body });
      const sent = resp.message as RawMsg;
      if (sent.type === 'error') {
        // Stream did not keep it (board-port API §B1): ANY error reply means "re-read the
        // allowance". Held → the still note, the words stay in the field; anything else is
        // an ordinary failed send.
        const fresh = await applyHeld(sent.allowance);
        if (sent.allowance?.held || noteFor(fresh, exemptRef.current)) throw new HeldSend();
        throw new Error('send refused');
      }
      if (!firstSentRef.current) {
        firstSentRef.current = true;
        capture('chat_first_message_sent'); // funnel tail — no content, ever
      }
      appendMessage(resp.message as RawMsg);
      surfaceCrisis(resp.message as CrisisCarrier);
      void refreshAllowance(); // counted server-side, in the before-send hook
    },
    [appendMessage, surfaceCrisis, applyHeld, refreshAllowance],
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

  const markRisen = useCallback((id: string) => {
    freshIds.current.delete(id);
    openingIds.current?.delete(id);
  }, []);

  // One fixed place, and none at all in a still state (see CHAT_PERCH).
  const perch = useCompanionPlacement('chat', CHAT_PERCH, {
    hidden: crisis !== null || error !== null || sendFailed || optionsOpen,
    still: note !== null,
  });

  // Row facts that depend on the whole thread, computed once per change.
  const lastMineId = useMemo(() => [...messages].reverse().find((m) => m.mine)?.id ?? null, [messages]);
  // The save key rests under the mentor's message only while it is the newest thing in the
  // thread (board A05); once the member has written back it is gone (board A22).
  const lastTheirsId = useMemo(() => {
    const last = messages[messages.length - 1];
    return last && !last.mine ? last.id : null;
  }, [messages]);
  const openingFrom = Math.max(0, messages.length - ARRIVAL_STEPS);
  // The opening arrival belongs to the rows that were there when the chat opened.
  const openingIds = useRef<Set<string> | null>(null);
  if (ready && openingIds.current === null) {
    openingIds.current = new Set(messages.slice(openingFrom).map((m) => m.id));
  }

  const leadName = headerName;
  const chrome = useMemo<ComposerChrome>(() => {
    if (!allowance) return {};
    if (note) {
      return {
        held: true,
        heldA11y:
          note === 'daily'
            ? t('allowance.sendHeldDailyA11y')
            : t('allowance.sendHeldRowA11y', { name: leadName }),
        above: (
          <AllowanceNote
            allowance={allowance}
            reason={note}
            name={leadName}
            onJournal={() => router.dismissTo('/journals')}
          />
        ),
      };
    }
    return { above: <AllowanceRow allowance={allowance} exempt={exempt} /> };
  }, [allowance, note, exempt, leadName, router, t]);

  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: depth.shown ? colors.dotIdle : colors.bg }]}
      edges={['top', 'bottom']}
    >
      <CompanionPerches placement={perch}>
      <Animated.View
        style={[styles.back, { backgroundColor: colors.bg }, depth.shown && styles.backSettled, depth.backStyle]}
      >
      {/* Header card + "In this chat" strip (DECISIONS §L.8) — shared with the native chat. */}
      <ChatHeaderCard
        name={headerName}
        status={header.profile?.status ?? null}
        community={header.community}
        topic={header.topic}
        savedCount={header.savedCount}
        onBack={() => leaveToChats(router)}
        onOpenProfile={() =>
          router.push({
            pathname: '/mentor-profile/[id]',
            params: { id: conversationId ?? '', name: headerName },
          })
        }
        onOpenOptions={() => setOptionsOpen(true)}
      />

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
            ref={listRef}
            data={messages}
            keyExtractor={(m) => m.id}
            // The thread rests on the composer (board: the column is bottom-aligned).
            contentContainerStyle={[styles.list, messages.length === 0 && styles.listEmpty]}
            // …and stays there when a message lands or the footer grows (the note, its
            // helplines): a jump, not a scroll animation — nothing moves in a still state.
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
            onLayout={() => listRef.current?.scrollToEnd({ animated: false })}
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
              const isLive = freshIds.current.has(item.id);
              const isOpening = openingIds.current?.has(item.id) ?? false;
              const isSaved = saved.has(item.id) || savedMessageIds.has(item.id);
              let statusText: string | null = null;
              if (item.id === lastMineId) {
                statusText = isRead(item)
                  ? t('allowance.read')
                  : note === 'in_a_row' && allowance
                    ? t('allowance.deliveredRow', { count: allowance.in_a_row })
                    : t('allowance.delivered');
              }
              return (
                <>
                <ThreadRow
                  item={item}
                  dayText={showDay ? dayLabel(item.at, t) : null}
                  statusText={statusText}
                  arrival={isLive ? 'live' : isOpening ? 'history' : null}
                  arrivalStep={Math.max(0, index - openingFrom)}
                  saveOpen={!item.mine && (item.id === lastTheirsId || actionsFor === item.id)}
                  nudge={item.id === lastTheirsId}
                  isSaved={isSaved}
                  savedNow={saved.has(item.id)}
                  onToggleSave={toggleActions}
                  onSave={saveToNotes}
                  onArrived={markRisen}
                />
                {crisis?.messageId === item.id ? (
                  // Its "why" note opens in place: while the card is the newest thing in the
                  // thread, keep the whole of it in view (a jump, never a scroll animation).
                  <View
                    style={styles.crisisSeat}
                    onLayout={
                      index === messages.length - 1
                        ? () => listRef.current?.scrollToEnd({ animated: false })
                        : undefined
                    }
                  >
                    <CrisisCard crisis={crisis.payload} mentorName={headerName} inset={false} />
                  </View>
                ) : null}
                </>
              );
            }}
          />
          {/* Presence only: three dots rising in turn, and who it is. */}
          {typing ? <TypingDots testID="typing-indicator" label={t('chat.typing', { name: typing })} /> : null}

          <ComposerPerchContext.Provider value={note ? null : COMPOSER_PERCH}>
            <ComposerChromeContext.Provider value={chrome}>
              <Composer
                onSend={send}
                onTyping={onTyping}
                initialDraft={starter}
                autoFocus={edit === '1'}
                onSendFailed={setSendFailed}
              />
            </ComposerChromeContext.Provider>
          </ComposerPerchContext.Provider>
        </View>
      )}

      </Animated.View>
      <ConversationOptions
        conversationId={conversationId}
        visible={optionsOpen}
        depth={depth}
        onSaveToJournal={() => {
          // Open the save key on the mentor's most recent message that is not kept yet.
          const target = [...messages]
            .reverse()
            .find((m) => !m.mine && !saved.has(m.id) && !savedMessageIds.has(m.id));
          if (target) setActionsFor(target.id);
        }}
        onClose={() => {
          setOptionsOpen(false);
          setPendingInitial(undefined);
        }}
        onLeft={() => leaveToChats(router)}
        listenerName={listenerName}
        initial={pendingInitial}
      />
      </CompanionPerches>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  back: { flex: 1 },
  // Under the sheet the chat is a card on a darker ground: rounded, clipped.
  backSettled: { borderRadius: radius.lg, overflow: 'hidden' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, padding: space.lg },
  // Board: 12 / 16 / 8, rows 10 apart, resting on the composer. The extra bottom room keeps
  // the last bubble clear of the companion on the footer's edge.
  list: {
    flexGrow: 1,
    justifyContent: 'flex-end',
    paddingTop: 12,
    paddingHorizontal: space.md,
    paddingBottom: space.sm,
    gap: 10,
  },
  listEmpty: { justifyContent: 'center' },
  crisisSeat: { paddingTop: 10 },
  emptyWrap: { alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg },
  emptyTitle: { fontFamily: font.serifBold, fontSize: 24, lineHeight: 30, textAlign: 'center' },
  sendErrorLine: { paddingHorizontal: space.md, paddingTop: space.xs },
});
