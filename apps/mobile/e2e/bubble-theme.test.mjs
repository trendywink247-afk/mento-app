// Run: npm run test:bubble
//  (= tsc components/chat/streamTheme.ts --outDir .tmp-bubble --module es2020 --target es2020 --skipLibCheck && node e2e/bubble-theme.test.mjs)
// NOT a browser spec: a Node unit test of the NATIVE thread's kit theme
// (components/chat/streamTheme.ts). No e2e spec drives a native chat — every browser spec
// runs the hand-rolled web thread — so this is the only automatic guard on the phone's
// bubbles, and it exists because the kit silently painted the member's own bubbles its
// default blue for weeks (see streamTheme.ts's header for the mechanism).
import assert from 'node:assert/strict';

import {
  BUBBLE_EDGE,
  BUBBLE_PAD_X,
  BUBBLE_PAD_Y,
  buildMyMessageTheme,
  buildStreamTheme,
} from '../.tmp-bubble/streamTheme.js';

/** Clay and Sage, terracotta companion (theme/tokens.ts + theme/companion.ts). */
const C = {
  accent: '#A2533A',
  accentEdge: '#7E3F2B',
  onAccent: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceAlt: '#F7F3EA',
  border: '#E6DFD3',
  edgeSurface: '#E2D9CB',
  ink: '#2B2B2B',
  inkMuted: '#5E5A53',
};
const R = { lg: 22, sm: 8 };
/** The kit's own outgoing bubble, stream-chat-react-native-core 9.3.0
 * (theme/generated/light/StreamTokens: chatBgOutgoing = brand100 = blue100). */
const KIT_BLUE = '#e3edff';

const theme = buildStreamTheme(C, 300, R);
const mine = buildMyMessageTheme(C, R);

// --- the member's own bubble is the companion accent, said BOTH ways ------------------
// The kit rebuilds `semantics` from its own tokens when it re-merges for own messages, so
// a theme that names the accent only once loses it. Both must carry it.
assert.equal(mine.semantics.chatBgOutgoing, C.accent, 'own bubble: semantics must name the accent');
assert.equal(
  mine.messageItemView.content.containerInner.backgroundColor,
  C.accent,
  'own bubble: containerInner must name the accent too — it is what survives the re-merge',
);
assert.notEqual(mine.semantics.chatBgOutgoing, KIT_BLUE);
assert.notEqual(mine.messageItemView.content.containerInner.backgroundColor, KIT_BLUE);

// White words on the accent, never on the kit's pale blue.
assert.equal(mine.semantics.chatTextOutgoing, C.onAccent);

// --- the mentor's bubble is the white pillow with its hairline rim ---------------------
assert.equal(theme.semantics.chatBgIncoming, C.surface);
assert.equal(theme.messageItemView.content.containerInner.backgroundColor, C.surface);
assert.equal(theme.messageItemView.content.containerInner.borderColor, C.border);

// --- board A05 geometry ---------------------------------------------------------------
const theirs = theme.messageItemView.content.container;
assert.equal(theirs.borderTopLeftRadius, R.lg);
assert.equal(theirs.borderTopRightRadius, R.lg);
assert.equal(theirs.borderBottomLeftRadius, R.sm, "the mentor's tail is bottom-left");
assert.equal(theirs.borderBottomRightRadius, R.lg);

const ours = mine.messageItemView.content.container;
assert.equal(ours.borderBottomRightRadius, R.sm, "the member's tail is bottom-right");
assert.equal(ours.borderBottomLeftRadius, R.lg);

// The pillow edge: a thicker bottom border, accent under our bubble, surface under theirs.
assert.equal(theme.messageItemView.content.containerInner.borderBottomWidth, 1 + BUBBLE_EDGE);
assert.equal(theme.messageItemView.content.containerInner.borderBottomColor, C.edgeSurface);
assert.equal(mine.messageItemView.content.containerInner.borderBottomWidth, BUBBLE_EDGE);
assert.equal(mine.messageItemView.content.containerInner.borderBottomColor, C.accentEdge);

// --- the bubble takes the board's share of the column, not the kit's fixed 256 ---------
assert.equal(theme.messageItemView.content.textContainer.maxWidth, 300);
assert.notEqual(theme.messageItemView.content.textContainer.maxWidth, 256);

// --- the bubble is padded once, by us, at the board's 14 / 10 --------------------------
const pad = theme.messageItemView.content.contentContainer;
assert.equal(pad.paddingHorizontal, BUBBLE_PAD_X);
assert.equal(pad.paddingTop, BUBBLE_PAD_Y);
assert.equal(pad.paddingBottom, BUBBLE_PAD_Y);
assert.equal(
  theme.messageItemView.content.textContainer.paddingHorizontal,
  0,
  'the kit must not pad the text as well, or the bubble is padded twice',
);

// The thread lies on the one sky.
assert.equal(theme.semantics.backgroundCoreApp, 'transparent');

console.log('BUBBLE THEME TEST PASSED');
