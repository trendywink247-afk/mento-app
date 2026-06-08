import type { ReactNode } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { OverlayProvider } from 'stream-chat-expo';

/** Native wraps the app in stream-chat-expo's providers (required by its UI kit). */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <OverlayProvider>{children}</OverlayProvider>
    </GestureHandlerRootView>
  );
}
