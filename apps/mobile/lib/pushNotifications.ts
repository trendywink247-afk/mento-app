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

export type PushRole = 'member' | 'listener';

let lastToken: string | null = null;

async function currentToken(): Promise<string | null> {
  if (Platform.OS === 'web' || !Device.isDevice) return null;
  const { status: existing } = await Notifications.getPermissionsAsync();
  let status = existing;
  if (status !== 'granted') ({ status } = await Notifications.requestPermissionsAsync());
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
    const platform = Platform.OS === 'ios' ? 'ios' : 'android';
    if (role === 'member') await api.registerPushToken(token, platform);
    else await listenerApi.registerPushToken(token, platform);
  } catch {
    /* best-effort — see module doc */
  }
}

/** Start Fresh: stop the old persona's device from receiving anything. */
export async function unregisterPush(): Promise<void> {
  try {
    const token = lastToken ?? (await currentToken());
    if (token) await api.deletePushToken(token);
  } catch {
    /* best-effort */
  }
}

/** Kept for API compatibility with the tab shell. */
export const registerForPushNotifications = () => registerPush('member');
