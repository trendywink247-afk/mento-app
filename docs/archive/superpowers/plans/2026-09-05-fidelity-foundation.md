# Fidelity Foundation Implementation Plan (Plan 1 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-skin the whole Mento mobile app onto the Clay and Sage palette, Baloo 2 type, a pillow-key depth system on every tappable surface, and Focus-style chat physics, without changing any flow, route, testID, or backend.

**Architecture:** Tokens change values under their existing names so no component needs colour edits. One new primitive, `PressKey` (edge view + face view, transform-only travel, impact haptic on press-in), plus its static sibling `EdgeSurface`, replace card shadows and button press physics. Chat gains rise-in for new messages, a breathing three-dot typing bubble, and send/receive haptics. Companion art is Plan 2 (`docs/superpowers/plans/2026-09-05-companion-pipeline.md`, written after this plan ships).

**Tech Stack:** Expo SDK 52 / RN 0.76 / TypeScript strict / Reanimated 3.16 (manual shared values only) / expo-haptics / @expo-google-fonts / i18n-js / Python 3 for the contrast gate and Lottie bake / Playwright e2e (plain Node). Spec: `docs/superpowers/specs/2026-09-05-fidelity-pass-design.md`.

**Verification model:** no JS unit runner. Gates are `npx tsc --noEmit` (every task) and the Playwright suites (behaviour) plus a screenshot walk (look). Reset before every e2e run and run them exactly as in `docs/superpowers/plans/2026-09-04-role-fork.md` (top of that file). Expo web on :8081 must be restarted with `-c` after Task 1 (font packages change) — the controller does that.

All paths relative to `apps/mobile/` unless they start with `scripts/`, `docs/`, `CLAUDE.md` or `PROGRESS.md`.

---

## File structure

| File | Responsibility |
|---|---|
| `package.json` (modify) | add `@expo-google-fonts/baloo-2`, remove lora + noto-sans-devanagari |
| `app/_layout.tsx` (modify) | load Baloo 2 weights only |
| `theme/tokens.ts` (modify) | Clay and Sage values under existing names; new `edge*` colours; `font` → Baloo; `type.displayHeadline` |
| `theme/companion.ts` (modify) | 7 accents re-derived (terracotta default), `AccentSet` gains `accentEdge` |
| `scripts/contrast_gate.py` (create) | WCAG AA check for every text/surface pair in the tokens |
| `components/motion/PressKey.tsx` (create) | the pillow-key pressable |
| `components/EdgeSurface.tsx` (create) | the static pillow surface (no press) |
| `components/PrimaryButton.tsx` (modify) | primary/ghost render through `PressKey` |
| `components/motion/TiltCard.tsx` (modify) | draws its own edge; keeps tilt |
| `components/Card.tsx` (modify) | `EdgeSurface` instead of shadow |
| `app/(tabs)/_layout.tsx`, `app/(tabs)/chats.tsx`, `app/(tabs)/journals.tsx`, `app/(tabs)/mentors.tsx`, `app/(tabs)/profile.tsx` (modify) | rows / pill / FAB / sheet rows adopt `PressKey` |
| `app/journal/[channel].tsx`, `app/coffee.tsx` (modify) | chips adopt `PressKey` (travel 3) |
| `components/chat/ChatScreen.web.tsx` (modify) | rise-in rows, `TypingDots`, send key, receive haptic |
| `components/chat/TypingDots.tsx` (create) | three breathing dots |
| `components/chat/ChatScreen.tsx` (modify) | Stream theme reads the new tokens (no code shape change) |
| `scripts/theme_lottie.py` (modify) + `assets/lottie/*.json` (regenerate) | palette bake onto Clay and Sage |
| `components/onboarding/steps/*.tsx`, `app/+not-found.tsx`, `app/mentor-home.tsx` (modify) | headline styles → `type.displayHeadline` |
| `e2e/*.e2e.js` | unchanged (testIDs unchanged); all re-run |
| `CLAUDE.md`, `PROGRESS.md`, `docs/DECISIONS.md` (modify) | tokens section, stack table, session log |

---

### Task 1: Baloo 2 font swap

**Files:** Modify `package.json`, `app/_layout.tsx`, `theme/tokens.ts` (the `font` and `type` blocks only).

- [ ] **Step 1: Install / uninstall packages**

```bash
npm install @expo-google-fonts/baloo-2@0.4.2
npm uninstall @expo-google-fonts/lora @expo-google-fonts/noto-sans-devanagari
node -e "console.log(Object.keys(require('@expo-google-fonts/baloo-2')).filter(k=>k.startsWith('Baloo2_')).join(' '))"
```
Expected last line includes: `Baloo2_400Regular Baloo2_500Medium Baloo2_600SemiBold Baloo2_700Bold Baloo2_800ExtraBold`. (postinstall runs patch-package; that is normal.) If the export names differ, use the printed names everywhere below.

- [ ] **Step 2: Load only Baloo in `app/_layout.tsx`**

Replace the three `@expo-google-fonts/*` import blocks with:
```ts
import {
  Baloo2_400Regular,
  Baloo2_500Medium,
  Baloo2_600SemiBold,
  Baloo2_700Bold,
  Baloo2_800ExtraBold,
} from '@expo-google-fonts/baloo-2';
```
Replace the `useFonts({ ... })` object with:
```ts
  // Family names must match theme/tokens.ts `font`. One family (DECISIONS §K.6):
  // Baloo 2 carries Latin AND Devanagari, so the Lora/Noto pairing is retired.
  const [fontsLoaded] = useFonts({
    Baloo2_400Regular,
    Baloo2_500Medium,
    Baloo2_600SemiBold,
    Baloo2_700Bold,
    Baloo2_800ExtraBold,
  });
```
Delete the comment lines about Lora/Devanagari mapping above the old object.

- [ ] **Step 3: Point the `font` tokens at Baloo in `theme/tokens.ts`**

Replace the whole `font` const (and its doc comment) with:
```ts
/**
 * Typography — ONE family, Baloo 2 (DECISIONS §K.6), loaded in app/_layout.tsx.
 * Each weight is its own family name (expo-google-fonts convention) — never add
 * fontWeight next to fontFamily or Android ignores the custom face.
 * `serif*` / `devanagari*` names are kept so no call site changes; they now map to
 * Baloo weights (rename to display*/hindi* is a follow-up).
 */
export const font = {
  sans: 'Baloo2_400Regular',
  sansSemi: 'Baloo2_600SemiBold',
  sansBold: 'Baloo2_700Bold',
  sansHeavy: 'Baloo2_800ExtraBold',
  serif: 'Baloo2_600SemiBold',
  serifBold: 'Baloo2_700Bold',
  devanagari: 'Baloo2_400Regular',
  devanagariBold: 'Baloo2_700Bold',
} as const;
```
In the `type` const, add one entry after `displaySerif`:
```ts
  /** Onboarding / Mentor Home headlines — replaces the per-step hand-rolled 28–30px styles. */
  displayHeadline: { fontSize: 28, fontFamily: font.sansHeavy, lineHeight: 36 },
```
and change `displaySerif`'s `lineHeight: 38` to `lineHeight: 40` (Baloo's ascenders need it).

- [ ] **Step 4: Typecheck and prove Hindi still renders**

```bash
npx tsc --noEmit
```
Expected: clean. Then ask the controller to restart Expo with `-c` (new font package), reset, and run `node e2e/hindi-core-loop.e2e.js` → `HINDI CORE-LOOP E2E PASSED — both passes, 0 page errors`.

- [ ] **Step 5: Commit**
```bash
git add package.json package-lock.json app/_layout.tsx theme/tokens.ts
git commit -m "feat(theme): Baloo 2 as the single type family (Latin + Devanagari); retire Lora/Noto

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Clay and Sage palette tokens + companion accents + contrast gate

**Files:** Modify `theme/tokens.ts` (`colors`, `wash`, `elevation` comment), `theme/companion.ts`; Create `scripts/contrast_gate.py` (repo root `scripts/`).

- [ ] **Step 1: Replace the `colors` and `wash` consts in `theme/tokens.ts`**

```ts
export const colors = {
  // Neutral light base (fixed, never themed) — Clay and Sage (DECISIONS §K.5)
  bg: '#F4EFE6', // oat ground
  bgLavender: '#EFE9DF', // "ritual" screens keep a slightly deeper oat (companion picker, reflection, coffee, PIN)
  surface: '#FFFFFF',
  surfaceAlt: '#FBF8F2',
  ink: '#2B2B2B', // charcoal
  inkMuted: '#6E6A64',
  border: '#E6DFD3',
  onBrand: '#FFFFFF',
  scrim: 'rgba(43,43,43,0.4)',

  /** Pillow-key edges (DECISIONS §K.8): the darker "underside" drawn beneath a face. */
  edgeSurface: '#E3DCCF', // under white / oat faces
  edgeAlt: '#D9D1C2', // under surfaceAlt faces
  edgeInk: '#141414', // under ink-toned pills

  // Default accent (terracotta companion). Prefer useTheme().colors.accent in components.
  brand: '#A2533A',
  brandPress: '#984E33',
  brandTint: '#F6D9CB',

  /** Light clay terracotta — display accent words and decorative icon tints only
   * (3.0:1 on oat = large text only, never body copy). */
  accentSoft: '#C9744F',

  // Semantic (fixed) — each passes 4.5:1 on white and on oat as text.
  accentWarm: '#8F6318',
  success: '#3B7A4F',
  warning: '#8F6318',
  danger: '#C2453E',
} as const;

/** Pastel clay washes for IconBadge — fixed, not themed by the companion accent. */
export const wash = {
  accent: '#F6D9CB',
  indigo: '#E8DFF0',
  orange: '#F5E8C4',
  green: '#DCE6DD',
  danger: '#F8DEDC',
} as const;
```
Update the file's header comment: replace the sentence about `brand*` being purple with `brand* below is the DEFAULT accent (terracotta)`, and replace the "CALIBRATED against the mockup pixels" sentence with `Values follow DECISIONS §K.5 (Clay and Sage) and pass scripts/contrast_gate.py.` Update the `elevation` doc comment to: `Shadows are now reserved for FLOATING layers (tab bar, sheets, FAB). Cards and buttons use the pillow-key edge (components/motion/PressKey.tsx, components/EdgeSurface.tsx) instead.`

- [ ] **Step 2: Replace `theme/companion.ts`**

```ts
/**
 * Growth-companion COLOUR → accent token set (DECISIONS §B.6: the companion colour is
 * a per-user theme layered over the neutral light base; it is NOT the chat handle).
 *
 * Clay and Sage family (DECISIONS §K.5/§K.8). Every `accent` passes WCAG AA (≥4.5:1)
 * with white text AND as text on the oat ground; `accentEdge` is the pillow-key
 * underside; `accentTint` is the pale surface (ink text on it ≥10:1).
 * Verified by scripts/contrast_gate.py — run it after changing any value.
 */
export type CompanionColor =
  | 'terracotta'
  | 'sage'
  | 'sky'
  | 'rose'
  | 'mustard'
  | 'plum'
  | 'teal';

export type AccentSet = {
  accent: string;
  accentPress: string;
  accentEdge: string;
  accentTint: string;
  onAccent: string;
};

export const COMPANION_COLORS: Record<CompanionColor, AccentSet> = {
  terracotta: { accent: '#A2533A', accentPress: '#984E33', accentEdge: '#7E3F2B', accentTint: '#F6D9CB', onAccent: '#FFFFFF' },
  sage: { accent: '#467054', accentPress: '#3F6549', accentEdge: '#33513C', accentTint: '#DCE6DD', onAccent: '#FFFFFF' },
  sky: { accent: '#3B6D8F', accentPress: '#356282', accentEdge: '#2A4F69', accentTint: '#DCE8F2', onAccent: '#FFFFFF' },
  rose: { accent: '#A94F65', accentPress: '#9A485C', accentEdge: '#7D3A4A', accentTint: '#F5DFE4', onAccent: '#FFFFFF' },
  mustard: { accent: '#8F6318', accentPress: '#825A16', accentEdge: '#674711', accentTint: '#F5E8C4', onAccent: '#FFFFFF' },
  plum: { accent: '#6B4C8C', accentPress: '#61457F', accentEdge: '#4D3765', accentTint: '#E8DFF0', onAccent: '#FFFFFF' },
  teal: { accent: '#286F6B', accentPress: '#246561', accentEdge: '#1C4F4C', accentTint: '#D8ECEA', onAccent: '#FFFFFF' },
};

export const DEFAULT_COMPANION_COLOR: CompanionColor = 'terracotta';

export const COMPANION_COLOR_LABELS: Record<CompanionColor, string> = {
  terracotta: 'Terracotta',
  sage: 'Sage',
  sky: 'Sky',
  rose: 'Rose',
  mustard: 'Mustard',
  plum: 'Plum',
  teal: 'Teal',
};

export function accentFor(color: CompanionColor | string | null | undefined): AccentSet {
  if (color && color in COMPANION_COLORS) return COMPANION_COLORS[color as CompanionColor];
  return COMPANION_COLORS[DEFAULT_COMPANION_COLOR];
}
```
`ThemeColors` in `theme/ThemeProvider.tsx` is `{...baseColors} & AccentSet`, so `accentEdge` becomes available on `colors` automatically — no change there.

Stored companion colours from before this change (`purple`, `blue`, …) no longer exist in `COMPANION_COLORS`; `accentFor` already falls back to the default, and `ThemeProvider`'s hydrate guard `c in COMPANION_COLORS` ignores them. Nothing else to migrate.

- [ ] **Step 3: Fix the compile errors the rename causes**

Run `npx tsc --noEmit`. Expected errors: every literal `'purple'` / `'blue'` etc. typed as `CompanionColor`. Known sites: `components/onboarding/steps/CompanionStep.tsx` (the colour list + `colour-${key}` testIDs), `app/(tabs)/profile.tsx` (`profile-colour-${key}`), `app/mentor-home.tsx` (uses `DEFAULT_COMPANION_COLOR` — fine), `e2e/*.e2e.js` (they click `colour-purple` — JS, not tsc). For each TS site: replace the literal list with `Object.keys(COMPANION_COLORS) as CompanionColor[]` if it is not already, or rename the literal to `'terracotta'`. Then in the e2e scripts replace every `colour-purple` with `colour-terracotta` (`sed -i "s/colour-purple/colour-terracotta/g" e2e/*.e2e.js`). Re-run tsc until clean.

- [ ] **Step 4: Create `scripts/contrast_gate.py`** (repo root)

```python
"""WCAG AA gate for Mento's tokens. Fails (exit 1) if any text/surface pair is below
4.5:1 (normal text) — the accent set on white AND on the oat ground, the semantic
colours, muted ink, and ink on every tint. Run from the repo root:

    python scripts/contrast_gate.py
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "apps" / "mobile" / "theme"


def hexes(name: str, text: str) -> dict[str, str]:
    """{key: '#RRGGBB'} for every `key: '#hex'` line inside the named const."""
    block = re.search(rf"export const {name}[\s\S]*?\n}} as const;", text)
    if not block:
        sys.exit(f"const {name} not found")
    return dict(re.findall(r"(\w+): '(#[0-9A-Fa-f]{6})'", block.group(0)))


def lum(h: str) -> float:
    r, g, b = (int(h[i : i + 2], 16) / 255 for i in (1, 3, 5))
    f = lambda c: c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)


def ratio(a: str, b: str) -> float:
    la, lb = lum(a), lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def main() -> int:
    tokens = (ROOT / "tokens.ts").read_text(encoding="utf-8")
    companion = (ROOT / "companion.ts").read_text(encoding="utf-8")
    colors = hexes("colors", tokens)
    white, oat, ink = colors["surface"], colors["bg"], colors["ink"]
    pairs: list[tuple[str, str, str, float]] = []  # (label, fg, bg, min)
    for key in ("ink", "inkMuted", "success", "warning", "danger"):
        pairs.append((f"{key} on white", colors[key], white, 4.5))
        pairs.append((f"{key} on oat", colors[key], oat, 4.5))
    pairs.append(("accentSoft on oat (large text only)", colors["accentSoft"], oat, 3.0))
    for name, block in re.findall(r"(\w+): \{ (accent: '#[^}]*) \}", companion):
        vals = dict(re.findall(r"(\w+): '(#[0-9A-Fa-f]{6})'", block))
        pairs.append((f"{name}: white on accent", vals["onAccent"], vals["accent"], 4.5))
        pairs.append((f"{name}: accent on white", vals["accent"], white, 4.5))
        pairs.append((f"{name}: accent on oat", vals["accent"], oat, 4.5))
        pairs.append((f"{name}: ink on tint", ink, vals["accentTint"], 4.5))
    failed = 0
    for label, fg, bg, minimum in pairs:
        r = ratio(fg, bg)
        ok = r >= minimum
        failed += not ok
        print(f"{'OK  ' if ok else 'FAIL'} {label:38s} {r:5.2f} (min {minimum})")
    print(f"\n{len(pairs) - failed}/{len(pairs)} pairs pass")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 5: Run the gate and the typecheck**

```bash
python ../../scripts/contrast_gate.py   # from apps/mobile; or `python scripts/contrast_gate.py` from the repo root
npx tsc --noEmit
```
Expected: every line `OK`, `N/N pairs pass`, exit 0; tsc clean. If a pair fails, darken that accent's `accent`/`accentPress`/`accentEdge` by 4–6% lightness and re-run — never lighten a tint or loosen the threshold.

- [ ] **Step 6: Commit**
```bash
git add theme/tokens.ts theme/companion.ts ../../scripts/contrast_gate.py components app e2e
git commit -m "feat(theme): Clay and Sage palette + terracotta-default companion accents, WCAG gate

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `PressKey` and `EdgeSurface` primitives

**Files:** Create `components/motion/PressKey.tsx`, Create `components/EdgeSurface.tsx`.

- [ ] **Step 1: Create `components/motion/PressKey.tsx`**

```tsx
/**
 * PressKey — the pillow key (DECISIONS §K.8). A tappable face sits on a darker
 * "edge" of the same shape offset down by `travel`; pressing moves ONLY the face
 * down (translateY, transform-only) so the edge disappears under it, like a
 * physical key. Impact haptic on press-in, nothing on release — the travel is
 * the feedback. Reduced motion: no travel, a 150 ms opacity dip instead.
 * Disabled: edge hidden, face dimmed, no haptic. Error states never use this.
 */
import { ReactNode } from 'react';
import {
  Pressable,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
  type AccessibilityRole,
  type AccessibilityState,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { haptic } from '@/lib/haptics';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { duration, easing, spring } from '@/theme/motion';
import { radius as radiusTokens } from '@/theme/tokens';

export type PressKeyTravel = 4 | 3 | 2;

type Props = {
  children: ReactNode;
  onPress?: () => void;
  /** Colour of the underside (e.g. colors.accentEdge under an accent face). */
  edge: string;
  /** Key travel in px: 4 buttons/cards, 3 chips, 2 the tab pill. */
  travel?: PressKeyTravel;
  radius?: number;
  haptic?: 'impact' | 'none';
  disabled?: boolean;
  /** Face visuals: background, padding, layout. Radius is applied by PressKey. */
  style?: StyleProp<ViewStyle>;
  /** Outer layout (margins, alignSelf, flex) — applies to the whole key. */
  containerStyle?: StyleProp<ViewStyle>;
  accessibilityRole?: AccessibilityRole;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityState?: AccessibilityState;
  testID?: string;
};

export function PressKey({
  children,
  onPress,
  edge,
  travel = 4,
  radius = radiusTokens.lg,
  haptic: hapticMode = 'impact',
  disabled = false,
  style,
  containerStyle,
  accessibilityRole = 'button',
  accessibilityLabel,
  accessibilityHint,
  accessibilityState,
  testID,
}: Props) {
  const reduced = useReducedMotion();
  const press = useSharedValue(0);

  const face = useAnimatedStyle(() => ({
    transform: [{ translateY: reduced ? 0 : press.value * travel }],
    opacity: reduced ? 1 - press.value * 0.15 : 1,
  }));

  const onPressIn = () => {
    if (disabled) return;
    if (hapticMode === 'impact') haptic.advance();
    press.value = withTiming(1, { duration: duration.fast / 2, easing: easing.exit });
  };
  const onPressOut = () => {
    if (disabled) return;
    press.value = reduced
      ? withTiming(0, { duration: duration.fast - 50 })
      : withSpring(0, spring.calm);
  };

  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      disabled={disabled}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled, ...accessibilityState }}
      testID={testID}
      style={[{ paddingBottom: travel }, containerStyle]}
    >
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          { top: travel, borderRadius: radius, backgroundColor: disabled ? 'transparent' : edge },
        ]}
      />
      <Animated.View style={[style, { borderRadius: radius }, disabled && styles.disabled, face]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  disabled: { opacity: 0.55 },
});
```

- [ ] **Step 2: Create `components/EdgeSurface.tsx`**

```tsx
/**
 * EdgeSurface — the pillow-key look with no press physics, for surfaces that are
 * not tappable (message bubbles, status cards, notes). Same drawing as PressKey:
 * an edge under a face, offset by `travel`. Replaces the old soft card shadow.
 */
import { ReactNode } from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

import { radius as radiusTokens } from '@/theme/tokens';

export function EdgeSurface({
  children,
  edge,
  travel = 3,
  radius = radiusTokens.lg,
  style,
  containerStyle,
  testID,
}: {
  children: ReactNode;
  edge: string;
  travel?: 4 | 3 | 2;
  radius?: number;
  /** Face visuals (background, padding). */
  style?: StyleProp<ViewStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  return (
    <View style={[{ paddingBottom: travel }, containerStyle]} testID={testID}>
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { top: travel, borderRadius: radius, backgroundColor: edge }]}
      />
      <View style={[style, { borderRadius: radius }]}>{children}</View>
    </View>
  );
}
```

- [ ] **Step 3: Typecheck and commit**
```bash
npx tsc --noEmit
git add components/motion/PressKey.tsx components/EdgeSurface.tsx
git commit -m "feat(motion): PressKey + EdgeSurface — the pillow-key depth primitives

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Buttons, tilt cards and Card adopt the key

**Files:** Modify `components/PrimaryButton.tsx`, `components/motion/TiltCard.tsx`, `components/Card.tsx`.

- [ ] **Step 1: Rewrite `components/PrimaryButton.tsx`** (same props, same testIDs, same behaviour; `link` stays a plain text button)

```tsx
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { PressKey } from '@/components/motion/PressKey';
import { haptic } from '@/lib/haptics';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space, type } from '@/theme/tokens';

type Props = {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  /** primary = filled key. ghost = white key with accent text. link = plain accent text. */
  variant?: 'primary' | 'ghost' | 'link';
  /** accent = companion colour. ink = charcoal key (onboarding CTAs). */
  tone?: 'accent' | 'ink';
  icon?: keyof typeof Ionicons.glyphMap;
  trailing?: 'arrow' | 'chevron';
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
};

export function PrimaryButton({
  label,
  onPress,
  loading,
  disabled,
  variant = 'primary',
  tone = 'accent',
  icon,
  trailing,
  accessibilityLabel,
  accessibilityHint,
  testID,
}: Props) {
  const { colors } = useTheme();
  const filled = variant === 'primary';
  const inactive = !!(disabled || loading);
  const bg = filled ? (tone === 'ink' ? colors.ink : colors.accent) : colors.surface;
  const edge = filled ? (tone === 'ink' ? colors.edgeInk : colors.accentEdge) : colors.edgeSurface;
  const fg = filled ? colors.onAccent : colors.accent;

  const content = loading ? (
    <ActivityIndicator color={fg} />
  ) : (
    <View style={styles.row}>
      {icon ? <Ionicons name={icon} size={18} color={fg} /> : null}
      <Text style={[type.bodySemi, styles.label, { color: fg }]}>{label}</Text>
      {trailing === 'arrow' ? <Ionicons name="arrow-forward" size={18} color={fg} /> : null}
      {trailing === 'chevron' ? <Ionicons name="chevron-forward" size={18} color={fg} /> : null}
    </View>
  );

  if (variant === 'link') {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ disabled: inactive, busy: !!loading }}
        onPress={() => {
          if (inactive) return;
          haptic.tick();
          onPress();
        }}
        disabled={inactive}
        testID={testID}
        style={({ pressed }) => [styles.link, inactive && styles.disabled, pressed && { opacity: 0.7 }]}
      >
        {content}
      </Pressable>
    );
  }

  return (
    <PressKey
      onPress={onPress}
      edge={edge}
      travel={4}
      radius={radius.pill}
      disabled={inactive}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ busy: !!loading }}
      testID={testID}
      style={[styles.base, { backgroundColor: bg }]}
    >
      {content}
    </PressKey>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  link: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  disabled: { opacity: 0.5 },
  label: { fontSize: 16 },
});
```
Note the haptic change: filled/ghost keys now fire `haptic.advance()` on press-in (inside `PressKey`) instead of `haptic.tick()` on press — the founder's pick. `link` keeps `tick`.

- [ ] **Step 2: Give `TiltCard` its own edge** — in `components/motion/TiltCard.tsx` add an `edge` prop and draw it under the tilting face. Add to the props type: `edge?: string;` and to the destructuring `edge,`. Replace the returned JSX with:
```tsx
  return (
    <Pressable
      onPress={onPress}
      onPressIn={pressIn}
      onPressOut={pressOut}
      onLayout={onLayout}
      disabled={disabled}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      style={edge ? { paddingBottom: 4 } : undefined}
    >
      {edge ? (
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { top: 4, borderRadius: radius.lg, backgroundColor: edge }]}
        />
      ) : null}
      <Animated.View style={[style, anim]}>{children}</Animated.View>
    </Pressable>
  );
```
and add `StyleSheet, View` to the `react-native` import and `import { radius } from '@/theme/tokens';`. Callers keep their `style` (background/padding); the edge is opt-in so nothing breaks before Task 5 passes `edge`. Also change `scale.value = withTiming(0.985, cfg)` to add a sink: `ty.value = withTiming(3, cfg)` with a new `const ty = useSharedValue(0);`, `ty.value = withSpring(0, spring.calm)` in `pressOut`, and `{ translateY: ty.value }` as the first transform entry — the card both tilts and travels.

Update every `TiltCard` call site to pass an edge and drop its shadow: `components/onboarding/steps/RoleStep.tsx` (both doors: `edge={colors.accentEdge}` for the talk door, `edge={colors.edgeSurface}` for the listen door; remove `elevation.md` / `elevation.sm` from their `style` arrays and remove the `borderWidth: 2` from `styles.door` since the edge now carries the depth), `app/(tabs)/path.tsx` (the `TiltCard` option cards: `edge={colors.edgeSurface}`, remove `elevation.sm` from their style). `grep -rn "TiltCard" app components --include=*.tsx` to be sure none is missed.

- [ ] **Step 3: `components/Card.tsx` uses `EdgeSurface`**

```tsx
import { ReactNode } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { EdgeSurface } from '@/components/EdgeSurface';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

/** The clay card: white (or tinted) face on a pillow edge. Replaces the shadow card. */
export function Card({
  children,
  tinted = false,
  style,
}: {
  children: ReactNode;
  /** Accent-tinted variant (info/footer cards). */
  tinted?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  return (
    <EdgeSurface
      edge={tinted ? colors.accentEdge : colors.edgeSurface}
      radius={radius.lg}
      style={[styles.card, { backgroundColor: tinted ? colors.accentTint : colors.surface }]}
      containerStyle={style}
    >
      {children}
    </EdgeSurface>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, padding: space.md },
});
```

- [ ] **Step 4: Typecheck, run two suites, commit**
```bash
npx tsc --noEmit
```
Reset, then `node e2e/connecting-experience.e2e.js` and `node e2e/role-fork.e2e.js` → both PASS, 0 page errors (the doors and every CTA now go through `PressKey`).
```bash
git add components/PrimaryButton.tsx components/motion/TiltCard.tsx components/Card.tsx components/onboarding/steps/RoleStep.tsx "app/(tabs)/path.tsx"
git commit -m "feat(ui): PrimaryButton, TiltCard and Card on the pillow key

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Rows, pill, FAB and sheet rows adopt the key

**Files:** Modify `app/(tabs)/_layout.tsx`, `app/(tabs)/chats.tsx`, `app/(tabs)/journals.tsx`, `app/(tabs)/mentors.tsx`, `app/(tabs)/profile.tsx`.

The transformation is the same everywhere: a `<Pressable … style={[styles.row, { backgroundColor: colors.surface }, elevation.sm]}>` becomes a `<PressKey edge={colors.edgeSurface} style={[styles.row, { backgroundColor: colors.surface }]} containerStyle={styles.rowSpacing} …same a11y props/testID…>`; a static `<View style={[styles.row, {backgroundColor: colors.surface}, elevation.sm]}>` becomes an `<EdgeSurface edge={colors.edgeSurface} style={[styles.row, { backgroundColor: colors.surface }]} containerStyle={styles.rowSpacing}>`. Because `PressKey`/`EdgeSurface` own the outer box, move any `marginBottom` from the row style into a new `rowSpacing` style passed as `containerStyle`.

- [ ] **Step 1: Tab bar pill in `app/(tabs)/_layout.tsx`** — replace the `Pressable` per tab so the pill is the key (the label stays outside the key):
```tsx
          <Pressable
            key={tab.name}
            style={styles.tab}
            onPress={() => {
              const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={t(tab.label)}
            testID={`tab-${tab.name}`}
          >
            <EdgeSurface
              edge={focused ? colors.accentEdge : 'transparent'}
              travel={2}
              radius={radius.md}
              style={[styles.pill, focused && { backgroundColor: colors.accentTint }]}
            >
              <Ionicons name={focused ? tab.active : tab.idle} size={22} color={focused ? colors.accent : colors.inkMuted} />
            </EdgeSurface>
            <Text style={[styles.label, { color: focused ? colors.accent : colors.inkMuted }, focused && { fontFamily: font.sansBold }]}>
              {t(tab.label)}
            </Text>
          </Pressable>
```
(import `EdgeSurface`). The tab bar keeps `elevation.lg` — it is a floating layer. The `styles.pill` `borderRadius` line can stay; `EdgeSurface` applies the same radius.

- [ ] **Step 2: `app/(tabs)/chats.tsx`** — import `PressKey` and `EdgeSurface`. (a) Conversation rows: replace the `<Pressable onPress={() => open(item)} … style={[styles.row, { backgroundColor: colors.surface }, elevation.sm]}>` … `</Pressable>` with `<PressKey onPress={() => open(item)} edge={colors.edgeSurface} accessibilityLabel={t('chats.convoA11y', { name: item.listener_persona_name })} testID={`convo-${item.id}`} style={[styles.row, { backgroundColor: colors.surface }]} containerStyle={styles.rowSpacing}>` … `</PressKey>`; move `marginBottom` out of `styles.row` into `rowSpacing: { marginBottom: space.sm }`. (b) The New Chat FAB: keep it a `Pressable` with `elevation.md` (it floats) but wrap its face in nothing — unchanged. (c) The New Chat sheet rows (`testID={`new-chat-${o.key}`}`): replace each `<Pressable … style={({ pressed }) => [styles.pickRow, …]}>` with `<PressKey onPress={o.go} edge={colors.edgeAlt} travel={3} radius={radius.md} accessibilityLabel={t(o.title)} testID={`new-chat-${o.key}`} style={[styles.pickRow, { backgroundColor: colors.surfaceAlt }]} containerStyle={{ marginBottom: space.xs }}>`. (d) The note/privacy card `<View style={[styles.note, { backgroundColor: colors.surfaceAlt }]} testID="chats-note">` → `<EdgeSurface edge={colors.edgeAlt} travel={2} radius={radius.md} style={[styles.note, { backgroundColor: colors.surfaceAlt }]} testID="chats-note">`. Remove now-unused `elevation` from the `useTheme()` destructure only if nothing else uses it (the FAB and gate card do — keep it).

- [ ] **Step 3: `app/(tabs)/journals.tsx`** — journal rows: `<Pressable … style={[styles.row, { backgroundColor: colors.surface }, elevation.sm]}>` → `<PressKey onPress={…same…} edge={colors.edgeSurface} accessibilityLabel={t(j.title)} testID={`journal-${j.route}`} style={[styles.row, { backgroundColor: colors.surface }]} containerStyle={styles.rowSpacing}>`; the AI assistant feature card (testID `journal-ai-organize`) → the same with `edge={colors.accentEdge}` and its existing tinted background. Add `rowSpacing` and strip `marginBottom` from `row`.

- [ ] **Step 4: `app/(tabs)/mentors.tsx`** — listener cards (`testID={`mentor-${l.id}`}`, `styles.card` + `elevation.sm`) → `PressKey edge={colors.edgeSurface}`; the `next-available` card (`styles.nextCard`, surfaceAlt) → `PressKey edge={colors.edgeAlt}`; filter pills (`filter-*`) → `PressKey travel={3} radius={radius.pill}` with `edge={selected ? colors.accentEdge : colors.edgeSurface}`.

- [ ] **Step 5: `app/(tabs)/profile.tsx`** — every `Pressable` row with `elevation.sm` (`profile-become-listener`, `profile-listener-status` when it is a Pressable, `profile-check-updates`, `profile-coffee`, `profile-start-fresh`, the language row if pressable) → `PressKey edge={colors.edgeSurface} style={[styles.row, { backgroundColor: colors.surface }]} containerStyle={styles.rowSpacing}`; every static `<View style={[styles.row|styles.card, …, elevation.sm]}>` → `EdgeSurface edge={colors.edgeSurface}`. The colour swatches (`profile-colour-${key}`) stay as they are (round, no key) but their selected ring uses `colors.accent`.

- [ ] **Step 6: Typecheck, suites, commit**
```bash
npx tsc --noEmit
```
Reset, then `node e2e/member-screens.e2e.js` (every tab + sheet) and `node e2e/path-communities.e2e.js` → PASS, 0 page errors.
```bash
git add "app/(tabs)"
git commit -m "feat(ui): tab pill, conversation/journal/mentor/profile rows and the New Chat sheet on the pillow key

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Chips

**Files:** Modify `app/journal/[channel].tsx`, `app/coffee.tsx`.

- [ ] **Step 1: Mood / category chips in `app/journal/[channel].tsx`** — each chip `<Pressable … style={[styles.chip, { backgroundColor: selected ? colors.accentTint : colors.surfaceAlt }, selected && { borderWidth: 1, borderColor: colors.accent }]}>` becomes
```tsx
                <PressKey
                  key={m}
                  onPress={() => setMood(selected ? null : m)}
                  edge={selected ? colors.accentEdge : colors.edgeAlt}
                  travel={3}
                  radius={radius.pill}
                  accessibilityState={{ selected }}
                  testID={`mood-${m.toLowerCase()}`}
                  style={[styles.chip, { backgroundColor: selected ? colors.accentTint : colors.surfaceAlt }]}
                >
```
(remove the `borderWidth` selected style; the edge colour now signals selection). Apply the identical transformation to the finance category chips and the expense/income toggle chips in the same file (same file, three `styles.chip` sites at ~lines 238, 291, 315) keeping each site's own `onPress`, `testID` and colours. Chips text styles unchanged.

- [ ] **Step 2: Amount chips + payment method rows in `app/coffee.tsx`** — amount chips (`amount-${a}`, `amount-custom`): `PressKey travel={3} radius={radius.pill} edge={selected ? colors.accentEdge : colors.edgeSurface} style={[styles.chip, { backgroundColor: colors.surface }]}` (drop the `borderColor`/`borderWidth` selection styling). Method rows (`method-${m.key}`): `PressKey edge={colors.edgeSurface} style={[styles.method, { backgroundColor: colors.surface }]} containerStyle={{ marginBottom: space.sm }}` (drop `borderColor`; move any `marginBottom` out of `styles.method`).

- [ ] **Step 3: Typecheck, suites, commit**
```bash
npx tsc --noEmit
```
Reset, then `node e2e/member-screens.e2e.js` (coffee + journals) and `node e2e/journal-organize.e2e.js` → PASS.
```bash
git add "app/journal/[channel].tsx" app/coffee.tsx
git commit -m "feat(ui): chips and payment rows on the pillow key

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Chat physics (Focus)

**Files:** Create `components/chat/TypingDots.tsx`; Modify `components/chat/ChatScreen.web.tsx`; Modify `components/chat/ChatScreen.tsx` (comment only — its Stream theme already reads the tokens).

- [ ] **Step 1: Create `components/chat/TypingDots.tsx`**

```tsx
/** Three dots breathing on a bubble — the "someone is typing" presence. Transform +
 * opacity only, staggered on the shared breathe tempo; frozen under reduced motion. */
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { EdgeSurface } from '@/components/EdgeSurface';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { breathe, easing } from '@/theme/motion';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

const PERIOD = breathe.period / 4; // 1300 ms per dot cycle

function Dot({ index, reduced }: { index: number; reduced: boolean }) {
  const { colors } = useTheme();
  const v = useSharedValue(0);
  useEffect(() => {
    if (reduced) {
      v.value = 0;
      return;
    }
    v.value = withDelay(
      index * (PERIOD / 6),
      withRepeat(
        withSequence(
          withTiming(1, { duration: PERIOD / 2, easing: easing.breathe }),
          withTiming(0, { duration: PERIOD / 2, easing: easing.breathe }),
        ),
        -1,
      ),
    );
    return () => cancelAnimation(v);
  }, [index, reduced, v]);
  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: -3 * v.value }],
    opacity: 0.45 + 0.55 * v.value,
  }));
  return <Animated.View style={[styles.dot, { backgroundColor: colors.accent }, style]} />;
}

export function TypingDots({ testID }: { testID?: string }) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  return (
    <EdgeSurface
      edge={colors.edgeSurface}
      travel={3}
      radius={radius.lg}
      style={[styles.bubble, { backgroundColor: colors.surface }]}
      containerStyle={styles.wrap}
      testID={testID}
    >
      <View style={styles.row} accessibilityLabel="typing">
        {[0, 1, 2].map((i) => (
          <Dot key={i} index={i} reduced={reduced} />
        ))}
      </View>
    </EdgeSurface>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'flex-start', marginHorizontal: space.md, marginTop: space.xs },
  bubble: { paddingHorizontal: space.md, paddingVertical: space.sm + 2, borderBottomLeftRadius: radius.sm },
  row: { flexDirection: 'row', gap: 5, alignItems: 'center', height: 14 },
  dot: { width: 7, height: 7, borderRadius: 4 },
});
```

- [ ] **Step 2: Rise-in rows, edge bubbles, send key, receive haptic in `components/chat/ChatScreen.web.tsx`**

(a) Imports: add `import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';`, `import { EdgeSurface } from '@/components/EdgeSurface';`, `import { PressKey } from '@/components/motion/PressKey';`, `import { TypingDots } from '@/components/chat/TypingDots';`, `import { useReducedMotion } from '@/lib/useReducedMotion';`, `import { haptic } from '@/lib/haptics';`, `import { duration, easing } from '@/theme/motion';`.

(b) `MessageRowProps` gains `fresh: boolean;` (true only for messages that arrived after the initial load). Inside `MessageRow`, at the top of the body:
```tsx
  const reduced = useReducedMotion();
  // Rise-in for messages that arrive live; history renders still.
  const rise = useSharedValue(fresh && !reduced ? 1 : 0);
  useEffect(() => {
    if (rise.value === 1) rise.value = withTiming(0, { duration: duration.gentle, easing: easing.settle });
  }, [rise]);
  const riseStyle = useAnimatedStyle(() => ({
    opacity: 1 - rise.value,
    transform: [{ translateY: 10 * rise.value }],
  }));
```
and change the outer `<View>` of the row to `<Animated.View style={riseStyle}>` (closing tag too). Add `useEffect` to the React import if missing.

(c) Bubbles: the "mine" bubble `<View style={[styles.bubble, styles.mine, { backgroundColor: colors.accentTint }]}>` → `<EdgeSurface edge={colors.accentEdge} travel={3} radius={radius.lg} style={[styles.bubble, styles.mine, { backgroundColor: colors.accentTint }]}>` (closing tag accordingly). The "theirs" bubble is a `Pressable` (opens actions): → `<PressKey onPress={() => onToggleActions(item.id)} edge={colors.edgeSurface} travel={3} radius={radius.lg} haptic="none" accessibilityHint={t('chat.actionsHintA11y')} testID={`msg-${item.id}`} style={[styles.bubble, styles.theirs, { backgroundColor: colors.surface }]}>`. Remove `elevation.sm` from both. Keep `maxWidth` on `styles.bubble`; because `PressKey`'s outer box is the `Pressable`, move `maxWidth: '80%'` from `styles.bubble` to a new `bubbleWrap: { maxWidth: '80%' }` passed as `containerStyle` on both.

(d) Fresh tracking in `ChatScreenWeb`: add `const loadedAtRef = useRef<number>(0);` and `const freshIds = useRef<Set<string>>(new Set());`. Where the initial history is set (the `setup` effect, after the channel query resolves and the existing messages are mapped), set `loadedAtRef.current = Date.now();`. In `appendMessage`, before `setMessages`, add: `if (loadedAtRef.current) freshIds.current.add(msg.id);`. In the `message.new` handler (around `ch.on('message.new', …)`), after `appendMessage(...)`, add `if (e.user && e.user.id !== client.userID) haptic.nudge();` (receive haptic; the screen is the focused route whenever this handler runs). In `renderItem`, pass `fresh={freshIds.current.has(item.id)}`.

(e) Typing: replace the `{typing ? (<Text … testID="typing-indicator">…</Text>) : null}` block with `{typing ? <TypingDots testID="typing-indicator" /> : null}`. The `chat.typing` string stays in the locale files (the listener console still uses it).

(f) Composer send key: replace the send `Pressable` with
```tsx
        <PressKey
          onPress={() => void submit()}
          edge={colors.accentEdge}
          travel={4}
          radius={radius.pill}
          disabled={sending}
          testID="composer-send"
          accessibilityLabel={t('chat.sendA11y')}
          style={[styles.sendBtn, { backgroundColor: colors.accent }]}
        >
          <Ionicons name="paper-plane" size={19} color={colors.onAccent} />
        </PressKey>
```
and the input pill `<View style={[styles.inputPill, { backgroundColor: colors.surface }, elevation.sm]}>` → `<View style={[styles.inputPill, { backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border }]}>` (inputs get the clay outline, no edge). Remove now-unused `elevation` reads if tsc flags them.

- [ ] **Step 3: Native chat** — in `components/chat/ChatScreen.tsx` update the comment above `streamTheme` to say `oat app bg, white incoming bubbles, accent-tint outgoing bubbles`; no code change (it reads `colors.*`, which already changed).

- [ ] **Step 4: Typecheck, suites, commit**
```bash
npx tsc --noEmit
```
Reset, then `node e2e/connecting-experience.e2e.js`, `node e2e/path-communities.e2e.js` (it sends a message and asserts the bubble) → PASS. If `two-party-chat`'s manual setup is available, run it too (typing indicator + receive path).
```bash
git add components/chat
git commit -m "feat(chat): Focus physics — rise-in messages, breathing typing dots, pillow send key, receive haptic

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Lottie re-bake

**Files:** Modify `scripts/theme_lottie.py` (repo root), regenerate `assets/lottie/*.json` (5 files), Modify `assets/lottie/README.md`.

- [ ] **Step 1: Palette constants** — in `scripts/theme_lottie.py` replace the seven constants:
```python
INK = (0x2B / 255, 0x2B / 255, 0x2B / 255)          # #2B2B2B charcoal
INK2 = (0x4A / 255, 0x45 / 255, 0x40 / 255)         # #4A4540
INK_MUTED = (0x6E / 255, 0x6A / 255, 0x64 / 255)    # #6E6A64
ACCENT = (0xA2 / 255, 0x53 / 255, 0x3A / 255)       # #A2533A terracotta
ACCENT_SOFT = (0xC9 / 255, 0x74 / 255, 0x4F / 255)  # #C9744F
PALE = (0xF6 / 255, 0xD9 / 255, 0xCB / 255)         # #F6D9CB
LIGHT_GRAY = (0xE6 / 255, 0xDF / 255, 0xD3 / 255)   # #E6DFD3 clay border
```
and in `remap_rgb` change the deep-indigo tuple `(0x33 / 255, 0x2D / 255, 0x5C / 255)` to `(0x7E / 255, 0x3F / 255, 0x2B / 255)` (#7E3F2B, the terracotta edge). Update the docstring's colour list accordingly.

- [ ] **Step 2: Re-bake each asset in place** (from the repo root; the script accepts an already-baked JSON — it remaps by lightness/saturation role, so the old purple family maps onto the terracotta family):
```bash
for f in breathing-calm chat-loading notebook-writing piggy-bank study-discussion; do
  python scripts/theme_lottie.py apps/mobile/assets/lottie/$f.json apps/mobile/assets/lottie/$f.json
done
```
Expected: five lines of the script's normal output, no tracebacks. Add one line to `apps/mobile/assets/lottie/README.md` under the licence table: `Re-baked 2026-09-05 onto the Clay and Sage palette (DECISIONS §K.5) with scripts/theme_lottie.py.`

- [ ] **Step 3: Verify in the browser** — the landing hero and the chats empty state use these; reset, then `node e2e/connecting-experience.e2e.js` → PASS (the hero Lottie mounts on the landing). Take one screenshot of `/` at 390×844 and confirm the hero is terracotta/oat, not purple (the controller's screenshot walk in Task 10 covers the rest).

- [ ] **Step 4: Commit**
```bash
git add ../../scripts/theme_lottie.py assets/lottie
git commit -m "chore(lottie): re-bake scene art onto the Clay and Sage palette

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Headline token adoption

**Files:** Modify `components/onboarding/steps/AgeStep.tsx`, `EmailStep.tsx`, `RoleStep.tsx`, `PrimerStep.tsx`, `HandoffStep.tsx`, `ReadyStep.tsx`, `CompanionStep.tsx`, `app/+not-found.tsx`, `app/mentor-home.tsx`.

- [ ] **Step 1** — in each file, find the local `headline` / `title` style object whose `fontFamily` is `font.sansHeavy` or `font.serifBold` with `fontSize` 26–30 and replace its font/size/lineHeight trio with the spread `...type.displayHeadline` (keep `textAlign`, margins, padding). Example, `RoleStep.tsx`:
```ts
  headline: { ...type.displayHeadline, textAlign: 'center', marginBottom: space.sm },
```
Import `type` from `@/theme/tokens` where it is not already imported; remove `font` from the import if it becomes unused. Do not touch serif hub titles (`type.displaySerif` users) — they already use a token.

- [ ] **Step 2: Typecheck, one suite, commit**
```bash
npx tsc --noEmit
```
Reset, `node e2e/role-fork.e2e.js` → PASS.
```bash
git add components/onboarding/steps app/+not-found.tsx app/mentor-home.tsx
git commit -m "refactor(theme): onboarding and Mentor Home headlines use type.displayHeadline

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Full proof, screenshot walk, docs

**Files:** Modify `CLAUDE.md`, `PROGRESS.md`, `docs/DECISIONS.md` (one line).

- [ ] **Step 1: Every suite** (reset before each): `connecting-experience`, `path-communities`, `hindi-core-loop`, `member-screens`, `listener-apply`, `apply`, `analytics-dark`, `journal-organize`, `role-fork` → all PASS, 0 page errors. (`admin-dashboard` needs an admin token; `two-party-chat` needs the manual listener setup — run if available, otherwise say so.)

- [ ] **Step 2: Screenshot walk** — the controller re-runs the session-30 scratchpad walk (or an equivalent: onboarding through chat, every tab, options sheet, Path home, journals, coffee, profile, Mentor Home) at 390×844 and reviews the sheets against `https://claude.ai/code/artifact/1c68e534-bb75-4e18-80a3-493cba6e5a8f` (the chosen "Clay and Sage, illustrated" block). Anything that still reads purple/lavender is a missed token (grep for `#` hex literals in `app` and `components` outside `theme/`).

- [ ] **Step 3: Docs**
  - `CLAUDE.md` **Design tokens** section: replace the sentence that begins `**The code is the source of truth**: colours/type/space/elevation in …` so it reads: `**The code is the source of truth**: colours/type/space/elevation in \`apps/mobile/theme/tokens.ts\` — Clay and Sage (DECISIONS §K.5): oat ground \`#F4EFE6\`, charcoal ink \`#2B2B2B\`, default accent terracotta \`#A2533A\` (7 companion accents in \`theme/companion.ts\`, all WCAG AA via \`scripts/contrast_gate.py\`); one type family, Baloo 2. Depth is the **pillow key** (\`components/motion/PressKey.tsx\` for tappables, \`components/EdgeSurface.tsx\` for static surfaces) — shadows are reserved for floating layers.` Keep the rest of the paragraph about motion tokens.
  - `CLAUDE.md` **Stack** table: change the i18n row's `Devanagari via Noto Sans (loaded) + platform fallback` to `Devanagari via Baloo 2 (single family)`.
  - `CLAUDE.md` **Coding conventions**: after the "Design tokens, never raw hex" bullet add: `- **Tappable = PressKey.** Buttons, cards, rows, chips and the tab pill render through \`PressKey\` (impact haptic on press-in, transform-only travel); non-tappable cards use \`EdgeSurface\`. No new \`elevation.*\` on cards.`
  - `docs/DECISIONS.md` §K.8: append one sentence: `Accent values were deepened from the concept renders so white labels and accent text pass WCAG AA on both white and oat (gate: scripts/contrast_gate.py); the light concept terracotta survives as accentSoft/tints.`
  - `PROGRESS.md`: new session entry on top (Done per commit with the suite that proved it; Open: bubble edges may read heavy → one-token fallback; serif token rename follow-up; Next: Plan 2 companion pipeline).

- [ ] **Step 4: Commit**
```bash
git add CLAUDE.md PROGRESS.md docs/DECISIONS.md
git commit -m "docs: fidelity foundation shipped — tokens, PressKey convention, progress

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review against the spec

- **§1 tokens/type** → Tasks 1, 2, 9 (names kept; `edge*` as flat `colors.edgeSurface/edgeAlt/edgeInk` instead of a nested `edge.*` object — simpler for the `ThemeColors` mapped type; `accentEdge` on the accent set; Baloo through existing names; `displayHeadline`; Lottie re-bake in Task 8). Contrast rule enforced by the gate; accents deepened accordingly (recorded in Task 10's DECISIONS line).
- **§2 depth** → Tasks 3–6 (PressKey props per spec: `edge`, `travel 4|3|2`, `radius`, `haptic`, `disabled`, `style`, testID, a11y; reduced motion = opacity dip; disabled = no edge; adopters list covered: PrimaryButton, TiltCard (doors, Path options), rows, journal cards, chips, tab pill, New Chat sheet, send key; static surfaces via EdgeSurface; inputs outlined; shadows kept only on tab bar / FAB / sheets).
- **§3 chat** → Task 7 (rise-in only for post-load messages, TypingDots on breathe tempo, send `advance` via PressKey, receive `nudge`, no scene/companion, reduced motion handled in both).
- **§4 companions** → Plan 2 (explicitly out of this plan).
- **§5 verification** → every task ends in tsc + a suite; Task 10 runs all + screenshot walk; contrast gate in Task 2.
- **§6 reduced motion/safety** → PressKey/TypingDots/rise-in all consult `useReducedMotion`; error states untouched (they never used PressKey); no audio.
- **Type consistency:** `PressKey` props (`edge`, `travel`, `radius`, `haptic`, `disabled`, `style`, `containerStyle`, a11y, `testID`) match every call site in Tasks 4–7; `EdgeSurface` (`edge`, `travel`, `radius`, `style`, `containerStyle`, `testID`) matches Card, tab pill, bubbles, TypingDots; `colors.edgeSurface/edgeAlt/edgeInk/accentEdge` defined in Task 2 before use in Task 3+; `type.displayHeadline` defined in Task 1 before Task 9.
- **Placeholders:** none. Task 5/6 give the transformation once with a concrete example and name every site with its testID; each site's own props are preserved as stated.
