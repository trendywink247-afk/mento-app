/**
 * Native chat input — the pillow-key composer (DECISIONS: "Pillow key" composer,
 * spec docs/superpowers/specs/2026-09-06-chat-profiles-composer-design.md §5.1).
 *
 * KIT SEAM (verified against the bundled source, not the published types — Metro
 * bundles the `src/` TS per CLAUDE.md's stream-chat gotcha):
 * stream-chat-expo 9.3.0 re-exports `stream-chat-react-native-core`, which is
 * NOT hoisted — it lives nested at
 * node_modules/stream-chat-expo/node_modules/stream-chat-react-native-core/src.
 * The kit's `<MessageComposer />` (…/components/MessageInput/MessageComposer.tsx)
 * reads `Input` off `useComponentsContext()` and, when it is set, renders
 * `<Input additionalTextInputProps getUsers />` in place of its ENTIRE default row
 * (leading view, `AutoCompleteInput`, trailing/send-button view) — nothing else
 * about `<MessageComposer />` changes. `Input` is declared on
 * `OptionalComponentOverrides` (contexts/componentsContext/defaultComponents.ts)
 * with no default implementation, so `WithComponents overrides={{ Input: Composer }}`
 * (the same seam `MessageText` already uses) is the smallest override that replaces
 * the visible input while everything upstream of it — `<MessageList/>`'s own kit
 * `TypingIndicator`, the crisis webhook, read state — is untouched.
 *
 * We keep the kit's own composer state so typing/send/crisis behaviour matches
 * today exactly:
 *  - text lives on `useMessageComposer().textComposer` (a `StateStore`) — read via
 *    `useStateStore` (same pattern as the kit's own `AutoCompleteInput`), written
 *    via `textComposer.handleChange({ text, selection })` — the exact call the
 *    kit's input makes on every keystroke, which is what fires the typing
 *    keystroke event. (`textComposer.setText` — used by `StarterSeed` in
 *    ChatScreen.tsx — is the silent, no-typing-event variant, deliberately used
 *    for programmatic seeds and here for the pre-send trim.)
 *  - `useMessageInputContext().sendMessage` is the same async function the kit's
 *    own `SendButton` calls; awaiting it drives the `sending` spinner below. The
 *    kit exposes no separate "is sending" flag — this component's local state IS
 *    that signal.
 *
 * The kit's outer `<MessageComposer/>` wrapper still paints its own border/
 * background and top padding (`theme.messageComposer.wrapper`) around whatever
 * `Input` renders, and separately applies a bottom safe-area inset — both screens
 * neutralise the border/background/top-padding via their `streamTheme` and leave
 * the safe-area bottom padding alone, so this component does not double it.
 */
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, TextInput, View } from 'react-native';
import type { TextComposerState } from 'stream-chat';
import { useMessageComposer, useMessageInputContext, useStateStore } from 'stream-chat-expo';

import { EdgeSurface } from '@/components/EdgeSurface';
import { PressKey } from '@/components/motion/PressKey';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space, type as typeTokens } from '@/theme/tokens';

const FIELD_RADIUS = radius.lg; // 22
const SEND_SIZE = 44;
const INPUT_VERTICAL_PADDING = space.sm; // 8 top + 8 bottom inside the field
const MAX_LINES = 4;
const MAX_INPUT_HEIGHT = MAX_LINES * typeTokens.body.lineHeight + INPUT_VERTICAL_PADDING * 2;

const textComposerStateSelector = (state: TextComposerState) => ({ text: state.text });

export function Composer() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const messageComposer = useMessageComposer();
  const { textComposer } = messageComposer;
  const { text } = useStateStore(textComposer.state, textComposerStateSelector);
  const { sendMessage } = useMessageInputContext();
  const [sending, setSending] = useState(false);

  const trimmed = text.trim();
  const isEmpty = trimmed.length === 0;

  const onChangeText = useCallback(
    (next: string) => {
      // Mirrors the kit's own AutoCompleteInput onChangeText handler exactly (cursor
      // pinned to the end) so typing keeps firing the kit's keystroke/typing event.
      textComposer.handleChange({ text: next, selection: { start: next.length, end: next.length } });
    },
    [textComposer],
  );

  const handleSend = useCallback(async () => {
    if (!trimmed || sending) return;
    // Whitespace never sends: trim before compose picks the text up. setText is the
    // silent variant (no typing event) — appropriate immediately before a send.
    if (trimmed !== text) textComposer.setText(trimmed);
    setSending(true);
    try {
      await sendMessage();
    } catch {
      // sendMessage already reports failures via the kit's notification system and
      // restores the draft on failure — nothing further to do here.
    } finally {
      setSending(false);
    }
  }, [trimmed, sending, text, textComposer, sendMessage]);

  return (
    <View style={styles.row}>
      <EdgeSurface
        edge={colors.edgeSurface}
        radius={FIELD_RADIUS}
        style={[styles.field, { backgroundColor: colors.surface }]}
        containerStyle={styles.fieldContainer}
      >
        <TextInput
          value={text}
          onChangeText={onChangeText}
          placeholder={t('chat.placeholder')}
          placeholderTextColor={colors.inkMuted}
          multiline
          maxFontSizeMultiplier={1.3}
          style={[typeTokens.body, styles.input, { color: colors.ink, maxHeight: MAX_INPUT_HEIGHT }]}
          testID="composer-input"
          accessibilityLabel={t('chat.placeholder')}
        />
      </EdgeSurface>
      <PressKey
        onPress={() => void handleSend()}
        edge={colors.accentEdge}
        disabled={isEmpty || sending}
        radius={SEND_SIZE / 2}
        style={[styles.send, { backgroundColor: colors.accent }]}
        accessibilityLabel={t('chat.send')}
        testID="composer-send"
      >
        {sending ? (
          <ActivityIndicator size="small" color={colors.onAccent} />
        ) : (
          <Ionicons name="arrow-up" size={20} color={colors.onAccent} />
        )}
      </PressKey>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.sm,
    paddingHorizontal: 10,
    paddingTop: space.sm,
    paddingBottom: 12,
  },
  fieldContainer: { flex: 1 },
  field: {
    minHeight: 44,
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
  input: {
    paddingVertical: INPUT_VERTICAL_PADDING,
    margin: 0,
  },
  send: {
    width: SEND_SIZE,
    height: SEND_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
