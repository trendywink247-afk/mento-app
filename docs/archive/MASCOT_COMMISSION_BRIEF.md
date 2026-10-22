# Commission brief — Mento companion characters (Rive)

**Client:** Mento — an anonymous emotional-support app (calm, soothing, judgment-free; think Calm / Headspace / Finch, not a game).
**Deliverable:** SIX animal companion characters in ONE consistent style, built in **Rive** with state machines.
**Budget band:** $2,500–6,000 for the set · **Timeline:** 4–8 weeks · **Licence:** work-for-hire, full IP transfer, editable .rev source files included.

## The characters

Panda · Elephant · Fox · Turtle · Deer · Owl.

Style register: soft, rounded, cute-but-dignified — a companion an adult in a hard moment doesn't feel silly talking next to. Flat-ish with gentle depth (soft shading OK, no hard 3D render look). Reference: the app's current flat-rounded SVG companions (supplied), the Finch bird, Headspace characters. Our palette is light lavender/indigo (design tokens supplied) — see "Theming" below.

## Required states (per character, in one state machine)

| State | Behaviour |
|---|---|
| **Idle / breathe** | Default loop: slow breathing (~5s cycle), occasional randomized blink, subtle weight shift. Must loop seamlessly and read as "alive" at 64px. |
| **Greet** | A short wave/nod on entry (trigger input `greet`), settles back to idle. |
| **Celebrate** | A joyful beat — small hop/arms up (trigger `celebrate`), ~1.5s, settles to idle. No confetti/gamified effects. |
| **Comfort** | A soft, caring pose shift (trigger `comfort`) — used when the conversation turns heavy. Gentle, never cheerful. |
| **Tap-react** | Pointer/touch listener: a small acknowledging reaction (ear twitch, look toward the touch). |
| **Sleep** (nice-to-have) | Curled/resting loop (boolean `resting`) for night/paused states. |

Inputs must be identically named across all six files (`greet`, `celebrate`, `comfort`, `resting` + the tap listener) so the app drives every animal with one code path.

## Theming (important)

The app re-colours the companion to the user's chosen accent (7 accent sets, hex values supplied). Expose the accent-able parts (cape/scarf/inner-ear/cheek accents — designer's call on what carries the accent) as **runtime-recolourable** (bound colour inputs or clearly named fills we can target via the Rive data-binding/API). Body colours stay natural per animal.

## Technical constraints

- Each .riv ≤ ~100KB preferred (they ship in a mobile binary; total budget for all six ≤ 1MB).
- Must render crisply at 48–200px; no raster embeds.
- Runtimes: `rive-react-native` (iOS/Android) and `@rive-app/react-canvas` (web). Please verify state machines on both.
- 60fps on mid-range Android for the idle loop.

## Acceptance

Per character: all states demoed in the Rive editor + on a test device; inputs named per spec; recolour demonstrated with two accent sets; .riv + editable source delivered. We review the FIRST character (panda) fully before the remaining five proceed — style lock happens there.

## Supplied on kickoff

Current SVG companion art (style seed), design tokens (colours/motion timings), the app running in a browser for context, and the mockups' original 3D-style panda references.
