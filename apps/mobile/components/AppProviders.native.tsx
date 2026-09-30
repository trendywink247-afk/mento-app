import type { ReactNode } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { OverlayProvider } from 'stream-chat-expo';

import { LanguageProvider } from '@/lib/i18n';

// Sentry, env-gated (H1-remainder B2): JS-error capture only this pass — native
// crash symbolication is release-build work. Empty DSN = fully off; in Expo Go
// the SDK degrades to JS-only by itself.
const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN ?? '';
if (SENTRY_DSN) {
  // reason: guarded require keeps the SDK out of the module-eval path when dark.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Sentry = require('@sentry/react-native') as typeof import('@sentry/react-native');
  Sentry.init({ dsn: SENTRY_DSN, sendDefaultPii: false, tracesSampleRate: 0, enableAutoSessionTracking: false });
}

/** Native wraps the app in stream-chat-expo's providers (required by its UI kit). */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <LanguageProvider>
        <OverlayProvider>{children}</OverlayProvider>
      </LanguageProvider>
    </GestureHandlerRootView>
  );
}
