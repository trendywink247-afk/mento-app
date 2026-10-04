/** Anonymous onboarding→chat funnel (PostHog, env-gated — H1-remainder PRD A1).
 *
 * Deliberately dependency-free: raw HTTP capture, no PostHog SDK, zero native
 * deps — fully inert when `EXPO_PUBLIC_POSTHOG_KEY` is empty. The event names
 * and props below are a CLOSED union; adding a prop that could carry PII
 * (email, DOB, message content, persona, user id, conversation id) must be
 * impossible by type. No crisis-related event exists and none may be added
 * (T&S #10: crisis sessions never feed engagement dashboards).
 */
import { Platform } from 'react-native';
import { createPrivateAnalytics, mayCaptureFirstMessage, type EventMap, type WaitBucket } from './analyticsPolicy';

export type { WaitBucket } from './analyticsPolicy';

const KEY = process.env.EXPO_PUBLIC_POSTHOG_KEY ?? '';
const HOST = process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com';
const ID_KEY = 'mento.analytics_id';

/** Raw wait times never leave the device — only the bucket. */
export function waitBucket(ms: number): WaitBucket {
  if (ms < 5_000) return '<5s';
  if (ms < 15_000) return '5-15s';
  if (ms < 60_000) return '15-60s';
  return '>60s';
}

/** Random v4-shaped id — analytics-only, never the server user id or persona. */
function randomId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// Same platform-split storage as lib/session.ts (SecureStore native, localStorage web).
// reason: dynamic import keeps expo-secure-store entirely out of the bundle path
// when analytics is dark, and this module import-safe in plain Node (e2e).
async function loadOrCreateId(): Promise<string> {
  const read = async (): Promise<string | null> => {
    if (Platform.OS === 'web') return globalThis.localStorage?.getItem(ID_KEY) ?? null;
    const SecureStore = await import('expo-secure-store');
    return SecureStore.getItemAsync(ID_KEY);
  };
  const write = async (v: string): Promise<void> => {
    if (Platform.OS === 'web') {
      globalThis.localStorage?.setItem(ID_KEY, v);
      return;
    }
    const SecureStore = await import('expo-secure-store');
    await SecureStore.setItemAsync(ID_KEY, v);
  };
  const existing = await read();
  if (existing) return existing;
  const fresh = randomId();
  await write(fresh);
  return fresh;
}

const privateAnalytics = createPrivateAnalytics({
  enabled: Boolean(KEY),
  loadOrCreateId,
  forgetId: async () => {
    if (Platform.OS === 'web') {
      globalThis.localStorage?.removeItem(ID_KEY);
      return;
    }
    const SecureStore = await import('expo-secure-store');
    await SecureStore.deleteItemAsync(ID_KEY);
  },
  send: (event, properties, id) => fetch(`${HOST}/capture/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: KEY, event, distinct_id: id, properties }),
  }),
});

/** Fire-and-forget. Never throws, never blocks UI, returns synchronously and
 * does no storage/network work at all while the key is empty (dark mode). */
export function capture<E extends keyof EventMap>(
  event: E,
  ...props: EventMap[E] extends undefined ? [] : [EventMap[E]]
): void {
  privateAnalytics.capture(event, props[0]);
}

/** Suppress flagged first-message retention without emitting a crisis event. */
export function captureFirstMessage(message: unknown): void {
  if (mayCaptureFirstMessage(message)) capture('chat_first_message_sent');
}

/** Start fresh: the next identity on this device gets a new analytics id, so the funnel can
 * never join the old persona's events to the new one's (T&S #7 / #10). */
export async function forgetAnalyticsId(): Promise<void> {
  await privateAnalytics.forget();
}
