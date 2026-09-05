/** Foreground banners without sound + tap routing (spec 2026-09-05 push §6). */
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';

import { api } from '@/lib/api';
import { getListenerToken } from '@/lib/listenerSession';
import { routeForNotification, type PushData, type RouteCtx } from '@/lib/notificationRoute';
import { getSessionToken } from '@/lib/session';

export function installNotificationHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: false, // no audio anywhere (T&S #11)
      shouldSetBadge: false,
    }),
  });
}

async function buildCtx(data: PushData): Promise<RouteCtx> {
  const [session, listener] = await Promise.all([getSessionToken(), getListenerToken()]);
  const ctx: RouteCtx = { hasMemberSession: !!session, hasListenerToken: !!listener };
  if (data.kind === 'message' && session) {
    try {
      ctx.memberConversationIds = new Set((await api.listConversations()).map((c) => c.id));
    } catch {
      ctx.memberConversationIds = new Set();
    }
  }
  return ctx;
}

/** Mount once at the root layout. Handles cold-start taps and taps while running. */
export function useNotificationTaps(): void {
  const router = useRouter();
  useEffect(() => {
    let active = true;
    const handle = async (response: Notifications.NotificationResponse | null) => {
      const data = response?.notification.request.content.data as PushData | undefined;
      if (!data || !active) return;
      const route = routeForNotification(data, await buildCtx(data));
      if (route && active) router.push(route as never); // reason: expo-router typed routes reject a dynamic pathname string
    };
    void Notifications.getLastNotificationResponseAsync().then(handle);
    const sub = Notifications.addNotificationResponseReceivedListener((r) => void handle(r));
    return () => {
      active = false;
      sub.remove();
    };
  }, [router]);
}
