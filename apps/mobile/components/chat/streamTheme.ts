/**
 * The Stream kit's theme for the member's native thread, as two pure functions so the
 * bubble's colours can be asserted without a device (`npm run test:bubble`).
 *
 * Board A05: the mentor's words on a white pillow with a hairline rim, the member's on the
 * companion accent with white words, 22px corners with an 8px tail, a pillow edge along the
 * bottom of each bubble.
 *
 * ## Why the accent is set twice
 *
 * stream-chat-react-native-core 9.3.0 `mergeThemes` (contexts/themeContext/ThemeContext.tsx)
 * builds its result as `{...baseTheme, semantics}` — it RECOMPUTES `semantics` from its own
 * light/dark tokens and overwrites whatever the theme being merged had. At `<Chat style>`
 * that is harmless, because our style is merged in afterwards. But `MessageList` re-merges
 * for the member's OWN messages (`mergeThemes({style: myMessageTheme, theme})`), and
 * `myMessageTheme` carries no semantics — so every message the member sent lost our
 * semantics and fell back to the kit's `chatBgOutgoing`, `#e3edff`. With our white bubble
 * text over it, the member could barely read their own words (founder's phone, 20 Sep).
 *
 * So the own-bubble colour is stated two ways:
 *   1. `semantics` INSIDE `myMessageTheme`, so the re-merge keeps it (and the kit's other
 *      surfaces — reply previews, a deleted message — stay on our palette), and
 *   2. `containerInner.backgroundColor`, which MessageContent applies AFTER the
 *      semantics-derived `backgroundColor` in its style array, so it wins either way.
 */
/** The two corner radii the bubble uses, passed in rather than imported so this module
 * stays free of imports and can be compiled and run as a plain Node test. */
export type BubbleRadii = { lg: number; sm: number };

/** The colours this theme needs — the slice of `useTheme().colors` it reads. */
export type BubbleColors = {
  accent: string;
  accentEdge: string;
  onAccent: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  edgeSurface: string;
  ink: string;
  inkMuted: string;
};

/** The pillow edge under a bubble: a thicker bottom border, because the kit's bubble
 * clips its own overflow. */
export const BUBBLE_EDGE = 3;

/** The bubble's padding, board A05 (components/chat/ThreadRow.tsx's `bubble`). */
export const BUBBLE_PAD_X = 14;
export const BUBBLE_PAD_Y = 10;

/** The kit theme for the thread as a whole — the mentor's bubbles and everything around
 * them. `bubbleMax` caps the text container (see components/chat/bubbleWidth.ts). */
export function buildStreamTheme(c: BubbleColors, bubbleMax: number, radius: BubbleRadii) {
  return {
    semantics: {
      accentPrimary: c.accent,
      // The thread lies on the one sky (components/motion/SkyGround.tsx).
      backgroundCoreApp: 'transparent',
      chatBgIncoming: c.surface,
      chatTextIncoming: c.ink,
      chatBgOutgoing: c.accent,
      chatTextOutgoing: c.onAccent,
      chatTextTimestamp: c.inkMuted,
      buttonPrimaryBg: c.accent,
    },
    messageItemView: {
      content: {
        // The kit reads the corner radii off `container` and lays them over its own.
        container: {
          borderTopLeftRadius: radius.lg,
          borderTopRightRadius: radius.lg,
          borderBottomRightRadius: radius.lg,
          borderBottomLeftRadius: radius.sm,
        },
        containerInner: {
          backgroundColor: c.surface,
          borderWidth: 1,
          borderColor: c.border,
          borderBottomWidth: 1 + BUBBLE_EDGE,
          borderBottomColor: c.edgeSurface,
        },
        // The bubble's own padding, board A05: 14 across, 10 down (ThreadRow's `bubble`).
        // The kit pads with its own spacing tokens, which drew a thinner, pill-like bubble.
        contentContainer: {
          gap: 0,
          paddingHorizontal: BUBBLE_PAD_X,
          paddingTop: BUBBLE_PAD_Y,
          paddingBottom: BUBBLE_PAD_Y,
        },
        // The kit's own `maxWidth: 256` is a fixed number, not a share of the screen; its
        // `paddingHorizontal` is dropped so the bubble is padded once, by contentContainer.
        textContainer: { maxWidth: bubbleMax, paddingHorizontal: 0 },
      },
    },
  };
}

/** The member's own bubbles: the tail moves to the bottom-right, the pillow edge goes
 * accent, and the accent is restated (see the header). */
export function buildMyMessageTheme(c: BubbleColors, radius: BubbleRadii) {
  return {
    semantics: {
      chatBgOutgoing: c.accent,
      chatTextOutgoing: c.onAccent,
    },
    messageItemView: {
      content: {
        container: { borderBottomRightRadius: radius.sm, borderBottomLeftRadius: radius.lg },
        containerInner: {
          backgroundColor: c.accent,
          borderWidth: 0,
          borderBottomWidth: BUBBLE_EDGE,
          borderBottomColor: c.accentEdge,
        },
      },
    },
  };
}
