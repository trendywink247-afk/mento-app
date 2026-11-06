/** One-time Android push token refresh. A device token minted before the app's push
 * credentials existed can stay unusable even though the push provider reports success;
 * dropping the device's FCM registration once makes Android issue a fresh one, which
 * registration then sends to the server as usual. Best-effort: it can never stop push
 * registration, and it runs at most once per install. */
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const DONE_KEY = 'mento.push.fcm-refresh.v1';
let pending: Promise<void> | null = null;

export function refreshPushTokenOnce(): Promise<void> {
  if (Platform.OS !== 'android') return Promise.resolve();
  pending ??= (async () => {
    try {
      if (await SecureStore.getItemAsync(DONE_KEY)) return;
      await Notifications.unregisterForNotificationsAsync();
      await SecureStore.setItemAsync(DONE_KEY, '1');
    } catch {
      /* the next launch tries again; the current token is used meanwhile */
    }
  })();
  return pending;
}
