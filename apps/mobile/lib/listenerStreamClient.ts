/** Dedicated Stream client for the listener console. NOT the getInstance singleton —
 * one browser can hold a member session AND a listener session, and connectUser on a
 * shared instance with a different user throws. */
import { StreamChat } from 'stream-chat';

const STREAM_API_KEY = process.env.EXPO_PUBLIC_STREAM_API_KEY ?? '';

let client: StreamChat | null = null;
// Serializes connect/disconnect so concurrent connectUser calls can't race.
let connecting: Promise<void> = Promise.resolve();

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

/** Connect the listener client as `user`, deduping concurrent calls and switching
 * identity cleanly (disconnect first) when the connected user differs. */
export async function ensureListenerConnected(
  user: { id: string; name?: string },
  token: string,
): Promise<StreamChat> {
  const c = getListenerStreamClient();
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
