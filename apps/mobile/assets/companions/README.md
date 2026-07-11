# Companion assets

**Current default: Fluent Emoji Color art (`fluent/`, MIT — microsoft/fluentui-emoji).**
All six animals in one consistent soft 3D-shaded style, animated by the
ReactiveCompanion rig. Sourced via a verified GitHub sweep (2026-07-11); to refresh
the art, re-run the download + `fluent/convert.js`.

Optional per-animal override: a **Lottie loop** in `registry.ts` takes precedence
over the Fluent art (pipeline proven; sources below). A commissioned **Rive** set
remains the long-term upgrade path (brief: docs/MASCOT_COMMISSION_BRIEF.md).

## 10-minute download checklist (needs a free IconScout/LottieFiles account)

The licence (IconScout Digital License — free items verified) requires downloading
through an account, so this step is manual:

1. Sign in at iconscout.com (Google sign-in works).
2. From the **Animals Animation Pack by Vectors Market**
   (https://iconscout.com/lottie-animation-pack/animals-animation-pack_203768) download
   as **Lottie JSON** (not GIF/MP4):
   - Cute Panda → save as `panda.json`
   - Elephant Face → `elephant.json`
   - Fox Face (or Fox) → `fox.json`
   - Stag Face (or Deer Face) → `deer.json`
   - Owl Face → `owl.json`
3. Turtle (not in that pack): pick the calmest loop from the **Turtle Cartoon
   Animation Pack** (https://iconscout.com/lottie-animation-pack/turtle-cartoon-animation-pack_293896)
   → `turtle.json`.
4. Drop the six files in this folder and flip the entries in `registry.ts`:
   `Panda: require('./panda.json'),` etc.
5. `npx tsc --noEmit` + reload — the Companion component picks them up everywhere
   (onboarding stage, ready arch, profile) automatically.

Keep files under ~300KB each. When the Rive set arrives, this whole folder retires —
only `components/art/Companion.tsx` changes internally.
