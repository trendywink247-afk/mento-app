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
 *
 * The visible row (EdgeSurface field + PressKey send) lives in the presentational
 * components/chat/ComposerField.tsx, shared with the two hand-rolled web
 * composers — this file supplies only the kit-specific text/send wiring above.
 */
import { useCallback, useState } from 'react';
import type { TextComposerState } from 'stream-chat';
import { useMessageComposer, useMessageInputContext, useStateStore } from 'stream-chat-expo';

import { ComposerField } from '@/components/chat/ComposerField';
import { useI18n } from '@/lib/i18n';

const textComposerStateSelector = (state: TextComposerState) => ({ text: state.text });

export function Composer() {
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
      // The kit already clears the composer optimistically before this promise
      // settles; on failure the optimistic message stays in the transcript as a
      // retryable failed bubble (the kit's own error/retry affordance) — nothing
      // further to do here.
    } finally {
      setSending(false);
    }
  }, [trimmed, sending, text, textComposer, sendMessage]);

  return (
    <ComposerField
      value={text}
      onChangeText={onChangeText}
      onSubmit={() => void handleSend()}
      disabled={isEmpty || sending}
      sending={sending}
      placeholder={t('chat.placeholder')}
      testIDPrefix="composer"
    />
  );
}
