import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { StyleSheet, useColorScheme } from 'react-native';

import {
  getAppearance,
  getCompanionColor,
  getCompanionShown,
  saveAppearance,
  saveCompanionColor,
  saveCompanionShown,
} from '@/lib/session';
import {
  accentFor,
  COMPANION_COLORS,
  DEFAULT_COMPANION_COLOR,
  WHATSAPP_DARK_ACCENT,
  WHATSAPP_LIGHT_ACCENT,
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
export type ThemeColors = { [K in keyof ReturnType<typeof colorsFor>]: string } &
  AccentSet & {
    /** The chat's own ground and bubbles: WhatsApp's on Light and Dark, the accent pillow on Pastel. */
    chatGround: string;
    bubbleMine: string;
    bubbleMineInk: string;
    bubbleTheirs: string;
    /** The coloured word in a two-tone title ("My **Chats**"): the accent on Pastel, plain ink on
     * Light and Dark (WhatsApp titles are one colour). */
    titleAccent: string;
    /** A selected filter chip: ink on Pastel; WhatsApp's light green with green words on Light and Dark. */
    chipOn: string;
    chipOnInk: string;
    /** An unselected chip: white with a hairline on Pastel; WhatsApp's grey fill on Light and Dark. */
    chipOff: string;
    chipOffBorder: string;
  };

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
  /** Whether the member's own companion is drawn on their screens (Profile switch; off
   * after skipping it at signup). Other people's faces are never affected. */
  companionShown: boolean;
  setCompanionShown: (shown: boolean) => void;
  wash: { [K in Wash]: string };
  washInk: ReturnType<typeof washInkFor>;
};

function buildColors(accent: AccentSet, look: Look): ThemeColors {
  const baseColors = colorsFor(look);
  // The accent overrides the default brand* so existing brand-based components also
  // pick up the companion colour without a rewrite.
  const chat =
    look === 'light'
      ? { chatGround: '#EFEAE2', bubbleMine: '#D9FDD3', bubbleMineInk: '#111B21', bubbleTheirs: '#FFFFFF' }
      : look === 'dark'
        ? { chatGround: '#0B141A', bubbleMine: '#005C4B', bubbleMineInk: '#E9EDEF', bubbleTheirs: '#202C33' }
        : { chatGround: baseColors.bg, bubbleMine: accent.accent, bubbleMineInk: accent.onAccent, bubbleTheirs: baseColors.surface };
  return {
    ...baseColors,
    ...accent,
    ...chat,
    titleAccent: look === 'pastel' ? accent.accent : baseColors.ink,
    chipOn: look === 'pastel' ? baseColors.ink : accent.accentTint,
    chipOnInk: look === 'pastel' ? baseColors.onBrand : accent.accentInk,
    chipOff: look === 'pastel' ? baseColors.surface : baseColors.surfaceAlt,
    chipOffBorder: look === 'pastel' ? baseColors.border : baseColors.surfaceAlt,
    brand: accent.accent,
    brandPress: accent.accentPress,
    brandTint: accent.accentTint,
  };
}

const ThemeContext = createContext<ThemeValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [companionColor, setColor] = useState<CompanionColor>(DEFAULT_COMPANION_COLOR);
  // New installs start on Light (DECISIONS R.3); a saved choice always wins.
  const [appearance, setAppearanceState] = useState<Appearance>('light');
  const [companionShown, setShown] = useState(false);
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

  const setAppearance = useCallback(
    (a: Appearance) => {
      const fontChanges = (appearance === 'pastel') !== (a === 'pastel');
      setAppearanceState(a);
      void saveAppearance(a).then(() => {
        // Pastel draws in Baloo 2, Light and Dark in Roboto (app/_layout.tsx); a face is fixed
        // for the run, so moving between them restarts once, after the choice is saved.
        if (fontChanges) void restartForFont();
      });
    },
    [appearance],
  );

  // Hydrate the persisted companion colour and the companion switch on launch.
  useEffect(() => {
    let active = true;
    void getCompanionColor().then((c) => {
      if (active && c && c in COMPANION_COLORS) setColor(c as CompanionColor);
    });
    void getCompanionShown()
      .then((s) => {
        if (active) setShown(s);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const setCompanionColor = useCallback((c: CompanionColor) => {
    setColor(c); // live preview
    void saveCompanionColor(c); // persist
  }, []);

  const setCompanionShown = useCallback((shown: boolean) => {
    setShown(shown);
    void saveCompanionShown(shown);
  }, []);

  const value = useMemo<ThemeValue>(
    () => ({
      colors: buildColors(
        look === 'dark' ? WHATSAPP_DARK_ACCENT : look === 'light' ? WHATSAPP_LIGHT_ACCENT : accentFor(companionColor),
        look,
      ),
      space,
      radius,
      type,
      elevation,
      companionColor,
      setCompanionColor,
      appearance,
      look,
      setAppearance,
      // Companions belong to Pastel: Light and Dark (WhatsApp) never draw the member's own.
      companionShown: companionShown && look === 'pastel',
      setCompanionShown,
      wash: washFor(look),
      washInk: washInkFor(look),
    }),
    [companionColor, setCompanionColor, appearance, look, setAppearance, companionShown, setCompanionShown],
  );

  // One frame while the saved look is read, so a dark phone never flashes cream.
  if (!ready) return null;

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** DECISIONS T.2: Light and Dark draw keys and cards flat; only Pastel keeps the pillow edge.
 * Safe outside the provider (reads as pillow), so shared keys never throw. */
async function restartForFont(): Promise<void> {
  try {
    if (typeof window !== 'undefined' && typeof window.location?.reload === 'function') {
      window.location.reload();
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Updates = require('expo-updates') as { reloadAsync: () => Promise<void> };
    await Updates.reloadAsync();
  } catch {
    /* reason: a dev client without expo-updates keeps the old face until the next launch */
  }
}

export function useFlatSurfaces(): boolean {
  const ctx = useContext(ThemeContext);
  return ctx ? ctx.look !== 'pastel' : false;
}

/** A list row on the flat looks (DECISIONS T.1, WhatsApp): no card, no border, one hairline
 * divider under it. Pastel keeps its cards, so callers use this only when `useFlatSurfaces()`. */
export function flatRowStyle(border: string) {
  return {
    backgroundColor: 'transparent',
    borderWidth: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: border,
    borderRadius: 0,
  } as const;
}

export function useTheme(): ThemeValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
