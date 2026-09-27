/** Typed client for the Mento API. Mirrors services/api schemas. */
import Constants from 'expo-constants';
import { router } from 'expo-router';

import { screenCache } from './screenCache';
import {
  clearSession,
  getRefreshToken,
  getSessionToken,
  saveTokenPair,
} from './session';

const BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ??
  (Constants.expoConfig?.extra?.apiUrl as string | undefined) ??
  'http://localhost:8000/api/v1';

export type Persona = { id: string; persona_name: string; persona_avatar: string };

/** `GET /me` and the answer to `PUT /me/companion`: the persona plus the companion the
 * SERVER holds (canonical spelling; null = none stored). */
export type Me = Persona & {
  companion_animal: string | null;
  companion_colour: string | null;
  /** The account passed the server-side age gate (always true today — a session only comes
   * from onboarding/start). Optional: an older server omits it. */
  has_dob?: boolean;
  /** Everything the member side needs is on the account (age gate + companion), so a mentor
   * switching to talk goes straight to My Chats. Optional: an older server omits it. */
  member_setup_complete?: boolean;
  /** The member's own name for the companion — only ever shown back to them. */
  companion_name?: string | null;
};

/** `PUT /me/companion`: an omitted field is left as it is, `null` clears it. */
export type CompanionUpdate = {
  companion_animal?: string | null;
  companion_colour?: string | null;
  /** A refused name is a 422 with `code: 'companion_name_invalid'`; nothing is saved. */
  companion_name?: string | null;
};

export type OnboardingResult = {
  session_token: string;
  stream_token: string;
  user: Persona;
  /** Present when the server supports refresh (we always ask); pass it to saveSession.
   * An older server omits it and the session stays a long-lived token. */
  refresh_token?: string | null;
  expires_in?: number | null;
};

/** `POST /auth/upgrade` / `POST /auth/refresh` (T3.2). */
export type SessionPair = {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  refresh_expires_at: string;
};

export type MatchResult = {
  conversation_id: string;
  stream_channel_id: string | null;
  listener_persona_name: string;
  listener_persona_avatar: string;
  /** The mentor's face (server `services/mentor_face.py`) — draw with `MentorFace`. */
  listener_companion_animal?: string | null;
  listener_companion_colour?: string | null;
};

export type ScanResult = {
  triggered: boolean;
  signal: string;
  helplines: { name: string; number: string; hours: string }[];
  message: string | null;
};

export type Listener = {
  id: string;
  persona_name: string;
  persona_avatar: string;
  gender: string;
  categories: string[];
  status: 'online' | 'away' | 'offline';
  available: boolean;
  is_favourite: boolean;
  /** Stay in touch (DECISIONS §L.6): an ACCEPTED link with this mentor; Browse sorts these first. */
  in_touch?: boolean;
  /** The name this mentor carried when the member first met them, once it has changed. */
  first_met_as?: string | null;
  /** One mentor, one face (server `services/mentor_face.py`): the companion animal + wash
   * colour every screen draws for this mentor. Stable across name rotation. */
  companion_animal?: string;
  companion_colour?: string;
};

/** Mirrors server `ListenerProfileOut` — served both by conversation-scoped
 * ("Two in the room") and Browse-scoped ("/listeners/{id}") profile routes. */
export type ListenerProfile = {
  id: string;
  persona_name: string;
  persona_avatar: string;
  gender: string;
  categories: string[];
  community_slug: string | null;
  status: 'online' | 'away' | 'offline';
  available: boolean;
  public_line: string | null;
  availability_note: string | null;
  listening_since: string;
  conversations_held: number;
  is_favourite: boolean;
  in_touch?: boolean;
  first_met_as?: string | null;
  /** One mentor, one face (server `services/mentor_face.py`): the companion animal + wash
   * colour every screen draws for this mentor. Stable across name rotation. */
  companion_animal?: string;
  companion_colour?: string;
  /** The server's member-facing words for `categories`, same order (never a raw slug). */
  category_labels?: string[];
};

export type PersonalRequest = {
  id: string;
  status: 'pending' | 'matched' | 'declined' | 'expired';
  target_listener_id: string | null;
  intro_message: string | null;
  conversation_id: string | null;
  created_at: string;
  /** When the question first appeared in the mentor's console inbox — the letter's "Seen"
   * (board A04). Null while nobody has been shown it. */
  seen_at?: string | null;
  /** The mentor said yes and the chat is open — the letter's "Replying". */
  replying?: boolean;
  /** The mentor's face (server `services/mentor_face.py`) — draw with `MentorFace`. */
  listener_companion_animal?: string | null;
  listener_companion_colour?: string | null;
};

/** `GET /conversations/{id}/mentor`: the mentor's profile plus THIS conversation's topic. */
export type ConversationMentor = ListenerProfile & {
  issue_category: string | null;
  issue_category_label: string | null;
  /** The member's stay-in-touch standing with this mentor (same payload as
   * `GET /conversations/{id}/stay-in-touch`). */
  stay_in_touch?: StayInTouch | null;
  /** True while the mentor snoozed this chat (board A10). The member is only ever shown
   * the kind half: "<mentor> will reply within a day". */
  reply_within_a_day?: boolean;
};

// --- Stay in touch (DECISIONS §L.6–7; docs/superpowers/specs/2026-09-19-board-port-api.md B2) ---
export type InTouchSlots = { limit: number; in_touch: number; waiting: number; free: number };
export type StayInTouchBlock = 'in_touch_full' | 'in_touch_waiting' | 'not_now_cooldown' | 'unavailable';
export type StayInTouch = {
  state: 'none' | 'asked' | 'in_touch' | 'not_now';
  link_id: string | null;
  can_ask: boolean;
  blocked_reason: StayInTouchBlock | null;
  can_ask_again_at: string | null;
  slots: InTouchSlots;
  mentor_name: string;
  first_met_as: string | null;
  first_met_at: string | null;
  names_change_at: string;
};
export type InTouchItem = {
  link_id: string;
  state: 'in_touch' | 'asked';
  listener_id: string;
  persona_name: string;
  persona_avatar: string;
  first_met_as: string | null;
  first_met_at: string;
  since: string | null;
  status: 'online' | 'away' | 'offline';
  available: boolean;
  categories: string[];
  community_slug: string | null;
  public_line: string | null;
  availability_note: string | null;
  conversation_id: string | null;
  conversation_status: 'active' | 'ended' | 'wiped' | null;
  stream_channel_id: string | null;
  /** One mentor, one face (server `services/mentor_face.py`): the companion animal + wash
   * colour every screen draws for this mentor. Stable across name rotation. */
  companion_animal?: string;
  companion_colour?: string;
};
export type InTouchList = { slots: InTouchSlots; items: InTouchItem[]; waiting: InTouchItem[] };

export type ConversationListItem = {
  id: string;
  status: 'active' | 'ended' | 'wiped';
  listener_persona_name: string;
  listener_persona_avatar: string;
  stream_channel_id: string | null;
  is_locked: boolean;
  created_at: string;
  ended_at: string | null;
  /** What the conversation is about, set at match / accept. Null for a General match
   * started without a topic (every member-side General match today). */
  issue_category: string | null;
  /** The server's member-facing words for `issue_category` ("Exam stress"). */
  issue_category_label: string | null;
  /** Rotating names (DECISIONS §L.6): the member has an accepted stay-in-touch link with
   * this chat's mentor; `first_met_as` is the earlier name, only once it differs. */
  in_touch?: boolean;
  first_met_as?: string | null;
  /** See ConversationMentor.reply_within_a_day. */
  reply_within_a_day?: boolean;
  /** The mentor's face (server `services/mentor_face.py`) — draw with `MentorFace`. */
  listener_companion_animal?: string | null;
  listener_companion_colour?: string | null;
};

export type ConversationState = {
  id: string;
  status: string;
  is_locked: boolean;
  is_paused: boolean;
  status_mask: string | null;
};

export type JournalEntry = {
  id: string;
  channel: string;
  body: string;
  source: string;
  meta: Record<string, string | null>;
  created_at: string;
};

export type OrganizeResult = {
  overview: string;
  themes: { title: string; summary: string; count: number }[];
  entry_count: number;
};

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Machine code beside `detail` on refusals the UI must tell apart (`in_touch_full`…). */
    public code: string | null = null,
    /** The rest of a coded refusal's body (e.g. `can_ask_again_at`). */
    public body: Record<string, unknown> | null = null,
  ) {
    super(message);
  }
}

const REQUEST_TIMEOUT_MS = 10_000;

/** AbortSignal.timeout isn't guaranteed on RN's fetch polyfill (Hermes), so build the
 * equivalent from AbortController + setTimeout. */
function timeoutSignal(ms: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(id) };
}

/** Core request with a pluggable token source — the user client below binds it to
 * the user session; lib/listenerApi.ts binds it to the listener-console token. */
export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
  getToken?: () => Promise<string | null>,
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string>),
  };
  if (getToken) {
    const token = await getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const { signal, cancel } = timeoutSignal(REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, { ...init, headers, signal });
  } catch (e) {
    // Map an abort to the ApiError shape screens already handle (status 0 = network).
    if (e instanceof Error && e.name === 'AbortError') {
      throw new ApiError(0, 'The request timed out. Please check your connection and try again.');
    }
    throw e;
  } finally {
    cancel();
  }
  if (!res.ok) {
    let detail = res.statusText;
    let code: string | null = null;
    let body: Record<string, unknown> | null = null;
    try {
      body = (await res.json()) as Record<string, unknown>;
      // FastAPI puts a dict `detail` through as-is: accept {detail, code} flat or nested.
      const d = body.detail;
      if (d && typeof d === 'object') {
        const nested = d as Record<string, unknown>;
        body = { ...body, ...nested };
        if (typeof nested.detail === 'string') detail = nested.detail;
        else if (typeof nested.message === 'string') detail = nested.message;
      } else if (typeof d === 'string') detail = d;
      if (typeof body.code === 'string') code = body.code;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, detail, code, body);
  }
  if (res.status === 204) return undefined as T; // bodyless success (e.g. leave path)
  return (await res.json()) as T;
}

// --- Message allowance (DECISIONS §L.2, boards A05 / A22) ---
export type Allowance = {
  in_a_row: number;
  in_a_row_limit: number;
  sent_today: number;
  daily_limit: number;
  left_today: number;
  resets_at: string;
  can_send: boolean;
  held_reason: 'in_a_row' | 'daily' | null;
  enforced: boolean;
  /** The conversation is inside its crisis-exempt window: nothing is held or counted, and
   * the client never shows the three-in-a-row note. Optional — an older server omits it. */
  exempt?: boolean;
};

// --- Product feedback (board A11) ---
export type FeedbackCategory = 'broken' | 'confusing' | 'idea';
export type FeedbackCrisis = {
  support: string;
  signal: string;
  helplines: { name: string; number: string; hours: string }[];
};
export type FeedbackReceived = { status: 'received' | 'support'; crisis: FeedbackCrisis | null };

// --- Paths (Communities) ---
export type PathOption = {
  label: string;
  icon?: string;
  next?: string;
  community?: string;
  stage?: string;
};
export type PathNode = { question: string; options: PathOption[] };
export type PathTree = { root: string; nodes: Record<string, PathNode> };
export type PathState = {
  community: { slug: string; name: string; tagline: string } | null;
  stage: { id: string; title: string; blurb: string } | null;
  prompts: string[];
  seasonal: { title: string; body: string } | null;
  listeners_online: number;
};

// --- Become a listener (spec 2026-07-24) ---
export type ListenerApplicationStatus = 'pending' | 'approved' | 'declined';
export type ListenerApplication = {
  id: string;
  status: ListenerApplicationStatus;
  mentor_interest: boolean;
  created_at: string;
  console_url: string | null;
  /** Declined only: when the server's 30-day cooldown lets them apply again (ISO time). */
  reapply_after?: string | null;
  /** Approved only: when this mentor asked the team to step their mentor side back. */
  step_back_requested_at?: string | null;
};
export type ListenerApplicationIn = {
  motivation: string;
  communities: string[];
  availability: 'few_hours' | 'most_evenings' | 'weekends' | 'varies';
  /** Board A37's time-of-day chips (DECISIONS §L). Optional in the contract; this app
   * always sends at least one. */
  available_times?: Array<'mornings' | 'afternoons' | 'evenings' | 'late_nights' | 'weekends'>;
  email: string | null;
  mentor_interest: boolean;
  pledge_accepted: boolean;
};

/** Native console credential (spec 2026-09-05 §3). Only issued while the application
 * AND the listener profile are approved; 403 `not_approved` otherwise. */
export type ConsoleSession = {
  listener_token: string;
  listener_id: string;
  persona_name: string;
  persona_avatar: string;
  stream_token: string;
  expires_at: string;
};

// One-shot latch so overlapping 401s from parallel requests trigger a single
// session-clear + redirect instead of a replace() loop.
let handling401 = false;

/** USER-realm 401: the anonymous session is invalid/expired server-side. Clear it and
 * route honestly to the landing. Listener/admin consoles have their own handling. */
async function handleUserUnauthorized(): Promise<void> {
  if (handling401) return;
  handling401 = true;
  try {
    await clearSession();
    router.replace('/');
  } finally {
    // Allow future (post-re-onboarding) 401s to be handled again.
    handling401 = false;
  }
}

// --- Refreshing sessions (T3.2) ---
// A refresh-capable session holds a 15-minute access token + a rotating refresh token.
// The server treats a refresh token presented twice as theft and revokes the whole
// family, so this client must NEVER race itself: one refresh at a time per process
// (the in-flight promise) and, on web, per browser (a Web Lock across tabs), and it
// re-reads storage before spending a refresh token that someone else may already
// have rotated. Anything short of a definite 401 from /auth/refresh (offline, 5xx,
// timeout) keeps the session: a network blip must never sign a member out.

type RefreshOutcome = 'refreshed' | 'dead' | 'unavailable';

const EXPIRY_MARGIN_MS = 30_000;

/** The `exp` of a JWT in ms, or null when it can't be read (then: just try it). */
function tokenExpiry(token: string): number | null {
  try {
    const part = token.split('.')[1];
    if (!part || typeof globalThis.atob !== 'function') return null;
    const json = globalThis.atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    const exp = (JSON.parse(json) as { exp?: unknown }).exp;
    return typeof exp === 'number' ? exp * 1000 : null;
  } catch {
    return null;
  }
}

function expiringSoon(token: string): boolean {
  const exp = tokenExpiry(token);
  return exp !== null && exp - Date.now() < EXPIRY_MARGIN_MS;
}

type LockManager = { request<R>(name: string, cb: () => Promise<R>): Promise<R> };

/** Serialize across browser tabs where the platform offers it (web); no-op on native. */
function withRefreshLock<R>(cb: () => Promise<R>): Promise<R> {
  const locks = (globalThis.navigator as { locks?: LockManager } | undefined)?.locks;
  return locks?.request ? locks.request('mento.refresh', cb) : cb();
}

let refreshInFlight: Promise<RefreshOutcome> | null = null;

/** Rotate the refresh token. `staleToken` = the access token that just failed (or is
 * about to expire): if storage already holds a different, live one, another request
 * or tab refreshed first and there is nothing to spend. */
function refreshSession(staleToken: string | null): Promise<RefreshOutcome> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = withRefreshLock(async (): Promise<RefreshOutcome> => {
    const current = await getSessionToken();
    if (current && current !== staleToken && !expiringSoon(current)) return 'refreshed';
    const refresh = await getRefreshToken();
    if (!refresh) return 'dead';
    try {
      const pair = await apiRequest<SessionPair>('/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refresh_token: refresh }),
      });
      await saveTokenPair(pair.access_token, pair.refresh_token);
      return 'refreshed';
    } catch (e) {
      return e instanceof ApiError && e.status === 401 ? 'dead' : 'unavailable';
    }
  }).finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

// Installs from before refresh hold a long-lived token and no refresh token. Swap it
// once, quietly, in the background (the old token keeps working meanwhile and is not
// revoked by the swap). Each token is tried once per launch; failure changes nothing.
const upgradeTried = new Set<string>();

async function upgradeLegacySession(): Promise<void> {
  if (await getRefreshToken()) return;
  const token = await getSessionToken();
  if (!token || upgradeTried.has(token)) return;
  upgradeTried.add(token);
  try {
    const pair = await apiRequest<SessionPair>(
      '/auth/upgrade',
      { method: 'POST', body: JSON.stringify({}) },
      async () => token,
    );
    // Only if the identity did not change while the call was out.
    if ((await getSessionToken()) === token) {
      await saveTokenPair(pair.access_token, pair.refresh_token);
    }
  } catch {
    /* older server, offline, or 409 already_upgraded — keep what we have */
  }
}

/** The member bearer to send now — refreshed first when it is about to lapse. */
async function currentMemberToken(): Promise<string | null> {
  const token = await getSessionToken();
  if (token && expiringSoon(token) && (await getRefreshToken())) {
    await refreshSession(token);
    return getSessionToken();
  }
  return token;
}

async function request<T>(path: string, init: RequestInit = {}, auth = false): Promise<T> {
  if (!auth) return apiRequest<T>(path, init);
  void upgradeLegacySession();
  const token = await currentMemberToken();
  try {
    return await apiRequest<T>(path, init, async () => token);
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 401)) throw e;
    // A 401 is refused before the handler runs, so one retry is safe even for a POST.
    const outcome = await refreshSession(token);
    if (outcome === 'refreshed') {
      const next = await getSessionToken();
      try {
        return await apiRequest<T>(path, init, async () => next);
      } catch (retryError) {
        if (retryError instanceof ApiError && retryError.status === 401) {
          await handleUserUnauthorized();
        }
        throw retryError;
      }
    }
    // No refresh token (a pre-refresh install) or a dead family: the old behaviour.
    if (outcome === 'dead') await handleUserUnauthorized();
    throw e;
  }
}

export const api = {
  startOnboarding: (body: {
    dob: string; // YYYY-MM-DD
    email?: string | null;
    companion_animal?: string | null;
    companion_colour?: string | null;
    companion_name?: string | null;
  }) =>
    request<OnboardingResult>('/onboarding/start', {
      method: 'POST',
      // Always ask for a refreshing session; an older server ignores the flag.
      body: JSON.stringify({ ...body, refresh: true }),
    }),

  // --- The member's own record (companion saved on the account, not just the device) ---
  me: () => request<Me>('/me', {}, true),
  saveCompanion: (body: CompanionUpdate) =>
    request<Me>('/me/companion', { method: 'PUT', body: JSON.stringify(body) }, true),

  match: (body: { kind?: 'general' | 'personal'; issue_category?: string | null }) =>
    request<MatchResult>('/match', { method: 'POST', body: JSON.stringify(body) }, true),

  scan: (body: { text: string; conversation_id?: string | null }) =>
    request<ScanResult>('/safety/scan', { method: 'POST', body: JSON.stringify(body) }, true),

  listConversations: () => request<ConversationListItem[]>('/conversations', {}, true),

  // --- Paths (Communities) ---
  pathTree: () => request<PathTree>('/paths/tree'),
  myPath: () => request<PathState>('/paths/me', {}, true),
  choosePath: (community: string, stage: string) =>
    request<PathState>('/paths/me', { method: 'PUT', body: JSON.stringify({ community, stage }) }, true),
  leavePath: () => request<void>('/paths/me', { method: 'DELETE' }, true),

  // --- Mentor discovery + personal requests ---
  listListeners: () => request<Listener[]>('/listeners', {}, true),

  requestListener: (id: string, intro_message: string, issue_category?: string | null) =>
    request<PersonalRequest>(`/listeners/${id}/request`, { method: 'POST', body: JSON.stringify({ intro_message, issue_category }) }, true),

  myRequests: () => request<PersonalRequest[]>('/listeners/requests/mine', {}, true),
  /** Close the member's own open question (one open question at a time — a 409
   * `question_open` names it). Idempotent; an answered request comes back unchanged. */
  withdrawRequest: (requestId: string) =>
    request<PersonalRequest>(`/listeners/requests/${requestId}`, { method: 'DELETE' }, true),

  // --- Mentor profile ("Two in the room") + favourites ---
  mentorProfile: (convoId: string) =>
    request<ConversationMentor>(`/conversations/${convoId}/mentor`, {}, true),

  listenerProfile: (listenerId: string) =>
    request<ListenerProfile>(`/listeners/${listenerId}`, {}, true),

  favouriteListener: (listenerId: string, on: boolean) =>
    request<{ status: string }>(
      `/listeners/${listenerId}/favourite`,
      { method: on ? 'POST' : 'DELETE' },
      true,
    ),

  // --- Stay in touch (DECISIONS §L.6–7) ---
  stayInTouch: (convoId: string) =>
    request<StayInTouch>(`/conversations/${convoId}/stay-in-touch`, {}, true),
  askStayInTouch: (convoId: string) =>
    request<StayInTouch>(`/conversations/${convoId}/stay-in-touch`, { method: 'POST' }, true),
  takeBackStayInTouch: (convoId: string) =>
    request<StayInTouch>(`/conversations/${convoId}/stay-in-touch`, { method: 'DELETE' }, true),
  inTouch: () => request<InTouchList>('/in-touch', {}, true),
  endInTouch: (linkId: string) =>
    request<{ status: string }>(`/in-touch/${linkId}`, { method: 'DELETE' }, true),

  verifyPin: (id: string, pin: string) =>
    request<{ status: string }>(`/conversations/${id}/verify-pin`, { method: 'POST', body: JSON.stringify({ pin }) }, true),

  endConversation: (id: string) =>
    request<{ status: string }>(`/conversations/${id}/end`, { method: 'POST' }, true),

  // A wipe drops the conversation from the tab screens' last-loaded data (lib/screenCache.ts)
  // BEFORE the request goes out: My Chats must never repaint a wiped chat from memory.
  wipeConversation: (id: string) => {
    screenCache.forgetConversation(id);
    return request<{ status: string }>(`/conversations/${id}/wipe`, { method: 'POST' }, true);
  },

  // --- Conversation options sheet ---
  lockConversation: (id: string, pin: string) =>
    request<ConversationState>(`/conversations/${id}/lock`, { method: 'POST', body: JSON.stringify({ pin }) }, true),

  unlockConversation: (id: string, pin: string) =>
    request<ConversationState>(`/conversations/${id}/unlock`, { method: 'POST', body: JSON.stringify({ pin }) }, true),

  setStatusMask: (id: string, mask: string | null) =>
    request<ConversationState>(`/conversations/${id}/status-mask`, { method: 'POST', body: JSON.stringify({ mask }) }, true),

  setPause: (id: string, paused: boolean) =>
    request<ConversationState>(`/conversations/${id}/pause`, { method: 'POST', body: JSON.stringify({ paused }) }, true),

  reportConversation: (id: string, reason: string | null) =>
    request<{ status: string }>(`/conversations/${id}/report`, { method: 'POST', body: JSON.stringify({ reason }) }, true),

  blockConversation: (id: string, reason: string | null) =>
    request<{ status: string }>(`/conversations/${id}/block`, { method: 'POST', body: JSON.stringify({ reason }) }, true),

  saveReflection: (id: string, energy: number) =>
    request<{ status: string }>(`/conversations/${id}/reflection`, { method: 'POST', body: JSON.stringify({ energy }) }, true),

  // --- Journals (v1: save-to-Mentor-Notes from chat) ---
  saveMentorNote: (body: {
    body: string;
    conversation_id?: string | null;
    listener_persona?: string | null;
    stream_message_id?: string | null;
  }) => request<JournalEntry>('/journals/mentor-notes', { method: 'POST', body: JSON.stringify(body) }, true),

  listMentorNotes: () => request<JournalEntry[]>('/journals/mentor-notes', {}, true),

  journalSummary: () => request<Record<string, number>>('/journals/summary', {}, true),

  createJournalEntry: (body: { channel: string; body: string; meta?: Record<string, unknown> }) =>
    request<JournalEntry>('/journals/entries', { method: 'POST', body: JSON.stringify(body) }, true),

  listJournalEntries: (channel: string) =>
    request<JournalEntry[]>(`/journals/entries?channel=${encodeURIComponent(channel)}`, {}, true),

  // Opt-in AI note-sorting. 503 when the assistant isn't enabled server-side.
  organizeNotes: (channel: string) =>
    request<OrganizeResult>('/journals/organize', { method: 'POST', body: JSON.stringify({ channel }) }, true),

  // --- Become a listener (spec 2026-07-24) ---
  submitListenerApplication: (payload: ListenerApplicationIn) =>
    request<ListenerApplication>('/listener-applications', { method: 'POST', body: JSON.stringify(payload) }, true),

  getListenerApplication: () => request<ListenerApplication | null>('/listener-applications/me', {}, true),

  consoleSession: () =>
    request<ConsoleSession>('/listener-applications/me/console-session', { method: 'POST' }, true),

  // --- Push notifications (device registration only, v1 test pass) ---
  registerPushToken: (expo_push_token: string, platform: 'ios' | 'android') =>
    request<{ status: string }>(
      '/notifications/register-token',
      { method: 'POST', body: JSON.stringify({ expo_push_token, platform }) },
      true,
    ),

  deletePushToken: (expo_push_token: string) =>
    request<{ status: string }>(
      '/notifications/register-token',
      { method: 'DELETE', body: JSON.stringify({ expo_push_token }) },
      true,
    ),

  // --- Message allowance (boards A05 / A22) ---
  conversationAllowance: (id: string) => request<Allowance>(`/conversations/${id}/allowance`, {}, true),

  // --- Product feedback (board A11) ---
  sendFeedback: (body: { category: FeedbackCategory; text: string; screen?: string; app_version?: string }) =>
    request<FeedbackReceived>('/feedback', { method: 'POST', body: JSON.stringify(body) }, true),

  // --- Start fresh (board A32; DECISIONS §L.11) ---
  /** Erase this member on our servers and on Stream. 200 = gone (also when already gone).
   * Refusals carry a `code`: 409 `mentor_active` (also a live mentor — nothing touched),
   * 503 `erase_incomplete` (chats ended, the rest not yet — keep the session and retry). */
  eraseMe: () => request<{ status: 'erased' }>('/me', { method: 'DELETE' }, true),
  /** A live mentor asks the team to step their mentor side back (board A32 / 409, lane u14).
   * Idempotent; 409 `not_live_mentor` when there is no live mentor side. */
  requestStepBack: (reason?: string) =>
    request<{ status: 'requested'; requested_at: string }>(
      '/listener-applications/me/step-back',
      { method: 'POST', body: JSON.stringify(reason ? { reason } : {}) },
      true,
    ),
};
