/** Expo push token registration — device-testing prerequisite (v1 test pass,
 * mirrors services/api/app/routers/notifications.py). Sending is a one-off
 * script, not a product feature yet; this just gets a device's token to the
 * server so it can be found by user id later.
 *
 * Best-effort only and native-only: simulators have no push capability, a
 * denied permission is a normal outcome, and `getExpoPushTokenAsync` throws
 * until an EAS project is linked (`extra.eas.projectId` unset pre-`eas init`).
 * None of that should ever surface to the user — silent no-op is correct here
 * (this is not a safety-critical path like the crisis scan).
 */
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { api } from './api';

export async function registerForPushNotifications(): Promise<void> {
  if (Platform.OS === 'web' || !Device.isDevice) return;
  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    let status = existing;
    if (status !== 'granted') {
      ({ status } = await Notifications.requestPermissionsAsync());
    }
    if (status !== 'granted') return;

    const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
    const { data: expoPushToken } = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    await api.registerPushToken(expoPushToken, Platform.OS === 'ios' ? 'ios' : 'android');
  } catch {
    /* best-effort — see module doc */
  }
}
