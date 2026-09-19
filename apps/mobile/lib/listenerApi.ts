/** Typed client for the listener console (/listener/me endpoints). Same transport as
 * lib/api.ts, bound to the listener token instead of the member session. */
import { ApiError, apiRequest } from '@/lib/api';
import { clearListenerSession, getListenerToken } from '@/lib/listenerSession';

export type ListenerMe = {
  id: string;
  persona_name: string;
  persona_avatar: string;
  status: 'online' | 'away' | 'offline';
  categories: string[];
  active_conversations: number;
  max_concurrent: number;
  stream_token: string;
  public_line: string | null;
  availability_note: string | null;
  /** The next 04:00 IST rename (ISO UTC); null when rotation is off. */
  name_changes_at?: string | null;
};

/** Mirrors server `MemberBriefOut` — "Context for care" (mentor-side member brief). */
export type MemberBrief = {
  persona_name: string;
  persona_avatar: string;
  companion_animal: string | null;
  companion_colour: string | null;
  community_slug: string | null;
  community_label: string | null;
  journey_stage: string | null;
  journey_stage_label: string | null;
  issue_category: string | null;
  issue_category_label: string | null;
  created_at: string;
  last_message_at: string | null;
  member_masked: boolean;
  safety_flags_open: number;
  care_prompt: string;
  /** The member and this mentor stay in touch (board A36; the mentor can end it). */
  in_touch?: boolean;
};

export type ListenerConversation = {
  id: string;
  status: 'active' | 'ended' | 'wiped';
  user_persona_name: string;
  user_persona_avatar: string;
  stream_channel_id: string | null;
  /** True while the member has a Panda Mask set — shown as "Away right now". */
  member_masked: boolean;
  created_at: string;
  ended_at: string | null;
  in_touch?: boolean;
};

/** A member's waiting "stay in touch" ask, as the mentor sees it (board A15): the
 * member's persona and companion only — nothing else about them exists here. */
export type StayInTouchAsk = {
  id: string;
  member_persona_name: string;
  member_persona_avatar: string;
  companion_animal: string | null;
  companion_colour: string | null;
  conversation_id: string | null;
  asked_at: string;
};

export type ListenerRequest = {
  id: string;
  intro_message: string | null;
  issue_category: string | null;
  requester_persona_name: string;
  created_at: string;
};

/** Dev-only picker row (the /listener/dev/* endpoints 404 in production). */
export type DevListenerItem = {
  id: string;
  persona_name: string;
  persona_avatar: string;
  status: 'online' | 'away' | 'offline';
};

export type ListenerReportReason = 'abuse' | 'harassment' | 'spam' | 'other';

/** Fired whenever a console call comes back 401/403 (token expired or the listener
 * was suspended). Mentor Home subscribes and falls back to the status card; the
 * token is already cleared by then. */
const sessionLostListeners = new Set<() => void>();
export function onListenerSessionLost(fn: () => void): () => void {
  sessionLostListeners.add(fn);
  return () => {
    sessionLostListeners.delete(fn);
  };
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  try {
    return await apiRequest<T>(path, init, getListenerToken);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
      await clearListenerSession();
      sessionLostListeners.forEach((fn) => fn());
    }
    throw e;
  }
}

export const listenerApi = {
  me: () => req<ListenerMe>('/listener/me'),

  setStatus: (status: 'online' | 'away') =>
    req<ListenerMe>('/listener/me/status', { method: 'PATCH', body: JSON.stringify({ status }) }),

  conversations: () => req<ListenerConversation[]>('/listener/me/conversations'),

  requests: () => req<ListenerRequest[]>('/listener/me/requests'),

  brief: (convoId: string) => req<MemberBrief>(`/listener/me/conversations/${convoId}/brief`),

  /** PATCH-like semantics on a PUT: an omitted field is left unchanged server-side. */
  updateProfile: (body: { public_line?: string | null; availability_note?: string | null }) =>
    req<ListenerMe>('/listener/me/profile', { method: 'PUT', body: JSON.stringify(body) }),

  accept: (id: string) =>
    req<{ id: string; status: string; conversation_id: string | null }>(
      `/listener/me/requests/${id}/accept`,
      { method: 'POST' },
    ),

  decline: (id: string) =>
    req<{ status: string }>(`/listener/me/requests/${id}/decline`, { method: 'POST' }),

  // Dev-only convenience (no token needed; endpoints 404 in prod). Used by the
  // /listener picker so testing the listener side needs no script or pasted link.
  devRoster: () => apiRequest<DevListenerItem[]>('/listener/dev/roster'),

  devToken: (id: string) =>
    apiRequest<{ token: string }>(`/listener/dev/token/${id}`, { method: 'POST' }),

  heartbeat: () => req<{ status: string }>('/listener/me/heartbeat', { method: 'POST' }),

  report: (conversationId: string, reason: ListenerReportReason, note: string | null) =>
    req<{ status: string }>(`/listener/me/conversations/${conversationId}/report`, {
      method: 'POST',
      body: JSON.stringify({ reason, note }),
    }),

  end: (conversationId: string) =>
    req<{ status: string }>(`/listener/me/conversations/${conversationId}/end`, { method: 'POST' }),

  /** Asks waiting for an answer, oldest first (no push for these — seen next visit). */
  stayInTouchAsks: () => req<StayInTouchAsk[]>('/listener/me/stay-in-touch'),

  acceptStayInTouch: (id: string) =>
    req<{ status: string }>(`/listener/me/stay-in-touch/${id}/accept`, { method: 'POST' }),

  notNowStayInTouch: (id: string) =>
    req<{ status: string }>(`/listener/me/stay-in-touch/${id}/not-now`, { method: 'POST' }),

  endStayInTouch: (conversationId: string) =>
    req<{ status: string }>(`/listener/me/conversations/${conversationId}/stay-in-touch`, { method: 'DELETE' }),

  deletePushToken: (expo_push_token: string) =>
    req<{ status: string }>('/listener/me/push-token', {
      method: 'DELETE',
      body: JSON.stringify({ expo_push_token }),
    }),

  registerPushToken: (expo_push_token: string, platform: 'ios' | 'android') =>
    req<{ status: string }>('/listener/me/push-token', {
      method: 'POST',
      body: JSON.stringify({ expo_push_token, platform }),
    }),
};
