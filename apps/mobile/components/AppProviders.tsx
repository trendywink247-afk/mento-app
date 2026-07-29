import type { ReactNode } from 'react';

// Sentry, env-gated (H1-remainder B2): JS-error capture only this pass. Empty
// DSN = fully off — the branch is dead and the SDK never evaluates.
const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN ?? '';
if (SENTRY_DSN) {
  // reason: guarded require keeps the SDK out of the module-eval path when dark.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Sentry = require('@sentry/react-native') as typeof import('@sentry/react-native');
  Sentry.init({ dsn: SENTRY_DSN, sendDefaultPii: false, tracesSampleRate: 0 });
}

/** Web does NOT pull in stream-chat-expo (its RN new-arch internals don't bundle under
 * react-native-web). The web chat uses the stream-chat JS client + custom UI instead,
 * so no extra providers are needed here. Native = primary; web = best-effort (CLAUDE.md). */
export function AppProviders({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
