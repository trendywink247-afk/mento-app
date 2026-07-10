import { Stack } from 'expo-router';

/** Listener console routes (web-only surface; native renders a notice). */
export default function ListenerLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
