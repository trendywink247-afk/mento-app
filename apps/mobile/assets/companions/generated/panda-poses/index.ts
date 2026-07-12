/**
 * Generated panda pose art (same set/style as the companion cutouts —
 * Higgsfield / Nano Banana 2, style-locked on the shipped panda; full-res
 * originals + job IDs in docs/mascot-candidates/). ~26-31KB 512px WebP each.
 *
 * Consumed by components/art/Panda.tsx: a non-null entry replaces the coded
 * SVG pose; null falls back to the SVG (which is also what re-tints its cape
 * to the user accent — the raster poses wear the fixed indigo scarf, same
 * trade-off as the main companion set).
 */
import type { ImageSourcePropType } from 'react-native';

import type { PandaPose } from '@/components/art/Panda';

export const PANDA_POSES: Record<PandaPose, ImageSourcePropType | null> = {
  wave: require('./wave.webp'),
  sleep: require('./sleep.webp'),
  excited: require('./excited.webp'),
  coffee: require('./coffee.webp'),
  sad: require('./sad.webp'),
  shield: require('./shield.webp'),
};
