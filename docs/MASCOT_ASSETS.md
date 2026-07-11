# Mascot asset research — a reactive 6-animal companion set

**Date:** 2026-07-11 · **Status:** ✅ DECIDED (founder, 2026-07-11): **staged commission** — Rive set commissioned (brief: `MASCOT_COMMISSION_BRIEF.md`), free Lottie interim ships now behind the `Companion` component.
**Need:** panda, elephant, fox, turtle, deer, owl in ONE consistent style, each with at least idle/breathe + greet + celebrate, ideally truly reactive (responds to taps/choices). Calm/Finch register, recolourable toward the companion palette. Replaces the interim coded SVG rig.

## Headline finding (verified hands-on, 2026-07)

**No off-the-shelf pack — Lottie or Rive — covers all six animals in one style with the required actions.** The closest single-author match covers 5/6 but only as looping *faces*. A genuinely reactive, on-brand set exists only via commissioning.

## Routes examined

| Route | 6/6? | Actions | Reactive? | Licence | Cost | Expo/web fit | Score |
|---|---|---|---|---|---|---|---|
| **LottieFiles free/marketplace** — best: [Animals Animation Pack (Vectors Market)](https://lottiefiles.com/marketplace/animals-animation-pack_203768) | 5/6 (no turtle) | ✗ face blink/wiggle loops only | loop only | [IconScout Digital](https://iconscout.com/lottie-animation/cute-panda-animation_7350528) — verified free | $0 | ✅ Expo Go + web (lottie-react-native) | 5/10 |
| **IconScout sub** (same inventory + [a 45-action turtle pack](https://iconscout.com/lottie-animation-pack/turtle-cartoon-animation-pack_293896) in a different style) | 5/6 + off-style turtle | partial | loop/segments | Digital License | [$0–14.99/mo](https://iconscout.com/pricing) | ✅ | 5/10 |
| **Creattie** | 0/6 — human-centric scene illustrations, no mascots | ✗ | loop | perpetual | ~$15–25/mo | ✅ | 2/10 |
| **Rive community/marketplace** — [panda search](https://rive.app/marketplace/search/panda/) | 1–2/6, hobbyist one-offs | varies | ✅ state machines | CC BY (attribution!) | free | ⚠️ dev build, **no RN-web runtime** | 2/10 |
| **Commission a Rive set** — [RiveAnimator pricing](https://riveanimator.com/pricing.html), [Fiverr](https://www.fiverr.com/gigs/rive-animation), [Upwork rates](https://www.upwork.com/hire/animators/cost/) | **6/6** | **all + custom** | **✅ full state machines, tap inputs, runtime recolour** | work-for-hire | **$2.5k–6k** (budget tier $0.6–1.8k) | ⚠️ dev build + ~1–3 days for a custom `@rive-app/react-canvas` web adapter | **9/10** |
| UI8 / Envato / hybrid (static set + Fiverr rigging from our vectors, $35–150/animation) | partial | via rigging | via rigging | varies | ~$16.50/mo + fees | depends | 4/10 |

Notable extras: [Welcome Cute Animals](https://iconscout.com/lottie-animation-pack/welcome-cute-animals-animation-pack_116837) (11 full-body *waving* animals — but only owl + panda of our six), [Panda Emotions](https://iconscout.com/lottie-animation-pack/panda-emotions-animation-pack_272825) (panda only). Lottie free-library licence: [Lottie Simple License](https://lottiefiles.com/page/license) (free commercial, no attribution). Typical sizes: 20–300KB per Lottie JSON, ~40–80% smaller as .lottie — no binary-budget concern.

## Recommendation

**Staged commission.** Ship now on the free 5/6 Vectors Market Lottie faces (+ nearest-style free turtle) behind a `Companion` component that hides the asset format — an immediate visible upgrade over the coded SVG. In parallel, **commission one Rive specialist for the six-character set** (idle/breathe, greet, celebrate, tap-react state machine, colour-themeable to the persona palette): **$2,500–6,000, 4–8 weeks** (budget tier $600–1,800 via Fiverr/Upwork with style-consistency risk). Swap the component internals on delivery; integration cost is one Expo dev build + the small web adapter.

Runner-up: **pure-Lottie commission ($600–1,800)** — same six animals, three loops each, zero new runtime, keeps Expo Go + web free — but reactivity caps at "play a different clip on tap" forever.

## The decision (founder)

> Loop-only companions forever (Lottie commission, ~$0.6–1.8k, zero integration risk) — **or** $2.5–6k + one dev-build migration for genuinely reactive Rive companions that breathe, react to touch, and recolour live with the persona system?

Given the companion is the app's core emotional surface (Finch's entire retention engine is exactly this), the Rive path is the one that pays back. Nothing blocks shipping v1 on the free interim set today.
