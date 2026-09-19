/**
 * Living idle loops — WEB. Browsers play animated WebP natively, so the companions that
 * have a loop use it where a screen asks for `living` (today: the ready stage, board A18).
 * Only the Cat has one (scratch `alive/` keyer, session 35; 512², 74 frames, 1.17 MB); the
 * other eight fall back to the painted idle pose + breathing, exactly as the board does.
 */
import type { ImageSourcePropType } from 'react-native';

import type { CompanionAnimal } from '@/components/art/Companions';

export const COMPANION_LIVING: Partial<Record<CompanionAnimal, ImageSourcePropType>> = {
  Cat: require('./Cat_idle.webp') as ImageSourcePropType,
};
