/** Admin-console session storage — its own key, distinct from user/listener so one
 * browser can hold all three (two-party + admin testing). Web-only console. */
const TOKEN_KEY = 'mento.admin.session_token';

export async function saveAdminToken(token: string): Promise<void> {
  globalThis.localStorage?.setItem(TOKEN_KEY, token);
}

export async function getAdminToken(): Promise<string | null> {
  return globalThis.localStorage?.getItem(TOKEN_KEY) ?? null;
}

export async function clearAdminSession(): Promise<void> {
  globalThis.localStorage?.removeItem(TOKEN_KEY);
}
