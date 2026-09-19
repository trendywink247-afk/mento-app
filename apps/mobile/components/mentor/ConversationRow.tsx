import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { EdgeSurface } from '@/components/EdgeSurface';
import { MemberDisc } from '@/components/mentor/MemberDisc';
import { PressKey } from '@/components/motion/PressKey';
import type { ChannelLive } from '@/lib/useMentorConsole';
import { useI18n, type TFunc } from '@/lib/i18n';
import type { ListenerConversation } from '@/lib/listenerApi';
import { useTheme } from '@/theme/ThemeProvider';
import { COMPANION_COLORS } from '@/theme/companion';
import { radius, space, type } from '@/theme/tokens';

/** Is this conversation snoozed right now? (The server only sends an open window, but a
 * row can outlive the moment it closes.) */
export function isSnoozed(conversation: ListenerConversation, now = Date.now()): boolean {
  if (conversation.status !== 'active' || !conversation.snoozed_until) return false;
  return new Date(conversation.snoozed_until).getTime() > now;
}

/** "22 h" — how long the member has been waiting, in the board's short form. */
function waitedFor(since: number, t: TFunc): string {
  const minutes = Math.max(1, Math.floor((Date.now() - since) / 60_000));
  if (minutes < 60) return t('mentorHomePage.ageMinutes', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return t('mentorHomePage.ageHours', { count: hours });
  return t('mentorHomePage.ageDays', { count: Math.floor(hours / 24) });
}

/** "Snoozed · back at 9:40 pm" (or "back tomorrow at …" when the window closes on
 * another calendar day — a 24 h snooze almost always does). */
function backAt(iso: string, t: TFunc, locale: string): string {
  const d = new Date(iso);
  const time = new Intl.DateTimeFormat(locale === 'hi' ? 'hi-IN' : 'en-IN', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
  return sameDay ? t('mentorHomePage.snoozedUntil', { time }) : t('mentorHomePage.snoozedTomorrow', { time });
}

/** One conversation row (board A10).
 *  - Live: the member's disc, their persona, a live line (typing in sage, else the last
 *    words) and the accent "N new" pill.
 *  - Waiting on you: the member wrote, the mentor has READ it and not replied yet — the
 *    board's quiet warm row with "Waiting on you · 22 h" and the "Snooze 24 h" key.
 *  - Snoozed: the same warm row, "Snoozed · back at <time>" and an Undo key. The screen
 *    sorts it after the awake chats. Nothing here is red, nothing moves.
 *  - Ended: the quiet warm row with no pill — still tappable, the transcript stays reachable. */
export function ConversationRow({
  conversation,
  live,
  onPress,
  onSnooze,
  snoozeBusy = false,
}: {
  conversation: ListenerConversation;
  live: ChannelLive | undefined;
  onPress: () => void;
  /** Snooze (true) or undo (false). Omitted = no snooze key. */
  onSnooze?: (on: boolean) => void;
  snoozeBusy?: boolean;
}) {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const active = conversation.status === 'active';
  const typing = active && !!live?.typing;
  const snoozed = isSnoozed(conversation);
  const waitingSince = live && live.unread === 0 ? live.waitingSince : null;
  const waiting = active && !snoozed && !typing && waitingSince !== null;

  if (onSnooze && (snoozed || waiting)) {
    const name = conversation.user_persona_name;
    const line =
      snoozed && conversation.snoozed_until
        ? backAt(conversation.snoozed_until, t, locale)
        : t('mentorHomePage.waitingOnYou', { age: waitedFor(waitingSince ?? Date.now(), t) });
    return (
      <EdgeSurface
        edge={colors.edgeAlt}
        travel={4}
        radius={radius.md}
        testID={`mentor-convo-row-${conversation.id}`}
        style={[styles.quietRow, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
      >
        {/* reason: the row's identity half is chrome INSIDE the warm surface, not a card of
            its own — face and edge are both surfaceAlt (no visible lip, as the board draws
            it), so the travel + haptic are the cue that it opens the chat. */}
        <PressKey
          onPress={onPress}
          edge={colors.surfaceAlt}
          travel={4}
          radius={radius.md}
          intent="navigate"
          accessibilityLabel={
            snoozed
              ? t('mentorHomePage.conversationSnoozedA11y', { name })
              : t('mentorHomePage.conversationWaitingA11y', { name })
          }
          testID={`mentor-convo-${conversation.id}`}
          containerStyle={styles.grow}
          style={[styles.inner, { backgroundColor: colors.surfaceAlt }]}
        >
          <MemberDisc
            name={name}
            size={40}
            animal={conversation.user_companion_animal}
            colour={conversation.user_companion_colour}
            still
          />
          <View style={styles.text}>
            <Text style={[type.cardTitle, { color: colors.ink }]} numberOfLines={1}>
              {name}
            </Text>
            <Text
              style={[type.caption, { color: colors.inkMuted }]}
              numberOfLines={2}
              testID={snoozed ? `mentor-snoozed-${conversation.id}` : `mentor-waiting-${conversation.id}`}
            >
              {line}
            </Text>
          </View>
        </PressKey>
        <PressKey
          onPress={() => onSnooze(!snoozed)}
          disabled={snoozeBusy}
          edge={colors.edgeSurface}
          travel={3}
          radius={radius.md}
          intent="toggle"
          accessibilityLabel={
            snoozed ? t('mentorHomePage.wakeA11y', { name }) : t('mentorHomePage.snoozeA11y', { name })
          }
          testID={snoozed ? `mentor-wake-${conversation.id}` : `mentor-snooze-${conversation.id}`}
          style={[styles.key, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <Ionicons name={snoozed ? 'arrow-undo-outline' : 'timer-outline'} size={18} color={colors.ink} />
          <Text style={[type.label, { color: colors.ink }]} numberOfLines={1}>
            {snoozed ? t('mentorHomePage.wake') : t('mentorHomePage.snooze')}
          </Text>
        </PressKey>
      </EdgeSurface>
    );
  }

  const stateLine = !active
    ? t('mentor.ended')
    : typing
      ? t('mentor.typing')
      : conversation.member_masked
        ? t('mentor.masked')
        : (live?.preview ?? '');

  return (
    <PressKey
      onPress={onPress}
      edge={active ? colors.edgeSurface : colors.edgeAlt}
      travel={4}
      radius={radius.md}
      intent="navigate"
      accessibilityLabel={t('mentorHomePage.conversationA11y', { name: conversation.user_persona_name })}
      testID={`mentor-convo-${conversation.id}`}
      style={[
        styles.row,
        { backgroundColor: active ? colors.surface : colors.surfaceAlt, borderColor: colors.border },
      ]}
    >
      <MemberDisc
        name={conversation.user_persona_name}
        size={40}
        animal={conversation.user_companion_animal}
        colour={conversation.user_companion_colour}
        still
      />
      <View style={styles.text}>
        <Text style={[type.cardTitle, { color: colors.ink }]} numberOfLines={1}>
          {conversation.user_persona_name}
        </Text>
        <Text
          style={[
            type.caption,
            typing ? styles.typing : null,
            { color: typing ? COMPANION_COLORS.sage.accentEdge : colors.inkMuted },
          ]}
          numberOfLines={1}
        >
          {stateLine}
        </Text>
      </View>
      {live && live.unread > 0 ? (
        <View style={[styles.unread, { backgroundColor: colors.accent }]} testID={`mentor-unread-${conversation.id}`}>
          <Text style={[styles.unreadText, { color: colors.onAccent }]}>{t('mentor.unread', { count: live.unread })}</Text>
        </View>
      ) : (
        <Ionicons name="chevron-forward" size={18} color={colors.inkMuted} />
      )}
    </PressKey>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: space.sm,
    paddingHorizontal: 14,
    borderWidth: 1,
  },
  // Board A10's waiting row: 8 / 10 / 8 / 14 around a 44 px link and a 44 px key.
  quietRow: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: space.sm,
    paddingLeft: 14,
    paddingRight: 10,
    borderWidth: 1,
  },
  grow: { flex: 1, minWidth: 0 },
  inner: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 12 },
  key: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    borderWidth: 1,
  },
  text: { flex: 1, minWidth: 0 },
  typing: { fontFamily: type.bodySemi.fontFamily },
  unread: { height: 24, paddingHorizontal: 10, borderRadius: radius.pill, justifyContent: 'center' },
  unreadText: { fontSize: 12, lineHeight: 16, fontFamily: type.label.fontFamily },
});
