import { StyleSheet, Text, View } from 'react-native';

import { PressKey } from '@/components/motion/PressKey';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space, type } from '@/theme/tokens';

/**
 * Shared "end this conversation" confirm — extracted from the inline menu sheet in
 * components/mentor/MentorChatScreen.tsx so the same confirm renders from the
 * member brief's "End" action (components/mentor/MemberBriefScreen.tsx) too. No
 * <Modal> (Android new-arch blank-modal gotcha, CLAUDE.md) — the caller renders
 * this inline inside whatever backdrop/card it already owns.
 */
export function EndConfirmSheet({
  busy,
  onConfirm,
  onCancel,
}: {
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { colors } = useTheme();
  const { t } = useI18n();
  return (
    <View style={styles.wrap} testID="end-confirm-sheet">
      <Text style={[type.label, { color: colors.ink }]}>{t('mentor.chat.endTitle')}</Text>
      <Text style={[type.caption, { color: colors.inkMuted }]}>{t('mentor.chat.endBody')}</Text>
      <View style={styles.row}>
        <PressKey
          onPress={onConfirm}
          edge={colors.accentEdge}
          radius={radius.md}
          disabled={busy}
          style={[styles.item, { backgroundColor: colors.accent }]}
          containerStyle={{ flex: 1 }}
          testID="mentor-end-confirm"
        >
          <Text style={[type.label, { color: colors.onAccent }]}>{t('mentor.chat.endConfirm')}</Text>
        </PressKey>
        <PressKey
          onPress={onCancel}
          edge={colors.edgeSurface}
          radius={radius.md}
          disabled={busy}
          style={[styles.item, { backgroundColor: colors.surface }]}
          containerStyle={{ flex: 1 }}
          testID="mentor-end-cancel"
        >
          <Text style={[type.label, { color: colors.ink }]}>{t('mentor.chat.keep')}</Text>
        </PressKey>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  row: { flexDirection: 'row', gap: space.sm },
  item: { padding: space.sm, alignItems: 'center' },
});
