import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { ComponentProps } from 'react';
import type { Channel as ChannelType, Event } from 'stream-chat';
import { Channel, Chat, MessageComposer, MessageList, WithComponents } from 'stream-chat-expo';

// stream-chat-expo's star re-exports collide on the name `Theme` (the kit's UI theme vs
// a stream-chat type), so derive the exact prop type from the component instead.
type StreamChatStyle = ComponentProps<typeof Chat>['style'];

import { Composer } from '@/components/chat/Composer';
import { CrisisCard, type CrisisPayload } from '@/components/chat/CrisisCard';
import type { CompanionAnimal } from '@/components/art/Companions';
import { HelplinesSheet } from '@/components/mentor/HelplinesSheet';
import { MentorChatHeader } from '@/components/mentor/MentorChatHeader';
import { MentorPeek, mentorPeekRoom } from '@/components/mentor/MentorPeek';
import { MentorComposerHint } from '@/components/mentor/MentorComposerHint';
import { MentorMessageText } from '@/components/mentor/MentorMessageText';
import { MentorOptionsMenu } from '@/components/mentor/MentorOptionsMenu';
import { PressKey } from '@/components/motion/PressKey';
import { SageSky } from '@/components/motion/SageSky';
import { bubbleMaxWidth } from '@/components/chat/bubbleWidth';
import { useFrameSize } from '@/lib/useFrameSize';
import { useI18n } from '@/lib/i18n';
import { listenerApi, type MemberBrief } from '@/lib/listenerApi';
import { ensureListenerConnected, getListenerStreamClient } from '@/lib/listenerStreamClient';
import { leaveToMentorHome } from '@/lib/leaveToChats';
import { mentorFaces } from '@/lib/mentorFaces';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space, type } from '@/theme/tokens';

/** Where the options card sits: under the header card's first row (board: top 104). */
const MENU_TOP = 96;

/**
 * The mentor's real-time 1:1 chat (board A35), on the same stream-chat-expo kit as the
 * member side — a distinct listener identity/token, no "save to notes" (member-only).
 * The header mirrors the member's own: their companion in their colour, their persona,
 * the path lens, and the labelled Helplines key; Report / End live in the options card;
 * the composer carries "Reply when you are free" and never an allowance meter.
 *
 * Safety: the crisis scan runs server-side in the Stream before-message-send webhook,
 * never here — this screen only renders the server-provided `crisis` payload, still.
 */

/** Any Stream message shape can carry the server-injected `crisis` field. */
type CrisisCarrier = { id?: string; crisis?: CrisisPayload };

type MenuState = 'closed' | 'open' | 'confirmEnd';

/** A kit slot we draw nothing into. */
function RenderNothing() {
  return null;
}

export default function MentorChatScreen() {
  const router = useRouter();
  const { colors, elevation } = useTheme();
  const { t } = useI18n();
  const { id, channel: channelId, member, masked } = useLocalSearchParams<{
    id: string;
    channel: string;
    member: string;
    masked: string;
  }>();

  const [channel, setChannel] = useState<ChannelType | null>(null);
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const [crisis, setCrisis] = useState<CrisisPayload | null>(null);
  const [error, setError] = useState(false);
  const [menu, setMenu] = useState<MenuState>('closed');
  const [ending, setEnding] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [helplines, setHelplines] = useState(false);
  const [brief, setBrief] = useState<MemberBrief | null>(null);
  const [here, setHere] = useState(false);
  // The mentor's OWN face — the same animal members see for them (server mentor_face).
  const [mine, setMine] = useState<CompanionAnimal | null>(
    () => (mentorFaces.self()?.animal as CompanionAnimal | undefined) ?? null,
  );
  // The kit's list is inverted: its paddingTop is the thread's visual foot — room for the
  // companion so the last bubble never sits behind it.
  const listProps = useMemo(() => ({ contentContainerStyle: { paddingTop: mentorPeekRoom(mine) } }), [mine]);
  // Surface each crisis message once, so dismissing it isn't undone by later events.
  const shownRef = useRef<Set<string>>(new Set());

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

  const { width: frameWidth } = useFrameSize();
  const bubbleMax = bubbleMaxWidth(frameWidth);

  // Theme the Stream kit (v9 semantics tokens): the mentor's bubbles are the accent with
  // white text (MentorMessageText), the member's white with ink.
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
          // The kit caps its bubble text at a fixed 256px; the thread takes the same
          // share of the column the member's side does (components/chat/ChatScreen.tsx).
          textContainer: { maxWidth: bubbleMax },
        },
      },
      // See components/chat/Composer.tsx's header comment: neutralises the kit's own
      // composer wrapper chrome so the pillow-key row is the only visible chrome.
      messageComposer: {
        wrapper: { paddingHorizontal: 0, paddingTop: 0, borderTopWidth: 0, backgroundColor: 'transparent' },
      },
    }),
    [colors, bubbleMax],
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
    // Held so the cleanup below can unsubscribe the exact channel this run watched.
    let activeChannel: ChannelType | null = null;
    const onNew = (e: Event) => surfaceCrisis(e.message as CrisisCarrier);
    let onWatch: (() => void) | null = null;

    const setup = async () => {
      try {
        setError(false);
        const me = await listenerApi.me();
        mentorFaces.setSelf(me.companion_animal, me.companion_colour);
        setMine((me.companion_animal as CompanionAnimal | undefined) ?? 'Owl');
        const client = await ensureListenerConnected({ id: me.id, name: me.persona_name }, me.stream_token);
        const ch = client.channel('messaging', channelId);
        await ch.watch();
        if (cancelled) return;

        activeChannel = ch;
        setChannel(ch);
        ch.state.messages.forEach((m) => surfaceCrisis(m as CrisisCarrier));
        ch.on('message.new', onNew);
        // "here now" = the member is watching this channel (presence only).
        const others = () => Object.values(ch.state.watchers ?? {}).some((u) => u?.id && u.id !== client.userID);
        onWatch = () => setHere(others());
        onWatch();
        ch.on('user.watching.start', onWatch);
        ch.on('user.watching.stop', onWatch);
      } catch {
        if (!cancelled) setError(true);
      }
    };

    void setup();
    return () => {
      cancelled = true;
      activeChannel?.off('message.new', onNew);
      if (onWatch) {
        activeChannel?.off('user.watching.start', onWatch);
        activeChannel?.off('user.watching.stop', onWatch);
      }
    };
  }, [channelId, surfaceCrisis, attempt]);

  const endNow = async () => {
    if (ending) return;
    setEnding(true);
    try {
      await listenerApi.end(id);
      leaveToMentorHome(router);
    } catch {
      // Stay still and silent (T&S: no shaking/buzzing at a struggling user) —
      // release the spinner and fold the menu back rather than surface an error.
      setEnding(false);
      setMenu('closed');
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={['top', 'bottom']} testID="mentor-chat-screen">
      <SageSky shape="top" />
      <View style={styles.headerWrap}>
        <MentorChatHeader
          memberName={member}
          brief={brief}
          here={here}
          masked={masked === '1' || !!brief?.member_masked}
          onBack={() => leaveToMentorHome(router)}
          onOpenBrief={() => router.push({ pathname: '/mentor/member/[id]', params: { id, member, masked } })}
          onOptions={() => setMenu((m) => (m === 'closed' ? 'open' : 'closed'))}
          onHelplines={() => setHelplines(true)}
        />
      </View>

      {crisis ? <CrisisCard crisis={crisis} audience="mentor" onDismiss={() => setCrisis(null)} /> : null}

      {error ? (
        <View style={styles.center}>
          <Text style={[type.body, { color: colors.ink, textAlign: 'center' }]}>{t('mentor.chat.errOpen')}</Text>
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
        <View style={styles.flex} testID="mentor-chat-ready"
          onLayout={(event) => event.currentTarget.measureInWindow((_x, y) => setKeyboardOffset(y))}>
          <Chat client={getListenerStreamClient()} style={streamTheme}>
            {/* MessageAuthor off: the kit reserves an avatar's width beside every incoming
                message (an avatar on the last of a run, a spacer on the rest) — no thread
                in this app has an avatar column. */}
            <WithComponents
              overrides={{ MessageText: MentorMessageText, Input: Composer, MessageAuthor: RenderNothing }}
            >
              <Channel channel={channel} keyboardVerticalOffset={keyboardOffset}
                keyboardBehavior={Platform.OS === 'android' ? 'height' : 'padding'}
                additionalKeyboardAvoidingViewProps={{ style: { flex: 1 } }}>
                <MessageList additionalFlatListProps={listProps} />
                {/* Your companion over the message field, seated on the footer's edge. */}
                <MentorPeek animal={mine} label={t('mentorChatPage.companionA11y')} />
                <View style={[styles.footer, { backgroundColor: colors.bg, borderTopColor: colors.border }]}>
                  <MentorComposerHint />
                  <MessageComposer />
                </View>
              </Channel>
            </WithComponents>
          </Chat>
        </View>
      ) : (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={[type.body, { color: colors.inkMuted }]}>{t('mentor.chat.opening')}</Text>
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
          <Pressable
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
  flex: { flex: 1 },
  headerWrap: { paddingHorizontal: 12, paddingTop: space.sm, zIndex: 3 },
  footer: { paddingTop: space.sm, gap: space.xs, borderTopWidth: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md },
  retry: { paddingHorizontal: space.lg, paddingVertical: space.sm },
  helpLayer: { zIndex: 6 },
  helpScrim: { opacity: 0.35 },
  helpCard: { position: 'absolute', left: 12, right: 12, top: 186, alignItems: 'center' },
});
