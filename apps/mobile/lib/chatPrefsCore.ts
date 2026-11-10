/**
 * Pin and Archive for the chat list: two sets of conversation ids kept on this phone only
 * (founder, 2026-11-10: long-press and swipe on a chat, like WhatsApp). Pure rules; the storage
 * and the hook are in chatPrefs.ts.
 */
export type ChatPrefs = { pinned: string[]; archived: string[] };

export const EMPTY_PREFS: ChatPrefs = { pinned: [], archived: [] };
const MAX_IDS = 500;

const ids = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length < 80).slice(0, MAX_IDS) : [];

/** Anything damaged or unexpected reads as "nothing pinned, nothing archived". */
export function parsePrefs(raw: string | null | undefined): ChatPrefs {
  try {
    const v = raw ? JSON.parse(raw) : null;
    return v && typeof v === 'object' ? { pinned: ids(v.pinned), archived: ids(v.archived) } : EMPTY_PREFS;
  } catch {
    return EMPTY_PREFS;
  }
}

const flip = (list: string[], id: string): string[] => (list.includes(id) ? list.filter((x) => x !== id) : [id, ...list].slice(0, MAX_IDS));

export function togglePin(p: ChatPrefs, id: string): ChatPrefs {
  // A chat that is pinned is not archived, and the other way round.
  return { pinned: flip(p.pinned, id), archived: p.pinned.includes(id) ? p.archived : p.archived.filter((x) => x !== id) };
}

export function toggleArchive(p: ChatPrefs, id: string): ChatPrefs {
  return { archived: flip(p.archived, id), pinned: p.archived.includes(id) ? p.pinned : p.pinned.filter((x) => x !== id) };
}

/** A chat that no longer exists leaves no trace: keep only ids that are still in the list. */
export function forgetMissing(p: ChatPrefs, existing: string[]): ChatPrefs {
  const have = new Set(existing);
  return { pinned: p.pinned.filter((x) => have.has(x)), archived: p.archived.filter((x) => have.has(x)) };
}

/** Pinned chats first (most recently pinned on top), then the rest in the order given. */
export function pinnedFirst<T extends { id: string }>(items: T[], p: ChatPrefs): T[] {
  const rank = (id: string) => {
    const i = p.pinned.indexOf(id);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return items.map((x, i) => ({ x, i })).sort((a, b) => rank(a.x.id) - rank(b.x.id) || a.i - b.i).map(({ x }) => x);
}
