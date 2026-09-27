import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackKey } from '@/components/DeepHeader';
import { EdgeSurface } from '@/components/EdgeSurface';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Entrance } from '@/components/motion/Entrance';
import { ApiError, api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { saveCompanionAnimal, saveRole, saveSession } from '@/lib/session';
import { useTheme } from '@/theme/ThemeProvider';
import { COMPANION_COLORS, type CompanionColor } from '@/theme/companion';
import { font, radius, space, type } from '@/theme/tokens';

/** Come back with a recovery code (WS3 T3.5), from the landing. The server checks it,
 * signs every other device out and starts a session here; the companion the account
 * holds comes back with it, then My Chats. Wrong codes and too many tries are plain
 * still lines — nothing shakes (T&S #11). */
export default function RecoverScreen() {
  const router = useRouter();
  const { colors, setCompanionColor } = useTheme();
  const { t } = useI18n();
  const [phrase, setPhrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<'wrong' | 'tooMany' | 'failed' | null>(null);

  const submit = async () => {
    if (busy || !phrase.trim()) return;
    setBusy(true);
    setProblem(null);
    try {
      const result = await api.recover(phrase);
      await saveSession(result.session_token, result.stream_token, result.user, result.refresh_token);
      await saveRole('mentee');
      try {
        const me = await api.me();
        if (me.companion_animal) await saveCompanionAnimal(me.companion_animal);
        if (me.companion_colour && me.companion_colour in COMPANION_COLORS) {
          setCompanionColor(me.companion_colour as CompanionColor);
        }
      } catch {
        /* the companion is decoration; the session is what matters */
      }
      router.replace('/chats');
    } catch (e) {
      setProblem(
        e instanceof ApiError && e.status === 401
          ? 'wrong'
          : e instanceof ApiError && e.status === 429
            ? 'tooMany'
            : 'failed',
      );
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]}>
      <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <BackKey onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
          <Entrance index={0}>
            <Text style={[type.displayHeadline, { color: colors.ink }]} accessibilityRole="header">
              {t('recovery.enterTitle')}
            </Text>
          </Entrance>
          <Entrance index={1}>
            <Text style={[type.body, { color: colors.inkMuted }]}>{t('recovery.enterSub')}</Text>
          </Entrance>
          <Entrance index={2}>
            <EdgeSurface
              edge={colors.edgeSurface}
              travel={3}
              radius={radius.md}
              style={[styles.field, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              <TextInput
                value={phrase}
                onChangeText={setPhrase}
                placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
                placeholderTextColor={colors.inkMuted}
                autoCapitalize="characters"
                autoCorrect={false}
                autoComplete="off"
                spellCheck={false}
                accessibilityLabel={t('recovery.enterA11y')}
                onSubmitEditing={() => void submit()}
                style={[styles.input, { color: colors.ink }]}
                testID="recover-input"
              />
            </EdgeSurface>
          </Entrance>
          {/* Still, like every limit state: a line, never a shake. */}
          {problem ? (
            <Text style={[type.note, { color: colors.ink }]} testID="recover-problem" accessibilityLiveRegion="polite">
              {problem === 'wrong' ? t('recovery.wrong') : problem === 'tooMany' ? t('recovery.tooMany') : t('recovery.failed')}
            </Text>
          ) : null}
          <View style={styles.grow} />
          <PrimaryButton
            label={t('recovery.submit')}
            shape="key"
            trailing="arrow"
            onPress={() => void submit()}
            disabled={!phrase.trim()}
            loading={busy}
            testID="recover-submit"
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { flexGrow: 1, paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.lg, gap: 14 },
  grow: { flex: 1 },
  field: { borderWidth: 1, paddingHorizontal: 14, minHeight: 56, justifyContent: 'center' },
  input: { fontFamily: font.sansBold, fontSize: 17, letterSpacing: 0.5, paddingVertical: 12 },
});
