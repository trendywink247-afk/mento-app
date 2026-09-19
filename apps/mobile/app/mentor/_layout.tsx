import { Stack } from 'expo-router';

/** Mentor console routes: chat (fade, like the member chat) + member brief (normal
 * push, hardware back returns to the chat) + transparent-modal sheets.
 * Also owns `[id]` (the existing member-side mentor profile, previously auto-discovered
 * at the root) — headerShown:false here replaces the root Stack's screenOptions, which
 * a nested navigator does not inherit. */
export default function MentorLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="[id]" />
      <Stack.Screen name="chat/[id]" options={{ animation: 'fade' }} />
      <Stack.Screen name="member/[id]" />
      <Stack.Screen name="reading" />
      <Stack.Screen name="report" options={{ presentation: 'transparentModal', animation: 'fade' }} />
      <Stack.Screen name="helplines" options={{ presentation: 'transparentModal', animation: 'fade' }} />
      <Stack.Screen name="line" options={{ presentation: 'transparentModal', animation: 'fade' }} />
    </Stack>
  );
}
