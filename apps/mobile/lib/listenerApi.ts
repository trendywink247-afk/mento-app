/** Typed client for the listener console (/listener/me endpoints). Same transport as
 * lib/api.ts, bound to the listener token instead of the member session. */
import { apiRequest } from '@/lib/api';
import { getListenerToken } from '@/lib/listenerSession';

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

function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  return apiRequest<T>(path, init, getListenerToken);
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
};
