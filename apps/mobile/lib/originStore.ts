/**
 * originStore — "things come from where you touched" (board T90, principle 3).
 *
 * A surface that is about to open measures the thing that was tapped and leaves its window
 * rect here, keyed by what is opening. The next screen takes that rect (once) and starts its
 * matching element there instead of dropping it in from nowhere: T05 (the mentor's face flies
 * from the My Chats row into the chat header) and T06 (the profile hero grows out of the
 * header's avatar).
 *
 * Deliberately tiny and deliberately forgetful: one rect per key, taken exactly once, and
 * stale after ORIGIN_TTL_MS so a rect left behind by an abandoned tap can never fire a
 * hand-over on some later, unrelated arrival (the same lesson as lib/pendingOption.ts —
 * anything module-level must be keyed and short-lived).
 */
export type OriginRect = { x: number; y: number; width: number; height: number };

/** A rect older than this is not a hand-over any more — the arrival simply fades in. */
export const ORIGIN_TTL_MS = 1200;

const rects = new Map<string, { rect: OriginRect; at: number }>();

/** The chat header's avatar, flying from the row that was tapped (T05). */
export const chatFaceKey = (conversationId: string) => `chat-face:${conversationId}`;
/** The mentor profile's hero, growing from the chat header's avatar (T06). */
export const mentorHeroKey = (conversationId: string) => `mentor-hero:${conversationId}`;

/**
 * Measure a host view's window rect, on either platform. On web a ref IS the DOM node, and
 * `getBoundingClientRect` answers on the spot — which matters: react-native-web's own
 * `measureInWindow` defers by a macrotask, long enough for the next screen to have looked
 * for its origin and found nothing.
 */
type Measurable = {
  getBoundingClientRect?: () => { x: number; y: number; width: number; height: number };
  measureInWindow?: (cb: (x: number, y: number, width: number, height: number) => void) => void;
};

export function measureRect(node: unknown, then: (rect: OriginRect) => void): void {
  const target = node as Measurable | null;
  if (!target) return;
  if (typeof target.getBoundingClientRect === 'function') {
    const r = target.getBoundingClientRect();
    then({ x: r.x, y: r.y, width: r.width, height: r.height });
    return;
  }
  target.measureInWindow?.((x, y, width, height) => then({ x, y, width, height }));
}

export function rememberOrigin(key: string, rect: OriginRect): void {
  if (!key || rect.width <= 0 || rect.height <= 0) return;
  rects.set(key, { rect, at: Date.now() });
}

/** Read and forget. Returns null when there is nothing, or nothing fresh. */
export function takeOrigin(key: string): OriginRect | null {
  const held = rects.get(key);
  if (!held) return null;
  rects.delete(key);
  return Date.now() - held.at > ORIGIN_TTL_MS ? null : held.rect;
}

/** Clears everything — for a full reset, and for tests. */
export function forgetOrigins(): void {
  rects.clear();
}
