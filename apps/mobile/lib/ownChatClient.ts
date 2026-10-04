/** Own-chat protocol core. Deliberately inactive until the screens select a
 * server-owned transport. No shared singleton, storage, logging or fetch calls.
 * Pending bodies live in memory only: disconnect retains them; forget destroys them.
 * Screens, API/auth adapters and a durable device outbox are separate follow-ups.
 * Unconfirmed sends retry the same id up to five times; a lost held response is
 * ambiguous. A received held/failed response always requires explicit retry.
 */

export type OwnChatScope = Readonly<{
  conversationId: string;
  actorId: string;
  role: 'member' | 'mentor';
}>;

export type OwnChatMessage = {
  id: string;
  seq: number;
  sender: string;
  sender_kind: 'member' | 'mentor';
  client_id: string;
  text: string;
  ts: string;
  crisis?: Record<string, unknown>;
  moderation?: { redacted: boolean };
};

export type OwnChatPending = {
  clientId: string;
  text: string;
  status: 'queued' | 'sending' | 'held' | 'failed';
  attempts: number;
  code?: string;
  allowance?: Record<string, unknown>;
};

export type OwnChatSnapshot = {
  scopeKey: string;
  status: 'idle' | 'connecting' | 'syncing' | 'ready' | 'reconnecting' | 'stopped' | 'terminal';
  reason?: string;
  after: number;
  messages: OwnChatMessage[];
  pending: OwnChatPending[];
  peerOnline: boolean;
  peerTyping: boolean;
  read: Record<string, number>;
};

export interface OwnChatSocket {
  onopen: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onclose: ((event: { code: number }) => void) | null;
  onerror: (() => void) | null;
  send(data: string): void;
  close(): void;
}

export type OwnChatDependencies = {
  /** Must create a URL without credentials. Authentication is the first frame. */
  createSocket(scope: OwnChatScope): OwnChatSocket;
  /** Refresh through the existing role's auth layer; never reuse a Stream token. */
  getToken(scope: OwnChatScope): Promise<string>;
  /** Use the role's API adapter, with timeout/errors, and bearer authentication. */
  history(scope: OwnChatScope, after: number, token: string): Promise<{
    messages: OwnChatMessage[];
    last_seq: number;
  }>;
  onChange(snapshot: OwnChatSnapshot): void;
  random?: () => number;
  timers?: { set(callback: () => void, ms: number): unknown; clear(handle: unknown): void };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const isSeq = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const isMessage = (value: unknown): value is OwnChatMessage =>
  isRecord(value) && typeof value.id === 'string' && isSeq(value.seq) && value.seq > 0 &&
  typeof value.sender === 'string' && (value.sender_kind === 'member' || value.sender_kind === 'mentor') &&
  typeof value.client_id === 'string' && typeof value.text === 'string' && typeof value.ts === 'string';

export function createOwnChatClient(scopeInput: OwnChatScope, dependencies: OwnChatDependencies) {
  const scope = Object.freeze({ ...scopeInput });
  const scopeKey = JSON.stringify([scope.role, scope.actorId, scope.conversationId]);
  const timers = dependencies.timers ?? {
    set: (callback: () => void, ms: number) => setTimeout(callback, ms),
    clear: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  const messages = new Map<number, OwnChatMessage>();
  const pending = new Map<string, OwnChatPending>();
  const handles = new Set<unknown>();
  const abortOperations = new Set<() => void>();
  let socket: OwnChatSocket | undefined;
  let generation = 0;
  let active = false;
  let terminal = false;
  let attempts = 0;
  let after = 0;
  let target = 0;
  let syncingGeneration = -1;
  let status: OwnChatSnapshot['status'] = 'idle';
  let reason: string | undefined;
  let peerOnline = false;
  let peerTyping = false;
  let read: Record<string, number> = {};
  let pongDeadline: unknown;
  let typingDeadline: unknown;

  function snapshot(): OwnChatSnapshot {
    return {
      scopeKey, status, reason, after, peerOnline, peerTyping, read: { ...read },
      messages: [...messages.values()].sort((a, b) => a.seq - b.seq).map((m) => ({ ...m })),
      pending: [...pending.values()].map((p) => ({ ...p })),
    };
  }
  const notify = () => dependencies.onChange(snapshot());
  function later(callback: () => void, ms: number) {
    const handle = timers.set(() => { handles.delete(handle); callback(); }, ms);
    handles.add(handle);
    return handle;
  }
  function cancel(handle: unknown) {
    if (handles.delete(handle)) timers.clear(handle);
  }
  async function bounded<T>(operation: Promise<T>): Promise<T> {
    let deadline: unknown;
    let abort: (() => void) | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          abort = () => reject(new Error('connection_cancelled'));
          abortOperations.add(abort);
          deadline = later(() => reject(new Error('request_timeout')), 10_000);
        }),
      ]);
    } finally {
      cancel(deadline);
      if (abort) abortOperations.delete(abort);
    }
  }
  function cleanConnection() {
    generation++;
    for (const abort of abortOperations) abort();
    abortOperations.clear();
    for (const handle of handles) timers.clear(handle);
    handles.clear();
    const old = socket;
    socket = undefined;
    if (old) {
      old.onopen = old.onmessage = old.onclose = old.onerror = null;
      try { old.close(); } catch { /* Cleanup must finish even if native close fails. */ }
    }
    peerOnline = peerTyping = false;
    for (const item of pending.values()) if (item.status === 'sending') item.status = 'queued';
  }
  function finish(code: string, wipe = false) {
    active = false;
    terminal = true;
    cleanConnection();
    status = 'terminal';
    reason = code;
    if (wipe) { messages.clear(); pending.clear(); after = target = 0; read = {}; }
    else for (const item of pending.values()) {
      item.status = 'failed'; item.code = code;
    }
    notify();
  }
  function reconnect(code: string) {
    if (!active || terminal) return;
    cleanConnection();
    reason = code;
    if (attempts >= 8) {
      active = false; status = 'stopped'; reason = 'reconnect_exhausted'; notify(); return;
    }
    const delay = Math.min(30_000, 500 * 2 ** attempts++) *
      (0.75 + (dependencies.random ?? Math.random)() * 0.5);
    status = 'reconnecting';
    notify();
    later(connect, delay);
  }
  function write(frame: Record<string, unknown>) {
    try { socket?.send(JSON.stringify(frame)); }
    catch { reconnect('connection_lost'); }
  }
  function accept(message: OwnChatMessage, authoritative = false) {
    const existing = messages.get(message.seq);
    if (existing && existing.id !== message.id) throw new Error('sequence_conflict');
    messages.set(message.seq, { ...message });
    if (message.sender === scope.actorId && message.sender_kind === scope.role) {
      pending.delete(message.client_id);
    }
    if (authoritative) after = Math.max(after, message.seq);
    while (messages.has(after + 1)) after++;
    target = Math.max(target, message.seq);
  }
  function flush() {
    if (status !== 'ready') return;
    for (const item of pending.values()) {
      if (item.status !== 'queued') continue;
      if (item.attempts >= 5) {
        item.status = 'failed'; item.code = 'delivery_unconfirmed'; continue;
      }
      item.status = 'sending';
      item.attempts++;
      write({ t: 'send', client_id: item.clientId, text: item.text });
      if (status !== 'ready') break;
      const current = generation;
      later(() => {
        if (current === generation && pending.get(item.clientId)?.status === 'sending') {
          reconnect('ack_timeout');
        }
      }, 15_000);
    }
    notify();
  }
  async function catchUp(current: number, discoverTail = false) {
    if (syncingGeneration === current) return;
    syncingGeneration = current;
    if (status !== 'ready' || after < target) status = 'syncing';
    notify();
    try {
      while ((after < target || discoverTail) && current === generation) {
        const previous = after;
        const token = await bounded(dependencies.getToken(scope));
        if (current !== generation) return;
        const page = await bounded(dependencies.history(scope, previous, token));
        if (current !== generation) return;
        if (!isSeq(page.last_seq) || !Array.isArray(page.messages) || !page.messages.every(isMessage)) {
          throw new Error('bad_history');
        }
        if (page.last_seq < previous) { finish('history_reset', true); return; }
        if (discoverTail) target = Math.max(target, page.last_seq);
        discoverTail = false;
        // REST is authoritative about retention gaps; sockets alone cannot skip a gap.
        for (const message of [...page.messages].sort((a, b) => a.seq - b.seq)) accept(message, true);
        if (after <= previous && after < target) throw new Error('incomplete_history');
        // Catch up to the opening snapshot and any socket events received since.
        // Do not chase an ever-growing REST last_seq and starve the composer.
      }
      if (current !== generation) return;
      syncingGeneration = -1;
      attempts = 0;
      status = 'ready'; reason = undefined;
      flush();
    } catch {
      if (current === generation) reconnect('history_unavailable');
    }
  }
  function heartbeat(current: number) {
    later(() => {
      if (current !== generation) return;
      write({ t: 'ping' });
      if (current !== generation) return;
      pongDeadline = later(() => reconnect('ping_timeout'), 15_000);
      heartbeat(current);
    }, 25_000);
  }
  function receive(raw: string, current: number, helloDeadline: unknown) {
    if (current !== generation) return;
    try {
      const frame: unknown = JSON.parse(raw);
      if (!isRecord(frame)) throw new Error('bad_frame');
      if (status === 'connecting' && frame.t !== 'hello') throw new Error('hello_required');
      if (frame.t === 'hello') {
        if (status !== 'connecting' || frame.side !== scope.role || !isSeq(frame.last_seq)) {
          throw new Error('bad_hello');
        }
        if (frame.last_seq < after) { finish('history_reset', true); return; }
        cancel(helloDeadline);
        target = Math.max(after, frame.last_seq);
        peerOnline = frame.peer_online === true;
        if (isRecord(frame.read)) for (const [who, seq] of Object.entries(frame.read)) {
          if (isSeq(seq)) read[who] = Math.max(read[who] ?? 0, seq);
        }
        heartbeat(current);
        void catchUp(current);
      } else if (frame.t === 'message') {
        if (!isMessage(frame.message)) throw new Error('bad_message');
        accept(frame.message);
        if (after < target) void catchUp(current);
        notify();
      } else if (frame.t === 'pong') {
        cancel(pongDeadline);
        // Pub/sub may lose the final event even on a healthy socket. A bounded
        // authoritative tail check also repairs that case without waiting for a gap.
        void catchUp(current, true);
      }
      else if (frame.t === 'wiped') finish('wiped', true);
      // Wiped and ended are separate lossy events. An ended event alone cannot
      // establish that keeping the transcript is safe; read-only history is a
      // separate, freshly authorized screen integration.
      else if (frame.t === 'ended') finish('ended', true);
      else if (frame.t === 'presence' && frame.user !== scope.actorId) {
        peerOnline = frame.online === true; notify();
      } else if (frame.t === 'typing' && frame.from !== scope.actorId) {
        peerTyping = frame.on === true;
        cancel(typingDeadline);
        if (peerTyping) typingDeadline = later(() => { peerTyping = false; notify(); }, 6_000);
        notify();
      } else if (frame.t === 'read' && typeof frame.by === 'string' && isSeq(frame.seq)) {
        read[frame.by] = Math.max(read[frame.by] ?? 0, frame.seq); notify();
      } else if ((frame.t === 'held' || frame.t === 'error') && typeof frame.client_id === 'string') {
        if (frame.t === 'error' && typeof frame.code === 'string' &&
            ['ended', 'not_a_participant', 'member_suspended', 'member_banned', 'mentor_suspended'].includes(frame.code)) {
          finish(frame.code, true);
          return;
        }
        const item = pending.get(frame.client_id);
        if (item) {
          item.status = frame.t === 'held' ? 'held' : 'failed';
          item.code = typeof frame.code === 'string' ? frame.code : 'held';
          if (isRecord(frame.allowance)) item.allowance = frame.allowance;
          notify();
        }
      }
    } catch { reconnect('protocol_error'); }
  }
  async function connect() {
    if (!active || terminal) return;
    status = 'connecting';
    const current = generation;
    notify();
    try {
      // The server allows only five seconds for its first frame. Refresh before
      // creating the socket so a slow auth request cannot spend that deadline.
      const token = await bounded(dependencies.getToken(scope));
      if (current !== generation) return;
      const deadline = later(() => reconnect('hello_timeout'), 10_000);
      socket = dependencies.createSocket(scope);
      socket.onopen = () => { if (current === generation) write({ t: 'hello', token, after }); };
      socket.onmessage = (event) => receive(event.data, current, deadline);
      socket.onerror = () => { if (current === generation) reconnect('connection_lost'); };
      socket.onclose = (event) => {
        if (current !== generation) return;
        const terminalCodes: Record<number, string> = {
          4403: 'not_authorized', 4409: 'replaced', 4410: 'ended', 4400: 'protocol_error', 1009: 'too_large',
        };
        // A bare authorization/end close may follow a wipe while offline. Do not
        // retain a transcript whose continued visibility cannot be established.
        if (terminalCodes[event.code]) finish(terminalCodes[event.code], [4403, 4410].includes(event.code));
        else reconnect('connection_lost');
      };
    } catch { if (current === generation) reconnect('connection_lost'); }
  }
  return {
    snapshot,
    start() {
      if (active || terminal) return;
      active = true; attempts = 0; reason = undefined; return connect();
    },
    stop() {
      if (terminal) return;
      active = false; cleanConnection(); status = 'stopped'; notify();
    },
    /** Terminal local erasure. A new identity/conversation needs a new client. */
    forget() { finish('forgotten', true); },
    send(clientId: string, text: string) {
      if (terminal) throw new Error('conversation_closed');
      const body = text.trim();
      if (!clientId || clientId !== clientId.trim() || clientId.length > 64 || !body || body.length > 4000) {
        throw new Error('invalid_message');
      }
      const prior = pending.get(clientId);
      if (prior) {
        if (prior.text !== body) throw new Error('client_id_reused');
        return;
      }
      if ([...messages.values()].some((m) => m.sender === scope.actorId && m.client_id === clientId)) {
        throw new Error('client_id_already_sent');
      }
      if (pending.size >= 50) throw new Error('pending_full');
      pending.set(clientId, { clientId, text: body, status: 'queued', attempts: 0 });
      flush();
      if (status !== 'ready') notify();
    },
    /** Held/failed sends require explicit intent, never an automatic retry loop. */
    retry(clientId: string) {
      if (terminal) return;
      const item = pending.get(clientId);
      if (!item || item.status === 'sending') return;
      item.status = 'queued'; item.attempts = 0; delete item.code; delete item.allowance;
      flush();
    },
    discard(clientId: string) { pending.delete(clientId); notify(); },
    typing(on: boolean) { if (status === 'ready') write({ t: 'typing', on }); },
    markRead(seq: number) {
      if (status === 'ready' && isSeq(seq)) write({ t: 'read', seq: Math.min(seq, after) });
    },
  };
}
