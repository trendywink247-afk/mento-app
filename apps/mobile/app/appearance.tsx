import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { AppearancePicker } from '@/components/AppearancePicker';
import { Screen } from '@/components/Screen';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { space, type } from '@/theme/tokens';

/** Pastel (today's look, the default), Light, Dark or System. Kept on this phone only. */
export default function Appearance() {
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useI18n();
  return (
    <Screen onBack={() => router.back()} scroll>
      <View style={styles.page}>
        <Text style={[type.displayHeadline, { color: colors.ink }]} accessibilityRole="header">
          {t('appearance.title')}
        </Text>
        <Text style={[type.body, { color: colors.inkMuted }]}>{t('appearance.sub')}</Text>
        <AppearancePicker />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({ page: { gap: space.md, paddingBottom: space.xl } });
