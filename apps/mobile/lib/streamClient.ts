/** Shared Stream Chat client. The API key is the publishable key (safe on the client);
 * the per-user token comes from the backend (issued at onboarding, stored in session). */
import { StreamChat } from 'stream-chat';

const STREAM_API_KEY = process.env.EXPO_PUBLIC_STREAM_API_KEY ?? '';

let client: StreamChat | null = null;

export function getStreamClient(): StreamChat {
  if (!STREAM_API_KEY) {
    // reason: surfaced loudly in dev so a missing key never silently no-ops chat.
    throw new Error('EXPO_PUBLIC_STREAM_API_KEY is not set');
  }
  if (!client) {
    client = StreamChat.getInstance(STREAM_API_KEY);
  }
  return client;
}
