/**
 * Panda — legacy fixed-mascot entry point, now a thin adapter: renders the USER's
 * chosen companion (DECISIONS §I.5 "the chosen animal is the star") in the pose the
 * old panda vocabulary asked for. Kept so screens written against `<Panda pose=…>`
 * need no edits; new code should call `Companion` directly.
 */
import { Companion, type CompanionPose } from '@/components/art/Companion';
import { useCompanionAnimal } from '@/lib/useCompanionAnimal';

export type PandaPose = 'wave' | 'sleep' | 'excited' | 'coffee' | 'sad' | 'shield';

/** Legacy pose → painterly pose. `coffee`/`shield` exist for the panda only; other animals
 * take the nearest emotional pose. */
const LEGACY: Record<PandaPose, { panda: CompanionPose; other: CompanionPose }> = {
  wave: { panda: 'greet', other: 'greet' },
  sleep: { panda: 'sleepy', other: 'sleepy' },
  excited: { panda: 'joy', other: 'joy' },
  sad: { panda: 'comfort', other: 'comfort' },
  coffee: { panda: 'coffee', other: 'joy' },
  shield: { panda: 'shield', other: 'comfort' },
};

export function Panda({ pose = 'wave', size = 160 }: { pose?: PandaPose; size?: number }) {
  const animal = useCompanionAnimal();
  const mapped = LEGACY[pose];
  return <Companion animal={animal} size={size} pose={animal && animal !== 'Panda' ? mapped.other : mapped.panda} />;
}
