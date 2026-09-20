/**
 * Bubble — one message's pillow, board A05, drawn the SAME way on both platforms.
 *
 * The member's words sit on the companion accent with its tail bottom-right and an accent
 * pillow edge; the mentor's on white with a hairline rim, its tail bottom-left. 22px corners,
 * 8px on the tail, 14 × 10 of padding, at most 80% of the column.
 *
 * ## Why this is its own component
 *
 * The web thread draws itself (components/chat/ThreadRow.tsx) while the native thread hands
 * the transcript to stream-chat-expo, so for months "the bubble" existed twice: ours, and
 * the kit's re-skinned through its theme. They drifted, invisibly, because no test drives a
 * native chat — the founder's phone found an avatar gutter, a fixed 256px cap, bubbles in the
 * kit's default blue with white words on them, and finally text clipping out of an unpadded
 * bubble, one screenshot at a time (20 Sep). ThreadRow renders this on web and
 * components/chat/MentoBubble.tsx renders it inside the kit on native, so there is now one
 * bubble, and the browser specs that exercise ThreadRow exercise the phone's bubble too.
 *
 * Presentational only: no message plumbing, no press behaviour. The caller supplies both —
 * ThreadRow wraps it in a PressKey, MentoBubble in the kit's own press handling.
 */
import { ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { EdgeSurface } from '@/components/EdgeSurface';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, type } from '@/theme/tokens';

/** The board's bubble padding. */
export const BUBBLE_PAD_X = 14;
export const BUBBLE_PAD_Y = 10;
/** The share of the column a bubble may take. */
export const BUBBLE_SHARE = '80%';

/** The face's colours and tail, for a caller that draws its own surface (a PressKey, or
 * the kit's own bubble view) instead of using <Bubble>. */
export function bubbleFace(mine: boolean, colors: ReturnType<typeof useTheme>['colors']) {
  return {
    backgroundColor: mine ? colors.accent : colors.surface,
    textColor: mine ? colors.onAccent : colors.ink,
    edge: mine ? colors.accentEdge : colors.edgeSurface,
    tail: mine
      ? ({ borderBottomRightRadius: radius.sm } as const)
      : ({ borderBottomLeftRadius: radius.sm } as const),
  };
}

export function Bubble({
  mine,
  text,
  children,
  containerStyle,
  testID,
}: {
  mine: boolean;
  text: string;
  /** Anything that sits inside the pillow under the words (nothing, today). */
  children?: ReactNode;
  containerStyle?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const { colors } = useTheme();
  const face = bubbleFace(mine, colors);
  return (
    <EdgeSurface
      edge={face.edge}
      travel={3}
      radius={radius.lg}
      faceRadiusStyle={face.tail}
      style={[
        styles.bubble,
        { backgroundColor: face.backgroundColor },
        mine ? null : { borderWidth: 1, borderColor: colors.border },
      ]}
      containerStyle={[styles.wrap, containerStyle]}
      testID={testID}
    >
      <BubbleText mine={mine} text={text} />
      {children}
    </EdgeSurface>
  );
}

/** The words themselves. `maxFontSizeMultiplier` caps OS font scaling the way the native
 * path always did (the kit's MessageText) — without it a large system font breaks the
 * bubble on a phone. */
export function BubbleText({ mine, text }: { mine: boolean; text: string }) {
  const { colors } = useTheme();
  return (
    <Text style={[type.body, { color: mine ? colors.onAccent : colors.ink }]} maxFontSizeMultiplier={1.3}>
      {text}
    </Text>
  );
}

const styles = StyleSheet.create({
  bubble: { paddingHorizontal: BUBBLE_PAD_X, paddingVertical: BUBBLE_PAD_Y },
  wrap: { maxWidth: BUBBLE_SHARE, flexShrink: 1 },
});
