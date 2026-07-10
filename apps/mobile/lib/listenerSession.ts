/** Listener-console session storage — distinct keys from the member session so one
 * browser can hold BOTH (needed for two-party testing, and honest anyway: the roles
 * never share a token). The console is web-only, so localStorage is the store. */

const TOKEN_KEY = 'mento.listener.session_token';

export async function saveListenerToken(token: string): Promise<void> {
  globalThis.localStorage?.setItem(TOKEN_KEY, token);
}

export async function getListenerToken(): Promise<string | null> {
  return globalThis.localStorage?.getItem(TOKEN_KEY) ?? null;
}

export async function clearListenerSession(): Promise<void> {
  globalThis.localStorage?.removeItem(TOKEN_KEY);
}
