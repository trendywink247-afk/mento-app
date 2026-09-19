/**
 * Presentational pillow-key composer row (spec §5.1/§5.2): an EdgeSurface pill
 * field beside a PressKey send circle. Shared by the native kit override
 * (components/chat/Composer.tsx, which supplies the kit's own composer state) and
 * both hand-rolled web composers (components/chat/ChatScreen.web.tsx,
 * components/mentor/MentorChatScreen.web.tsx, which supply local `useState`
 * drafts). This component owns no message/send state of its own — callers keep
 * their own text state and guard/async logic and just hand it primitives.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRef } from 'react';
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';

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

type Props = {
  value: string;
  onChangeText: (text: string) => void;
  /** Fires on a send-button press AND (when the caller wires `onKeyPress`) on
   * Enter — the caller's own function owns trimming/guards/async/error handling. */
  onSubmit: () => void;
  /** Send button not pressable + dimmed (empty text, or a send already in flight). */
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
    <View style={styles.row}>
      <EdgeSurface
        edge={colors.edgeSurface}
        radius={FIELD_RADIUS}
        style={[styles.field, { backgroundColor: colors.surface }]}
        containerStyle={styles.fieldContainer}
      >
        <TextInput
          value={value}
          onChangeText={onChangeText}
          onKeyPress={onKeyPress}
          autoFocus={autoFocus}
          onFocus={autoFocus ? placeCaretAtEnd : undefined}
          placeholder={placeholder}
          placeholderTextColor={colors.inkMuted}
          multiline
          maxFontSizeMultiplier={1.3}
          style={[typeTokens.body, styles.input, { color: colors.ink, maxHeight: MAX_INPUT_HEIGHT }]}
          testID={`${testIDPrefix}-input`}
          accessibilityLabel={placeholder}
        />
      </EdgeSurface>
      <PressKey
        onPress={onSubmit}
        edge={colors.accentEdge}
        disabled={disabled}
        radius={SEND_SIZE / 2}
        style={[styles.send, { backgroundColor: colors.accent }]}
        accessibilityLabel={t('chat.send')}
        testID={`${testIDPrefix}-send`}
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
