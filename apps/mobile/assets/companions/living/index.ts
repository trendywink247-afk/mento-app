/**
 * Living idle loops (animated WebP with alpha: breathing, blinking, a tail sway) — NATIVE.
 * Empty on purpose. RN's Image only plays animated WebP on Android when the native build
 * sets `expo.webp.animated=true` (android/ is generated — see docs/ANDROID_BUILD.md), and
 * shipping a 1.2 MB loop that renders as a still would be dead weight. Native keeps the
 * painted idle pose + the rig's breathing. The web twin is ./index.web.ts.
 */
import type { ImageSourcePropType } from 'react-native';

import type { CompanionAnimal } from '@/components/art/Companions';

export const COMPANION_LIVING: Partial<Record<CompanionAnimal, ImageSourcePropType>> = {};
