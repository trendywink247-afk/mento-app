import type { ReactNode } from 'react';

/** Web does NOT pull in stream-chat-expo (its RN new-arch internals don't bundle under
 * react-native-web). The web chat uses the stream-chat JS client + custom UI instead,
 * so no extra providers are needed here. Native = primary; web = best-effort (CLAUDE.md). */
export function AppProviders({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
