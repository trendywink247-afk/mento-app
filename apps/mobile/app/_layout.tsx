import {
  Baloo2_400Regular,
  Baloo2_500Medium,
  Baloo2_600SemiBold,
  Baloo2_700Bold,
  Baloo2_800ExtraBold,
} from '@expo-google-fonts/baloo-2';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppProviders } from '@/components/AppProviders';
import { installNotificationHandler, useNotificationTaps } from '@/lib/notifications';
import { useShakeToUpdate } from '@/lib/useShakeToUpdate';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { colors } from '@/theme/tokens';

// Foreground banners without sound + tap routing (spec 2026-09-05 push §6). Web
// resolves to lib/notifications.web.ts, a no-op — the web console/app never receives pushes.
installNotificationHandler();

export default function RootLayout() {
  // Device-testing affordance: shake anywhere to check EAS Update. No-op in
  // Expo Go/dev server (see lib/useShakeToUpdate.ts).
  useShakeToUpdate();
  useNotificationTaps();

  // Family names must match theme/tokens.ts `font`. One family (DECISIONS §K.6):
  // Baloo 2 carries Latin AND Devanagari, so the Lora/Noto pairing is retired.
  const [fontsLoaded] = useFonts({
    Baloo2_400Regular,
    Baloo2_500Medium,
    Baloo2_600SemiBold,
    Baloo2_700Bold,
    Baloo2_800ExtraBold,
  });
  // Fonts are bundled locally (expo-google-fonts), so this resolves in a frame or two;
  // the Expo splash stays up meanwhile — no flash of fallback type.
  if (!fontsLoaded) return null;

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
          >
            {/* Designed seams: landing → journey → chat crossfade as one continuous
                shot; everything else keeps the default push. */}
            <Stack.Screen name="onboarding/index" options={{ animation: 'fade' }} />
            <Stack.Screen name="chat/[id]" options={{ animation: 'fade' }} />
            {/* Mentor branch hand-off crossfades in like the chat does (DECISIONS §K.7). */}
            <Stack.Screen name="mentor-home" options={{ animation: 'fade' }} />
            {/* Confirm dialog as a screens-backed transparent modal (see app/start-fresh.tsx). */}
            <Stack.Screen
              name="start-fresh"
              options={{
                presentation: 'transparentModal',
                animation: 'fade',
                contentStyle: { backgroundColor: 'transparent' },
              }}
            />
          </Stack>
        </ThemeProvider>
      </AppProviders>
    </SafeAreaProvider>
  );
}
