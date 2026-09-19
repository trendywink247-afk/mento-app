import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { ComponentProps } from 'react';
import type { Channel as ChannelType, Event } from 'stream-chat';
import { Channel, Chat, MessageComposer, MessageList, useMessageComposer, WithComponents } from 'stream-chat-expo';

// stream-chat-expo's star re-exports collide on the name `Theme` (the kit's UI theme vs
// a stream-chat type), so derive the exact prop type from the component instead.
type StreamChatStyle = ComponentProps<typeof Chat>['style'];

import { IconBadge } from '@/components/IconBadge';
import { CompanionPerches, CompanionSlot, useCompanionPlacement } from '@/components/art/PerchedCompanion';
import { AllowanceNote } from '@/components/chat/AllowanceNote';
import { AllowanceRow } from '@/components/chat/AllowanceRow';
import { ChatHeaderCard } from '@/components/chat/ChatHeaderCard';
import { Composer } from '@/components/chat/Composer';
import { ComposerChromeContext, ComposerPerchContext, type ComposerChrome } from '@/components/chat/ComposerField';
import { ConversationOptions } from '@/components/chat/ConversationOptions';
import { CrisisCard, type CrisisPayload } from '@/components/chat/CrisisCard';
import { KitMessageFooter, KitThreadContext, type KitThread } from '@/components/chat/KitMessageFooter';
import { KitSavedHeader } from '@/components/chat/KitSavedHeader';
import { KitTyping } from '@/components/chat/KitTyping';
import { MessageText, OwnBubbleToneContext } from '@/components/chat/MessageText';
import { capture } from '@/lib/analytics';
import { api } from '@/lib/api';
import type { PlacementSlot } from '@/lib/companionPlacement';
import { haptic } from '@/lib/haptics';
import { useI18n } from '@/lib/i18n';
import { leaveToChats } from '@/lib/leaveToChats';
import { pendingOption } from '@/lib/pendingOption';
import { getPersona, getStreamToken } from '@/lib/session';
import { ensureConnected, getStreamClient } from '@/lib/streamClient';
import { CRISIS_EXEMPT_MS, noteFor, useAllowance, type HeldAllowance } from '@/lib/useAllowance';
import { useChatHeader } from '@/lib/useChatHeader';
import { useSessionGuard } from '@/lib/useSessionGuard';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type } from '@/theme/tokens';

/** Bubble geometry (board A05): 22 all round, 8 on the tail corner; the pillow edge is a
 * thicker bottom border because the kit's bubble clips its own overflow. */
const BUBBLE_EDGE = 3;

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

/** Any Stream message shape can carry the server-injected `crisis` field. */
type CrisisCarrier = { id?: string; crisis?: CrisisPayload; created_at?: string | Date };
type SentMessage = CrisisCarrier & { type?: string; text?: string; allowance?: HeldAllowance };

/** Inside a live conversation the companion does not roam: ONE fixed place, on the composer
 * footer's top edge (same as ChatScreen.web.tsx) — or on the three-in-a-row note's while
 * that shows (components/chat/AllowanceNote.tsx carries that seat). Not drawn at all while
 * the crisis card or an error is showing, or while the options sheet is up (T&S #11). */
const CHAT_PERCH: PlacementSlot[] = [{ id: 'composerTop', type: 'top', level: 'low', home: true }];
const COMPOSER_PERCH = <CompanionSlot id="composerTop" size={72} inset={space.lg} />;

/** Puts a held message's words back into the field: the kit clears its composer
 * optimistically, and a held message exists nowhere but on the device (API doc B1). */
function HeldDraft({ text, onRestored }: { text: string | null; onRestored: () => void }) {
  const composer = useMessageComposer();
  useEffect(() => {
    if (text === null) return;
    composer.textComposer.setText(text);
    onRestored();
  }, [text, composer, onRestored]);
  return null;
}

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
  // Presence, community and the saved count for the header card. The header may know
  // the mentor's name even when the route did not carry it (a notification tap).
  const header = useChatHeader(conversationId);
  const { refreshSaved, savedMessageIds } = header;
  const headerName = listener ?? header.profile?.persona_name ?? listenerName;

  const [channel, setChannel] = useState<ChannelType | null>(null);
  const [crisis, setCrisis] = useState<CrisisPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  // Set right before pendingOption.take() opens the sheet with the Report flow
  // pre-selected (the mentor-profile screen's "Report or block" hand-off) — cleared
  // on close so a later, ordinary open of the sheet starts fresh.
  const [pendingInitial, setPendingInitial] = useState<'report' | undefined>(undefined);
  // When the crisis scan last flagged something in this thread (the allowance's exempt
  // window is read off the same payload the card renders), the mentor's latest message (it
  // carries the save key), what was kept during this visit, and a held draft waiting to go
  // back into the field.
  const [crisisAt, setCrisisAt] = useState(0);
  const [lastTheirsId, setLastTheirsId] = useState<string | null>(null);
  const [savedNow, setSavedNow] = useState<ReadonlySet<string>>(() => new Set());
  const [heldDraft, setHeldDraft] = useState<string | null>(null);
  // Surface each crisis message once, so dismissing it isn't undone by later events.
  const shownRef = useRef<Set<string>>(new Set());
  // Funnel: chat_first_message_sent fires once per screen mount.
  const firstSentRef = useRef(false);

  useFocusEffect(
    useCallback(() => {
      const opt = pendingOption.take(conversationId ?? '');
      if (opt === 'report') {
        setPendingInitial('report');
        setOptionsOpen(true);
      }
    }, [conversationId]),
  );

  const crisisRecent = crisisAt > 0 && Date.now() - crisisAt < CRISIS_EXEMPT_MS;
  const { allowance, note, exempt, refresh: refreshAllowance, applyHeld } = useAllowance(
    conversationId,
    crisisRecent,
  );
  const exemptRef = useRef(exempt);
  exemptRef.current = exempt;

  // The "kept" moment is confirmed by the server, not by the tap: success fires only once
  // the note is really saved; a failure stays still (T&S #11).
  const saveNote = useCallback(
    (message: { id: string; text?: string }) => {
      void api
        .saveMentorNote({
          body: message.text ?? '',
          conversation_id: conversationId ?? null,
          listener_persona: listenerName,
          stream_message_id: message.id,
        })
        .then(() => {
          haptic.success();
          setSavedNow((prev) => new Set(prev).add(message.id));
          refreshSaved(); // the "Saved N" chip follows the server, not the tap
        })
        .catch(() => {});
    },
    [conversationId, listenerName, refreshSaved],
  );

  // The core talk→action loop (SCOPE §7): the save key under the mentor's latest message
  // (board A05), and long-press any mentor message → message menu → "Save to Mentor Notes".
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
            saveNote(message);
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
    [saveNote, t],
  );

  // Theme the Stream kit (v9 semantics tokens) to board A05: oat app bg, white mentor
  // bubbles with a hairline rim, ACCENT member bubbles with white words (the words are
  // drawn by components/chat/MessageText.tsx, told the tone through OwnBubbleToneContext),
  // 22px corners with an 8px tail, and a pillow edge along the bottom of each bubble.
  const streamTheme = useMemo<StreamChatStyle>(
    () => ({
      semantics: {
        accentPrimary: colors.accent,
        backgroundCoreApp: colors.bg,
        chatBgIncoming: colors.surface,
        chatTextIncoming: colors.ink,
        chatBgOutgoing: colors.accent,
        chatTextOutgoing: colors.onAccent,
        chatTextTimestamp: colors.inkMuted,
        buttonPrimaryBg: colors.accent,
      },
      messageItemView: {
        content: {
          // The kit reads the corner radii off `container` and lays them over its own.
          container: {
            borderTopLeftRadius: radius.lg,
            borderTopRightRadius: radius.lg,
            borderBottomRightRadius: radius.lg,
            borderBottomLeftRadius: radius.sm,
          },
          containerInner: {
            borderWidth: 1,
            borderColor: colors.border,
            borderBottomWidth: 1 + BUBBLE_EDGE,
            borderBottomColor: colors.edgeSurface,
          },
        },
      },
      inlineDateSeparator: {
        container: { backgroundColor: 'transparent' },
        text: { fontFamily: font.sansBold, fontSize: 13, lineHeight: 18, color: colors.inkMuted },
      },
      dateHeader: {
        container: { backgroundColor: colors.surfaceAlt },
        text: { fontFamily: font.sansBold, fontSize: 13, lineHeight: 18, color: colors.inkMuted },
      },
      // The kit's own composer wrapper paints a border/background/top-padding around
      // whatever `Input` renders (see components/chat/Composer.tsx's header comment);
      // neutralised here so our pillow-key row is the only visible chrome. The
      // bottom safe-area padding it also applies is left alone — Composer.tsx relies
      // on it rather than adding its own.
      messageComposer: {
        wrapper: { paddingHorizontal: 0, paddingTop: 0, borderTopWidth: 0, backgroundColor: 'transparent' },
      },
    }),
    [colors],
  );
  // The member's own bubbles: the tail moves to the bottom-right and the edge goes accent.
  const myMessageTheme = useMemo(
    () => ({
      messageItemView: {
        content: {
          container: { borderBottomRightRadius: radius.sm, borderBottomLeftRadius: radius.lg },
          containerInner: {
            borderWidth: 0,
            borderBottomWidth: BUBBLE_EDGE,
            borderBottomColor: colors.accentEdge,
          },
        },
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
      const at = message?.created_at ? new Date(message.created_at).getTime() : Date.now();
      setCrisisAt((prev) => Math.max(prev, at));
    }
  }, []);

  // The server augments crisis messages with a `crisis` field. It reaches us two ways:
  //   - our OWN message: on the sendMessage response (see doSendMessageRequest below),
  //   - a RECEIVED message: on the message.new websocket event.
  const doSendMessageRequest = useCallback(
    async (_channelId: string, messageData: Parameters<ChannelType['sendMessage']>[0]) => {
      const resp = await channel!.sendMessage(messageData);
      const sent = resp.message as SentMessage;
      if (sent.type === 'error') {
        // Stream did not keep it (board-port API B1): ANY error reply means "re-read the
        // allowance". If the allowance is what held it, the still note is the whole answer:
        // the kit's error bubble is taken back out and the words go back into the field.
        void applyHeld(sent.allowance).then((fresh) => {
          if (!(sent.allowance?.held || noteFor(fresh, exemptRef.current))) return;
          if (sent.id) channel!.state.removeMessage({ id: sent.id });
          setHeldDraft(typeof messageData.text === 'string' ? messageData.text : null);
        });
        return resp;
      }
      void refreshAllowance(); // counted server-side, in the before-send hook
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
    [channel, surfaceCrisis, applyHeld, refreshAllowance],
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
        // The save key rests under the mentor's message only while it is the newest thing
        // in the thread (board A05); once the member has written back it is gone (A22).
        const newest = ch.state.messages[ch.state.messages.length - 1];
        setLastTheirsId(newest && newest.user?.id !== client.userID ? newest.id : null);
        ch.on('message.new', (e: Event) => {
          surfaceCrisis(e.message as CrisisCarrier);
          if (!e.message || !e.user) return;
          if (e.user.id !== client.userID) {
            setLastTheirsId(e.message.id);
            void refreshAllowance(); // the mentor wrote: the member's run starts over
          } else {
            setLastTheirsId(null);
          }
        });
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
  }, [channelId, surfaceCrisis, refreshAllowance]);

  const perch = useCompanionPlacement('chat', CHAT_PERCH, {
    hidden: crisis !== null || error !== null || optionsOpen,
    still: note !== null,
  });

  const chrome = useMemo<ComposerChrome>(() => {
    if (!allowance) return {};
    if (note) {
      return {
        held: true,
        heldA11y:
          note === 'daily'
            ? t('allowance.sendHeldDailyA11y')
            : t('allowance.sendHeldRowA11y', { name: headerName }),
        above: (
          <AllowanceNote
            allowance={allowance}
            reason={note}
            name={headerName}
            onJournal={() => router.dismissTo('/journals')}
          />
        ),
      };
    }
    return { above: <AllowanceRow allowance={allowance} exempt={exempt} /> };
  }, [allowance, note, exempt, headerName, router, t]);

  const thread = useMemo<KitThread>(
    () => ({
      lastTheirsId,
      savedIds: new Set([...savedMessageIds, ...savedNow]),
      savedNow,
      run: note === 'in_a_row' && allowance ? allowance.in_a_row : null,
      onSave: saveNote,
    }),
    [lastTheirsId, savedMessageIds, savedNow, note, allowance, saveNote],
  );
  const clearHeldDraft = useCallback(() => setHeldDraft(null), []);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={['top', 'bottom']}>
      <CompanionPerches placement={perch}>
      <ComposerPerchContext.Provider value={note ? null : COMPOSER_PERCH}>
      <ComposerChromeContext.Provider value={chrome}>
      <KitThreadContext.Provider value={thread}>
      <OwnBubbleToneContext.Provider value="accent">
      {/* Header card + "In this chat" strip (DECISIONS §L.8) — shared with the web chat. */}
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

      {crisis ? <CrisisCard crisis={crisis} mentorName={headerName} onDismiss={() => setCrisis(null)} /> : null}

      {error ? (
        <View style={styles.center}>
          <Text style={[type.body, { color: colors.danger, textAlign: 'center' }]}>{error}</Text>
        </View>
      ) : channel ? (
        <View style={{ flex: 1 }} testID="chat-ready">
          <Chat client={getStreamClient()} style={streamTheme}>
            {/* Baloo message text + Android measure/draw fix (components/chat/MessageText.tsx),
                pillow-key composer (components/chat/Composer.tsx), and the board's thread
                furniture: the delivery line / save key under a bubble, the "Saved" chip
                above it, the typing pill. */}
            <WithComponents
              overrides={{
                MessageText,
                Input: Composer,
                MessageFooter: KitMessageFooter,
                MessageHeader: KitSavedHeader,
                TypingIndicator: KitTyping,
              }}
            >
            <Channel
              channel={channel}
              doSendMessageRequest={doSendMessageRequest}
              messageActions={customMessageActions}
              myMessageTheme={myMessageTheme}
            >
              <HeldDraft text={heldDraft} onRestored={clearHeldDraft} />
              <StarterSeed text={starter} />
              <MessageList />
              <MessageComposer />
            </Channel>
            </WithComponents>
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
        onClose={() => {
          setOptionsOpen(false);
          setPendingInitial(undefined);
        }}
        onLeft={() => leaveToChats(router)}
        listenerName={listenerName}
        initial={pendingInitial}
      />
      </OwnBubbleToneContext.Provider>
      </KitThreadContext.Provider>
      </ComposerChromeContext.Provider>
      </ComposerPerchContext.Provider>
      </CompanionPerches>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md },
});
