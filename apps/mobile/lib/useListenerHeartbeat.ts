import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';

import { listenerApi } from '@/lib/listenerApi';
import { liveStatus } from '@/lib/liveEvents';

const HEARTBEAT_MS = 5 * 60 * 1000;

/** Presence pulse (spec 2026-09-05 §6), now only a fallback. While the live events socket is
 * open the server keeps the mentor's last_seen fresh itself (lib/liveEvents.ts), so no HTTP
 * pulse is sent. Only when the socket is not live (an older server, or a broken connection)
 * does this POST /listener/me/heartbeat on focus and every 5 minutes, as before: the server
 * marks a mentor away 15 minutes after the last sign of life. Failures are silent — the sweep
 * is the safety net, not the client. */
export function useListenerHeartbeat(enabled: boolean): void {
  useFocusEffect(
    useCallback(() => {
      if (!enabled) return;
      const beat = () => {
        if (liveStatus('listener') === 'live') return;
        void listenerApi.heartbeat().catch(() => {});
      };
      beat();
      const id = setInterval(beat, HEARTBEAT_MS);
      return () => clearInterval(id);
    }, [enabled]),
  );
}
