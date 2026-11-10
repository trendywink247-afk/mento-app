/** Pin and Archive on this phone only: the OS secure store on native, localStorage on web (the same
 * split as lib/preparedAnswers.ts). Removed when the session is cleared, so a wiped account leaves nothing. */
import * as SecureStore from 'expo-secure-store';
import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { EMPTY_PREFS, forgetMissing, parsePrefs, toggleArchive, togglePin, type ChatPrefs } from './chatPrefsCore';

export * from './chatPrefsCore';

const KEY = 'mento.chatprefs';

const store = {
  get: async (): Promise<string | null> =>
    Platform.OS === 'web' ? (globalThis.localStorage?.getItem(KEY) ?? null) : SecureStore.getItemAsync(KEY),
  set: async (v: string): Promise<void> =>
    Platform.OS === 'web' ? void globalThis.localStorage?.setItem(KEY, v) : SecureStore.setItemAsync(KEY, v),
  del: async (): Promise<void> =>
    Platform.OS === 'web' ? void globalThis.localStorage?.removeItem(KEY) : SecureStore.deleteItemAsync(KEY),
};

export async function clearChatPrefs(): Promise<void> {
  try {
    await store.del();
  } catch {
    /* nothing stored */
  }
}

export function useChatPrefs() {
  const [prefs, setPrefs] = useState<ChatPrefs>(EMPTY_PREFS);

  useEffect(() => {
    let live = true;
    void store
      .get()
      .then((raw) => live && setPrefs(parsePrefs(raw)))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const apply = useCallback((next: (p: ChatPrefs) => ChatPrefs) => {
    setPrefs((p) => {
      const n = next(p);
      void store.set(JSON.stringify(n)).catch(() => {});
      return n;
    });
  }, []);

  return {
    prefs,
    pin: (id: string) => apply((p) => togglePin(p, id)),
    archive: (id: string) => apply((p) => toggleArchive(p, id)),
    /** Drop ids for chats that are gone. */
    prune: (existing: string[]) => apply((p) => forgetMissing(p, existing)),
  };
}
