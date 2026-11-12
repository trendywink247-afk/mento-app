/** Mentor console data hook — the native reimplementation of the data flow in
 * components/listener/ListenerConsole.web.tsx: identity + requests + conversations
 * on focus, pushed updates instead of a poll (lib/liveEvents.ts: `request.new` /
 * `request.gone` refetch the requests, `conversation.changed` the conversations, and
 * every (re)connect does one full catch-up), and a live per-channel
 * unread/preview/typing mirror driven off Stream channel events
 * (message.new/message.read/typing.start/typing.stop). */
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Event } from 'stream-chat';

import { ApiError } from '@/lib/api';
import {
  listenerApi,
  onListenerSessionLost,
  type ListenerConversation,
  type ListenerMe,
  type ListenerRequest,
} from '@/lib/listenerApi';
import { mentorFaces } from '@/lib/mentorFaces';
import { ensureListenerConnected } from '@/lib/listenerStreamClient';
import { streamRooms } from '@/lib/ownLive';
import { createEventFetch, type EventFetch } from '@/lib/eventFetch';
import { FALLBACK_REFRESH_MS, useLiveEvent, useLiveStatus } from '@/lib/liveEvents';

export type ChannelLive = {
  unread: number;
  preview: string | null;
  typing: boolean;
  /** Board A10 "Waiting on you": when the member's oldest unanswered message was sent
   * (ms since epoch) — the start of the trailing run of the member's messages since the
   * mentor last wrote. Null once the mentor has replied (or nobody has written yet). */
  waitingSince: number | null;
};

type LiveMessage = { type?: string; user?: { id?: string } | null; created_at?: string | Date | null };

/** Only real messages count toward "waiting" — never a system line or an error echo. */
const counts = (m: LiveMessage) => !m.type || m.type === 'regular' || m.type === 'reply';

const at = (m: LiveMessage): number | null => (m.created_at ? new Date(m.created_at).getTime() : null);

/** Walk back from the newest message while the member is the author; the earliest of that
 * run is when they started waiting. The mentor's own last word means nobody waits. */
function waitingSinceOf(messages: readonly LiveMessage[], selfId: string | undefined): number | null {
  let since: number | null = null;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (!counts(m)) continue;
    if (m.user?.id === selfId) break;
    since = at(m) ?? since;
  }
  return since;
}

export type MentorConsole = {
  me: ListenerMe | null;
  requests: ListenerRequest[];
  conversations: ListenerConversation[];
  live: Record<string, ChannelLive>;
  loading: boolean;
  error: 'session' | 'network' | null;
  note: string | null;
  refresh: () => Promise<void>;
  toggleStatus: () => Promise<void>;
  /** Accept returns the new conversation's id (so the page can open the chat); decline returns null. */
  act: (requestId: string, action: 'accept' | 'decline') => Promise<string | null>;
  /** Board A10: snooze (true) or undo (false) one conversation; false on failure. */
  setSnooze: (conversationId: string, on: boolean) => Promise<boolean>;
  busy: string | null;
};

const EMPTY_LIVE: ChannelLive = { unread: 0, preview: null, typing: false, waitingSince: null };

export function useMentorConsole(atCapacityText: string, takenText = ''): MentorConsole {
  const [me, setMe] = useState<ListenerMe | null>(null);
  const [requests, setRequests] = useState<ListenerRequest[]>([]);
  const [conversations, setConversations] = useState<ListenerConversation[]>([]);
  const [live, setLive] = useState<Record<string, ChannelLive>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<'session' | 'network' | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Event-handler subscriptions for the currently-watched channels — torn down
  // before every re-subscribe (next refresh) and on blur.
  const unsubsRef = useRef<Array<{ unsubscribe: () => void }>>([]);
  const unsubscribeAll = useCallback(() => {
    unsubsRef.current.forEach((s) => s.unsubscribe());
    unsubsRef.current = [];
  }, []);

  // Generation token: a fast blur/refocus (or `act()` triggering a refresh while an
  // earlier one is still in flight) must not let the two runs interleave writes to
  // shared state or to unsubsRef — only the run holding the CURRENT seq is allowed
  // to touch either. Bumped by refresh() itself and by the focus-effect cleanup.
  const seq = useRef(0);

  // Pushed events for each list settle into one fetch, skipped when a read began after the
  // event (lib/eventFetch.ts). Created once; the fetch bodies are wired below.
  const fetchers = useRef<{ requests: EventFetch; conversations: EventFetch } | null>(null);
  const fetchBodies = useRef<{ requests: () => void; conversations: () => void }>({
    requests: () => undefined,
    conversations: () => undefined,
  });
  if (!fetchers.current) {
    fetchers.current = {
      requests: createEventFetch(() => fetchBodies.current.requests()),
      conversations: createEventFetch(() => fetchBodies.current.conversations()),
    };
  }

  const refresh = useCallback(async () => {
    const mySeq = ++seq.current;
    const live = () => seq.current === mySeq;

    setLoading(true);
    try {
      const meData = await listenerApi.me();
      if (!live()) return;
      fetchers.current?.requests.started();
      fetchers.current?.conversations.started();
      const [reqs, convos] = await Promise.all([
        listenerApi.requests(),
        listenerApi.conversations(),
      ]);
      if (!live()) return;
      setMe(meData);
      mentorFaces.setSelf(meData.companion_animal, meData.companion_colour);
      setRequests(reqs);
      setConversations(convos);
      setError(null);

      // Stream is reached only for Stream rooms. A mentor whose open chats are all own chats never
      // connects to it (and a build without a Stream key keeps working for them).
      const active = streamRooms(convos);
      if (active.length === 0) {
        unsubscribeAll();
        setLive({});
        return;
      }
      const client = await ensureListenerConnected(
        { id: meData.id, name: meData.persona_name },
        meData.stream_token,
      );
      if (!live()) return;

      // Watch every active Stream channel in parallel — no reason to serialize network calls.
      const watched = await Promise.all(
        active.map(async (c) => {
          const ch = client.channel('messaging', c.stream_channel_id);
          await ch.watch();
          return { channelId: c.stream_channel_id, ch };
        }),
      );
      if (!live()) return;

      const subs: Array<{ unsubscribe: () => void }> = [];
      const nextLive: Record<string, ChannelLive> = {};

      for (const { channelId, ch } of watched) {
        if (!live()) break;

        const messages = ch.state.messages;
        const lastMessage = messages[messages.length - 1];
        nextLive[channelId] = {
          unread: ch.countUnread(),
          preview: lastMessage?.text ?? null,
          typing: false,
          waitingSince: waitingSinceOf(messages, client.userID),
        };

        const onMessageNew = (e: Event) => {
          if (!live()) return;
          const m = (e.message ?? {}) as LiveMessage;
          setLive((prev) => {
            const was = prev[channelId] ?? EMPTY_LIVE;
            const waitingSince = !counts(m)
              ? was.waitingSince
              : m.user?.id === client.userID
                ? null
                : (was.waitingSince ?? at(m) ?? Date.now());
            return {
              ...prev,
              [channelId]: {
                ...was,
                unread: ch.countUnread(),
                preview: e.message?.text ?? was.preview ?? null,
                waitingSince,
              },
            };
          });
        };
        const onMessageRead = () => {
          if (!live()) return;
          setLive((prev) => ({
            ...prev,
            [channelId]: { ...(prev[channelId] ?? EMPTY_LIVE), unread: ch.countUnread() },
          }));
        };
        const onTypingStart = (e: Event) => {
          if (!live() || e.user?.id === client.userID) return;
          setLive((prev) => ({
            ...prev,
            [channelId]: { ...(prev[channelId] ?? EMPTY_LIVE), typing: true },
          }));
        };
        const onTypingStop = (e: Event) => {
          if (!live() || e.user?.id === client.userID) return;
          setLive((prev) => ({
            ...prev,
            [channelId]: { ...(prev[channelId] ?? EMPTY_LIVE), typing: false },
          }));
        };

        if (!live()) break;
        subs.push(
          ch.on('message.new', onMessageNew),
          ch.on('message.read', onMessageRead),
          ch.on('typing.start', onTypingStart),
          ch.on('typing.stop', onTypingStop),
        );
      }

      if (!live()) {
        // A newer run (or a blur) won the race — never leak these subscriptions.
        subs.forEach((s) => s.unsubscribe());
        return;
      }

      unsubscribeAll();
      unsubsRef.current = subs;
      setLive(nextLive);
    } catch (e) {
      if (!live()) return;
      setError(e instanceof ApiError && (e.status === 401 || e.status === 403) ? 'session' : 'network');
    } finally {
      if (live()) setLoading(false);
    }
  }, [unsubscribeAll]);

  // Pushed updates. Each event refetches only its own list, outside refresh()'s generation on
  // purpose: accept / decline / going online / saving the line all call refresh(), which bumps
  // `seq`, and an update pinned to an older generation would silently stop after the first action.
  // `focused` keeps a late answer from landing on a screen that has gone.
  const focused = useRef(false);
  const fetchRequests = useCallback(() => {
    fetchers.current?.requests.started();
    void listenerApi
      .requests()
      .then((r) => {
        if (focused.current) setRequests(r);
      })
      .catch(() => {
        /* the next event, focus or reconnect catches up */
      });
  }, []);
  // Own chats have no Stream mirror: who is waiting and what is unread arrives with the rows.
  const fetchConversations = useCallback(() => {
    fetchers.current?.conversations.started();
    void listenerApi
      .conversations()
      .then((rows) => {
        if (focused.current) setConversations(rows);
      })
      .catch(() => {
        /* same */
      });
  }, []);
  // A hello right after the focus refresh would only repeat it: skip a resync within 3 s of focus.
  const focusedAt = useRef(0);
  useLiveEvent('listener', ['resync', 'request.new', 'request.gone', 'conversation.changed'], (event) => {
    if (!focused.current) return;
    if (event.t === 'resync') {
      if (Date.now() - focusedAt.current < 3_000) return;
      void refresh();
    } else if (event.t === 'conversation.changed') fetchers.current?.conversations.onEvent();
    else fetchers.current?.requests.onEvent();
  });
  fetchBodies.current = { requests: fetchRequests, conversations: fetchConversations };
  const status = useLiveStatus('listener');

  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      focusedAt.current = Date.now();
      void refresh();
      return () => {
        focused.current = false;
        fetchers.current?.requests.cancel();
        fetchers.current?.conversations.cancel();
        // Invalidate any in-flight refresh() first so it bails out of its own
        // setStates/subscribes and unsubscribes only the subs IT created.
        seq.current += 1;
        unsubscribeAll();
      };
    }, [refresh, unsubscribeAll]),
  );

  // Only an older server that cannot push gets a safety net: one quiet read of both lists per
  // FALLBACK_REFRESH_MS while focused. Never faster, and never while the socket is live.
  useEffect(() => {
    if (status !== 'unavailable') return;
    let handle: ReturnType<typeof setTimeout> | null = null;
    const tick = () => {
      handle = setTimeout(() => {
        if (focused.current) { fetchRequests(); fetchConversations(); }
        tick();
      }, FALLBACK_REFRESH_MS);
    };
    tick();
    return () => { if (handle) clearTimeout(handle); };
  }, [status, fetchRequests, fetchConversations]);

  useEffect(() => onListenerSessionLost(() => setError('session')), []);

  const toggleStatus = useCallback(async () => {
    if (!me || busy) return;
    setBusy('status');
    try {
      setMe(await listenerApi.setStatus(me.status === 'online' ? 'away' : 'online'));
    } catch {
      // Stillness on failure (T&S #11) — leave `me` exactly as it was.
    } finally {
      setBusy(null);
    }
  }, [me, busy]);

  const act = useCallback(
    async (requestId: string, action: 'accept' | 'decline'): Promise<string | null> => {
      if (busy) return null;
      setBusy(requestId);
      setNote(null);
      try {
        let opened: string | null = null;
        if (action === 'accept') opened = (await listenerApi.accept(requestId)).conversation_id ?? null;
        else await listenerApi.decline(requestId);
        await refresh();
        return opened;
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) setNote(atCapacityText);
        else if (e instanceof ApiError && e.status === 404 && action === 'accept') {
          // Another mentor took an open request first (DECISIONS §P.4): it leaves the list.
          if (takenText) setNote(takenText);
          await refresh();
        }
        return null;
      } finally {
        setBusy(null);
      }
    },
    [busy, refresh, atCapacityText, takenText],
  );

  const setSnooze = useCallback(
    async (conversationId: string, on: boolean) => {
      if (busy) return false;
      setBusy(`snooze:${conversationId}`);
      try {
        const out = on ? await listenerApi.snooze(conversationId) : await listenerApi.wake(conversationId);
        setConversations((cs) =>
          cs.map((c) => (c.id === conversationId ? { ...c, snoozed_until: out.snoozed_until } : c)),
        );
        return true;
      } catch {
        // Still on failure (T&S #11): the row stays exactly as it was; the caller says so.
        return false;
      } finally {
        setBusy(null);
      }
    },
    [busy],
  );

  return { me, requests, conversations, live, loading, error, note, refresh, toggleStatus, act, setSnooze, busy };
}
