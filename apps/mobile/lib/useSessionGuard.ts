import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';

import { getSessionToken } from '@/lib/session';

/** Session-loss guard. If the anonymous session is gone (e.g. Start-fresh in another
 * browser tab), every authorized call from this screen would 403 forever with no way
 * out — route back to the landing flow instead. Used by the tabs layout, the chat
 * screens, and reflection (any surface that makes owner-scoped API calls). */
export function useSessionGuard(): void {
  const router = useRouter();
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void getSessionToken().then((token) => {
        if (!cancelled && !token) router.replace('/');
      });
      return () => {
        cancelled = true;
      };
    }, [router]),
  );
}
