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

async function request<T>(path: string, init: RequestInit = {}, auth = false): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string>),
  };
  if (auth) {
    const token = await getSessionToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, detail);
  }
  return (await res.json()) as T;
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
};
