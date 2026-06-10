import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';

import { LockFlow } from './options/LockFlow';
import { MaskFlow } from './options/MaskFlow';
import { OptionsSheet, type SheetChoice } from './options/OptionsSheet';
import { PauseFlow } from './options/PauseFlow';
import { ReportFlow } from './options/ReportFlow';
import { EndFlow } from './options/EndFlow';

/**
 * Conversation Options (PRD §6) — the mockup sheet (6 numbered cards + well-being
 * footer) orchestrating the styled sub-flows: PIN lock, Panda Mask presets, Panda
 * Pause, End vs Panda Wipe (honest copy), Report/Block reasons, and the coffee
 * screen. Every flow is wired to the same proven backend endpoints as before.
 */

type Props = {
  conversationId: string;
  visible: boolean;
  onClose: () => void;
  onLeft: () => void; // called after end/wipe/report/block (navigate away)
};

export function ConversationOptions({ conversationId, visible, onClose, onLeft }: Props) {
  const router = useRouter();
  const { colors } = useTheme();
  const [flow, setFlow] = useState<SheetChoice | null>(null);
  // Server-confirmed state, reflected back into the sheet labels.
  const [locked, setLocked] = useState(false);
  const [paused, setPaused] = useState(false);
  const [mask, setMask] = useState<string | null>(null);

  if (!visible) return null;

  const close = () => {
    setFlow(null);
    onClose();
  };

  const choose = (c: SheetChoice) => {
    if (c === 'coffee') {
      // The contribution surface is its own screen — reachable from the menu, never
      // auto-opened in a conversation (T&S #4).
      close();
      router.push('/coffee');
      return;
    }
    setFlow(c);
  };

  return (
    <View style={styles.backdrop}>
      <Pressable
        style={[styles.backdropFill, { backgroundColor: colors.scrim }]}
        onPress={close}
        testID="options-backdrop"
        accessibilityLabel="Close options"
      />
      {flow === null ? (
        <OptionsSheet locked={locked} onChoose={choose} onClose={close} />
      ) : flow === 'lock' ? (
        <LockFlow
          conversationId={conversationId}
          locked={locked}
          onBack={() => setFlow(null)}
          onChanged={setLocked}
        />
      ) : flow === 'status' ? (
        <MaskFlow
          conversationId={conversationId}
          current={mask}
          onBack={() => setFlow(null)}
          onChanged={setMask}
        />
      ) : flow === 'pause' ? (
        <PauseFlow
          conversationId={conversationId}
          paused={paused}
          onBack={() => setFlow(null)}
          onChanged={setPaused}
        />
      ) : flow === 'end' ? (
        <EndFlow conversationId={conversationId} onBack={() => setFlow(null)} onEnded={onLeft} />
      ) : (
        <ReportFlow conversationId={conversationId} onBack={() => setFlow(null)} onDone={onLeft} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, justifyContent: 'flex-end', zIndex: 100 },
  backdropFill: { ...StyleSheet.absoluteFillObject },
});
