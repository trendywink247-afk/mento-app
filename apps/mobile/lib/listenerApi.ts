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
};
