import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { HelplinesSheet } from '@/components/mentor/HelplinesSheet';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { space } from '@/theme/tokens';

/** Helplines sheet, presented as a transparentModal route (app/mentor/_layout.tsx) —
 * same scrim + centred-card pattern as app/start-fresh.tsx. */
export default function MentorHelplinesRoute() {
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
        accessibilityLabel={t('mentor.helplines.close')}
        testID="mentor-helplines-backdrop"
      />
      <HelplinesSheet onClose={close} />
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
