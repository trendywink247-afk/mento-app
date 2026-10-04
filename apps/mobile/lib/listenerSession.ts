/** Listener-console session storage — distinct keys from the member session so one
 * device can hold BOTH (two-party testing, and honest anyway: the roles never share
 * a token). Native: OS secure store; web: localStorage (same split as lib/session.ts). */
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { forgetOwnChats } from './ownChatLifecycle';

const TOKEN_KEY = 'mento.listener.session_token';

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

export async function saveListenerToken(token: string): Promise<void> {
  forgetOwnChats('mentor');
  await store.setItemAsync(TOKEN_KEY, token);
}

export async function getListenerToken(): Promise<string | null> {
  return store.getItemAsync(TOKEN_KEY);
}

export async function clearListenerSession(): Promise<void> {
  forgetOwnChats('mentor');
  await store.deleteItemAsync(TOKEN_KEY);
}
