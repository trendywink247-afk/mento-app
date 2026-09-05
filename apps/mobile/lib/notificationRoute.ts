/** Where a notification tap lands (spec 2026-09-05 push §6). Pure: no I/O, no RN. */
export type PushData =
  | { kind: 'request'; request_id: string }
  | { kind: 'accepted'; conversation_id: string; stream_channel_id: string | null }
  | { kind: 'message'; conversation_id: string; stream_channel_id: string | null };

export type RouteCtx = {
  hasMemberSession: boolean;
  hasListenerToken: boolean;
  /** Member-owned conversation ids, resolved lazily for `message` taps. */
  memberConversationIds?: Set<string>;
};

export type Route = { pathname: string; params?: Record<string, string> };

export function routeForNotification(data: PushData | null | undefined, ctx: RouteCtx): Route | null {
  if (!data) return null;
  if (data.kind === 'request') return ctx.hasListenerToken ? { pathname: '/mentor-home' } : null;
  if (data.kind === 'accepted') {
    return ctx.hasMemberSession
      ? { pathname: '/chat/[id]', params: { id: data.conversation_id, channel: data.stream_channel_id ?? '' } }
      : null;
  }
  const mine = ctx.memberConversationIds?.has(data.conversation_id) ?? false;
  if (mine && ctx.hasMemberSession) {
    return { pathname: '/chat/[id]', params: { id: data.conversation_id, channel: data.stream_channel_id ?? '' } };
  }
  if (ctx.hasListenerToken) {
    return { pathname: '/mentor/chat/[id]', params: { id: data.conversation_id, channel: data.stream_channel_id ?? '' } };
  }
  if (ctx.hasMemberSession) return { pathname: '/chats' };
  return null;
}
