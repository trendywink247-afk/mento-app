import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ApiError, api } from '@/lib/api';
import { colors, radius, space, type } from '@/theme/tokens';

/**
 * Conversation Options sheet (PRD §6). Each option is a real end-to-end flow wired to
 * the backend: lock (4-digit PIN), status mask, pause notifications, end, Panda Wipe,
 * report, and report+block. Report/Block end the chat and file a moderation event
 * (block also prevents the listener being re-matched — enforced server-side).
 */

type Props = {
  conversationId: string;
  visible: boolean;
  onClose: () => void;
  onLeft: () => void; // called after end/wipe/report/block (navigate away)
};

type Mode = 'menu' | 'lock' | 'unlock' | 'status' | 'report' | 'block' | 'end' | 'wipe';

export function ConversationOptions({ conversationId, visible, onClose, onLeft }: Props) {
  const [mode, setMode] = useState<Mode>('menu');
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [paused, setPaused] = useState(false);

  if (!visible) return null;

  const reset = () => {
    setMode('menu');
    setInput('');
    setError(null);
  };
  const close = () => {
    reset();
    setNote(null);
    onClose();
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const doLock = () =>
    run(async () => {
      const s = await api.lockConversation(conversationId, input);
      setLocked(s.is_locked);
      setNote('Conversation locked.');
      reset();
    });
  const doUnlock = () =>
    run(async () => {
      const s = await api.unlockConversation(conversationId, input);
      setLocked(s.is_locked);
      setNote('Conversation unlocked.');
      reset();
    });
  const doStatus = () =>
    run(async () => {
      await api.setStatusMask(conversationId, input.trim() || null);
      setNote(input.trim() ? `Status mask set to "${input.trim()}".` : 'Status mask cleared.');
      reset();
    });
  const doPause = () =>
    run(async () => {
      const s = await api.setPause(conversationId, !paused);
      setPaused(s.is_paused);
      setNote(s.is_paused ? 'Notifications paused.' : 'Notifications resumed.');
    });
  const doEnd = () => run(async () => { await api.endConversation(conversationId); onLeft(); });
  const doWipe = () => run(async () => { await api.wipeConversation(conversationId); onLeft(); });
  const doReport = () =>
    run(async () => { await api.reportConversation(conversationId, input.trim() || null); onLeft(); });
  const doBlock = () =>
    run(async () => { await api.blockConversation(conversationId, input.trim() || null); onLeft(); });

  return (
    <View style={styles.backdrop}>
      <Pressable style={styles.backdropFill} onPress={close} testID="options-backdrop" />
      <View style={styles.sheet} testID="options-sheet">
        {mode === 'menu' ? (
          <>
            <Text style={styles.title}>Conversation options</Text>
            {note ? <Text style={styles.note}>{note}</Text> : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Row icon="lock-closed-outline" label={locked ? 'Unlock conversation' : 'Lock with a PIN'}
              testID="opt-lock" onPress={() => { setNote(null); setMode(locked ? 'unlock' : 'lock'); }} />
            <Row icon="happy-outline" label="Status mask (Panda Mask)"
              testID="opt-status" onPress={() => { setNote(null); setMode('status'); }} />
            <Row icon={paused ? 'notifications-outline' : 'notifications-off-outline'}
              label={paused ? 'Resume notifications' : 'Pause notifications (Panda Pause)'}
              testID="opt-pause" onPress={() => void doPause()} />
            <Row icon="close-circle-outline" label="End conversation"
              testID="opt-end" onPress={() => { setNote(null); setMode('end'); }} />
            <Row icon="trash-outline" label="Panda Wipe — delete everywhere" danger
              testID="opt-wipe" onPress={() => { setNote(null); setMode('wipe'); }} />
            <Row icon="flag-outline" label="Report" danger
              testID="opt-report" onPress={() => { setNote(null); setMode('report'); }} />
            <Row icon="hand-left-outline" label="Report & block" danger
              testID="opt-block" onPress={() => { setNote(null); setMode('block'); }} />
          </>
        ) : (
          <Panel
            mode={mode}
            input={input}
            setInput={setInput}
            busy={busy}
            error={error}
            onBack={reset}
            onConfirm={
              mode === 'lock' ? doLock
              : mode === 'unlock' ? doUnlock
              : mode === 'status' ? doStatus
              : mode === 'end' ? doEnd
              : mode === 'wipe' ? doWipe
              : mode === 'report' ? doReport
              : doBlock
            }
          />
        )}
      </View>
    </View>
  );
}

function Row({ icon, label, onPress, testID, danger }: {
  icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; testID: string; danger?: boolean;
}) {
  return (
    <Pressable style={styles.row} onPress={onPress} testID={testID}>
      <Ionicons name={icon} size={20} color={danger ? colors.danger : colors.brand} />
      <Text style={[type.body, { color: danger ? colors.danger : colors.ink }]}>{label}</Text>
    </Pressable>
  );
}

const PANEL_COPY: Record<Mode, { title: string; confirm: string; field?: 'pin' | 'text'; placeholder?: string }> = {
  menu: { title: '', confirm: '' },
  lock: { title: 'Set a 4-digit PIN', confirm: 'Lock', field: 'pin', placeholder: '1234' },
  unlock: { title: 'Enter your PIN', confirm: 'Unlock', field: 'pin', placeholder: '1234' },
  status: { title: 'Show a custom status', confirm: 'Save', field: 'text', placeholder: 'e.g. Away' },
  report: { title: 'Report this conversation', confirm: 'Submit report', field: 'text', placeholder: 'What happened? (optional)' },
  block: { title: 'Report & block this listener', confirm: 'Block', field: 'text', placeholder: 'Reason (optional)' },
  end: { title: 'End this conversation?', confirm: 'End conversation' },
  wipe: { title: 'Delete messages on both sides — your device AND our servers. This cannot be undone.', confirm: 'Panda Wipe' },
};

function Panel({ mode, input, setInput, busy, error, onBack, onConfirm }: {
  mode: Mode; input: string; setInput: (v: string) => void; busy: boolean; error: string | null;
  onBack: () => void; onConfirm: () => void;
}) {
  const copy = PANEL_COPY[mode];
  const destructive = mode === 'wipe' || mode === 'block' || mode === 'report' || mode === 'end';
  return (
    <View style={{ gap: space.md }}>
      <Text style={styles.title}>{copy.title}</Text>
      {copy.field ? (
        <TextInput
          testID={copy.field === 'pin' ? 'opt-pin-input' : 'opt-text-input'}
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder={copy.placeholder}
          placeholderTextColor={colors.inkMuted}
          keyboardType={copy.field === 'pin' ? 'number-pad' : 'default'}
          maxLength={copy.field === 'pin' ? 4 : 200}
          secureTextEntry={copy.field === 'pin'}
          autoFocus
        />
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.panelButtons}>
        <Pressable style={[styles.btn, styles.btnGhost]} onPress={onBack} testID="opt-back">
          <Text style={[type.label, { color: colors.brand }]}>Back</Text>
        </Pressable>
        <Pressable
          style={[styles.btn, destructive ? styles.btnDanger : styles.btnPrimary, busy && { opacity: 0.6 }]}
          onPress={onConfirm}
          disabled={busy}
          testID="opt-confirm"
        >
          <Text style={[type.label, { color: colors.onBrand }]}>{copy.confirm}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, justifyContent: 'flex-end', zIndex: 100 },
  backdropFill: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.scrim },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: space.lg,
    gap: space.xs,
  },
  title: { ...type.label, color: colors.ink, marginBottom: space.sm },
  note: { ...type.caption, color: colors.success, marginBottom: space.sm },
  error: { ...type.caption, color: colors.danger },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  input: {
    height: 50,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    paddingHorizontal: space.md,
    ...type.body,
    color: colors.ink,
  },
  panelButtons: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
  btn: { flex: 1, height: 48, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  btnGhost: { backgroundColor: colors.surfaceAlt },
  btnPrimary: { backgroundColor: colors.brand },
  btnDanger: { backgroundColor: colors.danger },
});
