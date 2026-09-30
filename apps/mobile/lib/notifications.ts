/** Foreground banners without sound + tap routing (spec 2026-09-05 push §6). */
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';

import { api } from '@/lib/api';
import { getListenerToken } from '@/lib/listenerSession';
import { routeForNotification, type PushData, type Route, type RouteCtx } from '@/lib/notificationRoute';
import { getSessionToken } from '@/lib/session';

// Cold-start tap wins over the landing's session redirect (both fire on mount):
// true from the moment a tap listener mounts until its cold-start check resolves
// and any resulting navigation has been issued. app/index.tsx reads this before
// its own `router.replace`.
let pendingTap = false;
export function hasPendingTap(): boolean {
  return pendingTap;
}

// Dedupe: expo-notifications can hand the same response to both
// getLastNotificationResponseAsync() and the live listener on the same mount.
let lastHandledId: string | null = null;

export function installNotificationHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldShowBanner: true,
      shouldShowList: true,
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

    const handle = async (
      response: Notifications.NotificationResponse | null,
      navigate: (route: Route) => void,
    ) => {
      if (!response || !active) return;
      const id = response.notification.request.identifier;
      if (id === lastHandledId) return; // already routed this exact tap
      lastHandledId = id;
      const data = response.notification.request.content.data as PushData | undefined;
      if (!data) return;
      const route = routeForNotification(data, await buildCtx(data));
      if (route && active) navigate(route);
    };

    // Held true until the cold-start check resolves AND any resulting nav is issued —
    // see hasPendingTap() above and its read in app/index.tsx.
    pendingTap = true;
    void Notifications.getLastNotificationResponseAsync()
      .then((response) =>
        handle(response, (route) => router.replace(route as never)), // reason: expo-router typed routes reject a dynamic pathname string; replace — no back stack yet on cold start
      )
      .finally(() => {
        pendingTap = false;
      });

    const sub = Notifications.addNotificationResponseReceivedListener(
      (response) =>
        void handle(response, (route) => router.push(route as never)), // reason: expo-router typed routes reject a dynamic pathname string
    );
    return () => {
      active = false;
      sub.remove();
    };
  }, [router]);
}
