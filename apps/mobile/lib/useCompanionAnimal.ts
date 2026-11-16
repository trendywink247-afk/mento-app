import { useEffect, useState } from 'react';

import type { CompanionAnimal } from '@/components/art/Companions';
import { getCompanionAnimal, onCompanionAnimalSaved } from '@/lib/session';

/** The stored growth-companion animal: `undefined` while the async read is still in
 * flight (first paint — callers should reserve layout space rather than flash a
 * default), `null` once read and none is stored, else the stored animal. Read on
 * mount, then follows every later save: a pick made from Profile > Theme reaches the
 * tabs that are already mounted. */
export function useCompanionAnimal(): CompanionAnimal | null | undefined {
  const [animal, setAnimal] = useState<CompanionAnimal | null | undefined>(undefined);
  useEffect(() => {
    let active = true;
    void getCompanionAnimal().then((a) => {
      if (active) setAnimal((a as CompanionAnimal | null) ?? null);
    });
    const off = onCompanionAnimalSaved((a) => setAnimal(a as CompanionAnimal));
    return () => {
      active = false;
      off();
    };
  }, []);
  return animal;
}
