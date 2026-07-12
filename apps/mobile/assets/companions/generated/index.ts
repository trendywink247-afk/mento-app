/**
 * AI-generated companion art (founder-approved 2026-07-12) — one consistent
 * soft-shaded set across all six animals, generated via Higgsfield (Google
 * Nano Banana 2, panda as style lock), background-removed, trimmed and packed
 * as ~26KB 512px WebP cutouts (~162KB total — lighter than the Fluent SVGs).
 * Full-res originals + job IDs: docs/mascot-candidates/.
 *
 * Rendered by the Companion entry point on the ReactiveCompanion rig; sits
 * between the Lottie override and the Fluent fallback in the priority chain.
 * `scale` tunes visual weight per animal (cutouts are trimmed to content, so
 * 1 = fill the box via contain).
 */
import type { ImageSourcePropType } from 'react-native';

import type { CompanionAnimal } from '@/components/art/Companions';

export const COMPANION_GENERATED: Record<
  CompanionAnimal,
  { source: ImageSourcePropType; scale: number } | null
> = {
  Panda: { source: require('./panda.webp'), scale: 1 },
  Elephant: { source: require('./elephant.webp'), scale: 1 },
  Fox: { source: require('./fox.webp'), scale: 1 },
  Turtle: { source: require('./turtle.webp'), scale: 1 },
  Deer: { source: require('./deer.webp'), scale: 1 },
  Owl: { source: require('./owl.webp'), scale: 1 },
};
