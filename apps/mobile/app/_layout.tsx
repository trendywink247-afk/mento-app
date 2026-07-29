import {
  Lora_500Medium,
  Lora_600SemiBold,
} from '@expo-google-fonts/lora';
import {
  NotoSansDevanagari_400Regular,
  NotoSansDevanagari_700Bold,
} from '@expo-google-fonts/noto-sans-devanagari';
import {
  Nunito_400Regular,
  Nunito_600SemiBold,
  Nunito_700Bold,
  Nunito_800ExtraBold,
} from '@expo-google-fonts/nunito';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppProviders } from '@/components/AppProviders';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { colors } from '@/theme/tokens';

export default function RootLayout() {
  // Family names must match theme/tokens.ts `font`.
  const [fontsLoaded] = useFonts({
    Nunito_400Regular,
    Nunito_600SemiBold,
    Nunito_700Bold,
    Nunito_800ExtraBold,
    Lora_500Medium,
    Lora_600SemiBold,
    // Hindi (Devanagari) faces — Lora has no Devanagari, so hi display text
    // maps to the bold sans (logged in PROGRESS → Open decisions).
    NotoSansDevanagari_400Regular,
    NotoSansDevanagari_700Bold,
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
