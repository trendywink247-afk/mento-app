/** Shared Stream Chat client. The API key is the publishable key (safe on the client);
 * the per-user token comes from the backend (issued at onboarding, stored in session). */
import { StreamChat } from 'stream-chat';

const STREAM_API_KEY = process.env.EXPO_PUBLIC_STREAM_API_KEY ?? '';

let client: StreamChat | null = null;
// Serializes connect/disconnect so two screens can never race concurrent connectUser
// calls (or connect while a disconnect is in flight).
let connecting: Promise<void> = Promise.resolve();

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

/** Connect the shared client as `user`, deduping concurrent calls and switching
 * identity cleanly (disconnect first) when the connected user differs — e.g. after
 * "Start fresh" created a new anonymous persona. */
export async function ensureConnected(
  user: { id: string; name?: string },
  token: string,
): Promise<StreamChat> {
  const c = getStreamClient();
  const run = connecting
    .catch(() => {
      /* a previous failed connect must not poison the chain */
    })
    .then(async () => {
      if (c.userID === user.id) return;
      if (c.userID) await c.disconnectUser();
      await c.connectUser(user, token);
    });
  connecting = run;
  await run;
  return c;
}

/** Tear down the shared client's websocket + identity (used by clearSession). */
export async function disconnectStreamClient(): Promise<void> {
  if (!client) return;
  const c = client;
  const run = connecting
    .catch(() => {})
    .then(async () => {
      if (c.userID) await c.disconnectUser();
    });
  connecting = run;
  await run;
}
