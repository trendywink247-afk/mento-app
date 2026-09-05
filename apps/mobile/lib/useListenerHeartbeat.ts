import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';

import { listenerApi } from '@/lib/listenerApi';

const HEARTBEAT_MS = 5 * 60 * 1000;

/** Presence pulse (spec 2026-09-05 §6): while this screen is focused AND the mentor
 * is online, POST /listener/me/heartbeat once now and every 5 minutes. The server
 * marks a mentor away 15 minutes after the last pulse. Failures are silent — the
 * sweep is the safety net, not the client. */
export function useListenerHeartbeat(enabled: boolean): void {
  useFocusEffect(
    useCallback(() => {
      if (!enabled) return;
      const beat = () => void listenerApi.heartbeat().catch(() => {});
      beat();
      const id = setInterval(beat, HEARTBEAT_MS);
      return () => clearInterval(id);
    }, [enabled]),
  );
}
