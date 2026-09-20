/**
 * SkyGround — ONE sky for the whole member app (founder review 2026-09-20: "the same
 * background theming as the landing for the total app"). The landing / onboarding aurora
 * (`AmbientBackground`: the static gradient on the first frame, the Skia shader after)
 * is mounted once, behind the root `Stack`, and every member screen is transparent over
 * it — so the sky never restarts, never jumps and never doubles between routes; only the
 * content changes on top of it.
 *
 * Screens that keep their own opaque ground (the mentor side, the mentor path with its own
 * sky) cover it; while one of them is focused the sky's clock is OFF (constant uniforms,
 * no redraw), so the shader never runs unseen. The web admin dashboard and the web
 * listener console have their own layouts and get no sky at all (no CanvasKit download).
 *
 * Reduced motion: the aurora's clock is frozen (a still gradient). No blur anywhere.
 */
import { useSegments } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AmbientBackground } from '@/components/motion/AmbientBackground';

/** Route prefixes whose screens paint their own opaque ground over the sky. */
const OWN_GROUND: readonly (readonly string[])[] = [
  ['mentor-home'],
  ['mentor', 'chat'],
  ['mentor', 'member'],
  ['mentor', 'reading'],
  ['apply'],
  ['listener-apply'],
];

/** Web-only layouts that never show the member sky. */
const NO_SKY = new Set(['admin', 'listener']);

export function SkyGround() {
  const segments = useSegments() as string[];
  if (NO_SKY.has(segments[0] ?? '')) return null;
  const covered = OWN_GROUND.some((prefix) => prefix.every((part, i) => segments[i] === part));
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" testID="sky-ground">
      <AmbientBackground paused={covered} />
    </View>
  );
}
