/**
 * The ask loop (founder board review 2026-09-20). Wherever the member learns that nobody is
 * free — the connecting step (A19), the New chat sheet's own busy card (A24), the
 * first-question builder's busy card (A27) — "Send your question instead" takes the SAME
 * road, so the app only ever teaches one:
 *
 *   A24 New chat (over My Chats) → "Pick a mentor" → A25 Browse → /mentor/<id> →
 *   the question step → A04 the letter → "Go to My Chats" → the waiting row.
 *
 * A question the member has already drafted travels with them (`question`) and is never
 * sent on their behalf — it arrives in the question step's field, theirs to change.
 */
import type { Router } from 'expo-router';

export type AskLoopParams = {
  /** A draft the member already wrote (the first-question builder). */
  question?: string | null;
  /** The topic they had already chosen, if any. */
  topic?: string | null;
  /** Opens the sheet with the still "nobody is free" card already on it. */
  busy?: boolean;
};

function sheetParams({ question, topic, busy }: AskLoopParams): Record<string, string> {
  return {
    ...(question ? { question } : {}),
    ...(topic ? { topic } : {}),
    ...(busy ? { busy: '1' } : {}),
  };
}

/**
 * Open the New chat sheet over My Chats from inside the app (a screen that is itself a
 * stop on the way, like the builder): the screen leaves first so hardware back from the
 * sheet lands on My Chats.
 */
export function openNewChat(router: Router, params: AskLoopParams = {}): void {
  router.dismissTo('/chats');
  router.push({ pathname: '/new-chat', params: sheetParams(params) });
}

/**
 * The same door from the onboarding journey, where there is no stack to dismiss to yet:
 * the landing is replaced by My Chats so the app's home sits under the sheet.
 */
export function enterNewChat(router: Router, params: AskLoopParams = {}): void {
  router.dismissAll();
  router.replace('/chats');
  router.push({ pathname: '/new-chat', params: sheetParams(params) });
}
