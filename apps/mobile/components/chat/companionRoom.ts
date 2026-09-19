/**
 * The room a chat thread keeps free at its foot for the member's companion (boards A05 /
 * A22). The companion stands on the composer footer's top edge — or on the three-in-a-row
 * note's — so it rises into the thread's last few pixels; without this room it was drawn
 * over the last bubble and its "Delivered" line. Web pads the list's foot; native pads the
 * kit's inverted list (whose `paddingTop` is the visual bottom). Zero when no companion is
 * drawn (crisis card, error, failed send, options sheet: `slotId` is null).
 */
import { perchRise, type CompanionPlacement } from '@/components/art/PerchedCompanion';
import { NOTE_SEAT } from '@/components/chat/AllowanceNote';
import { space } from '@/theme/tokens';

/** The companion's seat on the composer's top edge. */
export const COMPOSER_SEAT = { size: 72 } as const;

export function companionRoom(placement: CompanionPlacement, onNote: boolean): number {
  if (!placement.slotId) return space.sm;
  const rise = onNote
    ? perchRise(placement.animal, NOTE_SEAT.size, NOTE_SEAT.nudge)
    : perchRise(placement.animal, COMPOSER_SEAT.size);
  // A breath of air between the last row and the top of the art.
  return Math.round(rise) + space.xs;
}
