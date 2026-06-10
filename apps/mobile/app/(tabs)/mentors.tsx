import { StyleSheet, Text, View } from 'react-native';

import { IconBadge } from '@/components/IconBadge';
import { Screen } from '@/components/Screen';
import { useTheme } from '@/theme/ThemeProvider';
import { space, type } from '@/theme/tokens';

/** Mentor discovery (list, filters, profiles) lands in Phase 5. */
export default function MentorsTab() {
  const { colors } = useTheme();

  return (
    <Screen>
      <Text style={[type.displaySerif, { color: colors.ink }]} accessibilityRole="header">
        Mentors
      </Text>
      <View style={styles.empty}>
        <IconBadge icon="people-outline" tone="indigo" size={64} />
        <Text style={[type.titleSerif, styles.center, { color: colors.ink }]}>
          Find someone who understands
        </Text>
        <Text style={[type.body, styles.center, { color: colors.inkMuted }]}>
          Browse listeners by what's on your mind and reach out when you're ready.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md },
  center: { textAlign: 'center' },
});
