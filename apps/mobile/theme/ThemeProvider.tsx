import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { getCompanionColor, saveCompanionColor } from '@/lib/session';
import {
  accentFor,
  COMPANION_COLORS,
  DEFAULT_COMPANION_COLOR,
  type AccentSet,
  type CompanionColor,
} from '@/theme/companion';
import { colors as baseColors, elevation, radius, space, type } from '@/theme/tokens';

/** Base neutral colours + the active companion accent merged in (widened from the
 * `as const` literals so the accent can override brand* at runtime). */
export type ThemeColors = { [K in keyof typeof baseColors]: string } & AccentSet;

type ThemeValue = {
  colors: ThemeColors;
  space: typeof space;
  radius: typeof radius;
  type: typeof type;
  elevation: typeof elevation;
  companionColor: CompanionColor;
  setCompanionColor: (c: CompanionColor) => void;
};

function buildColors(accent: AccentSet): ThemeColors {
  // The accent overrides the default brand* so existing brand-based components also
  // pick up the companion colour without a rewrite.
  return {
    ...baseColors,
    ...accent,
    brand: accent.accent,
    brandPress: accent.accentPress,
    brandTint: accent.accentTint,
  };
}

const ThemeContext = createContext<ThemeValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [companionColor, setColor] = useState<CompanionColor>(DEFAULT_COMPANION_COLOR);

  // Hydrate the persisted companion colour on launch.
  useEffect(() => {
    let active = true;
    void getCompanionColor().then((c) => {
      if (active && c && c in COMPANION_COLORS) setColor(c as CompanionColor);
    });
    return () => {
      active = false;
    };
  }, []);

  const setCompanionColor = useCallback((c: CompanionColor) => {
    setColor(c); // live preview
    void saveCompanionColor(c); // persist
  }, []);

  const value = useMemo<ThemeValue>(
    () => ({
      colors: buildColors(accentFor(companionColor)),
      space,
      radius,
      type,
      elevation,
      companionColor,
      setCompanionColor,
    }),
    [companionColor, setCompanionColor],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
