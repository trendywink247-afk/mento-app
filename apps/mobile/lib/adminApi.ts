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
  /** The mentor's face (services/mentor_face.py) — drawn with `MentorFace`, as members see them. */
  companion_animal?: string | null;
  companion_colour?: string | null;
  /** The mentor asked the team to step their mentor side back (lane u14); the list puts
   * live mentors with a waiting ask first. Suspend handles it; reinstate clears it. */
  step_back_requested_at?: string | null;
  step_back_reason?: string | null;
};
export type AdminModerationItem = {
  id: string;
  reporter_id: string | null;
  /** null = the reported member has since erased their account (DELETE /me). */
  subject_id: string | null;
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
  /** Board A37 chips in day order; [] for an application from an older build. */
  available_times?: string[];
  email: string | null;
  mentor_interest: boolean;
  status: 'pending' | 'approved' | 'declined';
  created_at: string;
};

/** Board A13 — one IST day of message-allowance counts. Numbers only: no ids, names, text. */
export type AdminAllowanceDay = {
  /** "YYYY-MM-DD" (IST); on `totals` it is the window, "first/last". */
  day: string;
  messages_sent: number;
  crisis_exempt_sends: number;
  in_a_row_pauses: number;
  members_paused_in_a_row: number;
  daily_cap_holds: number;
  members_reached_daily_cap: number;
};
export type AdminAllowance = {
  rule: {
    in_a_row: number;
    per_day: number;
    enforced: boolean;
    crisis_exempt_hours: number;
    timezone: string;
  };
  /** Oldest first, zero-filled. */
  days: AdminAllowanceDay[];
  totals: AdminAllowanceDay;
};
export type FeedbackCategory = 'broken' | 'confusing' | 'idea';
export type FeedbackRole = 'member' | 'mentor';
/** Board A11's notes, as the team reads them. No author exists — only which side wrote. */
export type AdminFeedbackItem = {
  id: string;
  created_at: string;
  role: FeedbackRole;
  category: FeedbackCategory;
  text: string;
  screen: string | null;
  app_version: string | null;
};
export type AdminFeedbackPage = {
  total: number;
  limit: number;
  offset: number;
  items: AdminFeedbackItem[];
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
  /** Only while the conversation has an open flag or report (else 403 `no_open_case`), and
   * only with a stated reason (8+ characters) — the reason is written to the audit trail. */
  conversationMessages: (id: string, reason: string) =>
    req<AdminMessage[]>(
      `/admin/conversations/${id}/messages?reason=${encodeURIComponent(reason.trim())}`,
    ),
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

  // --- Board port (2026-09-19): both reads are audited server-side ---
  /** `allowance.viewed` audit row per read. `days` 1–30. */
  allowance: (days = 14) => req<AdminAllowance>(`/admin/allowance?days=${days}`),
  /** `feedback.viewed` audit row per read. Newest first. */
  feedback: (
    opts: { limit?: number; offset?: number; category?: FeedbackCategory | null; role?: FeedbackRole | null } = {},
  ) => {
    const q = new URLSearchParams({ limit: String(opts.limit ?? 50), offset: String(opts.offset ?? 0) });
    if (opts.category) q.set('category', opts.category);
    if (opts.role) q.set('role', opts.role);
    return req<AdminFeedbackPage>(`/admin/feedback?${q.toString()}`);
  },
};
