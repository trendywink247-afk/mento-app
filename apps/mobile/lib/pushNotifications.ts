/** Expo push registration for either role (spec 2026-09-05 push §3). Best-effort,
 * native-only: simulators have no push, a denied permission is normal, and a
 * missing EAS projectId or local acceptance mode skips permissions entirely. The
 * permission prompt appears on first entry to the member tabs or the mentor
 * console, never on the landing. */
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { apiRequest, currentMemberToken } from './api';
import { getListenerToken } from './listenerSession';
import { getSessionToken } from './session';
import { beginPushIdentityChange, pushAlreadyRegistered, pushGeneration,
  pushScopeActive, rememberPushRegistration, type PushRole } from './pushRegistrationState';

export type { PushRole } from './pushRegistrationState';

let lastToken: string | null = null;
// A newer account waits for the previous same-role operation to settle. Successful
// stale responses cannot overwrite cache state or overtake a fresh registration.
const flights = new Map<PushRole, { generation: number; promise: Promise<void> }>();
const rolePath = (role: PushRole) => role === 'member' ? '/notifications/register-token' : '/listener/me/push-token';
const storedBearer = (role: PushRole) => role === 'member' ? getSessionToken() : getListenerToken();

function projectIdForPush(): string | null {
  const extra = Constants.expoConfig?.extra;
  // Local acceptance has no provider: do not even read permissions or prompt.
  if (extra?.localAcceptance) return null;
  const projectId = extra?.eas?.projectId;
  return typeof projectId === 'string' && projectId.trim() ? projectId.trim() : null;
}

async function currentToken(options: { prompt?: boolean; current?: () => boolean } = {}): Promise<string | null> {
  const { prompt = true, current = () => true } = options;
  if (Platform.OS === 'web' || !Device.isDevice) return null;
  const projectId = projectIdForPush();
  if (!projectId) return null;
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (!current()) return null;
  let status = existing;
  if (status !== 'granted') {
    if (!prompt) return null;
    ({ status } = await Notifications.requestPermissionsAsync());
  }
  if (!current() || status !== 'granted') return null;
  const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
  return data;
}

export async function registerPush(role: PushRole): Promise<void> {
  if (!projectIdForPush() || Platform.OS === 'web' || !Device.isDevice) return;
  const generation = pushGeneration(role);
  if (!pushScopeActive(role, generation)) return;
  const previous = flights.get(role);
  if (previous?.generation === generation) return previous.promise;
  const operation = (async () => {
    await previous?.promise;
    try {
      if (!pushScopeActive(role, generation)) return;
      const bearer = role === 'member' ? await currentMemberToken() : await getListenerToken();
      if (!bearer || !pushScopeActive(role, generation)) return;
      const current = async () => pushScopeActive(role, generation) && await storedBearer(role) === bearer;
      // Pin both identity verification and writes to the same credential. A delayed
      // permission answer must never borrow the next account's bearer.
      const identity = await apiRequest<{ id: string }>(role === 'member' ? '/me' : '/listener/me', {}, async () => bearer);
      if (!identity.id || !await current()) return;
      const token = await currentToken({ current: () => pushScopeActive(role, generation) });
      if (!token || !await current()) return;
      if (pushAlreadyRegistered(role, generation, identity.id, token)) return;
      lastToken = token;
      await apiRequest(rolePath(role), { method: 'POST', body: JSON.stringify({
        expo_push_token: token, platform: Platform.OS === 'ios' ? 'ios' : 'android',
      }) }, async () => bearer);
      if (await current()) rememberPushRegistration(role, generation, identity.id, token);
    } catch { /* best-effort — no credential clearing or stale cache success */ }
  })();
  flights.set(role, { generation, promise: operation });
  try { await operation; }
  finally { if (flights.get(role)?.promise === operation) flights.delete(role); }
}

/** Start Fresh: stop the old persona's device from receiving anything. Never prompts
 * for permission — if it was never granted there's no token to delete anyway. */
export async function unregisterPush(): Promise<void> {
  if (!projectIdForPush()) return;
  const roles: PushRole[] = ['member', 'listener'];
  const generations = roles.map(beginPushIdentityChange);
  const credentials = await Promise.all(roles.map(storedBearer));
  // Start Fresh suppresses a remount's registration until a new identity is saved.
  try {
    const token = lastToken ?? (await currentToken({ prompt: false }));
    if (!token) return;
    // Both roles, best-effort each: a device that was also a mentor keeps a listener
    // row (one row per role) — drop it too, or it would keep receiving mentor pushes
    // with no session left to route the tap.
    await Promise.all(roles.map(async (role, index) => {
      await flights.get(role)?.promise;
      if (pushGeneration(role) !== generations[index]) return;
      const bearer = credentials[index];
      if (bearer) await apiRequest(rolePath(role), { method: 'DELETE',
        body: JSON.stringify({ expo_push_token: token }) }, async () => bearer).catch(() => {});
    }));
    if (roles.some((role, index) => pushGeneration(role) === generations[index])) lastToken = null;
  } catch {
    /* best-effort */
  }
}

/** Kept for API compatibility with the tab shell. */
export const registerForPushNotifications = () => registerPush('member');
