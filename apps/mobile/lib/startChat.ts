/**
 * "Next available", for every door that offers it (DECISIONS §N.2).
 *
 * Life in general connects at once (`POST /match`). An exam road waits for a mentor's accept:
 * the server refuses the instant match with 409 `accept_required`, and the question goes to the
 * best online mentor through `POST /match/ask` instead. The server is the authority on which
 * is which — the app never guesses from the member's road, so an old cached Path cannot send
 * the wrong call, and a build from before this rule still gets a clean answer.
 *
 * The intro is the member's own words when they fit the server's 160 characters. A door with no
 * words of its own passes `askFor`, which shows the member an editable box (prefilled with the
 * plain line) before anything is sent; only a caller without it falls back to the server's line.
 * Nothing is cut mid-sentence on the member's behalf.
 */
import type { useRouter } from 'expo-router';

import { ApiError, api, type Audience, type MatchResult, type PersonalRequest } from '@/lib/api';
import { requestLetter } from '@/lib/requestLetter';

export const ASK_INTRO_MAX = 160;

export type Started =
  | { kind: 'chat'; match: MatchResult }
  | { kind: 'ask'; request: PersonalRequest }
  /** The member closed the "what would you like to talk about?" box: nothing was sent. */
  | { kind: 'cancelled' };

/** Asks the member for their own words before an ask goes out (components/AskIntroBox).
 * Resolves the text to send, or null when they cancel. */
export type AskForIntro = () => Promise<string | null>;

export const acceptRequired = (e: unknown): boolean =>
  e instanceof ApiError && e.status === 409 && e.code === 'accept_required';

export function askIntro(text: string | undefined | null): string | null {
  const t = (text ?? '').trim();
  return t && t.length <= ASK_INTRO_MAX ? t : null;
}

type Client = Pick<typeof api, 'match' | 'ask'>;

export async function matchOrAsk(
  body: { issue_category?: string | null; audience?: Audience },
  intro?: string | null,
  client: Client = api,
  askFor?: AskForIntro,
): Promise<Started> {
  // The audience matters only to an ask; the instant match has no such choice.
  const { audience, ...matchBody } = body;
  try {
    return { kind: 'chat', match: await client.match({ kind: 'general', ...matchBody }) };
  } catch (e) {
    if (!acceptRequired(e)) throw e;
    // An ask is a question in the member's own words: when the door has none yet, the member
    // writes (or keeps) it now. Life in general never reaches here, so it never sees the box.
    let words = intro;
    if (askIntro(words) === null && askFor) {
      const written = await askFor();
      if (written === null) return { kind: 'cancelled' };
      words = written;
    }
    return {
      kind: 'ask',
      request: await client.ask({ issue_category: body.issue_category ?? null, intro_message: askIntro(words), audience: audience ?? 'any' }),
    };
  }
}

/** The waiting letter for a question the member just sent (board A04). `replace`: back from
 * the letter never returns to a sheet or form that has done its job. */
export function openAsked(router: ReturnType<typeof useRouter>, request: PersonalRequest): void {
  requestLetter.put({ request, mentor: null });
  router.replace({ pathname: '/request-sent/[id]', params: { id: request.id } });
}
