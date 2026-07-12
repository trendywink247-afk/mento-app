# Landing screen enhancement + logo refresh — design spec

**Date:** 2026-07-13 · **Status:** founder approved direction ("enhance modestly,
don't alter the theme; everything"); logo concept = opinionated call (B), reversible.

## Goals (founder)

Wow factor + more alive, achieved **modestly**: same theme (light lavender aurora,
minimal copy, single CTA), no structural redesign. Update the logo.

## Logo — "bubble-heart" (concept B from brainstorm)

- New mark: a rounded chat bubble containing a heart, indigo→lavender gradient
  (`#5847D6 → #8177C9`), drawn as SVG in `components/art/Logo.tsx` — every call site
  (landing, onboarding steps) inherits automatically. Wordmark stays serif "mento".
- Must stay legible at 24px; keep the current accessibility label pattern.
- Rationale: "talking that cares" in one glyph; serene (register-safe, where the
  panda-face concept read playful/gamified); works as a future app icon.
- **Reversal cost is one file** — founder can veto after seeing it live.

## Landing polish (theme intact, all motion-token based)

1. **Composition:** rebalance vertical rhythm — logo block sits slightly lower and
   larger; headline group gains breathing room; the top-half emptiness closes.
2. **Headline:** larger serif sizing with tighter leading; keep the existing
   line-by-line rise ("understands." last).
3. **CTA:** gradient sheen on the pill (ink→deep-indigo), soft accent glow shadow,
   and a gentle breathing scale (breathe tempo from `theme/motion.ts`, transform-only,
   ≤1.02 — calm, no overshoot). Press haptic unchanged.
4. **Atmosphere:** up to 3 slow drifting light motes in the sky (opacity/transform
   only, desynced, ~40–60s drifts) — respects the ≤3-simultaneous-movers rule
   alongside the existing mountain drift (mountains count; tune so total ≤3 active).
5. **No new copy**, no new sections, no companion cluster (that was the bigger
   Direction A — explicitly not chosen).

## Constraints

- Motion rules are law: tokens only, transform/opacity only, manual shared values,
  `useReducedMotion` ⇒ motes off, CTA breathing off, logo static.
- First frame remains the static gradient (cold-start guard untouched).
- Web + native parity; web is the verification surface.

## Verification

- `tsc --noEmit` clean.
- Playwright 390×844: landing renders new logo + polish, 0 console errors; full
  onboarding walk still lands in chat (logo appears on step headers); reduced-motion
  run is static and completes.
- Before/after screenshots for the founder.

## Out of scope

Marketing website, Direction A/B/C hero redesigns, app-icon asset generation
(follows once the founder confirms the mark in-app), any copy changes.
