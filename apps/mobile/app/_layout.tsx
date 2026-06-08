import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppProviders } from '@/components/AppProviders';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { colors } from '@/theme/tokens';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      {/* Platform-split: native adds stream-chat-expo providers; web is a passthrough. */}
      <AppProviders>
        {/* Per-user companion-colour accent theme over the neutral light base. */}
        <ThemeProvider>
          <StatusBar style="dark" />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.bg },
              animation: 'slide_from_right',
            }}
          />
        </ThemeProvider>
      </AppProviders>
    </SafeAreaProvider>
  );
}
