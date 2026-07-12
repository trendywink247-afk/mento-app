# Landing Enhancement + Logo Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the bubble-heart logo and a modest, theme-intact polish of the landing screen (serif headline, glowing CTA, sequenced sky motes).

**Architecture:** All logo call sites render through `components/art/Logo.tsx`, so the mark swap is one file. Landing polish edits `app/index.tsx` plus one new motion component (`SkyMotes`). Motion budget rule (≤3 simultaneous movers) is honored by sequencing motes so only one moves at a time and keeping the CTA glow static.

**Tech Stack:** React Native (Expo SDK 52), react-native-svg, Reanimated 3 (manual shared values only), motion tokens from `theme/motion.ts`. Verification = `tsc --noEmit` + Playwright on Expo web at 390×844 (project convention; no unit-test framework for visuals).

**Spec:** `docs/superpowers/specs/2026-07-13-landing-enhance-design.md`

---

### Task 1: Bubble-heart logo mark

**Files:**
- Modify: `apps/mobile/components/art/Logo.tsx` (replace whole file)

- [ ] **Step 1: Find every call site so layout impact is known**

Run: `grep -rn "LogoMark\|LogoLockup" apps/mobile --include="*.tsx" -l`
Expected: `components/art/Logo.tsx` plus the landing (`app/index.tsx`) and onboarding step scaffold(s). Note each — Step 4 checks them visually. The old mark was 1.45× wider than tall; the new mark is square, so lockups get slightly tighter — acceptable.

- [ ] **Step 2: Replace `Logo.tsx` with the new mark**

```tsx
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';

import { useTheme } from '@/theme/ThemeProvider';
import { font } from '@/theme/tokens';

/**
 * Mento logo: a chat bubble holding a heart — "talking that cares" in one glyph.
 * Indigo→lavender gradient (brand tokens by VALUE — SVG gradients can't consume
 * useTheme, and the mark must not re-tint with the user accent; it's the brand).
 * Chosen 2026-07-13 (founder-approved "enhance modestly"; concept B of four).
 */
export function LogoMark({ size = 72 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 56" accessibilityLabel="Mento">
      <Defs>
        <LinearGradient id="mentoMark" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#5847D6" />
          <Stop offset="1" stopColor="#8177C9" />
        </LinearGradient>
      </Defs>
      {/* bubble with a soft tail, bottom-left */}
      <Path
        d="M24 2 C10.7 2 0 11.8 0 24 C0 36.2 10.7 46 24 46 L27 46 L23 54 L34 47 C44.5 43.9 48 34.7 48 24 C48 11.8 37.3 2 24 2 Z"
        fill="url(#mentoMark)"
      />
      {/* heart, slightly above optical center */}
      <Path
        d="M24 33 C22 31 14 26.5 14 20.7 C14 17 17 14.4 20.2 14.4 C22 14.4 23.3 15.3 24 16.4 C24.7 15.3 26 14.4 27.8 14.4 C31 14.4 34 17 34 20.7 C34 26.5 26 31 24 33 Z"
        fill="#FFFFFF"
      />
    </Svg>
  );
}

/** Horizontal lockup: mark + lowercase "mento" wordmark (landing/age/email headers). */
export function LogoLockup({ markSize = 44 }: { markSize?: number }) {
  const { colors } = useTheme();
  return (
    <View style={styles.row}>
      <LogoMark size={markSize} />
      <Text style={[styles.wordmark, { color: colors.ink, fontSize: markSize * 0.78 }]}>mento</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  wordmark: { fontFamily: font.serifBold, letterSpacing: 0.25 },
});
```

Note: wordmark moves `sansSemi → serifBold` to match the app's display type (tabs headers, ready screen). If `font.serifBold` does not exist in `theme/tokens.ts`, use the serif family token that the `type.displaySerif` style uses — check `theme/tokens.ts` first, do not invent a token.

- [ ] **Step 3: Type-check**

Run: `cd apps/mobile && npx tsc --noEmit`
Expected: clean exit 0.

- [ ] **Step 4: Visual check on every call site (Playwright, 390×844)**

With backend (:8000) + Expo web (:8081) running: clear `localStorage`, load `/` (landing lockup), then walk to the age step and email step (headers use the lockup). Screenshot each. Confirm: gradient bubble renders, heart centered, wordmark serif, no clipping, 0 console errors.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/components/art/Logo.tsx
git commit -m "feat(mobile): bubble-heart logo mark (brainstormed concept B)"
```

---

### Task 2: SkyMotes — sequenced drifting light motes

**Files:**
- Create: `apps/mobile/components/motion/SkyMotes.tsx`
- Modify: `apps/mobile/theme/motion.ts` (add drift token)

- [ ] **Step 1: Add the drift token to `theme/motion.ts`**

Find the exported `breathe` constant and add below it (matching the file's style):

```ts
/** Sky-mote drift: one full three-mote rotation. Each mote owns period/3, so only
 * ONE mote is ever moving — the landing's motion budget (≤3 simultaneous movers:
 * breathing logo + mountain drift + one mote). */
export const drift = { period: 36000 };
```

- [ ] **Step 2: Create `components/motion/SkyMotes.tsx`**

```tsx
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

import { useReducedMotion } from '@/lib/useReducedMotion';
import { drift, easing } from '@/theme/motion';

/**
 * Three soft light motes drifting up through the sky, SEQUENCED so only one moves
 * at any moment (motion budget: the landing already has the breathing logo and the
 * mountain drift; CLAUDE.md caps simultaneous movers at 3). Transform/opacity only.
 * Reduced motion renders nothing at all.
 */
const MOTES: { left: `${number}%`; top: `${number}%`; size: number }[] = [
  { left: '18%', top: '22%', size: 10 },
  { left: '74%', top: '14%', size: 7 },
  { left: '58%', top: '34%', size: 8 },
];

function Mote({ index, left, top, size }: { index: number } & (typeof MOTES)[number]) {
  const t = useSharedValue(0);

  useEffect(() => {
    const active = drift.period / 3;
    t.value = 0;
    t.value = withDelay(
      index * active,
      withRepeat(
        withSequence(
          withTiming(1, { duration: active, easing: easing.breathe }), // my window: drift
          withTiming(0, { duration: 0 }), // reset instantly (invisible at t=0/1)
          withTiming(0, { duration: active * 2 }), // hold while the others take turns
        ),
        -1,
      ),
    );
    return () => cancelAnimation(t);
  }, [index, t]);

  const style = useAnimatedStyle(() => ({
    // sin curve: fade in, peak mid-drift, fade out — never pops.
    opacity: Math.sin(t.value * Math.PI) * 0.45,
    transform: [{ translateY: t.value * -34 }, { translateX: t.value * 10 }],
  }));

  return (
    <Animated.View
      style={[
        styles.mote,
        { left, top, width: size, height: size, borderRadius: size / 2 },
        style,
      ]}
    />
  );
}

export function SkyMotes() {
  const reduced = useReducedMotion();
  if (reduced) return null; // stillness, not frozen dots
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {MOTES.map((m, i) => (
        <Mote key={i} index={i} {...m} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  mote: { position: 'absolute', backgroundColor: '#FFFFFF' },
});
```

- [ ] **Step 3: Type-check**

Run: `cd apps/mobile && npx tsc --noEmit`
Expected: clean. (If `easing.breathe` or the tuple type complains, match the exact easing export name in `theme/motion.ts`.)

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/components/motion/SkyMotes.tsx apps/mobile/theme/motion.ts
git commit -m "feat(mobile): SkyMotes — sequenced ambient light motes (motion-budget safe)"
```

---

### Task 3: Landing polish (serif headline, CTA glow, motes, balance)

**Files:**
- Modify: `apps/mobile/app/index.tsx`

- [ ] **Step 1: Wire in the changes**

In `app/index.tsx`:

a. Add imports: `import { SkyMotes } from '@/components/motion/SkyMotes';` and add `radius` to the tokens import (`font, radius, space, type`).

b. Mount motes directly after the ambient background:

```tsx
      <AmbientBackground />
      <SkyMotes />
```

c. Headline becomes display serif (matches ready-screen/tab display type). Replace the `headline` style:

```ts
  headline: {
    fontFamily: font.serifBold,
    fontSize: 34,
    lineHeight: 44,
    textAlign: 'center',
  },
```

(Use the same serif token found in Task 1 Step 2 if `font.serifBold` differs.)

d. Logo slightly larger for balance: `<LogoLockup markSize={72} />` (was 64).

e. CTA gets a STATIC accent glow (no scale animation — motion budget is spent). Wrap the button inside the existing `<Entrance index={6}>`:

```tsx
            <Entrance index={6}>
              <View style={[styles.ctaGlow, { shadowColor: colors.accent }]}>
                <PrimaryButton
                  label="Start a Conversation"
                  tone="ink"
                  icon="chatbubble-outline"
                  onPress={begin}
                  accessibilityHint="Begins anonymous onboarding"
                  testID="start"
                />
              </View>
            </Entrance>
```

and add the style:

```ts
  ctaGlow: {
    borderRadius: radius.pill,
    shadowOpacity: 0.35,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
```

- [ ] **Step 2: Type-check**

Run: `cd apps/mobile && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Playwright verification (390×844)**

1. Clear localStorage, load `/`: new logo + serif headline + glowing CTA render; screenshot `after-landing.jpeg`; 0 console errors.
2. Wait ~13s, screenshot again: a DIFFERENT mote is visible (sequencing works; compare positions).
3. Reduced-motion run (`reducedMotion: 'reduce'` context or CDP emulation): motes absent, page static, CTA still clickable → onboarding opens.
4. Full journey to chat still passes: run `NODE_PATH=<playwright-skill node_modules> node C:/tmp/playwright-test-console.js` → all OK lines, 0 page errors.

- [ ] **Step 4: Commit + close out**

```bash
git add apps/mobile/app/index.tsx
git commit -m "feat(mobile): landing polish — serif headline, CTA glow, sky motes"
```

Update `PROGRESS.md` (session entry: logo + landing polish shipped, spec/plan paths) and commit as `docs(progress): ...`.

---

## Self-review notes

- Spec coverage: logo (Task 1), composition/headline/CTA/atmosphere (Task 3), motes + motion budget (Task 2), reduced motion (Tasks 2–3), verification incl. before/after screenshots (Tasks 1/3). Before-screenshots exist from today's UX review (`scratchpad/ux-review/ux-01-landing.jpeg`).
- Deviation from spec, deliberate: CTA "breathing" dropped — with logo breathe + mountain drift + one active mote the budget (≤3) is full; glow is static. Spec's own constraint clause wins over its enhancement list.
- Type consistency: `font.serifBold` existence is verified in Task 1 Step 2 with a stated fallback; `easing.breathe` verified in Task 2 Step 3.
