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

  // Event-handler `off` functions for the currently-watched channels — torn down
  // before every re-subscribe (next refresh) and on blur.
  const unsubsRef = useRef<(() => void)[]>([]);
  const unsubscribeAll = useCallback(() => {
    unsubsRef.current.forEach((off) => off());
    unsubsRef.current = [];
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const meData = await listenerApi.me();
      const [reqs, convos] = await Promise.all([
        listenerApi.requests(),
        listenerApi.conversations(),
      ]);
      setMe(meData);
      setRequests(reqs);
      setConversations(convos);
      setError(null);

      unsubscribeAll();
      const client = await ensureListenerConnected(
        { id: meData.id, name: meData.persona_name },
        meData.stream_token,
      );

      const nextLive: Record<string, ChannelLive> = {};
      for (const c of convos) {
        if (c.status !== 'active' || !c.stream_channel_id) continue;
        const channelId = c.stream_channel_id;
        const ch = client.channel('messaging', channelId);
        await ch.watch();

        const messages = ch.state.messages;
        const lastMessage = messages[messages.length - 1];
        nextLive[channelId] = {
          unread: ch.countUnread(),
          preview: lastMessage?.text ?? null,
          typing: false,
        };

        const onMessageNew = (e: Event) => {
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
          setLive((prev) => ({
            ...prev,
            [channelId]: { ...(prev[channelId] ?? EMPTY_LIVE), unread: ch.countUnread() },
          }));
        };
        const onTypingStart = (e: Event) => {
          if (e.user?.id === client.userID) return;
          setLive((prev) => ({
            ...prev,
            [channelId]: { ...(prev[channelId] ?? EMPTY_LIVE), typing: true },
          }));
        };
        const onTypingStop = (e: Event) => {
          if (e.user?.id === client.userID) return;
          setLive((prev) => ({
            ...prev,
            [channelId]: { ...(prev[channelId] ?? EMPTY_LIVE), typing: false },
          }));
        };

        unsubsRef.current.push(
          ch.on('message.new', onMessageNew).unsubscribe,
          ch.on('message.read', onMessageRead).unsubscribe,
          ch.on('typing.start', onTypingStart).unsubscribe,
          ch.on('typing.stop', onTypingStop).unsubscribe,
        );
      }
      setLive(nextLive);
    } catch (e) {
      setError(e instanceof ApiError && (e.status === 401 || e.status === 403) ? 'session' : 'network');
    } finally {
      setLoading(false);
    }
  }, [unsubscribeAll]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
      const id = setInterval(() => {
        void listenerApi
          .requests()
          .then(setRequests)
          .catch(() => {
            /* the 30s poll is a freshness nicety, not a source of truth — swallow */
          });
      }, REQUEST_POLL_MS);
      return () => {
        clearInterval(id);
        unsubscribeAll();
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
