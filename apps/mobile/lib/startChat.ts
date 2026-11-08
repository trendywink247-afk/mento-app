/**
 * "Next available", for every door that offers it (DECISIONS §N.2).
 *
 * Life in general connects at once (`POST /match`). An exam road waits for a mentor's accept:
 * the server refuses the instant match with 409 `accept_required`, and the question goes to the
 * best online mentor through `POST /match/ask` instead. The server is the authority on which
 * is which — the app never guesses from the member's road, so an old cached Path cannot send
 * the wrong call, and a build from before this rule still gets a clean answer.
 *
 * The intro is the member's own words when they fit the server's 160 characters; otherwise the
 * server's plain line is used. Nothing is cut mid-sentence on the member's behalf.
 */
import type { useRouter } from 'expo-router';

import { ApiError, api, type MatchResult, type PersonalRequest } from '@/lib/api';
import { requestLetter } from '@/lib/requestLetter';

export const ASK_INTRO_MAX = 160;

export type Started =
  | { kind: 'chat'; match: MatchResult }
  | { kind: 'ask'; request: PersonalRequest };

export const acceptRequired = (e: unknown): boolean =>
  e instanceof ApiError && e.status === 409 && e.code === 'accept_required';

export function askIntro(text: string | undefined | null): string | null {
  const t = (text ?? '').trim();
  return t && t.length <= ASK_INTRO_MAX ? t : null;
}

type Client = Pick<typeof api, 'match' | 'ask'>;

export async function matchOrAsk(
  body: { issue_category?: string | null },
  intro?: string | null,
  client: Client = api,
): Promise<Started> {
  try {
    return { kind: 'chat', match: await client.match({ kind: 'general', ...body }) };
  } catch (e) {
    if (!acceptRequired(e)) throw e;
    return {
      kind: 'ask',
      request: await client.ask({ issue_category: body.issue_category ?? null, intro_message: askIntro(intro) }),
    };
  }
}

/** The waiting letter for a question the member just sent (board A04). `replace`: back from
 * the letter never returns to a sheet or form that has done its job. */
export function openAsked(router: ReturnType<typeof useRouter>, request: PersonalRequest): void {
  requestLetter.put({ request, mentor: null });
  router.replace({ pathname: '/request-sent/[id]', params: { id: request.id } });
}
