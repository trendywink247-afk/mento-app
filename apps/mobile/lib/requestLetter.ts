/**
 * The letter screen's first frame (board A04). Whoever sends a Personal request — or opens
 * one from My Chats' waiting row — already holds the question and the mentor it went to;
 * they leave them here, keyed by the request id, so the letter paints at once with no
 * spinner and without putting the member's words into a URL. The screen still re-reads the
 * server (`GET /listeners/requests/mine`) for the truth.
 */
import type { PersonalRequest } from '@/lib/api';

export type LetterMentor = { id: string; name: string; avatar: string };
export type Letter = { request: PersonalRequest; mentor: LetterMentor | null };

const letters = new Map<string, Letter>();

export const requestLetter = {
  put(letter: Letter): void {
    letters.set(letter.request.id, letter);
  },
  get(id: string): Letter | undefined {
    return letters.get(id);
  },
};
