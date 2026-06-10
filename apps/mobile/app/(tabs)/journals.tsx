import { StyleSheet, Text, View } from 'react-native';

import { IconBadge } from '@/components/IconBadge';
import { Screen } from '@/components/Screen';
import { useTheme } from '@/theme/ThemeProvider';
import { space, type } from '@/theme/tokens';

/** Journals hub lands in Phase 5 (AI assistant card + Finance/Mood/Mentor Notes). */
export default function JournalsTab() {
  const { colors } = useTheme();

  return (
    <Screen>
      <Text style={[type.displaySerif, { color: colors.ink }]} accessibilityRole="header">
        Journals
      </Text>
      <View style={styles.empty}>
        <IconBadge icon="book-outline" size={64} />
        <Text style={[type.titleSerif, styles.center, { color: colors.ink }]}>
          Your journals will live here
        </Text>
        <Text style={[type.body, styles.center, { color: colors.inkMuted }]}>
          Mentor notes, moods, and everyday expenses — gathered gently, just for you.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md },
  center: { textAlign: 'center' },
});
