/** Expo push registration for either role (spec 2026-09-05 push §3). Best-effort,
 * native-only: simulators have no push, a denied permission is normal, and a
 * missing EAS projectId makes token minting throw — all silent no-ops. The
 * permission prompt appears on first entry to the member tabs or the mentor
 * console, never on the landing. */
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { api } from './api';
import { listenerApi } from './listenerApi';
import { getListenerToken } from './listenerSession';

export type PushRole = 'member' | 'listener';

let lastToken: string | null = null;
/** Tracks the last (token, role) pair successfully registered with the server, so a
 * remount (e.g. Mentor Home re-focusing) doesn't re-POST an unchanged token. */
let registered: { token: string; role: PushRole } | null = null;

async function currentToken(options: { prompt?: boolean } = {}): Promise<string | null> {
  const { prompt = true } = options;
  if (Platform.OS === 'web' || !Device.isDevice) return null;
  const { status: existing } = await Notifications.getPermissionsAsync();
  let status = existing;
  if (status !== 'granted') {
    if (!prompt) return null;
    ({ status } = await Notifications.requestPermissionsAsync());
  }
  if (status !== 'granted') return null;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  const { data } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
  return data;
}

export async function registerPush(role: PushRole): Promise<void> {
  try {
    const token = await currentToken();
    if (!token) return;
    lastToken = token;
    if (registered && registered.token === token && registered.role === role) return;
    const platform = Platform.OS === 'ios' ? 'ios' : 'android';
    if (role === 'member') await api.registerPushToken(token, platform);
    else await listenerApi.registerPushToken(token, platform);
    registered = { token, role };
  } catch {
    /* best-effort — see module doc */
  }
}

/** Start Fresh: stop the old persona's device from receiving anything. Never prompts
 * for permission — if it was never granted there's no token to delete anyway. */
export async function unregisterPush(): Promise<void> {
  try {
    const token = lastToken ?? (await currentToken({ prompt: false }));
    if (!token) return;
    // Both roles, best-effort each: a device that was also a mentor keeps a listener
    // row (one row per role) — drop it too, or it would keep receiving mentor pushes
    // with no session left to route the tap.
    await api.deletePushToken(token).catch(() => {});
    if (await getListenerToken()) await listenerApi.deletePushToken(token).catch(() => {});
    registered = null;
  } catch {
    /* best-effort */
  }
}

/** Kept for API compatibility with the tab shell. */
export const registerForPushNotifications = () => registerPush('member');
