/** Typed client for the Mento API. Mirrors services/api schemas. */
import Constants from 'expo-constants';
import { router } from 'expo-router';

import { screenCache } from './screenCache';
import { clearSession, getSessionToken } from './session';

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
};

export type MatchResult = {
  conversation_id: string;
  stream_channel_id: string | null;
  listener_persona_name: string;
  listener_persona_avatar: string;
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
};

export type PersonalRequest = {
  id: string;
  status: 'pending' | 'matched' | 'declined' | 'expired';
  target_listener_id: string | null;
  intro_message: string | null;
  conversation_id: string | null;
  created_at: string;
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

async function request<T>(path: string, init: RequestInit = {}, auth = false): Promise<T> {
  try {
    return await apiRequest<T>(path, init, auth ? getSessionToken : undefined);
  } catch (e) {
    if (auth && e instanceof ApiError && e.status === 401) {
      await handleUserUnauthorized();
    }
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
  }) => request<OnboardingResult>('/onboarding/start', { method: 'POST', body: JSON.stringify(body) }),

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
};
