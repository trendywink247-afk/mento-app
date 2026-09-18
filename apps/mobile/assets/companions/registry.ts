/**
 * Interim companion animation registry (DECISIONS §I.4 — free Lottie set while the
 * commissioned Rive characters are produced).
 *
 * null = no asset yet → the Companion component falls back to the coded SVG art,
 * so the app is never broken by a missing file. To light an animal up: download its
 * **Lottie JSON** (see README.md in this folder for the exact sources), drop it
 * here (e.g. panda.json), and point the entry at it:
 *
 *   Panda: require('./panda.json'),
 */
import type { AnimationObject } from 'lottie-react-native';

import type { CompanionAnimal } from '@/components/art/Companions';

// Metro parses required .json into the animation object lottie-react-native expects.
export type CompanionAnimationSource = AnimationObject;

export const COMPANION_LOTTIE: Record<CompanionAnimal, CompanionAnimationSource | null> = {
  Panda: null,
  Elephant: null,
  Fox: null,
  Turtle: null,
  Deer: null,
  Owl: null,
  Dog: null,
  Cat: null,
  Capybara: null,
};
