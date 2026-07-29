import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { Panda } from '@/components/art/Panda';
import { ApiError, api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { font, space, type } from '@/theme/tokens';

import { ConfirmModal, FlowScreen, LockFootnote, PinPad } from './bits';

/** Lock/unlock with a 4-digit PIN — dots + keypad per the PIN mockups; wrong-PIN
 * shows the sad panda. (Biometric + email reset are deferred — simplified per DoD.) */
export function LockFlow({
  conversationId,
  locked,
  onBack,
  onChanged,
}: {
  conversationId: string;
  locked: boolean;
  onBack: () => void;
  onChanged: (locked: boolean) => void;
}) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async () => {
    if (pin.length !== 4 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const s = locked
        ? await api.unlockConversation(conversationId, pin)
        : await api.lockConversation(conversationId, pin);
      onChanged(s.is_locked);
      setDone(true);
    } catch (e) {
      setPin('');
      setError(
        e instanceof ApiError && e.status === 403
          ? t('options.lock.wrongPin')
          : e instanceof ApiError
            ? e.message
            : t('common.somethingWrong'),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <FlowScreen
      title={locked ? t('options.lock.titleUnlock') : t('options.lock.titleLock')}
      subtitle={locked ? t('options.lock.subUnlock') : t('options.lock.subLock')}
      icon="lock-closed-outline"
      onBack={onBack}
      footer={
        <>
          <PrimaryButton
            label={locked ? t('options.lock.ctaUnlock') : t('options.lock.ctaLock')}
            onPress={() => void submit()}
            disabled={pin.length !== 4}
            loading={busy}
            testID="opt-confirm"
          />
          <LockFootnote text={t('options.lock.footnote')} />
        </>
      }
    >
      <View style={styles.art}>
        <Panda pose={error ? 'sad' : 'shield'} size={120} />
        <Text style={[styles.lead, { color: colors.ink }]}>
          {locked ? t('options.lock.leadUnlock') : t('options.lock.leadLock')}
        </Text>
        <Text style={[type.body, { color: colors.inkMuted, textAlign: 'center' }]}>
          {locked
            ? t('options.lock.bodyUnlock')
            : t('options.lock.bodyLock')}
        </Text>
      </View>
      <PinPad value={pin} onChange={(v) => { setPin(v); setError(null); }} error={error} />

      <ConfirmModal
        visible={done}
        art={<Panda pose="shield" size={110} />}
        title={locked ? t('options.lock.doneTitleUnlock') : t('options.lock.doneTitleLock')}
        body={
          locked
            ? t('options.lock.doneBodyUnlock')
            : t('options.lock.doneBodyLock')
        }
        cta={t('common.gotIt')}
        onDone={onBack}
      />
    </FlowScreen>
  );
}

const styles = StyleSheet.create({
  art: { alignItems: 'center', gap: space.xs, marginBottom: space.md },
  lead: { fontFamily: font.serifBold, fontSize: 24, lineHeight: 30, marginTop: space.sm },
});
