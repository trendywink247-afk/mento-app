/**
 * How wide a chat bubble may be on the NATIVE threads (both sides).
 *
 * The hand-rolled web thread draws a bubble at `maxWidth: '80%'` of the column
 * (components/chat/ThreadRow.tsx), which is what board A05 is drawn to. The Stream kit
 * instead caps its text container at a FIXED 256px
 * (stream-chat-react-native-core MessageTextContainer.tsx) — a number, not a share — so on
 * a phone its bubbles wrapped well before the board's did and the thread read narrower and
 * squatter than the design. Both native screens override that through the theme
 * (`messageItemView.content.textContainer`), from the frame's width.
 */
import { space } from '@/theme/tokens';

/** The share of the column a bubble may take — the web thread's 80%. */
export const BUBBLE_SHARE = 0.8;

/** The list's gutter plus the bubble's inner padding, taken off that share so the
 * bubble's OUTER width lands where the web one does. */
export const BUBBLE_INSET = 2 * space.md;

/** The kit's `textContainer.maxWidth` for a frame this wide. */
export function bubbleMaxWidth(frameWidth: number): number {
  return Math.round(frameWidth * BUBBLE_SHARE) - BUBBLE_INSET;
}
