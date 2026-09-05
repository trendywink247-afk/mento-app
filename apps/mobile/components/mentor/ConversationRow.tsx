import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { PersonaAvatar } from '@/components/art/PersonaAvatar';
import { PressKey } from '@/components/motion/PressKey';
import type { ChannelLive } from '@/lib/useMentorConsole';
import { useI18n } from '@/lib/i18n';
import type { ListenerConversation } from '@/lib/listenerApi';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space, type } from '@/theme/tokens';

/** One row in the conversation list — active conversations read live (typing/unread/
 * preview via Stream), ended ones read as a quiet, non-clickable-looking archive
 * entry (still tappable — the transcript stays reachable). */
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

  const stateLine = !active
    ? t('mentor.ended')
    : live?.typing
      ? t('mentor.typing')
      : conversation.member_masked
        ? t('mentor.masked')
        : (live?.preview ?? '');

  return (
    <PressKey
      onPress={onPress}
      edge={colors.edgeSurface}
      accessibilityLabel={conversation.user_persona_name}
      testID={`mentor-convo-${conversation.id}`}
      style={[styles.row, { backgroundColor: colors.surface, opacity: active ? 1 : 0.7 }]}
    >
      <PersonaAvatar
        name={conversation.user_persona_name}
        size={44}
        online={active && !conversation.member_masked}
      />
      <View style={{ flex: 1 }}>
        <Text style={[type.label, { color: colors.ink }]}>{conversation.user_persona_name}</Text>
        <Text style={[type.caption, { color: colors.inkMuted }]} numberOfLines={1}>
          {stateLine}
        </Text>
      </View>
      {live && live.unread > 0 ? (
        <View style={[styles.unread, { backgroundColor: colors.accentTint }]} testID={`mentor-unread-${conversation.id}`}>
          <Text style={[type.caption, { color: colors.accentEdge }]}>
            {t('mentor.unread', { count: live.unread })}
          </Text>
        </View>
      ) : (
        <Ionicons name="chevron-forward" size={18} color={colors.inkMuted} />
      )}
    </PressKey>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.lg,
    padding: space.sm + 2,
    marginBottom: space.sm,
  },
  unread: {
    borderRadius: radius.pill,
    paddingVertical: 2,
    paddingHorizontal: space.sm,
  },
});
