/** The small "Saved" chip that settles on a mentor bubble's top-right corner once the
 * server has the note (board A05). Decorative wash + sage ink, never the accent. */
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { Settle } from '@/components/motion/Settle';
import { useI18n } from '@/lib/i18n';
import { COMPANION_COLORS } from '@/theme/companion';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, wash } from '@/theme/tokens';

export function SavedChip({ settle, testID }: { settle: boolean; testID?: string }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const ink = COMPANION_COLORS.sage.accentEdge;
  return (
    <Settle play={settle}>
      <View
        style={[styles.chip, { backgroundColor: wash.green, borderColor: colors.successWashBorder }]}
        accessible
        accessibilityLabel={t('chat.savedA11y')}
        testID={testID}
      >
        <Ionicons name="bookmark" size={12} color={ink} />
        <Text style={[styles.text, { color: ink }]} maxFontSizeMultiplier={1.3}>
          {t('chat.savedToNotes')}
        </Text>
      </View>
    </Settle>
  );
}

const styles = StyleSheet.create({
  chip: {
    height: 20,
    paddingLeft: 6,
    paddingRight: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: radius.pill,
  },
  text: { fontFamily: font.sansBold, fontSize: 12, lineHeight: 16 },
});
