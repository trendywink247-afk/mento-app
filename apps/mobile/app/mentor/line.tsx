import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { LineSheet } from '@/components/mentor/LineSheet';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { space } from '@/theme/tokens';

/** "Your line" editor sheet, presented as a transparentModal route
 * (app/mentor/_layout.tsx) — same scrim + centred-card pattern as
 * app/mentor/report.tsx / app/mentor/helplines.tsx. Going back re-focuses Mentor
 * Home, whose useMentorConsole() re-fetches `me` on focus — no manual refresh
 * plumbing needed for PresenceHeader to pick up a saved line. */
export default function MentorLineRoute() {
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useI18n();
  const close = () => router.back();

  return (
    <View style={[styles.backdrop, { backgroundColor: colors.scrim }]}>
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={close}
        accessibilityRole="button"
        accessibilityLabel={t('common.goBack')}
        testID="mentor-line-backdrop"
      />
      <LineSheet onClose={close} onSaved={close} />
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.md,
  },
});
