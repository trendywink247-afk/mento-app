import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { space, type } from '@/theme/tokens';

/** The line over the mentor's composer (board A35): no allowance meter on this side —
 * mentors are never limited — only the reassurance that nobody expects an instant reply. */
export function MentorComposerHint() {
  const { colors } = useTheme();
  const { t } = useI18n();
  return (
    <View style={styles.row} testID="mentor-composer-hint">
      <Ionicons name="time-outline" size={16} color={colors.inkMuted} />
      <Text style={[type.caption, styles.text, { color: colors.inkMuted }]}>{t('mentorChatPage.composerHint')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md },
  text: { flex: 1, lineHeight: 16 },
});
