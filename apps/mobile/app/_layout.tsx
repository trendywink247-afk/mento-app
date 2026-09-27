import {
  Baloo2_400Regular,
  Baloo2_500Medium,
  Baloo2_600SemiBold,
  Baloo2_700Bold,
  Baloo2_800ExtraBold,
} from '@expo-google-fonts/baloo-2';
import Ionicons from '@expo/vector-icons/Ionicons';
import { DefaultTheme, ThemeProvider as NavigationThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppProviders } from '@/components/AppProviders';
import { SkyGround } from '@/components/motion/SkyGround';
import { WebFrame } from '@/components/WebFrame';
import { installNotificationHandler, useNotificationTaps } from '@/lib/notifications';
import { useShakeToUpdate } from '@/lib/useShakeToUpdate';
import { ThemeProvider } from '@/theme/ThemeProvider';

// Foreground banners without sound + tap routing (spec 2026-09-05 push §6). Web
// resolves to lib/notifications.web.ts, a no-op — the web console/app never receives pushes.
installNotificationHandler();

// The navigators' own ground is transparent: every card and scene lies on the one sky
// (components/motion/SkyGround.tsx). Without this react-navigation paints its default grey.
const SKY_NAV_THEME = { ...DefaultTheme, colors: { ...DefaultTheme.colors, background: 'transparent' } };

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
    // The one icon family the app uses. Without it in this gate the tab bar (and every
    // icon key) painted first and its glyphs popped in a beat later — empty boxes on web.
    ...Ionicons.font,
  });
  // Fonts are bundled locally (expo-google-fonts, vector-icons), so this resolves in a frame
  // or two; the Expo splash stays up meanwhile — no flash of fallback type or missing icons.
  if (!fontsLoaded) return null;

  return (
    <SafeAreaProvider>
      {/* Platform-split: native adds stream-chat-expo providers; web is a passthrough. */}
      <AppProviders>
        {/* Per-user companion-colour accent theme over the neutral light base. */}
        <ThemeProvider>
          <StatusBar style="dark" />
          {/* Web: centered app column on wide windows (passthrough on native + phones). */}
          <WebFrame>
            {/* One sky behind every member screen (components/motion/SkyGround.tsx); the
                screens are transparent over it, so it never restarts between routes. */}
            <SkyGround />
            <NavigationThemeProvider value={SKY_NAV_THEME}>
            <Stack
              screenOptions={{
                headerShown: false,
                // Transparent: the one sky shows through. Screens that need an opaque
                // ground (mentor side, admin) paint their own.
                contentStyle: { backgroundColor: 'transparent' },
                // Over one still sky a page crossfades (native) while its content column
                // comes in from the side (DeepArrival) — a sliding transparent page would
                // drag its words across the previous page's words.
                animation: 'fade',
              }}
            >
              {/* Designed seams: landing → journey → chat crossfade as one continuous
                  shot; everything else keeps the default push. */}
              <Stack.Screen name="onboarding/index" options={{ animation: 'fade' }} />
              <Stack.Screen name="chat/[id]" options={{ animation: 'fade' }} />
              {/* Mentor branch hand-off crossfades in like the chat does (DECISIONS §K.7). */}
              <Stack.Screen name="mentor-home" options={{ animation: 'fade' }} />
              {/* A board sheet as a screens-backed transparent modal (see app/start-fresh.tsx):
                  the sheet animates itself, so the route does not. */}
              <Stack.Screen
                name="start-fresh"
                options={{
                  presentation: 'transparentModal',
                  animation: 'none',
                  contentStyle: { backgroundColor: 'transparent' },
                }}
              />
              {/* Board sheets (components/motion/BoardSheet.tsx): the sheet animates itself and
                  the screen underneath settles back, so the route itself never animates. */}
              <Stack.Screen
                name="new-chat"
                options={{
                  presentation: 'transparentModal',
                  animation: 'none',
                  contentStyle: { backgroundColor: 'transparent' },
                }}
              />
              {/* Board A11: the feedback sheet over whichever screen opened it — its own
                  scrim + rise run inside (app/feedback.tsx), so the route itself does not animate. */}
              <Stack.Screen
                name="feedback"
                options={{
                  presentation: 'transparentModal',
                  animation: 'none',
                  contentStyle: { backgroundColor: 'transparent' },
                }}
              />
            </Stack>
            </NavigationThemeProvider>
          </WebFrame>
        </ThemeProvider>
      </AppProviders>
    </SafeAreaProvider>
  );
}
