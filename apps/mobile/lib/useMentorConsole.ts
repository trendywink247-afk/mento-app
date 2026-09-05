/** Mentor console data hook — the native reimplementation of the data flow in
 * components/listener/ListenerConsole.web.tsx: identity + requests + conversations
 * on focus, a 30s request poll so a Personal request never waits a full refresh to
 * appear, and a live per-channel unread/preview/typing mirror driven off Stream
 * channel events (message.new/message.read/typing.start/typing.stop). */
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
import { ensureListenerConnected } from '@/lib/listenerStreamClient';

const REQUEST_POLL_MS = 30_000;

export type ChannelLive = {
  unread: number;
  preview: string | null;
  typing: boolean;
};

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
  act: (requestId: string, action: 'accept' | 'decline') => Promise<void>;
  busy: string | null;
};

const EMPTY_LIVE: ChannelLive = { unread: 0, preview: null, typing: false };

export function useMentorConsole(atCapacityText: string): MentorConsole {
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

  const refresh = useCallback(async () => {
    const mySeq = ++seq.current;
    const live = () => seq.current === mySeq;

    setLoading(true);
    try {
      const meData = await listenerApi.me();
      if (!live()) return;
      const [reqs, convos] = await Promise.all([
        listenerApi.requests(),
        listenerApi.conversations(),
      ]);
      if (!live()) return;
      setMe(meData);
      setRequests(reqs);
      setConversations(convos);
      setError(null);

      const client = await ensureListenerConnected(
        { id: meData.id, name: meData.persona_name },
        meData.stream_token,
      );
      if (!live()) return;

      // Watch every active channel in parallel — no reason to serialize network calls.
      const active = convos.filter(
        (c): c is ListenerConversation & { stream_channel_id: string } =>
          c.status === 'active' && c.stream_channel_id !== null,
      );
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
        };

        const onMessageNew = (e: Event) => {
          if (!live()) return;
          setLive((prev) => ({
            ...prev,
            [channelId]: {
              ...(prev[channelId] ?? EMPTY_LIVE),
              unread: ch.countUnread(),
              preview: e.message?.text ?? prev[channelId]?.preview ?? null,
            },
          }));
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

  useFocusEffect(
    useCallback(() => {
      void refresh();
      // Pin the poll to the generation refresh() just started — if a blur (or a
      // later refresh) bumps seq, this poll's writes become no-ops.
      const g = seq.current;
      const id = setInterval(() => {
        void listenerApi
          .requests()
          .then((r) => {
            if (seq.current === g) setRequests(r);
          })
          .catch(() => {
            /* the 30s poll is a freshness nicety, not a source of truth — swallow */
          });
      }, REQUEST_POLL_MS);
      return () => {
        // Invalidate any in-flight refresh() first so it bails out of its own
        // setStates/subscribes and unsubscribes only the subs IT created.
        seq.current += 1;
        unsubscribeAll();
        clearInterval(id);
      };
    }, [refresh, unsubscribeAll]),
  );

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
    async (requestId: string, action: 'accept' | 'decline') => {
      if (busy) return;
      setBusy(requestId);
      setNote(null);
      try {
        if (action === 'accept') await listenerApi.accept(requestId);
        else await listenerApi.decline(requestId);
        await refresh();
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) setNote(atCapacityText);
      } finally {
        setBusy(null);
      }
    },
    [busy, refresh, atCapacityText],
  );

  return { me, requests, conversations, live, loading, error, note, refresh, toggleStatus, act, busy };
}
