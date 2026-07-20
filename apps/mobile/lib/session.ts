/** Anonymous session storage. Native uses the OS secure store; web falls back to
 * localStorage (expo-secure-store is unsupported on web). Tokens never touch AsyncStorage. */
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const SESSION_KEY = 'mento.session_token';
const STREAM_KEY = 'mento.stream_token';
const PERSONA_KEY = 'mento.persona';
const COMPANION_COLOR_KEY = 'mento.companion_colour';
const COMPANION_ANIMAL_KEY = 'mento.companion_animal';

type Store = {
  setItemAsync(key: string, value: string): Promise<void>;
  getItemAsync(key: string): Promise<string | null>;
  deleteItemAsync(key: string): Promise<void>;
};

const webStore: Store = {
  setItemAsync: async (k, v) => {
    globalThis.localStorage?.setItem(k, v);
  },
  getItemAsync: async (k) => globalThis.localStorage?.getItem(k) ?? null,
  deleteItemAsync: async (k) => {
    globalThis.localStorage?.removeItem(k);
  },
};

const store: Store = Platform.OS === 'web' ? webStore : SecureStore;

export type Persona = { id: string; persona_name: string; persona_avatar: string };

export async function saveSession(
  sessionToken: string,
  streamToken: string,
  persona: Persona,
): Promise<void> {
  await store.setItemAsync(SESSION_KEY, sessionToken);
  await store.setItemAsync(STREAM_KEY, streamToken);
  await store.setItemAsync(PERSONA_KEY, JSON.stringify(persona));
}

export async function getSessionToken(): Promise<string | null> {
  return store.getItemAsync(SESSION_KEY);
}

export async function getStreamToken(): Promise<string | null> {
  return store.getItemAsync(STREAM_KEY);
}

export async function getPersona(): Promise<Persona | null> {
  const raw = await store.getItemAsync(PERSONA_KEY);
  return raw ? (JSON.parse(raw) as Persona) : null;
}

/** Growth-companion colour drives the per-user accent theme (see ThemeProvider). */
export async function saveCompanionColor(color: string): Promise<void> {
  await store.setItemAsync(COMPANION_COLOR_KEY, color);
}

export async function getCompanionColor(): Promise<string | null> {
  return store.getItemAsync(COMPANION_COLOR_KEY);
}

/** The chosen growth-companion animal — the star of the identity (DECISIONS §I.5). */
export async function saveCompanionAnimal(animal: string): Promise<void> {
  await store.setItemAsync(COMPANION_ANIMAL_KEY, animal);
}

export async function getCompanionAnimal(): Promise<string | null> {
  return store.getItemAsync(COMPANION_ANIMAL_KEY);
}

export async function clearSession(): Promise<void> {
  // Tear down the Stream websocket too — otherwise the singleton keeps the old
  // identity connected and the next persona's first chat fails.
  // reason: dynamic import avoids a require cycle (streamClient never imports session).
  try {
    const { disconnectStreamClient } = await import('./streamClient');
    await disconnectStreamClient();
  } catch {
    /* best-effort: storage cleanup below must always run */
  }
  await Promise.all([
    store.deleteItemAsync(SESSION_KEY),
    store.deleteItemAsync(STREAM_KEY),
    store.deleteItemAsync(PERSONA_KEY),
    store.deleteItemAsync(COMPANION_COLOR_KEY),
    store.deleteItemAsync(COMPANION_ANIMAL_KEY),
  ]);
}
