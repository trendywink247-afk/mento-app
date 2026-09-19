/**
 * "Find the threads" consent (board A30) — a DEVICE preference, off until the member says
 * so. There is no server flag for it: the server simply never reads notes unless the
 * member presses the key, and the key only exists while this is on.
 *
 * Stored as the persona id that agreed, not as `true`: Start fresh (a new identity on the
 * same device) must never inherit the last person's yes.
 */
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { getPersona } from '@/lib/session';

// reason: SecureStore keys allow only [A-Za-z0-9._-]
const KEY = 'mento.journal_threads_consent';

async function read(): Promise<string | null> {
  try {
    return Platform.OS === 'web'
      ? (globalThis.localStorage?.getItem(KEY) ?? null)
      : await SecureStore.getItemAsync(KEY);
  } catch {
    return null;
  }
}

async function write(value: string | null): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      if (value === null) globalThis.localStorage?.removeItem(KEY);
      else globalThis.localStorage?.setItem(KEY, value);
    } else if (value === null) await SecureStore.deleteItemAsync(KEY);
    else await SecureStore.setItemAsync(KEY, value);
  } catch {
    /* a preference that cannot be stored simply reads as off next time */
  }
}

export async function getThreadsConsent(): Promise<boolean> {
  const [agreedBy, persona] = await Promise.all([read(), getPersona()]);
  return Boolean(agreedBy && persona && agreedBy === persona.id);
}

export async function setThreadsConsent(on: boolean): Promise<void> {
  const persona = on ? await getPersona() : null;
  await write(on && persona ? persona.id : null);
}
