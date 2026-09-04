# Fidelity pass — design

**Date:** 2026-09-05 · **Status:** approved by founder (sections 1–6) · **Ruling:** `docs/DECISIONS.md` §K.8 (palette §K.5, typeface §K.6)

## Why

The founder asked for the whole app to feel immersive and premium: every component "realistic", the floating companion realistic, "3D haptic" feedback on touch, and an immersive chat. Session 30 fixed the palette (Clay and Sage) and the typeface (Baloo 2). This pass turns those into a design system and a component kit, then upgrades the companion art. Everything stays inside the Calm register: no audio, no gamification, no 3D engine (DECISIONS §I.1, §I.7).

## Decisions taken (founder, browser mockups, 2026-09-05)

| Question | Answer | Rejected |
|---|---|---|
| Depth language | **Pillow key** — every tappable surface has a visible bottom edge that collapses on press | Soft clay (double shadow); quiet matte |
| Companion art | **Painterly** — visible fur, rim light, real volume, still an illustration | Storybook flat; soft-3D film render |
| Chat immersion | **Focus** — physics only (bubbles rise in, typing dots breathe, send key presses); no scene, no companion inside the chat | Living sky (aurora + companion by the composer); scene header |
| Build order | **Foundation first, two plans** | Screen by screen |
| Companion budget | **All six animals**, 1 reference + 6 poses each (~52 credits incl. redos) | Panda only; fewer poses |

## 1. Tokens and type

- `apps/mobile/theme/tokens.ts` — palette becomes Clay and Sage. Existing token **names are kept** (`bg`, `surface`, `surfaceAlt`, `ink`, `inkMuted`, `border`, `accent`, `accentSoft`, `accentTint`, `wash.*`) so components need no colour edits. Values: ground oat `#F4EFE6`, surface `#FFFFFF`, alt surface warm `#FBF8F2`, ink charcoal `#2B2B2B`, muted `#6E6A64`, border `#E6DFD3`. Each surface gains an **edge** shade for the pillow key: `edge.surface #E3DCCF`, `edge.accent` derived per accent (see §2).
- `apps/mobile/theme/companion.ts` — the 7 companion accents are re-derived on the new palette; **terracotta `#D98C6B` becomes the default**, then sage `#9DB5A1`, sky, rose, mustard, plum, teal. Each `AccentSet` gains `accentEdge` (the darker key edge) and keeps `accent` / `accentSoft` / `accentTint`. Contrast rule: sage is a surface/edge colour, never body text.
- **Fonts**: Baloo 2 (400/500/600/700/800) replaces Nunito and Lora through the existing `font.sans*` / `font.serif*` names (serif names now point at Baloo weights so no call sites change; a follow-up may rename). Lora and Noto Sans Devanagari are dropped from `app/_layout.tsx` — Baloo 2 carries Devanagari. `type.*` scale retuned for Baloo's x-height; one new `type.displayHeadline` (28/36, weight 800) replaces the per-step hand-rolled onboarding headline styles.
- **Lottie** scene art re-baked with `scripts/theme_lottie.py` onto the new palette (static bake, as before). Raster illustrations (landing hero, persona avatars, journal empty states) are left untouched in this pass.

## 2. Depth system — `PressKey`

- New primitive `apps/mobile/components/motion/PressKey.tsx`: a `Pressable` that renders an **edge view** (same radius, offset down by `travel`, colour `edge`) beneath a **face view** and animates only the face's `translateY` from 0 → `travel` on press-in and back with `spring.calm` on release. Transform only; the edge never changes size. Props: `edge: string`, `travel?: 4 | 3 | 2` (default 4), `radius?`, `haptic?: 'impact' | 'none'` (default `impact`: `haptic.advance()` on press-in, nothing on release — founder's pick), `disabled`, `style` (face visuals), `testID`, accessibility props.
- Reduced motion: no travel; press = 150 ms opacity dip. Disabled: edge removed, face desaturated, no haptic. Error states: never collapse, never buzz (T&S #11).
- **Adopters** (face colour → edge colour): `PrimaryButton` (accent → `accentEdge`; ghost → `edge.surface`), `TiltCard` (surface → `edge.surface`; keeps its tilt), conversation rows and journal cards (surface), chips (surface / accent), tab-bar active pill (`accentTint` → `edge.surface`, travel 2), New Chat sheet rows, the two role doors, composer send key (accent, travel 4). Non-tappable surfaces — message bubbles, status cards, notes — draw the edge with no press physics (a static `EdgeSurface` wrapper sharing the same drawing code).
- Inputs: clay outline (`border`), no edge. Shadows: the existing `elevation.*` shadow tokens are kept for a few floating layers (sheets, FAB) but removed from cards, which now use the edge instead — fewer shadow draws on Android.

## 3. Chat physics (Focus)

- `components/chat/ChatScreen.web.tsx` and the native `ChatScreen.tsx` message rendering: messages that arrive **after initial load** rise in (10 px translateY + opacity, `duration.gentle`, `easing.settle`) via a manual shared value keyed on first mount of the row; history renders still.
- Typing indicator: three dots on a bubble, breathing at `breathe.period / 4` stagger, replacing the plain caption line; the header keeps the presence copy. Reduced motion: dots static.
- Haptics: `haptic.advance()` on send-key press-in (via `PressKey`), `haptic.nudge()` when a message arrives while the chat is focused. None on crisis cards, none on errors.
- No ambient background, no companion in the chat, no audio. Everything else in chat (crisis card, privacy banner, save-to-notes, options sheet) unchanged apart from tokens.

## 4. Companion pipeline (Plan 2)

- `scripts/companions/` (repo root): `recipe.md` (the locked painterly prompt + negative constraints), `poses.json` (idle, greet, comfort, joy, curious, sleepy — the rig's `character` vocabulary), `manifest.json` recording every render's Higgsfield job id, prompt and accepted/rejected state.
- Per animal (panda, elephant, fox, turtle, deer, owl): one **reference** render (idle, oat ground, terracotta scarf), then six pose renders using the reference as an image input (Nano Banana `image_references`) for identity consistency. Background removed **locally** by `scripts/companions/cutout.py` (Pillow: the renders sit on a flat oat ground, so a colour-distance matte with edge feathering is enough; no paid remove-bg call), exported as webp at the registry's expected sizes into `assets/companions/generated/<animal>/<pose>.webp`; `assets/companions/generated/index.ts` maps animal × pose. `components/art/Companion.tsx` reads the pose for the current rig state; unchanged public API, unchanged state vocabulary.
- Scarf follows the companion accent by tint, as today. Reduced motion: the still idle pose only.
- Budget: ~42 renders + ~10 redos ≈ 52 credits (approved).

## 5. Verification

- `npx tsc --noEmit` at every commit. All e2e suites re-run (they select by testID, not colour): connecting-experience, path-communities, hindi-core-loop, member-screens, listener-apply, apply, analytics-dark, journal-organize, role-fork; plus a screenshot walk of every route at 390×844 compared side by side with the concept gallery.
- **Contrast gate**: a small script checks every text/surface pair in the new tokens to WCAG AA before the token commit ships.
- Performance: pillow edges are plain views (no blur, no shadow radius). Card shadows removed. Reanimated transforms only. 60 fps mid-Android target unchanged.
- Companion assets: each animal's six poses reviewed on one contact sheet before acceptance; identity drift → regenerate that pose with the reference, never hand-edit.

## 6. Reduced motion and safety

- Reduced motion: presses collapse to opacity, companion float stops (still idle pose), bubbles appear, dots freeze. Every flow must complete.
- Error states stay still: no edge collapse, no haptic, no shake.
- Calm register held: the pillow key is tactile, not playful; no confetti, no bounce springs (`spring.calm` only), no audio.

## Out of scope

- Dark mode (the app is light-mode v1).
- Redrawing raster illustrations (landing hero, persona avatars, journal empty states) — a later art pass.
- The web listener console and admin dashboard: they receive the token swap only.

## Open notes for the founder (logged in PROGRESS)

- Serif token names (`font.serifBold` etc.) temporarily point at Baloo weights to avoid a wide rename; a rename to `font.display*` is a follow-up.
- If the pillow edge on message bubbles reads too heavy in the real app, the fallback is edge on tappables only (bubbles flat) — a one-token change.
