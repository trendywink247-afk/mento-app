/**
 * Prepared answers (founder, 2026-11-08): a mentor's own reusable replies, each with a short
 * /shortcut and the words it expands to. Typing "/" and a few letters in a chat (at the start or after
 * other words) lists the matches; choosing one replaces that /word with the answer and only FILLS the
 * composer. Nothing is sent for the mentor, and the server's crisis scan reads what they send, as
 * always. Pure: no storage, no React, so the rules are tested without a device.
 */
export type PreparedAnswer = {
  id: string;
  /** Lower-case letters and digits, no slash: "thanks". */
  shortcut: string;
  /** Derived from the body when saved (the first words); never typed by the mentor. */
  title: string;
  body: string;
  pinned?: boolean;
};

export const MAX_ANSWERS = 30;
export const SHORTCUT_MAX = 12;
export const TITLE_MAX = 60;

/** The first words of the body, for a list row's accessibility label. */
export function titleFrom(body: string): string {
  const one = body.trim().replace(/\s+/g, ' ');
  return one.length <= TITLE_MAX ? one : one.slice(0, TITLE_MAX - 1).trimEnd() + '…';
}
export const BODY_MAX = 500;

/** "/Thanks!" -> "thanks": the slash and anything that is not a letter or digit is dropped. */
export function cleanShortcut(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/^\/+/, '')
    .replace(/[^a-z0-9]/g, '')
    .slice(0, SHORTCUT_MAX);
}

export type AnswerProblem = 'shortcut' | 'body' | 'duplicate' | 'full' | null;

export function validateAnswer(
  draft: { shortcut: string; body: string },
  existing: PreparedAnswer[],
  selfId?: string,
): AnswerProblem {
  if (!selfId && existing.length >= MAX_ANSWERS) return 'full';
  if (cleanShortcut(draft.shortcut).length < 2) return 'shortcut';
  const body = draft.body.trim();
  if (!body || body.length > BODY_MAX) return 'body';
  const short = cleanShortcut(draft.shortcut);
  if (existing.some((a) => a.id !== selfId && a.shortcut === short)) return 'duplicate';
  return null;
}

/**
 * A slash command is the LAST word of the composer when it is "/" plus up to 12 letters or digits:
 * "/th" and "Hello /th" both are; "/th ank" and "a/b" are not. `start` is where the "/" sits, so
 * choosing an answer replaces just that word.
 */
export function slashTrigger(text: string): { query: string; start: number } | null {
  const m = /(^|\s)\/([A-Za-z0-9]{0,12})$/.exec(text);
  return m ? { query: m[2].toLowerCase(), start: m.index + m[1].length } : null;
}

export function slashQuery(text: string): string | null {
  return slashTrigger(text)?.query ?? null;
}

/** Matches for the query: shortcuts that start with it first, then answers that contain it. Pinned
 * answers lead each group. At most `limit`. */
export function suggest(text: string, answers: PreparedAnswer[], limit = 4): PreparedAnswer[] {
  const q = slashQuery(text);
  if (q === null) return [];
  const rank = (a: PreparedAnswer): number =>
    q === '' ? 1 : a.shortcut.startsWith(q) ? 0 : a.body.toLowerCase().includes(q) || a.title.toLowerCase().includes(q) ? 1 : 2;
  return answers
    .filter((a) => rank(a) < 2)
    .sort((a, b) => rank(a) - rank(b) || Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || a.shortcut.localeCompare(b.shortcut))
    .slice(0, limit);
}

/** What the composer holds after choosing an answer: what the mentor already typed, with the /word
 * replaced by the answer's body. The mentor reads it and sends it. */
export function applyAnswer(text: string, answer: PreparedAnswer): string {
  const t = slashTrigger(text);
  return (t ? text.slice(0, t.start) : '') + answer.body;
}
