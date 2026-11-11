/** One live event connection per role (member / listener): the app's replacement for polling.
 *
 * The server pushes tiny id-only events over `<api>/events` (a WebSocket); a screen that cares
 * refetches just the thing that changed. The socket is open only while it is useful:
 *   - at least one screen subscribes (a short linger covers screen-to-screen navigation),
 *   - the app is in the foreground (in the background FCM carries what matters, at no cost),
 *   - the network is up, and the role has a session.
 * Every `hello` (first connect AND every reconnect) emits a synthetic `resync`, so each screen
 * does exactly one catch-up fetch for whatever it may have missed while disconnected.
 *
 * Pure: every platform piece (socket, tokens, AppState, NetInfo, timers, randomness) is injected,
 * so the behaviour is unit-tested without React Native (e2e/live-events.test.cjs). */

export type LiveRole = 'member' | 'listener';
export type LiveStatus = 'live' | 'connecting' | 'offline' | 'unavailable';
export type LiveEvent = { t: string } & Record<string, unknown>;
export type LiveHandler = (event: LiveEvent) => void;

export interface LiveSocket {
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code?: number }) => void) | null;
  onerror: (() => void) | null;
  send(data: string): void;
  close(code?: number): void;
}

export type LiveDependencies = {
  url: string;
  createSocket(url: string): LiveSocket;
  /** The role's current bearer, or null when there is no session (the socket then stays shut). */
  getToken(role: LiveRole): Promise<string | null>;
  /** Force one refresh after a 4401; resolves when done (the next connect re-reads the token). */
  refreshToken(role: LiveRole): Promise<unknown>;
  appState: { current(): string | null | undefined; subscribe(cb: (state: string) => void): () => void };
  /** Emits true/false as connectivity changes (NetInfo fires once with the current state). */
  network: { subscribe(cb: (online: boolean) => void): () => void };
  timers?: { set(callback: () => void, ms: number): unknown; clear(handle: unknown): void };
  random?: () => number;
};

export const BACKOFF_BASE_MS = 1_000;
export const BACKOFF_CAP_MS = 60_000;
/** Never retry faster than this, even when full jitter draws ~0: no hot reconnect loop. */
export const BACKOFF_FLOOR_MS = 250;
/** A server without the endpoint (an older API) is retried this rarely. */
export const UNAVAILABLE_RETRY_MS = 300_000;
/** Closes before any hello, while online, on a server never seen live: then "unavailable". */
export const UNAVAILABLE_AFTER_STRIKES = 3;
export const HELLO_TIMEOUT_MS = 10_000;
/** Keep the socket across a quick screen change instead of closing and reopening it. */
export const LINGER_MS = 10_000;
/** Close codes from the server contract. */
export const CLOSE_AUTH_FAILED = 4401;
export const CLOSE_REPLACED = 4409;

export type LiveConnection = {
  /** Subscribe a handler to some event types (`resync` included when wanted). */
  subscribe(types: readonly string[], handler: LiveHandler): () => void;
  status(): LiveStatus;
  onStatus(listener: (status: LiveStatus) => void): () => void;
  /** The role's identity changed (sign-in, Start Fresh, sign-out): drop the socket and start over. */
  resetIdentity(): void;
};

/** `<api base>/events` as ws(s), with the same origin rules as the own-chat socket: https only,
 * plain http only for a local dev server, and never credentials, query or fragment in the URL. */
export function liveEventsUrl(apiBase: string): string {
  const url = new URL(apiBase);
  if (url.username || url.password || url.search || url.hash) throw new Error('invalid_events_origin');
  const local = ['localhost', '127.0.0.1', '[::1]', '10.0.2.2'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new Error('insecure_events_origin');
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = `${url.pathname.replace(/\/$/, '')}/events`;
  return url.toString();
}

/** Full-jitter exponential backoff: uniform in [floor, min(cap, base * 2^attempt)). */
export function backoffDelay(attempt: number, random: () => number): number {
  const ceiling = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** Math.min(attempt, 16));
  return Math.max(BACKOFF_FLOOR_MS, Math.floor(random() * ceiling));
}

const defaultTimers = {
  set: (callback: () => void, ms: number) => setTimeout(callback, ms),
  clear: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createLiveConnection(role: LiveRole, deps: LiveDependencies): LiveConnection {
  const timers = deps.timers ?? defaultTimers;
  const random = deps.random ?? Math.random;
  const handlers = new Map<string, Set<LiveHandler>>();
  const statusListeners = new Set<(status: LiveStatus) => void>();
  let subscribers = 0;
  let current: LiveStatus = 'offline';
  let socket: LiveSocket | null = null;
  let generation = 0;
  let foreground = false;
  let online = true;
  let attempt = 0;
  let strikes = 0;
  let everLive = false;
  let refreshedOnce = false;
  /** Replaced by a newer socket, or auth failed twice: stay shut until the next foreground. */
  let halted = false;
  let retry: unknown = null;
  let helloTimer: unknown = null;
  let linger: unknown = null;
  let detachApp: (() => void) | null = null;
  let detachNet: (() => void) | null = null;

  const setStatus = (next: LiveStatus) => {
    if (next === current) return;
    current = next;
    for (const listener of statusListeners) {
      try { listener(next); } catch { /* one listener never stops the others */ }
    }
  };
  /** Idle states keep "unavailable" sticky: an old server stays old across a background. */
  const idle = () => setStatus(current === 'unavailable' ? 'unavailable' : 'offline');
  const wanted = () => subscribers > 0 && foreground && online && !halted;
  const clearTimer = (handle: unknown) => { if (handle != null) timers.clear(handle); };

  function emit(event: LiveEvent) {
    const group = handlers.get(event.t);
    if (!group) return;
    for (const handler of group) {
      try { handler(event); } catch { /* a screen's handler never breaks the connection */ }
    }
  }

  function teardown() {
    generation += 1;
    clearTimer(retry); retry = null;
    clearTimer(helloTimer); helloTimer = null;
    const open = socket;
    socket = null;
    if (open) {
      open.onopen = open.onmessage = open.onclose = open.onerror = null;
      try { open.close(1000); } catch { /* already closed */ }
    }
  }

  function schedule(ms: number) {
    clearTimer(retry);
    retry = timers.set(() => { retry = null; if (wanted()) void connect(); }, ms);
  }

  function closed(mine: number, code: number, helloed: boolean) {
    if (mine !== generation) return;
    socket = null;
    clearTimer(helloTimer); helloTimer = null;
    if (!wanted()) { idle(); return; }
    if (code === CLOSE_REPLACED) { halted = true; idle(); return; }
    if (code === CLOSE_AUTH_FAILED) {
      if (refreshedOnce) { halted = true; idle(); return; }
      refreshedOnce = true;
      setStatus('connecting');
      void Promise.resolve()
        .then(() => deps.refreshToken(role))
        .catch(() => undefined)
        .then(() => { if (mine === generation && wanted()) void connect(); });
      return;
    }
    if (!helloed && !everLive) {
      strikes += 1;
      if (strikes >= UNAVAILABLE_AFTER_STRIKES) {
        setStatus('unavailable');
        schedule(UNAVAILABLE_RETRY_MS);
        return;
      }
    }
    if (current !== 'unavailable') setStatus('connecting');
    schedule(current === 'unavailable' ? UNAVAILABLE_RETRY_MS : backoffDelay(attempt, random));
    attempt = Math.min(attempt + 1, 16);
  }

  async function connect() {
    clearTimer(retry); retry = null;
    if (socket) return;
    const mine = ++generation;
    if (current !== 'unavailable') setStatus('connecting');
    let token: string | null = null;
    try { token = await deps.getToken(role); } catch { token = null; }
    if (mine !== generation || !wanted()) return;
    if (!token) { idle(); return; } // no session: nothing to listen for until something changes
    let opened: LiveSocket;
    try { opened = deps.createSocket(deps.url); } catch { closed(mine, 1006, false); return; }
    socket = opened;
    let helloed = false;
    helloTimer = timers.set(() => {
      helloTimer = null;
      if (mine !== generation || helloed) return;
      const stale = socket;
      socket = null;
      if (stale) {
        stale.onopen = stale.onmessage = stale.onclose = stale.onerror = null;
        try { stale.close(1000); } catch { /* ignore */ }
      }
      closed(mine, 1006, false);
    }, HELLO_TIMEOUT_MS);
    opened.onopen = () => {
      if (mine !== generation) return;
      try { opened.send(JSON.stringify({ t: 'auth', token, role })); } catch { /* onclose follows */ }
    };
    opened.onmessage = (message) => {
      if (mine !== generation || typeof message.data !== 'string') return;
      let frame: unknown;
      try { frame = JSON.parse(message.data); } catch { return; }
      if (!frame || typeof frame !== 'object' || typeof (frame as { t?: unknown }).t !== 'string') return;
      const event = frame as LiveEvent;
      if (event.t === 'hello') {
        if (helloed) return;
        helloed = true;
        clearTimer(helloTimer); helloTimer = null;
        attempt = 0; strikes = 0; everLive = true; refreshedOnce = false;
        setStatus('live');
        emit({ t: 'resync' });
        return;
      }
      // Nothing counts before hello, and `resync` is ours alone: a server frame never fakes it.
      if (!helloed || event.t === 'resync') return;
      emit(event);
    };
    opened.onclose = (event) => closed(mine, typeof event?.code === 'number' ? event.code : 1006, helloed);
    opened.onerror = () => { /* onclose always follows; it decides */ };
  }

  function evaluate() {
    if (wanted()) {
      if (socket || retry != null) return;
      if (current === 'unavailable') { schedule(UNAVAILABLE_RETRY_MS); return; }
      void connect();
    } else {
      teardown();
      idle();
    }
  }

  function onApp(state: string) {
    const nowForeground = state === 'active';
    if (nowForeground === foreground) return;
    foreground = nowForeground;
    if (foreground) {
      halted = false; refreshedOnce = false; attempt = 0;
    }
    evaluate();
  }

  function onNet(isOnline: boolean) {
    if (isOnline === online) return;
    online = isOnline;
    if (online) attempt = 0;
    evaluate();
  }

  function attach() {
    if (detachApp) return;
    foreground = deps.appState.current() === 'active';
    detachApp = deps.appState.subscribe(onApp);
    detachNet = deps.network.subscribe(onNet);
  }

  function detach() {
    detachApp?.(); detachNet?.();
    detachApp = detachNet = null;
  }

  return {
    subscribe(types, handler) {
      for (const type of types) {
        const group = handlers.get(type) ?? new Set<LiveHandler>();
        handlers.set(type, group);
        group.add(handler);
      }
      subscribers += 1;
      clearTimer(linger); linger = null;
      attach();
      evaluate();
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        for (const type of types) {
          const group = handlers.get(type);
          group?.delete(handler);
          if (group && group.size === 0) handlers.delete(type);
        }
        subscribers -= 1;
        if (subscribers > 0) return;
        clearTimer(linger);
        linger = timers.set(() => {
          linger = null;
          if (subscribers > 0) return;
          teardown();
          detach();
          idle();
        }, LINGER_MS);
      };
    },
    status: () => current,
    onStatus(listener) {
      statusListeners.add(listener);
      return () => { statusListeners.delete(listener); };
    },
    resetIdentity() {
      teardown();
      halted = false; refreshedOnce = false; attempt = 0;
      if (current === 'live') setStatus('connecting');
      evaluate();
    },
  };
}
