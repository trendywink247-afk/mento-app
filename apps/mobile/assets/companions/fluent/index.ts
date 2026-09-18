/**
 * Fluent Emoji Color art for the six companions — microsoft/fluentui-emoji, MIT
 * (LICENSE in this folder). One consistent soft-gradient style across all six;
 * rendered via SvgXml inside the Companion entry point, animated by the
 * ReactiveCompanion rig.
 *
 * `scale` normalises Unicode framing: panda/fox are FACE emoji (fill the canvas),
 * elephant/turtle/deer/owl are full-body/bust (more padding) — without this the
 * six would read as different sizes side-by-side in the picker.
 */
import type { CompanionAnimal } from '@/components/art/Companions';

import { deerXml } from './deer';
import { elephantXml } from './elephant';
import { foxXml } from './fox';
import { owlXml } from './owl';
import { pandaXml } from './panda';
import { turtleXml } from './turtle';

// Partial: Dog / Cat / Capybara (2026-09-19) ship painterly art only — there is no
// capybara emoji, and this tier is unreachable while every animal has an `idle` cutout.
export const COMPANION_FLUENT: Partial<Record<CompanionAnimal, { xml: string; scale: number }>> = {
  Panda: { xml: pandaXml, scale: 1 },
  Elephant: { xml: elephantXml, scale: 1.08 },
  Fox: { xml: foxXml, scale: 1 },
  Turtle: { xml: turtleXml, scale: 1.08 },
  Deer: { xml: deerXml, scale: 1.05 },
  Owl: { xml: owlXml, scale: 1.08 },
};
