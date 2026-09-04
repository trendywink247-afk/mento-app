import { useEffect, useState } from 'react';

import type { CompanionAnimal } from '@/components/art/Companions';
import { getCompanionAnimal } from '@/lib/session';

/** The stored growth-companion animal: `undefined` while the async read is still in
 * flight (first paint — callers should reserve layout space rather than flash a
 * default), `null` once read and none is stored, else the stored animal. Read once
 * per mount — the choice only changes on the companion step, which remounts
 * everything after it. */
export function useCompanionAnimal(): CompanionAnimal | null | undefined {
  const [animal, setAnimal] = useState<CompanionAnimal | null | undefined>(undefined);
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
