/**
 * Last-loaded data for the tab screens — so coming back to a tab shows what was there and
 * refreshes quietly, instead of a spinner over a screen the member was reading a moment ago.
 *
 * Why a module store and not component state: a tab screen can REMOUNT while the member
 * still has a session — any `router.replace` onto a tab route builds a new tab navigator
 * (leaving a chat used to; `lib/leaveToChats.ts` now pops back to the mounted tabs instead,
 * but a chat reached straight from onboarding has no tabs beneath it, and other routes
 * still replace). A remount starts `useState` empty; state that must survive it lives here.
 *
 * Rules (they are the privacy posture, not an optimisation):
 *  - Memory only. Never persisted, never logged, gone when the app process ends.
 *  - `clear()` runs when the identity changes (`clearSession` / `saveSession`);
 *    `forgetConversation()` runs on Clean Wipe (`lib/api.ts`) — a wiped chat's last message
 *    must never repaint from here, not even for the moment before the refresh lands (T&S #8).
 *  - A screen shows a spinner only when its key is empty (the very first load). A failed
 *    refresh keeps the stale data on screen and goes still.
 */
import type {
  ConversationListItem,
  InTouchList,
  JournalEntry,
  Listener,
  ListenerApplication,
  PathState,
} from './api';

export type ChatPreview = { text: string; at: Date | null; unread: number };

/** An unanswered Personal request, joined with the mentor it went to (My Chats "Waiting"). */
export type WaitingQuestion = {
  id: string;
  listenerId: string;
  name: string;
  avatar: string;
  intro: string | null;
  createdAt: string;
};

type Shape = {
  chats: {
    rows: ConversationListItem[];
    previews: Record<string, ChatPreview>;
    /** Best-effort extras for the richer rows — absent until their own reads land. */
    waiting?: WaitingQuestion[];
    saved?: Record<string, number>;
  };
  inTouch: InTouchList;
  path: PathState;
  journal: { entries: JournalEntry[]; hasFinance: boolean };
  mentors: Listener[];
  application: ListenerApplication | null;
};

/** The one definition of "this conversation was wiped" for a loaded chat list — shared by
 * the cache and by My Chats' own mounted state. */
function markWiped(chats: Shape['chats'], conversationId: string): Shape['chats'] {
  const gone = chats.rows.find((c) => c.id === conversationId);
  const previews = { ...chats.previews };
  if (gone?.stream_channel_id) delete previews[gone.stream_channel_id];
  return {
    ...chats,
    rows: chats.rows.map((c) => (c.id === conversationId ? { ...c, status: 'wiped' as const } : c)),
    previews,
  };
}

let store: Partial<Shape> = {};
const forgetListeners = new Set<(conversationId: string) => void>();

export const screenCache = {
  get<K extends keyof Shape>(key: K): Shape[K] | undefined {
    return store[key];
  },
  set<K extends keyof Shape>(key: K, value: Shape[K]): void {
    store[key] = value;
  },
  /** Clean Wipe: the row turns into its "wiped" marker (the list keeps one on purpose), its
   * message preview leaves memory, and so does the journal snapshot (kept guidance may
   * point at this conversation). Everything else stays warm. */
  forgetConversation(conversationId: string): void {
    if (store.chats) store.chats = markWiped(store.chats, conversationId);
    delete store.journal;
    // My Chats is usually still MOUNTED under the chat (lib/leaveToChats.ts pops back to it),
    // holding the row in component state — tell it now, so the preview is gone before the
    // member is back on that screen rather than one refresh later.
    forgetListeners.forEach((fn) => fn(conversationId));
  },
  onConversationForgotten(fn: (conversationId: string) => void): () => void {
    forgetListeners.add(fn);
    return () => {
      forgetListeners.delete(fn);
    };
  },
  clear(): void {
    store = {};
  },
};
