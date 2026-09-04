/**
 * Painterly companion set (DECISIONS §K.8, 2026-09-05): six animals × six poses (+ two
 * panda extras), generated on Higgsfield from one locked recipe with a reference image
 * per animal (scripts/companions/recipe.md, manifest.json), cut out locally by
 * scripts/companions/cutout.py, packed as ~30KB 512px RGBA WebP.
 *
 * Rendered by components/art/Companion.tsx on the ReactiveCompanion rig. `idle` is
 * required for every animal; any missing pose falls back to `idle` in Companion.
 * `scale` tunes visual weight per animal (cutouts are trimmed to content).
 */
import type { ImageSourcePropType } from 'react-native';

import type { CompanionAnimal } from '@/components/art/Companions';

export type CompanionPose = 'idle' | 'greet' | 'joy' | 'comfort' | 'curious' | 'sleepy' | 'coffee' | 'shield';

export type CompanionArtSet = {
  poses: Partial<Record<CompanionPose, ImageSourcePropType>> & { idle: ImageSourcePropType };
  scale: number;
};

export const COMPANION_GENERATED: Record<CompanionAnimal, CompanionArtSet> = {
  Panda: {
    poses: {
      idle: require('./Panda/idle.webp'),
      greet: require('./Panda/greet.webp'),
      joy: require('./Panda/joy.webp'),
      comfort: require('./Panda/comfort.webp'),
      curious: require('./Panda/curious.webp'),
      sleepy: require('./Panda/sleepy.webp'),
      coffee: require('./Panda/coffee.webp'),
      shield: require('./Panda/shield.webp'),
    },
    scale: 1,
  },
  Elephant: { poses: { idle: require('./Elephant/idle.webp'), greet: require('./Elephant/greet.webp'), joy: require('./Elephant/joy.webp'), comfort: require('./Elephant/comfort.webp'), curious: require('./Elephant/curious.webp'), sleepy: require('./Elephant/sleepy.webp') }, scale: 1 },
  Fox: { poses: { idle: require('./Fox/idle.webp'), greet: require('./Fox/greet.webp'), joy: require('./Fox/joy.webp'), comfort: require('./Fox/comfort.webp'), curious: require('./Fox/curious.webp'), sleepy: require('./Fox/sleepy.webp') }, scale: 1 },
  Turtle: { poses: { idle: require('./Turtle/idle.webp'), greet: require('./Turtle/greet.webp'), joy: require('./Turtle/joy.webp'), comfort: require('./Turtle/comfort.webp'), curious: require('./Turtle/curious.webp'), sleepy: require('./Turtle/sleepy.webp') }, scale: 1 },
  Deer: { poses: { idle: require('./Deer/idle.webp'), greet: require('./Deer/greet.webp'), joy: require('./Deer/joy.webp'), comfort: require('./Deer/comfort.webp'), curious: require('./Deer/curious.webp'), sleepy: require('./Deer/sleepy.webp') }, scale: 1 },
  Owl: { poses: { idle: require('./Owl/idle.webp'), greet: require('./Owl/greet.webp'), joy: require('./Owl/joy.webp'), comfort: require('./Owl/comfort.webp'), curious: require('./Owl/curious.webp'), sleepy: require('./Owl/sleepy.webp') }, scale: 1 },
};
