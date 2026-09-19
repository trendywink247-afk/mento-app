import { StyleSheet, Text } from 'react-native';
import { useMessageContext } from 'stream-chat-expo';

import { useTheme } from '@/theme/ThemeProvider';
import { type as typeTokens } from '@/theme/tokens';

type Props = {
  message?: { text?: string };
  onlyEmojis?: boolean;
};

/** The native mentor chat's message text (board A35): the mentor's own bubbles are the
 * accent with white text, the member's white with ink. Same explicit Baloo metrics as
 * components/chat/MessageText.tsx (the Android measure/draw fix) — only the colour
 * follows the side. */
export function MentorMessageText({ message, onlyEmojis }: Props) {
  const { colors } = useTheme();
  const { isMyMessage } = useMessageContext();
  if (!message?.text) return null;
  return (
    <Text
      style={[styles.text, { color: isMyMessage ? colors.onAccent : colors.ink }, onlyEmojis ? styles.emoji : null]}
      maxFontSizeMultiplier={1.3}
      testID="message-text"
    >
      {message.text}
    </Text>
  );
}

const styles = StyleSheet.create({
  text: { ...typeTokens.body },
  emoji: { fontSize: 40, lineHeight: 48 },
});
