/** Typed client for the admin dashboard (/admin endpoints), bound to the admin token. */
import { apiRequest } from '@/lib/api';
import { getAdminToken } from '@/lib/adminSession';

export type AdminMe = { id: string; name: string; role: 'owner' | 'helper' };
export type AttentionItem = { kind: string; text: string; href: string };
export type AdminOverview = {
  members_today: number;
  matches_today: number;
  active_conversations: number;
  listeners_online: number;
  flags_unreviewed: number;
  reports_unreviewed: number;
  attention: AttentionItem[];
};
export type AdminFlag = {
  id: string;
  signal: string;
  conversation_id: string | null;
  member_persona: string | null;
  listener_persona: string | null;
  reviewed: boolean;
  created_at: string;
};
export type AdminMessage = { id: string; text: string; user_persona: string; at: string };
export type AdminListener = {
  id: string;
  persona_name: string;
  persona_avatar: string;
  vetting_status: string;
  status: string;
  categories: string[];
  active_conversations: number;
  max_concurrent: number;
  rank: number;
  public_line: string | null;
};
export type AdminModerationItem = {
  id: string;
  reporter_id: string | null;
  subject_id: string;
  conversation_id: string | null;
  level: number;
  reason: string | null;
  blocked: boolean;
  reviewed: boolean;
  created_at: string;
};
export type AdminHealth = {
  db_ok: boolean;
  redis_ok: boolean;
  stream_configured: boolean;
  last_webhook_at: string | null;
  rate_limiter_ok: boolean;
};
export type AdminContribution = {
  id: string;
  amount_paise: number;
  status: string;
  created_at: string;
};
export type AdminAccountItem = {
  id: string;
  name: string;
  role: string;
  status: string;
  created_at: string;
};
export type AdminAuditItem = {
  id: string;
  admin_name: string;
  action: string;
  subject_type: string | null;
  subject_id: string | null;
  created_at: string;
};

export type AdminApplication = {
  id: string;
  persona_name: string;
  motivation: string;
  communities: string[];
  availability: string;
  email: string | null;
  mentor_interest: boolean;
  status: 'pending' | 'approved' | 'declined';
  created_at: string;
};

function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  return apiRequest<T>(path, init, getAdminToken);
}

export const adminApi = {
  me: () => req<AdminMe>('/admin/me'),
  overview: () => req<AdminOverview>('/admin/overview'),
  flags: (reviewed = false) => req<AdminFlag[]>(`/admin/safety/flags?reviewed=${reviewed}`),
  reviewFlag: (id: string, action: string, note?: string) =>
    req<{ status: string }>(`/admin/safety/flags/${id}/review`, {
      method: 'POST',
      body: JSON.stringify({ action, note }),
    }),
  conversationMessages: (id: string) => req<AdminMessage[]>(`/admin/conversations/${id}/messages`),
  moderationQueue: () => req<AdminModerationItem[]>('/admin/moderation/queue'),
  resolveEvent: (id: string) =>
    req<{ status: string }>(`/admin/moderation/${id}/resolve`, { method: 'POST' }),
  suspendListener: (id: string) =>
    req<{ status: string }>(`/admin/listeners/${id}/suspend`, { method: 'POST' }),
  reinstateListener: (id: string) =>
    req<{ status: string }>(`/admin/listeners/${id}/reinstate`, { method: 'POST' }),
  clearListenerLine: (id: string) =>
    req<{ status: string }>(`/admin/listeners/${id}/clear-line`, { method: 'POST' }),
  listeners: () => req<AdminListener[]>('/admin/listeners'),
  createListener: (categories: string[], max_concurrent: number) =>
    req<AdminListener>('/admin/listeners', {
      method: 'POST',
      body: JSON.stringify({ categories, max_concurrent }),
    }),
  patchListener: (
    id: string,
    body: Partial<{ categories: string[]; max_concurrent: number; rank: number }>,
  ) => req<AdminListener>(`/admin/listeners/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  listenerLink: (id: string) =>
    req<{ url: string }>(`/admin/listeners/${id}/console-link`, { method: 'POST' }),
  health: () => req<AdminHealth>('/admin/health/deep'),
  contributions: () => req<AdminContribution[]>('/admin/contributions'),
  admins: () => req<AdminAccountItem[]>('/admin/admins'),
  createAdmin: (name: string) =>
    req<{ id: string; url: string }>('/admin/admins', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  revokeAdmin: (id: string) =>
    req<{ status: string }>(`/admin/admins/${id}/revoke`, { method: 'POST' }),
  audit: () => req<AdminAuditItem[]>('/admin/audit'),

  // --- Listener applications (spec 2026-07-24) ---
  listApplications: (status?: string) =>
    req<AdminApplication[]>(`/admin/applications${status ? `?status=${status}` : ''}`),
  approveApplication: (id: string) =>
    req<AdminApplication>(`/admin/applications/${id}/approve`, { method: 'POST' }),
  declineApplication: (id: string, reason: string) =>
    req<AdminApplication>(`/admin/applications/${id}/decline`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
};
