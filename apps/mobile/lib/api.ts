/** Typed client for the Mento API. Mirrors services/api schemas. */
import Constants from 'expo-constants';

import { getSessionToken } from './session';

const BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ??
  (Constants.expoConfig?.extra?.apiUrl as string | undefined) ??
  'http://localhost:8000/api/v1';

export type Persona = { id: string; persona_name: string; persona_avatar: string };

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
};

export type PersonalRequest = {
  id: string;
  status: 'pending' | 'matched' | 'declined' | 'expired';
  target_listener_id: string | null;
  intro_message: string | null;
  conversation_id: string | null;
  created_at: string;
};

export type ConversationListItem = {
  id: string;
  status: 'active' | 'ended' | 'wiped';
  listener_persona_name: string;
  listener_persona_avatar: string;
  stream_channel_id: string | null;
  is_locked: boolean;
  created_at: string;
  ended_at: string | null;
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

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
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
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, detail);
  }
  if (res.status === 204) return undefined as T; // bodyless success (e.g. leave path)
  return (await res.json()) as T;
}

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

async function request<T>(path: string, init: RequestInit = {}, auth = false): Promise<T> {
  return apiRequest<T>(path, init, auth ? getSessionToken : undefined);
}

export const api = {
  startOnboarding: (body: {
    dob: string; // YYYY-MM-DD
    email?: string | null;
    companion_animal?: string | null;
    companion_colour?: string | null;
  }) => request<OnboardingResult>('/onboarding/start', { method: 'POST', body: JSON.stringify(body) }),

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

  verifyPin: (id: string, pin: string) =>
    request<{ status: string }>(`/conversations/${id}/verify-pin`, { method: 'POST', body: JSON.stringify({ pin }) }, true),

  endConversation: (id: string) =>
    request<{ status: string }>(`/conversations/${id}/end`, { method: 'POST' }, true),

  wipeConversation: (id: string) =>
    request<{ status: string }>(`/conversations/${id}/wipe`, { method: 'POST' }, true),

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
};
