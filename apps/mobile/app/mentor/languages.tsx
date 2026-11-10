import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LanguageChips } from '@/components/LanguageChips';
import { PrimaryButton } from '@/components/PrimaryButton';
import { MentorPageHeader } from '@/components/mentor/MentorPageHeader';
import { useI18n } from '@/lib/i18n';
import { listenerApi } from '@/lib/listenerApi';
import { useSessionGuard } from '@/lib/useSessionGuard';
import { useTheme } from '@/theme/ThemeProvider';
import { space, type } from '@/theme/tokens';

/** The languages a mentor talks in. Members who prefer one see matching mentors first (never a filter). */
export default function MentorLanguages() {
  useSessionGuard();
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useI18n();
  const [value, setValue] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void listenerApi
      .me()
      .then((me) => live && setValue(me.languages ?? []))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const save = async () => {
    setBusy(true);
    setNote(null);
    try {
      await listenerApi.updateProfile({ languages: value });
      router.back();
    } catch {
      setNote(t('common.somethingWrong'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <MentorPageHeader eyebrow={t('mentor.languages')} title={t('mentor.languagesTitle')} onBack={() => router.back()} />
        <Text style={[type.body, { color: colors.inkMuted }]}>{t('mentor.languagesBody')}</Text>
        <LanguageChips value={value} onChange={setValue} testIDPrefix="mentor-lang" />
        <View style={styles.foot}>
          {note ? <Text style={[type.caption, { color: colors.inkMuted }]} accessibilityLiveRegion="polite" testID="mentor-lang-note">{note}</Text> : null}
          <PrimaryButton label={t('mentor.languagesSave')} shape="key" onPress={() => void save()} loading={busy} disabled={value.length === 0} testID="mentor-lang-save" />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.xl, gap: space.md },
  foot: { gap: space.sm, marginTop: space.sm },
});
