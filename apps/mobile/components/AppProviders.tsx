import type { ReactNode } from 'react';

import { LanguageProvider } from '@/lib/i18n';
import { sentryInitOptions } from '@/lib/sentryConfig';

// Sentry, env-gated (H1-remainder B2): JS-error capture only this pass. Off unless a DSN is set AND
// EXPO_PUBLIC_APP_ENV is qa/staging/production (lib/sentryConfig.ts).
const SENTRY_OPTIONS = sentryInitOptions({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  appEnv: process.env.EXPO_PUBLIC_APP_ENV,
  gitSha: process.env.EXPO_PUBLIC_GIT_SHA,
});
if (SENTRY_OPTIONS) {
  // reason: guarded require keeps the SDK out of the module-eval path when dark.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Sentry = require('@sentry/react-native') as typeof import('@sentry/react-native');
  Sentry.init(SENTRY_OPTIONS);
}

/** Web does NOT pull in stream-chat-expo (its RN new-arch internals don't bundle under
 * react-native-web). The web chat uses the stream-chat JS client + custom UI instead,
 * so no extra providers are needed here. Native = primary; web = best-effort (CLAUDE.md). */
export function AppProviders({ children }: { children: ReactNode }) {
  return <LanguageProvider>{children}</LanguageProvider>;
}
