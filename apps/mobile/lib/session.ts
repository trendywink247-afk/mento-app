/** Anonymous session storage. Native uses the OS secure store; web falls back to
 * localStorage (expo-secure-store is unsupported on web). Tokens never touch AsyncStorage. */
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { screenCache } from './screenCache';
import { forgetOwnChats } from './ownChatLifecycle';

const SESSION_KEY = 'mento.session_token';
/** T3.2: present once the session refreshes (a short access token in SESSION_KEY). A
 * missing key = an install from before refresh, holding a long-lived token. */
const REFRESH_KEY = 'mento.refresh_token';
const STREAM_KEY = 'mento.stream_token';
const PERSONA_KEY = 'mento.persona';
const COMPANION_COLOR_KEY = 'mento.companion_colour';
const COMPANION_ANIMAL_KEY = 'mento.companion_animal';
const ROLE_KEY = 'mento.role';

/** Local-only preference chosen on the role step. Never sent to the server, never
 * part of the persona — a missing key reads as mentee so every existing install
 * behaves exactly as before the fork existed. */
export type Role = 'mentee' | 'mentor';

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
  refreshToken?: string | null,
): Promise<void> {
  forgetOwnChats('member');
  // A new identity never inherits the previous one's last-loaded tab data.
  screenCache.clear();
  await store.setItemAsync(SESSION_KEY, sessionToken);
  // Never leave the previous identity's refresh token beside a new access token.
  if (refreshToken) await store.setItemAsync(REFRESH_KEY, refreshToken);
  else await store.deleteItemAsync(REFRESH_KEY);
  await store.setItemAsync(STREAM_KEY, streamToken);
  await store.setItemAsync(PERSONA_KEY, JSON.stringify(persona));
}

/** The bearer token for member calls: the access token once the session refreshes,
 * the long-lived session token before that. Also the "is there a session?" check. */
export async function getSessionToken(): Promise<string | null> {
  return store.getItemAsync(SESSION_KEY);
}

export async function getRefreshToken(): Promise<string | null> {
  return store.getItemAsync(REFRESH_KEY);
}

/** Store a rotated pair (POST /auth/refresh or /auth/upgrade) — same identity, so the
 * screen cache stays. Refresh first: a crash between the two writes then leaves a
 * valid refresh token beside a stale access token, which the next 401 repairs. */
export async function saveTokenPair(accessToken: string, refreshToken: string): Promise<void> {
  await store.setItemAsync(REFRESH_KEY, refreshToken);
  await store.setItemAsync(SESSION_KEY, accessToken);
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

export async function saveRole(role: Role): Promise<void> {
  await store.setItemAsync(ROLE_KEY, role);
}

export async function getRole(): Promise<Role> {
  const raw = await store.getItemAsync(ROLE_KEY);
  return raw === 'mentor' ? 'mentor' : 'mentee';
}

export async function clearSession(): Promise<void> {
  forgetOwnChats('member');
  screenCache.clear();
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
    store.deleteItemAsync(REFRESH_KEY),
    store.deleteItemAsync(STREAM_KEY),
    store.deleteItemAsync(PERSONA_KEY),
    store.deleteItemAsync(COMPANION_COLOR_KEY),
    store.deleteItemAsync(COMPANION_ANIMAL_KEY),
    store.deleteItemAsync(ROLE_KEY),
  ]);
}
