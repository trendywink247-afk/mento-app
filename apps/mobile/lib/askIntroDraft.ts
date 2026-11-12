/**
 * The "what would you like to talk about?" box before an ask (components/AskIntroBox). Pure, so a
 * node test can hold it to its rules: prefilled with the member's own draft or the plain line,
 * never sent empty, never longer than the server takes (ASK_INTRO_MAX), nothing cut for them.
 */
import { ASK_INTRO_MAX } from './startChat';

export type IntroDraft = { left: number; canSend: boolean; tooLong: boolean };

/** What the box starts with: the member's own drafted question when it fits, else the plain line. */
export function initialIntro(drafted: string | null | undefined, fallback: string): string {
  const own = (drafted ?? '').trim();
  return own && own.length <= ASK_INTRO_MAX ? own : fallback;
}

/** Characters left, and whether Send is allowed: something to say, within the server's limit. */
export function introDraft(text: string): IntroDraft {
  const length = text.trim().length;
  const tooLong = length > ASK_INTRO_MAX;
  return { left: ASK_INTRO_MAX - length, canSend: length > 0 && !tooLong, tooLong };
}
