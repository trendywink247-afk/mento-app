import { useEffect, useState } from 'react';

import type { CompanionAnimal } from '@/components/art/Companions';
import { getCompanionAnimal } from '@/lib/session';

/** The stored growth-companion animal (null until read / when none chosen). Read once per mount —
 * the choice only changes on the companion step, which remounts everything after it. */
export function useCompanionAnimal(): CompanionAnimal | null {
  const [animal, setAnimal] = useState<CompanionAnimal | null>(null);
  useEffect(() => {
    let active = true;
    void getCompanionAnimal().then((a) => {
      if (active) setAnimal((a as CompanionAnimal | null) ?? null);
    });
    return () => {
      active = false;
    };
  }, []);
  return animal;
}
