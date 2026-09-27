/** A random id for THIS install of the app (WS3 T3.7 / T3.8). Sent at signup, stored
 * server-side only as a SHA-256, and used for two signals: a new account from the
 * install of a suspended/banned member is flagged for the team to look at (never
 * refused), and an age-gate refusal cools down per install.
 *
 * Deliberately NOT cleared by Start fresh (lib/session.ts clearSession) — a signal that
 * a reinstall-free "start over" wipes would signal nothing. It is not a hardware id,
 * grants nothing on its own (it is a label, not a credential), is never shown to anyone
 * and never goes to analytics. Uninstalling (or clearing site data on web) resets it. */
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const KEY = 'mento.install_id';

async function read(): Promise<string | null> {
  if (Platform.OS === 'web') return globalThis.localStorage?.getItem(KEY) ?? null;
  return SecureStore.getItemAsync(KEY);
}

async function write(value: string): Promise<void> {
  if (Platform.OS === 'web') globalThis.localStorage?.setItem(KEY, value);
  else await SecureStore.setItemAsync(KEY, value);
}

/** 128 random bits as hex. Platform CSPRNG when there is one (web); otherwise
 * Math.random — acceptable because this is a collision-resistant label, not a secret. */
function fresh(): string {
  const bytes = new Uint8Array(16);
  const cryptoApi = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => void } })
    .crypto;
  if (cryptoApi?.getRandomValues) cryptoApi.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

let cached: string | null = null;

/** The install id, created on first use. Never throws: storage trouble → null (the
 * server treats a missing id as "no signal", exactly like an older build). */
export async function getInstallId(): Promise<string | null> {
  if (cached) return cached;
  try {
    cached = (await read()) ?? null;
    if (!cached) {
      cached = fresh();
      await write(cached);
    }
    return cached;
  } catch {
    return null;
  }
}
