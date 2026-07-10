/** Dedicated Stream client for the listener console. NOT the getInstance singleton —
 * one browser can hold a member session AND a listener session, and connectUser on a
 * shared instance with a different user throws. */
import { StreamChat } from 'stream-chat';

const STREAM_API_KEY = process.env.EXPO_PUBLIC_STREAM_API_KEY ?? '';

let client: StreamChat | null = null;

export function getListenerStreamClient(): StreamChat {
  if (!STREAM_API_KEY) {
    // reason: surfaced loudly in dev so a missing key never silently no-ops chat.
    throw new Error('EXPO_PUBLIC_STREAM_API_KEY is not set');
  }
  if (!client) {
    client = new StreamChat(STREAM_API_KEY);
  }
  return client;
}
