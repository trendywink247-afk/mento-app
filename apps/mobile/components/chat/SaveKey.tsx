/** "Save to Mentor Notes" — the accent-tint pillow key that rests under a mentor's message
 * (board A05), with the one-line nudge beneath it on the mentor's latest message. */
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { PressKey } from '@/components/motion/PressKey';
import { Settle } from '@/components/motion/Settle';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, type } from '@/theme/tokens';

export function SaveKey({
  onPress,
  nudge,
  delay = 0,
  testID,
}: {
  onPress: () => void;
  nudge: boolean;
  /** Wait for the bubble above it to land first (a live arrival). */
  delay?: number;
  testID?: string;
}) {
  const { colors } = useTheme();
  const { t } = useI18n();
  return (
    <View style={styles.zone}>
      <Settle delay={delay}>
        <PressKey
          onPress={onPress}
          edge={colors.accentTintEdge}
          radius={radius.pill}
          intent="commit"
          accessibilityLabel={t('chat.saveToNotes')}
          testID={testID}
          style={[styles.key, { backgroundColor: colors.accentTint }]}
          containerStyle={styles.keyWrap}
        >
          <Ionicons name="bookmark-outline" size={18} color={colors.accent} />
          <Text style={[type.label, { color: colors.accent }]} maxFontSizeMultiplier={1.3}>
            {t('chat.saveToNotes')}
          </Text>
        </PressKey>
      </Settle>
      {nudge ? (
        <Text style={[type.caption, styles.nudge, { color: colors.inkMuted }]}>{t('chat.saveHint')}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  zone: { gap: 8, alignItems: 'flex-start' },
  keyWrap: { alignSelf: 'flex-start' },
  key: { height: 40, paddingLeft: 10, paddingRight: 14, flexDirection: 'row', alignItems: 'center', gap: 6 },
  nudge: { maxWidth: 260 },
});
