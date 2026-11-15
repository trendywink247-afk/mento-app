import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DeepHeader } from '@/components/DeepHeader';
import { KeyboardAvoidingView } from '@/components/KeyboardAvoidingView';
import { PrimaryButton } from '@/components/PrimaryButton';
import { ApiError, api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { leaveToChats } from '@/lib/leaveToChats';
import { useSessionGuard } from '@/lib/useSessionGuard';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type } from '@/theme/tokens';

/**
 * Add and confirm an email (DECISIONS R.10): opened from the second visit while the server's
 * switch is on and an email service exists. Off today. The code is six digits, valid 15 minutes.
 */
export default function EmailConfirm() {
  useSessionGuard();
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const back = () => (router.canGoBack() ? router.back() : leaveToChats(router));
  const input = [styles.input, { color: colors.ink, backgroundColor: colors.surface, borderColor: colors.border }];

  const start = async () => {
    if (busy || !email.trim()) return;
    setBusy(true);
    setNote(null);
    try {
      await api.emailStart(email.trim());
      setSent(true);
    } catch (e) {
      setNote(e instanceof ApiError && e.status === 503 ? t('emailConfirm.unavailable') : t('common.networkError'));
    } finally {
      setBusy(false);
    }
  };
  const confirm = async () => {
    if (busy || code.length !== 6) return;
    setBusy(true);
    setNote(null);
    try {
      await api.emailConfirm(code);
      back();
    } catch (e) {
      setNote(e instanceof ApiError && e.status === 400 ? t('emailConfirm.wrong') : t('common.networkError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.safe}>
        <DeepHeader title={t(sent ? 'emailConfirm.codeTitle' : 'emailConfirm.title')} onBack={back} />
        <View style={styles.body}>
          <Text style={[type.body, { color: colors.inkMuted }]}>{t(sent ? 'emailConfirm.codeSub' : 'emailConfirm.sub')}</Text>
          {sent ? (
            <TextInput value={code} onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" maxLength={6} style={input} testID="email-code" />
          ) : (
            <TextInput value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" style={input} testID="email-address" />
          )}
          {note ? <Text style={[type.note, { color: colors.ink }]} testID="email-confirm-note">{note}</Text> : null}
          {sent ? (
            <>
              <PrimaryButton label={t('emailConfirm.confirm')} onPress={() => void confirm()} loading={busy} testID="email-confirm" />
              <PrimaryButton label={t('emailConfirm.resend')} variant="link" onPress={() => void start()} testID="email-resend" />
            </>
          ) : (
            <PrimaryButton label={t('emailConfirm.send')} onPress={() => void start()} loading={busy} testID="email-send" />
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  body: { padding: space.md, gap: space.md },
  input: { minHeight: 48, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 12, fontFamily: font.sans, fontSize: 18 },
});
