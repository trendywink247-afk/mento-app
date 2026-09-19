import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import type { SheetDepth } from '@/components/motion/useSheetDepth';
import { ApiError, api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/theme/ThemeProvider';

import { LockFlow } from './options/LockFlow';
import { MaskFlow } from './options/MaskFlow';
import { OptionsSheet, type SheetChoice } from './options/OptionsSheet';
import { PauseFlow } from './options/PauseFlow';
import { ReportFlow } from './options/ReportFlow';
import { EndFlow } from './options/EndFlow';

/**
 * Conversation options (PRD §6, board A20) — the sheet over the settled-back chat, and the
 * sub-flows it opens: PIN lock, Away Mask presets, Quiet Pause, Report / Block, and End and
 * wipe's honest confirmation. Every flow is wired to the same proven endpoints as before;
 * the board changes how they are REACHED:
 *   - Away Mask and Quiet Pause are switches: off → the flow that turns it on (its presets /
 *     its plain-words explanation); on → one tap turns it off, confirmed by the server;
 *   - End is two keys on the sheet itself: End closes the chat and goes to the private
 *     reflection; End and wipe goes to the wipe confirmation;
 *   - Save to Journal hands back to the chat, which opens the save key on the mentor's
 *     latest message;
 *   - the contribution row is gone — money never appears inside a conversation (T&S #4).
 *
 * Depth: the screen owns ONE shared value (components/motion/useSheetDepth.ts) that settles
 * the chat back, fades the scrim and raises the sheet together.
 */

type Props = {
  conversationId: string;
  visible: boolean;
  /** The screen's sheet choreography — `useSheetDepth(visible)`. */
  depth: SheetDepth;
  onClose: () => void;
  onLeft: () => void; // called after wipe/report/block (navigate away)
  /** "Save to Journal": the chat opens the save key on the mentor's latest message. */
  onSaveToJournal: () => void;
  /** Persona name, echoed on the reflection screen. */
  listenerName?: string;
  /** Opens straight onto a sub-flow instead of the choice sheet — the mentor-profile
   * screen's "Report or block" hand-off (spec §3.5). Undefined = normal behaviour
   * (sheet first). Only applied on the rising edge of `visible` so it never re-fires
   * flow back to Report on a later, ordinary reopen of an already-mounted sheet. */
  initial?: 'report';
};

type Flow = 'lock' | 'status' | 'pause' | 'report' | 'wipe';

export function ConversationOptions({
  conversationId,
  visible,
  depth,
  onClose,
  onLeft,
  onSaveToJournal,
  listenerName,
  initial,
}: Props) {
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useI18n();
  const [flow, setFlow] = useState<Flow | null>(initial ?? null);
  // Server-confirmed state, reflected back into the sheet's labels and switches.
  const [locked, setLocked] = useState(false);
  const [paused, setPaused] = useState(false);
  const [mask, setMask] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wasVisible = useRef(visible);
  useEffect(() => {
    if (visible && !wasVisible.current) {
      setError(null);
      if (initial) setFlow(initial);
    }
    wasVisible.current = visible;
  }, [visible, initial]);

  const scrim = useAnimatedStyle(() => ({ opacity: depth.progress.value }));

  if (!visible && !depth.shown) return null;

  const close = () => {
    setFlow(null);
    onClose();
  };

  /** One server call from the sheet itself; a failure is one still line (T&S #11). */
  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('common.somethingWrong'));
    } finally {
      setBusy(false);
    }
  };

  const choose = (c: SheetChoice) => {
    if (c === 'save') {
      close();
      onSaveToJournal();
    } else if (c === 'status' && mask !== null) {
      void run(async () => setMask((await api.setStatusMask(conversationId, null)).status_mask ?? null));
    } else if (c === 'pause' && paused) {
      void run(async () => setPaused((await api.setPause(conversationId, false)).is_paused));
    } else if (c === 'end') {
      // Plain End flows into the private reflection (board A23).
      void run(async () => {
        await api.endConversation(conversationId);
        router.replace({
          pathname: '/reflection',
          params: { conversation: conversationId, listener: listenerName ?? '' },
        });
      });
    } else {
      setFlow(c);
    }
  };

  return (
    <View style={styles.backdrop} pointerEvents={visible ? 'auto' : 'none'}>
      <Animated.View style={[styles.backdropFill, { backgroundColor: colors.scrimSheet }, scrim]}>
        <Pressable
          style={styles.backdropFill}
          onPress={close}
          testID="options-backdrop"
          accessibilityLabel={t('options.sheet.closeA11y')}
        />
      </Animated.View>
      {flow === null ? (
        <OptionsSheet
          locked={locked}
          maskOn={mask !== null}
          paused={paused}
          busy={busy}
          error={error}
          onChoose={choose}
          onClose={close}
          progress={depth.progress}
          reduced={depth.reduced}
        />
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
      ) : flow === 'wipe' ? (
        // End and wipe already has its own "All clean" closure, so it leaves directly.
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
