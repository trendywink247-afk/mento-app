/**
 * Prepared answers (founder, 2026-11-08): a mentor's own reusable replies, each with a short
 * /shortcut. Typing "/" and a few letters in a chat lists the matches; choosing one only FILLS the
 * composer. Nothing is sent for the mentor, and the server's crisis scan reads what they send, as
 * always. Pure: no storage, no React, so the rules are tested without a device.
 */
export type PreparedAnswer = {
  id: string;
  /** Lower-case letters and digits, no slash: "thanks". */
  shortcut: string;
  title: string;
  body: string;
  pinned?: boolean;
};

export const MAX_ANSWERS = 30;
export const SHORTCUT_MAX = 12;
export const TITLE_MAX = 60;
export const BODY_MAX = 500;

/** "/Thanks!" -> "thanks": the slash and anything that is not a letter or digit is dropped. */
export function cleanShortcut(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/^\/+/, '')
    .replace(/[^a-z0-9]/g, '')
    .slice(0, SHORTCUT_MAX);
}

export type AnswerProblem = 'shortcut' | 'title' | 'body' | 'duplicate' | 'full' | null;

export function validateAnswer(
  draft: { shortcut: string; title: string; body: string },
  existing: PreparedAnswer[],
  selfId?: string,
): AnswerProblem {
  if (!selfId && existing.length >= MAX_ANSWERS) return 'full';
  if (cleanShortcut(draft.shortcut).length < 2) return 'shortcut';
  if (!draft.title.trim() || draft.title.trim().length > TITLE_MAX) return 'title';
  const body = draft.body.trim();
  if (!body || body.length > BODY_MAX) return 'body';
  const short = cleanShortcut(draft.shortcut);
  if (existing.some((a) => a.id !== selfId && a.shortcut === short)) return 'duplicate';
  return null;
}

/**
 * The composer text is a slash command only while it is "/" plus letters or digits and nothing
 * else (no space, no second line): "/th" -> "th", "/" -> "". Anything else -> null.
 */
export function slashQuery(text: string): string | null {
  const m = /^\/([A-Za-z0-9]{0,12})$/.exec(text);
  return m ? m[1].toLowerCase() : null;
}

/** Matches for the query: shortcuts that start with it first, then titles that contain it. Pinned
 * answers lead each group. At most `limit`. */
export function suggest(text: string, answers: PreparedAnswer[], limit = 4): PreparedAnswer[] {
  const q = slashQuery(text);
  if (q === null) return [];
  const rank = (a: PreparedAnswer): number =>
    q === '' ? 1 : a.shortcut.startsWith(q) ? 0 : a.title.toLowerCase().includes(q) ? 1 : 2;
  return answers
    .filter((a) => rank(a) < 2)
    .sort((a, b) => rank(a) - rank(b) || Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || a.shortcut.localeCompare(b.shortcut))
    .slice(0, limit);
}

/** What choosing an answer puts in the composer: its body, as the mentor wrote it. */
export function fill(answer: PreparedAnswer): string {
  return answer.body;
}
