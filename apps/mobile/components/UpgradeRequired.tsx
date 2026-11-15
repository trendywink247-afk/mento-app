import { Linking, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/PrimaryButton';
import { useI18n } from '@/lib/i18n';
import { useUpgradeRequired } from '@/lib/upgradeGate';
import { useTheme } from '@/theme/ThemeProvider';
import { space, type } from '@/theme/tokens';

const STORE_URL = 'https://play.google.com/store/apps/details?id=chat.mento.app';

/** Covers the app while this build is too old for the server. Your chats and account are safe; update and carry on. */
export function UpgradeRequired() {
  const needed = useUpgradeRequired();
  const { colors } = useTheme();
  const { t } = useI18n();
  if (!needed) return null;
  return (
    <SafeAreaView style={[styles.cover, { backgroundColor: colors.bg }]} testID="upgrade-required">
      <View style={styles.body}>
        <Text style={[type.displayHeadline, { color: colors.ink }]} accessibilityRole="header">
          {t('upgrade.title')}
        </Text>
        <Text style={[type.body, { color: colors.inkMuted }]}>{t('upgrade.body')}</Text>
        <PrimaryButton label={t('upgrade.button')} shape="key" onPress={() => void Linking.openURL(STORE_URL).catch(() => {})} testID="upgrade-update" />
        <Text style={[type.caption, { color: colors.inkMuted }]}>{t('upgrade.safe')}</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  cover: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, zIndex: 100 },
  body: { flex: 1, justifyContent: 'center', gap: space.md, paddingHorizontal: space.lg },
});
