/** The device remembers an age-gate refusal for a day (WS3 T3.8), so the answer after a
 * refusal is the same answer, not a second try with a different year. The server holds
 * the same line per install and per address (routers/onboarding.py); this copy only
 * saves a round trip and keeps the screen honest. Not cleared by Start fresh. */
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const KEY = 'mento.age_refused_until';
const DAY_MS = 24 * 60 * 60 * 1000;

async function read(): Promise<string | null> {
  if (Platform.OS === 'web') return globalThis.localStorage?.getItem(KEY) ?? null;
  return SecureStore.getItemAsync(KEY);
}

async function write(value: string): Promise<void> {
  if (Platform.OS === 'web') globalThis.localStorage?.setItem(KEY, value);
  else await SecureStore.setItemAsync(KEY, value);
}

export async function rememberAgeRefusal(): Promise<void> {
  try {
    await write(String(Date.now() + DAY_MS));
  } catch {
    /* best-effort: the server still holds the line */
  }
}

export async function ageRefusalActive(): Promise<boolean> {
  try {
    const until = Number(await read());
    return Number.isFinite(until) && until > Date.now();
  } catch {
    return false;
  }
}
