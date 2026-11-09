import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useColorScheme } from 'react-native';

import { getAppearance, getCompanionColor, saveAppearance, saveCompanionColor } from '@/lib/session';
import {
  accentFor,
  COMPANION_COLORS,
  DEFAULT_COMPANION_COLOR,
  darkAccentFor,
  type AccentSet,
  type CompanionColor,
} from '@/theme/companion';
import {
  applyStaticPalette,
  colorsFor,
  elevation,
  radius,
  space,
  type,
  washFor,
  washInkFor,
  type Appearance,
  type Look,
  type Wash,
} from '@/theme/tokens';

/** Base neutral colours + the active companion accent merged in (widened from the
 * `as const` literals so the accent can override brand* at runtime). */
export type ThemeColors = { [K in keyof ReturnType<typeof colorsFor>]: string } & AccentSet;

type ThemeValue = {
  colors: ThemeColors;
  space: typeof space;
  radius: typeof radius;
  type: typeof type;
  elevation: typeof elevation;
  companionColor: CompanionColor;
  setCompanionColor: (c: CompanionColor) => void;
  /** What the person chose (pastel, light, dark or system) and the look that is showing. */
  appearance: Appearance;
  look: Look;
  setAppearance: (a: Appearance) => void;
  wash: { [K in Wash]: string };
  washInk: ReturnType<typeof washInkFor>;
};

function buildColors(accent: AccentSet, look: Look): ThemeColors {
  const baseColors = colorsFor(look);
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
  const [appearance, setAppearanceState] = useState<Appearance>('pastel');
  const [ready, setReady] = useState(false);
  const phone = useColorScheme();
  const look: Look = appearance === 'system' ? (phone === 'dark' ? 'dark' : 'light') : appearance;
  // Rewrite the module-level palettes BEFORE children render with the new look.
  applyStaticPalette(look);

  useEffect(() => {
    let active = true;
    void getAppearance()
      .then((a) => {
        if (active && (a === 'pastel' || a === 'light' || a === 'dark' || a === 'system')) setAppearanceState(a);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const setAppearance = useCallback((a: Appearance) => {
    setAppearanceState(a);
    void saveAppearance(a);
  }, []);

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
      colors: buildColors(look === 'dark' ? darkAccentFor(companionColor) : accentFor(companionColor), look),
      space,
      radius,
      type,
      elevation,
      companionColor,
      setCompanionColor,
      appearance,
      look,
      setAppearance,
      wash: washFor(look),
      washInk: washInkFor(look),
    }),
    [companionColor, setCompanionColor, appearance, look, setAppearance],
  );

  // One frame while the saved look is read, so a dark phone never flashes cream.
  if (!ready) return null;

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
