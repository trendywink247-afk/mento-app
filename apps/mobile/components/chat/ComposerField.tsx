/**
 * Presentational pillow-key composer (board A05 footer): a hairline-topped oat footer
 * holding whatever the screen puts above the row (the allowance meter, or the
 * three-in-a-row note), then a 52px pillow field beside a 52px accent send key. Shared by the native kit override
 * (components/chat/Composer.tsx, which supplies the kit's own composer state) and
 * both hand-rolled web composers (components/chat/ChatScreen.web.tsx,
 * components/mentor/MentorChatScreen.web.tsx, which supply local `useState`
 * drafts). This component owns no message/send state of its own — callers keep
 * their own text state and guard/async logic and just hand it primitives.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';

import { EdgeSurface } from '@/components/EdgeSurface';
import { PressKey } from '@/components/motion/PressKey';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space, type as typeTokens } from '@/theme/tokens';

const FIELD_RADIUS = radius.md; // 14
const FIELD_HEIGHT = 52;
const SEND_SIZE = 52;
const INPUT_VERTICAL_PADDING = 14; // (52 − one 24px line) / 2
/** The field grows with its words up to this many lines, then scrolls inside (board A05's
 * composer): a pre-filled two-line starter from the question builder is never clipped. */
const MAX_LINES = 5;
const LINE = typeTokens.body.lineHeight; // 24
const INPUT_PAD = INPUT_VERTICAL_PADDING - 1; // the field's 1px border
const MAX_INPUT_HEIGHT = MAX_LINES * LINE + INPUT_VERTICAL_PADDING * 2;

/** Something small that sits ON the field's top edge, at its right end — the member chat's
 * companion (components/art/PerchedCompanion.tsx). Provided by the member chat screens only;
 * the mentor console never provides one (no animals there), so it renders nothing. A context
 * rather than a prop because on native the kit mounts the composer itself. */
export const ComposerPerchContext = createContext<ReactNode>(null);

/** What the member chat adds to the footer (boards A05 / A22). A context, like the perch,
 * because on native the kit mounts the composer itself.
 *  - `above`: the allowance meter row, or the three-in-a-row note + the Journal key;
 *  - `held`: the allowance asks for a pause — the send key goes quiet (never red, no
 *    haptic, no travel) while the FIELD STAYS LIVE so the draft is never lost;
 *  - `heldA11y`: what the quiet key says to a screen reader. */
export type ComposerChrome = { above?: ReactNode; held?: boolean; heldA11y?: string };
export const ComposerChromeContext = createContext<ComposerChrome>({});

type Props = {
  value: string;
  onChangeText: (text: string) => void;
  /** Fires on a send-button press AND (when the caller wires `onKeyPress`) on
   * Enter — the caller's own function owns trimming/guards/async/error handling. */
  onSubmit: () => void;
  /** Nothing to send (empty text, or a send already in flight): the key stays drawn live
   * (board A05) but presses silently; `sending` is what actually locks it. */
  disabled: boolean;
  /** Swaps the send icon for a calm spinner; does not by itself disable the field. */
  sending: boolean;
  placeholder: string;
  /** testIDs become `${testIDPrefix}-input` / `${testIDPrefix}-send`. */
  testIDPrefix: string;
  /** Web-only Enter-to-send / Shift+Enter-newline wiring. Omitted on native, where
   * the OS keyboard's Enter already inserts a newline and the button is the only
   * way to send. */
  onKeyPress?: TextInputProps['onKeyPress'];
  /** Open with the field focused and the caret at the END of whatever it holds — the
   * first-question builder's "Edit in chat" (app/path-question.tsx). Focus only: it
   * never sends anything. */
  autoFocus?: boolean;
};

export function ComposerField({
  value,
  onChangeText,
  onSubmit,
  disabled,
  sending,
  placeholder,
  testIDPrefix,
  onKeyPress,
  autoFocus = false,
}: Props) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const caretPlaced = useRef(false);
  const perch = useContext(ComposerPerchContext);
  const chrome = useContext(ComposerChromeContext);
  const held = chrome.held === true;
  // T6.2 regression hunt (2026-10-01): on native, tapping the send key leaves zero
  // trace anywhere — not even Composer.tsx's own unconditional entry log. One of the
  // two things that could silently swallow a tap with no trace is this branch: the
  // "held" view (allowance paused) has no onPress at all, by design. Logged once per
  // change, not every render, so the next run tells us whether held is unexpectedly
  // true from the very first fresh conversation.
  useEffect(() => {
    console.log(`[ComposerField] testIDPrefix=${testIDPrefix} held=${held} disabled=${disabled}`);
  }, [held, testIDPrefix, disabled]);
  // Web only: react-native-web's <textarea> never grows by itself (it is pinned to one row
  // below), so an invisible twin of the words measures the wrapped height and the field is
  // sized from it — one line to MAX_LINES. It shrinks again as words are deleted. Native
  // multiline inputs grow on their own up to `maxHeight`.
  const [webLines, setWebLines] = useState(1);
  const webHeight = Math.min(MAX_LINES, Math.max(1, webLines)) * LINE + INPUT_PAD * 2;

  // A browser focuses a pre-filled textarea with the caret at the START; typing would
  // then land in front of the draft. Native already puts it at the end. Once only, so
  // it never fights the member's own caret afterwards.
  const placeCaretAtEnd: TextInputProps['onFocus'] = (e) => {
    if (Platform.OS !== 'web' || caretPlaced.current) return;
    caretPlaced.current = true;
    // reason: on react-native-web the focus event's target is the DOM <textarea>; RN's
    // event type only knows a native node handle.
    const el = e.target as unknown as { setSelectionRange?: (start: number, end: number) => void };
    el.setSelectionRange?.(value.length, value.length);
  };

  return (
    // The footer is the furniture: the companion's perch is its absolutely-positioned child.
    <View style={[styles.footer, { borderTopColor: colors.border }]}>
      {perch}
      {chrome.above}
      <View style={styles.row}>
        <EdgeSurface
          edge={colors.edgeSurface}
          travel={4}
          radius={FIELD_RADIUS}
          style={[styles.field, { backgroundColor: colors.surface, borderColor: colors.border }]}
          containerStyle={styles.fieldContainer}
        >
          {Platform.OS === 'web' ? (
            <Text
              aria-hidden
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              onLayout={(e) => setWebLines(Math.round(e.nativeEvent.layout.height / LINE))}
              style={[typeTokens.body, styles.mirror]}
            >
              {/* A zero-width tail so a trailing newline still counts as a line. */}
              {`${value}​`}
            </Text>
          ) : null}
          <TextInput
            value={value}
            onChangeText={onChangeText}
            onKeyPress={onKeyPress}
            autoFocus={autoFocus}
            onFocus={autoFocus ? placeCaretAtEnd : undefined}
            placeholder={placeholder}
            placeholderTextColor={colors.inkMuted}
            multiline
            // Web only: react-native-web's textarea opens two rows high and the field
            // outgrows the board's 52 (`numberOfLines` is its `rows`). Native sizes itself;
            // on Android the same prop would pin the field to one line for good.
            {...(Platform.OS === 'web' ? { numberOfLines: 1 } : null)}
            maxFontSizeMultiplier={1.3}
            style={[
              typeTokens.body,
              styles.input,
              { color: colors.ink, maxHeight: MAX_INPUT_HEIGHT },
              Platform.OS === 'web' ? { height: webHeight } : null,
            ]}
            testID={`${testIDPrefix}-input`}
            accessibilityLabel={placeholder}
          />
        </EdgeSurface>
        {held ? (
          // Quietly unavailable: no edge, no travel, no haptic — and never red (T&S #11).
          <View
            accessibilityRole="button"
            accessibilityState={{ disabled: true }}
            accessibilityLabel={chrome.heldA11y ?? t('chat.send')}
            aria-disabled
            testID={`${testIDPrefix}-send`}
            style={[styles.send, styles.sendHeld, { backgroundColor: colors.heldFace, borderColor: colors.borderStrong }]}
          >
            <Ionicons name="paper-plane-outline" size={22} color={colors.heldInk} />
          </View>
        ) : (
          <PressKey
            onPress={onSubmit}
            edge={colors.accentEdge}
            intent="commit"
            // Drawn live even over an empty field (board A05); an empty press is a no-op in
            // every caller, so it stays silent too.
            haptic={disabled ? 'none' : 'impact'}
            disabled={sending}
            radius={SEND_SIZE / 2}
            style={[styles.send, { backgroundColor: colors.accent }]}
            accessibilityLabel={t('chat.send')}
            testID={`${testIDPrefix}-send`}
          >
            {sending ? (
              <ActivityIndicator size="small" color={colors.onAccent} />
            ) : (
              <Ionicons name="paper-plane-outline" size={22} color={colors.onAccent} />
            )}
          </PressKey>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Board: padding 8 / 16 / 28 under a hairline. On native the kit (or the screen's
  // SafeAreaView) already adds the bottom inset, so only the web frame carries the 28.
  footer: {
    borderTopWidth: 1,
    paddingHorizontal: space.md,
    paddingTop: space.sm,
    paddingBottom: Platform.OS === 'web' ? 28 : 12,
    gap: space.sm,
  },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  fieldContainer: { flex: 1 },
  field: {
    minHeight: FIELD_HEIGHT,
    paddingHorizontal: space.md,
    justifyContent: 'center',
    borderWidth: 1,
  },
  input: {
    paddingVertical: INPUT_PAD,
    margin: 0,
  },
  // The web twin: same words, same type, same width as the input, never seen or read.
  mirror: { position: 'absolute', left: space.md, right: space.md, top: 0, opacity: 0, pointerEvents: 'none' },
  send: {
    width: SEND_SIZE,
    height: SEND_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // No edge beneath it: lifted by the field's travel so the two tops stay level.
  sendHeld: { borderRadius: SEND_SIZE / 2, borderWidth: 1, marginBottom: 4 },
});
