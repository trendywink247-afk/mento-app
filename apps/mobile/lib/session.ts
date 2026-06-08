/** Anonymous session storage. Tokens live in the OS secure store, never AsyncStorage. */
import * as SecureStore from 'expo-secure-store';

const SESSION_KEY = 'mento.session_token';
const STREAM_KEY = 'mento.stream_token';
const PERSONA_KEY = 'mento.persona';

export type Persona = { id: string; persona_name: string; persona_avatar: string };

export async function saveSession(
  sessionToken: string,
  streamToken: string,
  persona: Persona,
): Promise<void> {
  await SecureStore.setItemAsync(SESSION_KEY, sessionToken);
  await SecureStore.setItemAsync(STREAM_KEY, streamToken);
  await SecureStore.setItemAsync(PERSONA_KEY, JSON.stringify(persona));
}

export async function getSessionToken(): Promise<string | null> {
  return SecureStore.getItemAsync(SESSION_KEY);
}

export async function getStreamToken(): Promise<string | null> {
  return SecureStore.getItemAsync(STREAM_KEY);
}

export async function getPersona(): Promise<Persona | null> {
  const raw = await SecureStore.getItemAsync(PERSONA_KEY);
  return raw ? (JSON.parse(raw) as Persona) : null;
}

export async function clearSession(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(SESSION_KEY),
    SecureStore.deleteItemAsync(STREAM_KEY),
    SecureStore.deleteItemAsync(PERSONA_KEY),
  ]);
}
