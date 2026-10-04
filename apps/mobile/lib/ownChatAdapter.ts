/** Own-chat integration foundation. Existing screens continue using Stream.
 * Requires explicit acceptance opt-in AND server-owned conversation transport.
 * Tokens are bound to one role/account, never placed in URLs or persisted here.
 */
import {
  createOwnChatClient, type OwnChatDependencies, type OwnChatMessage,
  type OwnChatScope, type OwnChatSocket,
} from './ownChatClient';
import { registerOwnChat } from './ownChatLifecycle';

export type ChatTransport = 'stream' | 'own';
export class OwnChatSendError extends Error {
  constructor(public code: string, public allowance?: Record<string, unknown>) {
    super(code);
  }
}
export function selectChatTransport(transport?: string | null, ownAccepted = false): ChatTransport {
  if (transport == null || transport === 'stream') return 'stream';
  if (transport !== 'own') throw new Error('unknown_chat_transport');
  if (!ownAccepted) throw new Error('own_chat_not_accepted');
  return 'own';
}

export function ownChatSocketUrl(apiBase: string, conversationId: string): string {
  if (!conversationId || conversationId === '.' || conversationId === '..' || /[\u0000-\u001f\u007f]/.test(conversationId)) {
    throw new Error('invalid_conversation');
  }
  const url = new URL(apiBase);
  if (url.username || url.password || url.search || url.hash) throw new Error('invalid_chat_origin');
  const local = ['localhost', '127.0.0.1', '[::1]', '10.0.2.2'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new Error('insecure_chat_origin');
  }
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = `${url.pathname.replace(/\/$/, '')}/chat/ws/${encodeURIComponent(conversationId)}`;
  return url.toString();
}

export type OwnChatAdapterDependencies = {
  apiBase: string;
  getToken(role: OwnChatScope['role']): Promise<string | null>;
  /** Must execute with this exact bearer, not an implicit member session. */
  request<T>(path: string, token: string): Promise<T>;
  createSocket(url: string): OwnChatSocket;
  onChange: OwnChatDependencies['onChange'];
  timers?: OwnChatDependencies['timers'];
};

export function createOwnChatAdapter(
  scope: OwnChatScope,
  options: { transport: string; ownAccepted?: boolean },
  dependencies: OwnChatAdapterDependencies,
) {
  if (selectChatTransport(options.transport, options.ownAccepted) !== 'own') {
    throw new Error('conversation_uses_stream');
  }
  if (!scope.actorId || !scope.conversationId || !['member', 'mentor'].includes(scope.role)) {
    throw new Error('invalid_chat_scope');
  }
  const boundScope = Object.freeze({ ...scope });
  const url = ownChatSocketUrl(dependencies.apiBase, boundScope.conversationId);
  let disposed = false;
  type Waiter = { resolve(message: OwnChatMessage): void; reject(error: OwnChatSendError): void };
  const waiters = new Map<string, Set<Waiter>>();
  function rejectAll(code: string) {
    for (const group of waiters.values()) for (const waiter of group) waiter.reject(new OwnChatSendError(code));
  }
  const checkActive = () => { if (disposed) throw new Error('chat_disposed'); };
  const client = createOwnChatClient(boundScope, {
    onChange(snapshot) {
      for (const [id, group] of waiters) {
        const message = snapshot.messages.find(m => m.client_id === id &&
          m.sender === boundScope.actorId && m.sender_kind === boundScope.role);
        const pending = snapshot.pending.find(item => item.clientId === id);
        for (const waiter of group) {
          if (message) waiter.resolve(message);
          else if (pending?.status === 'held' || pending?.status === 'failed') {
            waiter.reject(new OwnChatSendError(pending.code ?? pending.status, pending.allowance));
          } else if (snapshot.status === 'terminal' || snapshot.status === 'stopped') {
            waiter.reject(new OwnChatSendError(snapshot.reason ?? 'send_stopped'));
          }
        }
      }
      dependencies.onChange(snapshot);
    }, timers: dependencies.timers,
    async getToken() {
      checkActive();
      const token = await dependencies.getToken(boundScope.role);
      if (!token) throw new Error('chat_session_missing');
      const identity = await dependencies.request<{ id: string }>(
        boundScope.role === 'member' ? '/me' : '/listener/me', token,
      );
      checkActive();
      if (identity.id !== boundScope.actorId) throw new Error('chat_identity_changed');
      if (await dependencies.getToken(boundScope.role) !== token) throw new Error('chat_session_changed');
      checkActive();
      return token;
    },
    createSocket() {
      checkActive();
      return dependencies.createSocket(url);
    },
    async history(_scope, after, token) {
      checkActive();
      if (await dependencies.getToken(boundScope.role) !== token) throw new Error('chat_session_changed');
      const response = await dependencies.request<{ messages: OwnChatMessage[]; last_seq: number }>(
        `/chat/${encodeURIComponent(boundScope.conversationId)}/messages?after=${after}`, token,
      );
      checkActive();
      // Never release a response to a screen after its account was replaced.
      if (await dependencies.getToken(boundScope.role) !== token) throw new Error('chat_session_changed');
      checkActive();
      return response;
    },
  });
  const unregister = registerOwnChat(boundScope.role, () => {
    disposed = true;
    client.forget();
  });
  return {
    ...client,
    /** Resolve only for a persisted echo/history acknowledgement, never queueing.
     * A timeout/cancel is ambiguous once sent: callers must reuse this clientId
     * rather than minting another id for the same draft.
     */
    sendAndWait(clientId: string, text: string, options: { signal?: AbortSignal; timeoutMs?: number } = {}) {
      checkActive();
      const timeoutMs = options.timeoutMs ?? 15_000;
      if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
        return Promise.reject(new OwnChatSendError('invalid_send_timeout'));
      }
      if (options.signal?.aborted) return Promise.reject(new OwnChatSendError('send_cancelled'));
      const acknowledged = client.snapshot().messages.find(m => m.client_id === clientId &&
        m.sender === boundScope.actorId && m.sender_kind === boundScope.role);
      if (acknowledged) {
        return acknowledged.text === text.trim() ? Promise.resolve(acknowledged) :
          Promise.reject(new OwnChatSendError('client_id_reused'));
      }
      if ([...waiters.values()].reduce((count, group) => count + group.size, 0) >= 50) {
        return Promise.reject(new OwnChatSendError('send_waiters_full'));
      }
      return new Promise<OwnChatMessage>((resolve, reject) => {
        let deadline: unknown;
        const timers = dependencies.timers ?? {
          set: (fn: () => void, ms: number) => setTimeout(fn, ms),
          clear: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
        };
        const group = waiters.get(clientId) ?? new Set<Waiter>();
        const cleanup = () => {
          timers.clear(deadline);
          options.signal?.removeEventListener('abort', cancel);
          group.delete(waiter);
          if (!group.size) waiters.delete(clientId);
        };
        const waiter: Waiter = {
          resolve: message => { cleanup(); resolve(message); },
          reject: error => { cleanup(); reject(error); },
        };
        const cancel = () => waiter.reject(new OwnChatSendError('send_cancelled'));
        group.add(waiter); waiters.set(clientId, group);
        options.signal?.addEventListener('abort', cancel, { once: true });
        deadline = timers.set(() => waiter.reject(new OwnChatSendError('send_timeout')), timeoutMs);
        try {
          client.send(clientId, text);
          const pending = client.snapshot().pending.find(item => item.clientId === clientId);
          if (pending?.status === 'held' || pending?.status === 'failed') {
            waiter.reject(new OwnChatSendError(pending.code ?? pending.status, pending.allowance));
          }
        } catch (error) {
          waiter.reject(new OwnChatSendError(error instanceof Error ? error.message : 'send_failed'));
        }
      });
    },
    discard(clientId: string) {
      for (const waiter of waiters.get(clientId) ?? []) waiter.reject(new OwnChatSendError('send_cancelled'));
      client.discard(clientId);
    },
    dispose() {
      disposed = true;
      unregister();
      rejectAll('chat_disposed');
      client.forget();
    },
  };
}
