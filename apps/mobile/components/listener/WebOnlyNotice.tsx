/** Native stand-in for the listener console — the console is web-only (DECISIONS
 * §I.6), and this stub keeps stream-chat web UI code out of native bundles. */
import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';
import { space, type } from '@/theme/tokens';

export function WebOnlyNotice() {
  const { colors } = useTheme();
  return (
    <View style={[styles.center, { backgroundColor: colors.bg }]}>
      <Text style={[type.title, { color: colors.ink, textAlign: 'center' }]}>
        The listener console is web-only
      </Text>
      <Text style={[type.body, { color: colors.inkMuted, textAlign: 'center' }]}>
        Open your console link in a desktop or mobile browser.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.sm, padding: space.lg },
});
