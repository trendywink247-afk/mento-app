import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { MemberDisc } from '@/components/mentor/MemberDisc';
import { PressKey } from '@/components/motion/PressKey';
import type { ChannelLive } from '@/lib/useMentorConsole';
import { useI18n } from '@/lib/i18n';
import type { ListenerConversation } from '@/lib/listenerApi';
import { useTheme } from '@/theme/ThemeProvider';
import { COMPANION_COLORS } from '@/theme/companion';
import { radius, space, type } from '@/theme/tokens';

/** One conversation row (board A10): the member's disc, their persona, a live line
 * (typing in sage, else the last words), and the accent "N new" pill. An ended chat is
 * the quiet warm row with no pill — still tappable, the transcript stays reachable. */
export function ConversationRow({
  conversation,
  live,
  onPress,
}: {
  conversation: ListenerConversation;
  live: ChannelLive | undefined;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const active = conversation.status === 'active';
  const typing = active && !!live?.typing;

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
      <MemberDisc name={conversation.user_persona_name} size={40} />
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
  text: { flex: 1, minWidth: 0 },
  typing: { fontFamily: type.bodySemi.fontFamily },
  unread: { height: 24, paddingHorizontal: 10, borderRadius: radius.pill, justifyContent: 'center' },
  unreadText: { fontSize: 12, lineHeight: 16, fontFamily: type.label.fontFamily },
});
