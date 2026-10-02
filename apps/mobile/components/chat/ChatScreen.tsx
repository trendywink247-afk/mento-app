import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { ComponentProps } from 'react';
import type { Channel as ChannelType, Event } from 'stream-chat';
import {
  Channel,
  Chat,
  MessageComposer,
  MessageList,
  useAttachmentPickerContext,
  useMessageComposer,
  WithComponents,
} from 'stream-chat-expo';

// stream-chat-expo's star re-exports collide on the name `Theme` (the kit's UI theme vs
// a stream-chat type), so derive the exact prop type from the component instead.
type StreamChatStyle = ComponentProps<typeof Chat>['style'];

import { IconBadge } from '@/components/IconBadge';
import { CompanionPerches, CompanionSlot, useCompanionPlacement } from '@/components/art/PerchedCompanion';
import { COMPOSER_SEAT, companionRoom } from '@/components/chat/companionRoom';
import { AllowanceNote } from '@/components/chat/AllowanceNote';
import { bubbleMaxWidth } from '@/components/chat/bubbleWidth';
import { buildMyMessageTheme, buildStreamTheme } from '@/components/chat/streamTheme';
import { AllowanceRow } from '@/components/chat/AllowanceRow';
import { ChatHeaderCard } from '@/components/chat/ChatHeaderCard';
import { Composer } from '@/components/chat/Composer';
import { ComposerChromeContext, ComposerPerchContext, type ComposerChrome } from '@/components/chat/ComposerField';
import { ConversationOptions } from '@/components/chat/ConversationOptions';
import { CrisisCard, type CrisisPayload } from '@/components/chat/CrisisCard';
import { KitMessageFooter, KitThreadContext, type KitThread } from '@/components/chat/KitMessageFooter';
import { KitSavedHeader } from '@/components/chat/KitSavedHeader';
import { KitTyping } from '@/components/chat/KitTyping';
import { MentoBubble } from '@/components/chat/MentoBubble';
import { MessageText, OwnBubbleToneContext } from '@/components/chat/MessageText';
import { ThreadEmpty } from '@/components/chat/ThreadEmpty';
import { useSheetDepth } from '@/components/motion/useSheetDepth';
import { capture } from '@/lib/analytics';
import { api } from '@/lib/api';
import type { PlacementSlot } from '@/lib/companionPlacement';
import { haptic } from '@/lib/haptics';
import { useI18n } from '@/lib/i18n';
import { leaveToChats } from '@/lib/leaveToChats';
import { chatFaceKey } from '@/lib/originStore';
import { pendingOption } from '@/lib/pendingOption';
import { getPersona, getStreamToken } from '@/lib/session';
import { ensureConnected, getStreamClient } from '@/lib/streamClient';
import { CRISIS_EXEMPT_MS, noteFor, useAllowance, type HeldAllowance } from '@/lib/useAllowance';
import { useChatHeader } from '@/lib/useChatHeader';
import { useFrameSize } from '@/lib/useFrameSize';
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

/** Any Stream message shape can carry the server-injected `crisis` field. */
type CrisisCarrier = { id?: string; crisis?: CrisisPayload; created_at?: string | Date };
type SentMessage = CrisisCarrier & { type?: string; text?: string; allowance?: HeldAllowance };

/** Inside a live conversation the companion does not roam: ONE fixed place, on the composer
 * footer's top edge (same as ChatScreen.web.tsx) — or on the three-in-a-row note's while
 * that shows (components/chat/AllowanceNote.tsx carries that seat). Not drawn at all while
 * the crisis card or an error is showing, or while the options sheet is up (T&S #11). */
const CHAT_PERCH: PlacementSlot[] = [{ id: 'composerTop', type: 'top', level: 'low', home: true }];
const COMPOSER_PERCH = <CompanionSlot id="composerTop" size={COMPOSER_SEAT.size} inset={space.lg} />;

/**
 * Mento is text + emoji only (CLAUDE.md SCOPE §3) — a member never attaches anything.
 *
 * The kit still mounts its attachment picker: `<Channel>` always renders `<AttachmentPicker/>`,
 * a @gorhom bottom sheet parked at index −1 inside the channel's own layout, and the sheet
 * re-snaps to index 0 when that layout changes under it (the crisis card arriving above the
 * thread, the keyboard closing behind a `tel:` link). Index 0 makes the picker's store pick
 * `images`, which mounts the media gallery — on Android that asks for the photo permission:
 * the "unnecessary media-selection pop-up" the founder hit mid-crisis.
 *
 * Three locks, so it can neither open nor show anything if it does:
 *   1. every door off — `hasImagePicker` / `hasFilePicker` / `hasCameraPicker` / `hasCommands`
 *      false and `disableAttachmentPicker` (which also drops the sheet to 72px);
 *   2. the sheet's own two parts are overridden with nothing;
 *   3. this guard shuts the store the instant anything selects a picker.
 * The composer, and with it the send key, is untouched — a member can always keep talking.
 */
function NoAttachments() {
  const { attachmentPickerStore, closePicker } = useAttachmentPickerContext();
  useEffect(() => {
    const unsubscribe = attachmentPickerStore.state.subscribe((state) => {
      if (!state.selectedPicker) return;
      attachmentPickerStore.setSelectedPicker(undefined);
      closePicker();
    });
    return unsubscribe;
  }, [attachmentPickerStore, closePicker]);
  return null;
}

/** Nothing at all — the kit's picker chrome, removed (see NoAttachments). */
function RenderNothing() {
  return null;
}

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
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const [crisis, setCrisis] = useState<CrisisPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  // The options sheet rises over a chat that settles back (board A20) — one shared value.
  const depth = useSheetDepth(optionsOpen);
  // "Save to Journal" on that sheet: the save key opens on this mentor message.
  const [openSaveId, setOpenSaveId] = useState<string | null>(null);
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
  const [lastMineId, setLastMineId] = useState<string | null>(null);
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
  // (board A05), and long-press any mentor message → message menu → "Save to Journal" (the Mentor Notes channel).
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

  const { width: frameWidth } = useFrameSize();
  const bubbleMax = bubbleMaxWidth(frameWidth);

  // Theme the Stream kit (v9 semantics tokens) to board A05: oat app bg, white mentor
  // bubbles with a hairline rim, ACCENT member bubbles with white words (the words are
  // drawn by components/chat/MessageText.tsx, told the tone through OwnBubbleToneContext),
  // 22px corners with an 8px tail, and a pillow edge along the bottom of each bubble.
  const streamTheme = useMemo<StreamChatStyle>(
    () => ({
      ...buildStreamTheme(colors, bubbleMax, radius),
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
    [colors, bubbleMax],
  );
  // The member's own bubbles. The accent is stated twice on purpose — the kit drops our
  // semantics when it re-merges for own messages (see components/chat/streamTheme.ts).
  const myMessageTheme = useMemo(
    () => buildMyMessageTheme(colors, radius),
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
        setLastMineId(
          [...ch.state.messages].reverse().find((m) => m.user?.id === client.userID)?.id ?? null,
        );
        ch.on('message.new', (e: Event) => {
          surfaceCrisis(e.message as CrisisCarrier);
          if (!e.message || !e.user) return;
          if (e.user.id !== client.userID) {
            setLastTheirsId(e.message.id);
            void refreshAllowance(); // the mentor wrote: the member's run starts over
          } else {
            setLastTheirsId(null);
            setLastMineId(e.message.id);
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

  const listFoot = companionRoom(perch, note !== null);
  const listProps = useMemo(() => ({ contentContainerStyle: { paddingTop: listFoot } }), [listFoot]);

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
      lastMineId,
      openSaveId,
      savedIds: new Set([...savedMessageIds, ...savedNow]),
      savedNow,
      run: note === 'in_a_row' && allowance ? allowance.in_a_row : null,
      onSave: saveNote,
    }),
    [lastTheirsId, lastMineId, openSaveId, savedMessageIds, savedNow, note, allowance, saveNote],
  );
  const clearHeldDraft = useCallback(() => setHeldDraft(null), []);

  return (
    <SafeAreaView
      style={styles.safe}
      edges={['top', 'bottom']}
    >
      <CompanionPerches placement={perch}>
      <ComposerPerchContext.Provider value={note ? null : COMPOSER_PERCH}>
      <ComposerChromeContext.Provider value={chrome}>
      <KitThreadContext.Provider value={thread}>
      <OwnBubbleToneContext.Provider value="accent">
      <Animated.View
        style={[styles.back, depth.shown && styles.backSettled, depth.backStyle]}
      >
      {/* Header card + "In this chat" strip (DECISIONS §L.8) — shared with the web chat. */}
      <ChatHeaderCard
        // Hand-overs: the avatar flies in from the My Chats row that opened this chat, and
        // leaves its own place behind for the profile hero (board T05 / T06).
        conversationId={conversationId}
        faceOriginKey={conversationId ? chatFaceKey(conversationId) : undefined}
        name={headerName}
        face={header.face ?? undefined}
        status={header.profile?.status ?? null}
        replyWithinADay={Boolean(header.profile?.reply_within_a_day)}
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
        <View style={{ flex: 1 }} testID="chat-ready"
          onLayout={(event) => event.currentTarget.measureInWindow((_x, y) => setKeyboardOffset(y))}>
          <Chat client={getStreamClient()} style={streamTheme}>
            {/* Baloo message text + Android measure/draw fix (components/chat/MessageText.tsx),
                pillow-key composer (components/chat/Composer.tsx), and the board's thread
                furniture: the delivery line / save key under a bubble, the "Saved" chip
                above it, the typing pill. */}
            <WithComponents
              overrides={{
                // OUR bubble, not the kit's re-skinned one (components/chat/MentoBubble.tsx).
                // MessageText stays registered for the places the kit still draws text itself.
                MessageContent: MentoBubble,
                MessageText,
                // The empty thread in the board's language (no kit bubble icon / "No chats").
                EmptyStateIndicator: ThreadEmpty,
                // No avatar column in the thread — the board draws none, and the kit's
                // MessageAuthor reserves an avatar's width beside EVERY mentor message
                // (an avatar on the last of a run, a spacer on the rest), which indented
                // and narrowed every one of them on the phone.
                MessageAuthor: RenderNothing,
                Input: Composer,
                // The attachment sheet has no bar and no gallery here (see NoAttachments).
                AttachmentPickerSelectionBar: RenderNothing,
                AttachmentPickerContent: RenderNothing,
                // No reactions anywhere: Mento's thread is text + emoji only (SCOPE §3) and
                // the board draws none. The kit renders its own dark reaction pill over the
                // bubble's corner — where the board puts the "Saved" chip.
                ReactionListTop: RenderNothing,
                ReactionListBottom: RenderNothing,
                MessageFooter: KitMessageFooter,
                MessageHeader: KitSavedHeader,
                TypingIndicator: KitTyping,
              }}
            >
            <Channel
              channel={channel}
              // The thread starts below our header, not at screen origin. Stream's
              // default Android offset (-300) leaves the composer under the IME.
              keyboardVerticalOffset={keyboardOffset}
              doSendMessageRequest={doSendMessageRequest}
              messageActions={customMessageActions}
              myMessageTheme={myMessageTheme}
              // Text + emoji only: every upload door is shut (see NoAttachments).
              hasImagePicker={false}
              hasFilePicker={false}
              hasCameraPicker={false}
              hasCommands={false}
              // …and none to give: an empty set also takes the reaction picker out of the
              // long-press menu, not just the pill off the bubble.
              supportedReactions={[]}
              disableAttachmentPicker
            >
              <NoAttachments />
              <HeldDraft text={heldDraft} onRestored={clearHeldDraft} />
              <StarterSeed text={starter} />
              {/* Inverted list: `paddingTop` is the visual foot — the companion's room. */}
              <MessageList additionalFlatListProps={listProps} />
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

      </Animated.View>
      <ConversationOptions
        conversationId={conversationId}
        visible={optionsOpen}
        depth={depth}
        onSaveToJournal={() => {
          // Open the save key on the mentor's most recent message that is not kept yet.
          const me = getStreamClient().userID;
          const target = [...(channel?.state.messages ?? [])]
            .reverse()
            .find((m) => m.user?.id !== me && !!m.text && !thread.savedIds.has(m.id));
          setOpenSaveId(target?.id ?? null);
        }}
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
  back: { flex: 1 },
  // Under the sheet the chat is a card on a darker ground: rounded, clipped.
  backSettled: { borderRadius: radius.lg, overflow: 'hidden' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md },
});
