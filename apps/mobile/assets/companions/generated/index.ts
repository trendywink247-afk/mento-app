/**
 * Painterly companion set (DECISIONS §K.8, 2026-09-05; Dog / Cat / Capybara added
 * 2026-09-19): nine animals × six poses (+ two panda extras), generated on Higgsfield from one locked recipe with a reference image
 * per animal (scripts/companions/recipe.md, manifest.json), cut out locally by
 * scripts/companions/cutout.py, packed as ~30KB 512px RGBA WebP.
 *
 * Rendered by components/art/Companion.tsx on the ReactiveCompanion rig. `idle` is
 * required for every animal; any missing pose falls back to `idle` in Companion.
 * `scale` tunes visual weight per animal (cutouts are trimmed to content).
 *
 * CLING poses (2026-09-19) — `hang` / `peek` / `dangle` — are OPTIONAL: only some animals
 * have them (today: Cat). They are what lets the companion hold on to the UI
 * (components/art/PerchedCompanion.tsx), and which slot types an animal may take is read
 * straight from which of these files exist (lib/companionPlacement.ts `slotTypesFor`) — so
 * giving another animal a cling pose is one `require` line here, no code change. Each is cut
 * so its CONTACT line is an image edge or a known fraction (scripts/companions/recipe.md
 * "Cling poses"): hang = paws on the TOP edge · peek = paw line on the BOTTOM edge ·
 * dangle = seat line at 0.84 of the height.
 */
import type { ImageSourcePropType } from 'react-native';

import type { CompanionAnimal } from '@/components/art/Companions';

/** Optional poses only some animals have — the companion holding on to an edge. */
export type CompanionClingPose = 'hang' | 'peek' | 'dangle';

export type CompanionPose =
  | 'idle'
  | 'greet'
  | 'joy'
  | 'comfort'
  | 'curious'
  | 'sleepy'
  | 'coffee'
  | 'shield'
  | CompanionClingPose;

export type CompanionArtSet = {
  poses: Partial<Record<CompanionPose, ImageSourcePropType>> & { idle: ImageSourcePropType };
  scale: number;
  /** Where the feet are, as a fraction of the square art box from its top. Default
   * `COMPANION_GROUND` — every portrait cutout carries cutout.py's 6% pad, so the feet are at
   * 0.945. A LANDSCAPE cutout is also letterboxed by `contain`, so its feet sit higher.
   * Measured from the alpha bbox; only perching (PerchedCompanion) reads this. */
  ground?: number;
  /** Cling poses: where the art touches the furniture, same fraction (0 = the box's top
   * edge). Comes with the art — see scripts/companions/recipe.md "Cling poses". */
  contact?: Partial<Record<CompanionClingPose, number>>;
};

/** Feet line of a standard (portrait, 6%-padded) cutout inside its square box. */
export const COMPANION_GROUND = 0.94;

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
  Turtle: { poses: { idle: require('./Turtle/idle.webp'), greet: require('./Turtle/greet.webp'), joy: require('./Turtle/joy.webp'), comfort: require('./Turtle/comfort.webp'), curious: require('./Turtle/curious.webp'), sleepy: require('./Turtle/sleepy.webp') }, scale: 1, ground: 0.875 },
  Deer: { poses: { idle: require('./Deer/idle.webp'), greet: require('./Deer/greet.webp'), joy: require('./Deer/joy.webp'), comfort: require('./Deer/comfort.webp'), curious: require('./Deer/curious.webp'), sleepy: require('./Deer/sleepy.webp') }, scale: 1 },
  Owl: { poses: { idle: require('./Owl/idle.webp'), greet: require('./Owl/greet.webp'), joy: require('./Owl/joy.webp'), comfort: require('./Owl/comfort.webp'), curious: require('./Owl/curious.webp'), sleepy: require('./Owl/sleepy.webp') }, scale: 1 },
  Dog: { poses: { idle: require('./Dog/idle.webp'), greet: require('./Dog/greet.webp'), joy: require('./Dog/joy.webp'), comfort: require('./Dog/comfort.webp'), curious: require('./Dog/curious.webp'), sleepy: require('./Dog/sleepy.webp') }, scale: 1 },
  Cat: { poses: { idle: require('./Cat/idle.webp'), greet: require('./Cat/greet.webp'), joy: require('./Cat/joy.webp'), comfort: require('./Cat/comfort.webp'), curious: require('./Cat/curious.webp'), sleepy: require('./Cat/sleepy.webp'), hang: require('./Cat/hang.webp'), peek: require('./Cat/peek.webp'), dangle: require('./Cat/dangle.webp') }, scale: 1, contact: { hang: 0, peek: 0.979, dangle: 0.84 } },
  Capybara: { poses: { idle: require('./Capybara/idle.webp'), greet: require('./Capybara/greet.webp'), joy: require('./Capybara/joy.webp'), comfort: require('./Capybara/comfort.webp'), curious: require('./Capybara/curious.webp'), sleepy: require('./Capybara/sleepy.webp') }, scale: 1 },
};
