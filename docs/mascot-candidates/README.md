# Mascot candidates — AI-generated set (2026-07-12)

Six companion characters in one consistent style, generated via Higgsfield (Google Nano Banana 2, 1024×1024 PNG, 12 credits total). The panda was generated first as the style lock (prompt built from `docs/MASCOT_COMMISSION_BRIEF.md`); the other five used it as an image reference. The owl took three attempts (v1 too alert, v2 too sleepy); `owl.png` is v3.

Style register: soft rounded shapes, flat with gentle shading (no hard 3D), cute-but-dignified, natural animal colours, one accent piece (indigo scarf ~`#5847D6`), warm-cream ground `#FDF8F5`, subtle oval shadow.

## What these are — and are not

- **They are:** a style-consistent reference set. Candidate uses: (a) the visual style-lock to hand a Rive specialist with the commission brief, (b) static art upgrades over the Fluent Emoji SVGs after background removal.
- **They are not:** a replacement for the `ReactiveCompanion` rig. These are flat rasters — they cannot breathe, greet, hop, or comfort. The reactive states still come from the rig (or a future Rive commission).
- **Licence note:** AI-generated output — verify Higgsfield's terms grant commercial use on the current plan before shipping in the app binary.

## Status

✅ **Founder-approved and shipped (2026-07-12).** Background-removed, trimmed 512px WebP cutouts live at `apps/mobile/assets/companions/generated/` and render as the default companion art on the ReactiveCompanion rig (Playwright-proven, all six animals, 0 console errors). This folder keeps the full-res originals with backgrounds — the style-lock package for the Rive commission and the regeneration source of truth.

Higgsfield job IDs (for re-download/upscale/background-removal): panda `8928da8c`, elephant `70eb8342`, fox `467aa9e1`, turtle `c7038ac3`, deer `e26d4668`, owl `2d8dd1ad`.

## Empty-state scenes (`scenes/`, added same day)

Four spot illustrations in the same register (no character — theme-invariant), shipped as `apps/mobile/assets/scenes/` (~23KB total) and rendered as rounded tiles by `components/art/SceneTile.tsx`: chat-connected `72884ea6` (chat "You're connected!"), chats-empty `31e7d78f` (My Chats "No conversations yet"), journals-ai `7bffdbcf` (AI-assistant card), journal-empty `ac062a77` (all four journal channels). Scenes keep their warm-cream background — they blend into cream screens and read as deliberate tiles on tinted cards.

## Panda poses (`poses/`, added same day)

Six pose variants of the same panda (style-locked on `panda.png` as image reference), shipped as `apps/mobile/assets/companions/generated/panda-poses/` and rendered by `components/art/Panda.tsx` (coded SVG stays as fallback). Job IDs: wave `cf1e6f57`, sleep `6e1921fc`, excited `691103bf`, coffee `b277ce4a`, sad `5ee6fc1a`, shield `bbc5651a`. Note: the raster poses wear the fixed indigo scarf; the retired SVG poses re-tinted their cape to the user accent — trade-off accepted to match the companion set.

## Painterly pose set (`companions-2026-09/`, 2026-09-05 — DECISIONS §K.8)

The Clay-and-Sage fidelity pass replaced the flat set above with a **painterly semi-realistic** set: six animals × six poses (`idle, greet, joy, comfort, curious, sleepy`) plus panda-only `coffee` and `shield` — 38 renders, one locked recipe (`scripts/companions/recipe.md`), one reference render per animal used as the `image_references` input for every pose so identity holds. Higgsfield `nano_banana`, 1024×1024, 46 credits (6 references + 38 poses + 2 elephant re-rolls for background smudges). Every job id lives in `scripts/companions/manifest.json`; the full-res PNGs are **not** committed (re-download by job id) — this folder keeps only the review contact sheets (`references.jpg`, `<animal>-poses.jpg`, ~60KB each).

Shipped as `apps/mobile/assets/companions/generated/<Animal>/<pose>.webp` (512px RGBA, ~30KB each, ~1.2MB total) via `scripts/companions/cutout.py` — border flood-fill matte (enclosed light regions such as the owl's cream face stay opaque) with the baked contact shadow kept as a soft translucent ramp. Rendered by `components/art/Companion.tsx` (pose crossfade); the legacy `Panda` component is now an adapter that renders the user's chosen animal. Known trade-off: the terracotta scarf is painted in and does not follow the companion accent. Never hand-edit a cutout — regenerate from the recipe with the animal's reference and re-cut.
