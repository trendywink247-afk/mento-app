import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { Panda } from '@/components/art/Panda';
import { ApiError, api } from '@/lib/api';
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
          ? "That PIN doesn't look quite right. Please enter your current PIN."
          : e instanceof ApiError
            ? e.message
            : 'Something went wrong. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <FlowScreen
      title={locked ? 'Unlock this conversation' : 'Lock this Conversation'}
      subtitle={locked ? 'Enter your PIN to unlock' : 'Protect this chat with a 4-digit PIN'}
      icon="lock-closed-outline"
      onBack={onBack}
      footer={
        <>
          <PrimaryButton
            label={locked ? 'Unlock' : 'Lock Conversation'}
            onPress={() => void submit()}
            disabled={pin.length !== 4}
            loading={busy}
            testID="opt-confirm"
          />
          <LockFootnote text="Only you can open this chat. The PIN never leaves hashed storage." />
        </>
      }
    >
      <View style={styles.art}>
        <Panda pose={error ? 'sad' : 'shield'} size={120} />
        <Text style={[styles.lead, { color: colors.ink }]}>
          {locked ? 'Enter your PIN' : 'Set a 4-digit PIN'}
        </Text>
        <Text style={[type.body, { color: colors.inkMuted, textAlign: 'center' }]}>
          {locked
            ? 'This conversation is locked.'
            : "You'll need this PIN to open the conversation again."}
        </Text>
      </View>
      <PinPad value={pin} onChange={(v) => { setPin(v); setError(null); }} error={error} />

      <ConfirmModal
        visible={done}
        art={<Panda pose="shield" size={110} />}
        title={locked ? 'Conversation unlocked' : 'Conversation locked!'}
        body={
          locked
            ? 'Welcome back. This chat is open again.'
            : 'This chat now asks for your PIN before it opens.'
        }
        cta="Got it"
        onDone={onBack}
      />
    </FlowScreen>
  );
}

const styles = StyleSheet.create({
  art: { alignItems: 'center', gap: space.xs, marginBottom: space.md },
  lead: { fontFamily: font.serifBold, fontSize: 24, lineHeight: 30, marginTop: space.sm },
});
