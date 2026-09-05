/**
 * Message body for the native chat kit (member chat + mentor chat).
 *
 * Two reasons to own this instead of the kit's markdown renderer:
 *  1. DECISIONS §K.6 — one type family, Baloo 2. The kit's default text is the system
 *     font, so bubbles were the one place the app broke its own type system.
 *  2. Android new-architecture measure/draw mismatch (device finding, session 31f;
 *     React Native #52895): the kit's text was measured with one typeface/scale and
 *     drawn with a wider one, so the last word ("…are you |doing|") or even the last
 *     letter ("Hell|o|") fell outside the bubble's overflow:hidden box. Explicit
 *     family / size / lineHeight give the measure and draw passes identical metrics.
 *
 * Plain text only — Mento chat is text + emoji (SCOPE §3), no markdown. Press and
 * long-press stay on the kit's message container (that is where "Save to Mentor
 * Notes" lives), so this component renders text and nothing else.
 */
import { StyleSheet, Text } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';
import { type as typeTokens } from '@/theme/tokens';

type Props = {
  message?: { text?: string };
  onlyEmojis?: boolean;
};

export function MessageText({ message, onlyEmojis }: Props) {
  const { colors } = useTheme();
  if (!message?.text) return null;
  return (
    <Text
      style={[styles.text, { color: colors.ink }, onlyEmojis ? styles.emoji : null]}
      maxFontSizeMultiplier={1.3}
      testID="message-text"
    >
      {message.text}
    </Text>
  );
}

const styles = StyleSheet.create({
  text: { ...typeTokens.body },
  // Emoji-only messages read as a reaction: bigger, still on the same line grid.
  emoji: { fontSize: 40, lineHeight: 48 },
});
