/** App bindings for the live event connection (lib/liveEventsCore.ts) and the hooks screens use
 * instead of polling:
 *   - useLiveEvent(role, types, handler): run a handler for pushed events.
 *   - useLiveStatus(role) / liveStatus(role): 'live' | 'connecting' | 'offline' | 'unavailable'.
 *   - useLiveRefresh(role, types, refresh, …): the standard screen recipe — fetch on focus, once on
 *     every (re)connect (`resync`), and on each relevant event; coalesced so a burst of events is one
 *     fetch. Only against an older server without the endpoint ('unavailable') does it fall back to a
 *     single slow focused refresh every FALLBACK_REFRESH_MS. Never faster. */
import NetInfo from '@react-native-community/netinfo';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { API_BASE_URL, currentMemberToken, refreshMemberToken } from './api';
import { getListenerToken } from './listenerSession';
import {
  createLiveConnection, liveEventsUrl, type LiveConnection, type LiveEvent, type LiveRole,
  type LiveSocket, type LiveStatus,
} from './liveEventsCore';
import { createEventFetch, type EventFetch } from './eventFetch';
import { registerOwnChat } from './ownChatLifecycle';

export type { LiveEvent, LiveRole, LiveStatus } from './liveEventsCore';

/** The slowest-possible safety net against a server that cannot push (older API builds). */
export const FALLBACK_REFRESH_MS = 120_000;

const connections = new Map<LiveRole, LiveConnection>();

function connection(role: LiveRole): LiveConnection {
  const existing = connections.get(role);
  if (existing) return existing;
  let url: string | null = null;
  try { url = liveEventsUrl(API_BASE_URL); } catch { url = null; }
  const created = createLiveConnection(role, {
    // An unusable origin (http to a non-local host) never opens: it simply stays unavailable.
    url: url ?? 'ws://invalid.invalid/events',
    createSocket: (target) => {
      if (!url) throw new Error('events_origin_refused');
      return new WebSocket(target) as unknown as LiveSocket;
    },
    getToken: (r) => (r === 'member' ? currentMemberToken() : getListenerToken()),
    refreshToken: (r) => (r === 'member' ? refreshMemberToken() : getListenerToken()),
    appState: {
      current: () => AppState.currentState,
      subscribe: (cb) => {
        const sub = AppState.addEventListener('change', cb);
        return () => sub.remove();
      },
    },
    network: {
      subscribe: (cb) => NetInfo.addEventListener((state) => cb(state.isConnected !== false)),
    },
  });
  connections.set(role, created);
  // Sign-in, Start Fresh and sign-out already notify own-chat observers per role; the same hook
  // drops a socket that is still authenticated as the previous identity. One-shot registry, so
  // re-register after each call.
  const lifecycleRole = role === 'member' ? 'member' : 'mentor';
  const watch = () => registerOwnChat(lifecycleRole, () => { created.resetIdentity(); watch(); });
  watch();
  return created;
}

export function liveStatus(role: LiveRole): LiveStatus {
  return connection(role).status();
}

export function useLiveStatus(role: LiveRole): LiveStatus {
  const conn = connection(role);
  return useSyncExternalStore(
    (onChange) => conn.onStatus(onChange),
    () => conn.status(),
    () => conn.status(),
  );
}

/** Subscribe while mounted and `enabled`. The handler may change every render without
 * resubscribing; `types` resubscribe only when their contents change. */
export function useLiveEvent(
  role: LiveRole,
  types: readonly string[],
  handler: (event: LiveEvent) => void,
  enabled = true,
): void {
  const latest = useRef(handler);
  latest.current = handler;
  const key = types.join('|');
  useEffect(() => {
    if (!enabled) return;
    return connection(role).subscribe(key.split('|'), (event) => latest.current(event));
  }, [role, key, enabled]);
}

/** Fetch on focus, on every (re)connect and on matching events; coalesced; slow fallback only
 * against a server that cannot push. `match` filters events (e.g. by id); `resync` always counts. */
export function useLiveRefresh(
  role: LiveRole,
  types: readonly string[],
  refresh: () => unknown,
  options: { enabled?: boolean; match?: (event: LiveEvent) => boolean; onFocus?: boolean } = {},
): void {
  const { enabled = true, match, onFocus = true } = options;
  const latest = useRef(refresh);
  latest.current = refresh;
  const matcher = useRef(match);
  matcher.current = match;
  const running = useRef(false);
  const again = useRef(false);
  const focused = useRef(false);
  // Pushed events settle for a moment into one fetch, and a fetch that began after the latest
  // event (focus, an action) already covers it (lib/eventFetch.ts). Focus itself runs at once.
  const settled = useRef<EventFetch | null>(null);
  const runRef = useRef<() => void>(() => undefined);
  if (!settled.current) settled.current = createEventFetch(() => runRef.current());
  useEffect(() => () => settled.current?.cancel(), []);

  const run = useCallback(() => {
    // Coalesce: while one fetch is in flight, any number of events become ONE follow-up fetch.
    if (running.current) { again.current = true; return; }
    running.current = true;
    settled.current?.started();
    void Promise.resolve()
      .then(() => latest.current())
      .catch(() => undefined)
      .finally(() => {
        running.current = false;
        if (again.current) { again.current = false; run(); }
      });
  }, []);
  runRef.current = run;

  useLiveEvent(
    role,
    ['resync', ...types],
    (event) => {
      if (event.t !== 'resync' && matcher.current && !matcher.current(event)) return;
      settled.current?.onEvent();
    },
    enabled,
  );

  const status = useLiveStatus(role);
  useFocusEffect(
    useCallback(() => {
      if (!enabled) return;
      focused.current = true;
      if (onFocus) run();
      return () => { focused.current = false; };
    }, [enabled, onFocus, run]),
  );

  // Fallback for an older server only: one quiet refresh per FALLBACK_REFRESH_MS while focused.
  useEffect(() => {
    if (!enabled || status !== 'unavailable') return;
    let handle: ReturnType<typeof setTimeout> | null = null;
    const tick = () => {
      handle = setTimeout(() => {
        if (focused.current && AppState.currentState === 'active') run();
        tick();
      }, FALLBACK_REFRESH_MS);
    };
    tick();
    return () => { if (handle) clearTimeout(handle); };
  }, [enabled, status, run]);
}
