/**
 * SceneTile — renders a generated empty-state scene (assets/scenes) as a
 * softly rounded illustration tile. The art carries its own warm-cream
 * background, so the tile blends into cream screens and reads as a
 * deliberate illustration card on tinted surfaces.
 */
import { Image } from 'react-native';

import { SCENES, type SceneName } from '@/assets/scenes';

export function SceneTile({ name, size = 140 }: { name: SceneName; size?: number }) {
  return (
    <Image
      source={SCENES[name]}
      resizeMode="cover"
      accessibilityIgnoresInvertColors
      style={{ width: size, height: size, borderRadius: size * 0.24 }}
    />
  );
}
