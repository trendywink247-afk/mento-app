# Companion Pipeline Implementation Plan (Plan 2 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Tasks marked CONTROLLER are executed by the controlling session itself** (they call the Higgsfield MCP tools, which subagents cannot); everything else is a normal implementer task.

**Goal:** Replace the companion art with a painterly, consistent set — six animals × six poses (plus two panda-only extras) — generated from one locked recipe with a reference image per animal, cut out locally, and wired in behind the existing `Companion` component so the user's chosen animal carries every pose in the app.

**Architecture:** A repo-root `scripts/companions/` folder holds the locked prompt recipe, the pose list, a manifest of every render (job id, prompt, accepted/rejected) and a Pillow cutout script. Renders land as `apps/mobile/assets/companions/generated/<animal>/<pose>.webp`; the registry becomes `animal × pose`. `Companion` gains a `pose` prop and crossfades art (opacity only) when the rig plays a state or the sleepy hour begins. The fixed-panda `Panda` component becomes a thin adapter over `Companion` (legacy pose names mapped), so the twenty existing `<Panda pose=…>` sites render the user's animal with no call-site edits. No backend, no e2e testID changes.

**Tech Stack:** Higgsfield MCP (Nano Banana, 1 credit/render, `image_references` for identity lock) / Python 3 + Pillow for cutouts and contact sheets / Expo SDK 52, RN 0.76, TypeScript strict, Reanimated 3.16 (manual shared values only). Spec: `docs/superpowers/specs/2026-09-05-fidelity-pass-design.md` §4. Budget approved: ~52 credits (DECISIONS §K.8).

**Verification model:** `npx tsc --noEmit` at every code commit; contact-sheet review before any asset is accepted; e2e suites `connecting-experience`, `role-fork`, `member-screens` (they render the companion on every step) plus a screenshot pass; reduced motion checked (crossfade becomes an instant swap). Reset before every e2e run as in `docs/superpowers/plans/2026-09-04-role-fork.md`.

All paths relative to the repo root unless noted (`apps/mobile/…` for app code).

---

## Vocabulary (locked)

| Pose | Rig state it serves | Brief |
|---|---|---|
| `idle` | rest, breathing | sitting calmly, soft neutral smile, paws in lap |
| `greet` | `greet` (arrival) | one paw raised in a small wave |
| `joy` | `joy`, `celebrate` | eyes closed happy, tiny bounce posture, paws up |
| `comfort` | `comfort` | one paw on chest, gentle, slightly leaning in |
| `curious` | `curious` | head tilted, ears perked |
| `sleepy` | sleepy hour idle | eyes closed, head drooped, curled scarf |
| `coffee` *(panda only)* | coffee screen | holding a small mug with both paws |
| `shield` *(panda only)* | lock / mask / report / pause screens | hugging a small heart-shield |

Legacy `PandaPose` → new pose: `wave→greet`, `sleep→sleepy`, `excited→joy`, `sad→comfort`, `coffee→coffee` (non-panda animals fall back to `joy`), `shield→shield` (non-panda → `comfort`).

Animals: `Panda, Elephant, Fox, Turtle, Deer, Owl` (the existing `CompanionAnimal` union).

Render count: 6 references + 36 poses + 2 panda extras = 44, plus up to 8 redos.

---

## File structure

| File | Responsibility |
|---|---|
| `scripts/companions/recipe.md` (create) | the locked painterly prompt, per-animal identity lines, pose lines, negative constraints |
| `scripts/companions/poses.json` (create) | pose keys + one-line briefs (source of truth for prompts and the registry) |
| `scripts/companions/manifest.json` (create, grows) | every render: animal, pose, job id, url, prompt, status |
| `scripts/companions/cutout.py` (create) | PNG on flat oat → trimmed, feathered, 512px WebP |
| `scripts/companions/sheet.py` (create) | contact sheet per animal for review |
| `apps/mobile/assets/companions/generated/<animal>/<pose>.webp` (create ×44) | the art |
| `apps/mobile/assets/companions/generated/index.ts` (rewrite) | `COMPANION_GENERATED[animal].poses[pose]` + `scale` |
| `apps/mobile/components/art/Companion.tsx` (modify) | `pose` prop, effective-pose resolution, opacity crossfade |
| `apps/mobile/components/art/Panda.tsx` (rewrite) | thin adapter: user's animal + legacy pose map |
| `apps/mobile/lib/useCompanionAnimal.ts` (create) | hook reading the stored animal once per mount |
| `apps/mobile/assets/companions/generated/panda-poses/` (delete) + `docs/mascot-candidates/` note | retire the old panda pose rasters |
| `CLAUDE.md`, `PROGRESS.md`, `docs/DECISIONS.md` (modify) | asset route, session log |

---

### Task 1: Recipe, poses, manifest, cutout and sheet scripts

**Files:** Create `scripts/companions/recipe.md`, `scripts/companions/poses.json`, `scripts/companions/manifest.json`, `scripts/companions/cutout.py`, `scripts/companions/sheet.py`.

- [ ] **Step 1: `scripts/companions/poses.json`**

```json
{
  "animals": ["Panda", "Elephant", "Fox", "Turtle", "Deer", "Owl"],
  "poses": {
    "idle": "sitting calmly facing the camera, soft neutral smile, paws resting in its lap",
    "greet": "sitting, one paw raised beside its head in a small friendly wave, warm smile",
    "joy": "sitting, eyes closed in a happy smile, both paws lifted slightly, a tiny joyful bounce in the posture",
    "comfort": "sitting, one paw resting gently on its chest, leaning very slightly forward, soft caring expression",
    "curious": "sitting, head tilted to one side, ears perked, eyes wide and interested",
    "sleepy": "sitting, eyes closed, head drooped a little, curled up with the scarf snug, peaceful"
  },
  "extras": {
    "Panda": {
      "coffee": "sitting, holding a small round ceramic mug with both paws close to its chest, content smile, a wisp of steam",
      "shield": "sitting, hugging a small rounded heart-shaped shield with both paws, calm protective expression"
    }
  }
}
```

- [ ] **Step 2: `scripts/companions/recipe.md`** — the exact prompt assembly the controller uses. Paste this file verbatim:

```markdown
# Companion recipe — painterly (DECISIONS §K.8), locked 2026-09-05

Model: Higgsfield `nano_banana`, aspect `1:1`, 1 credit/render. Poses are generated
WITH the animal's accepted reference as `medias: [{ role: "image_references", value: <reference job_id> }]`.

## Base (every render)
"Character asset on a plain solid pale oat background (#F4EFE6), no scene, no props except
those named, no text, no watermark. A cute {ANIMAL} {POSE_LINE}, wearing a small terracotta
(#D98C6B) knitted scarf. STYLE: painterly semi-realistic illustration, visible soft fur
texture, gentle rim light from the upper left, subtle depth and volume, warm cinematic
lighting, still friendly and rounded (not photoreal, not a toy, not clay, not 3D render),
digital painting quality like a premium animated film concept. Full body visible, centered,
generous margin around the character, soft contact shadow beneath, front three-quarter view."

## Identity lines ({ANIMAL})
- Panda: "giant panda with round ears, black eye patches, white face"
- Elephant: "small round-eared elephant, soft grey, short trunk curled gently"
- Fox: "red fox with a white chest and black-tipped ears, bushy tail curled around"
- Turtle: "small green turtle with a warm brown patterned shell, head out, friendly"
- Deer: "young fawn with white spots, big ears, slender legs folded"
- Owl: "round little owl with warm brown feathers, big amber eyes, small tufts"

## Pose lines ({POSE_LINE})
From `poses.json` — the reference render uses the `idle` line. Pose renders append:
"Same character, same fur colours, same scarf, same lighting and style as the reference
image; only the pose changes."

## Negative constraints (appended to every prompt)
"No background elements, no floor line beyond the soft shadow, no extra characters, no
accessories other than the scarf (and the named prop), no outline strokes, no glossy plastic
look."

## Acceptance (per animal contact sheet)
- identity consistent across all poses (face markings, scarf, fur tone)
- ground is the flat oat (#F4EFE6 ± small variance) so cutout.py can matte it
- full body inside frame with margin; no cropping
- pose reads unambiguously at 96px
Rejects are regenerated with the same reference; never hand-edited.
```

- [ ] **Step 3: `scripts/companions/manifest.json`** — start empty:

```json
{ "renders": [] }
```
Each entry appended by the controller: `{ "animal": "Panda", "pose": "idle", "role": "reference"|"pose", "job_id": "…", "url": "…", "prompt": "…", "status": "pending"|"accepted"|"rejected", "note": "" }`.

- [ ] **Step 4: `scripts/companions/cutout.py`**

```python
"""Cut a companion render out of its flat oat ground and export a trimmed WebP.

    python scripts/companions/cutout.py <in.png> <out.webp> [--size 512] [--pad 0.06]

The renders sit on a near-uniform #F4EFE6 ground. We sample the four corners for the
actual ground colour, build a colour-distance matte, feather it, trim to content, pad,
and resize so the longest side is `size`. Output: RGBA WebP, quality 88.
"""
import argparse
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageFilter


def ground_colour(im: Image.Image) -> tuple[int, int, int]:
    w, h = im.size
    pts = [(2, 2), (w - 3, 2), (2, h - 3), (w - 3, h - 3)]
    px = [im.getpixel(p)[:3] for p in pts]
    return tuple(sum(c[i] for c in px) // len(px) for i in range(3))  # type: ignore[return-value]


def matte(im: Image.Image, ground: tuple[int, int, int], soft: int = 34, hard: int = 70) -> Image.Image:
    """Alpha = 0 at the ground colour, ramping to 255 beyond `hard` distance (per-channel max)."""
    rgb = im.convert("RGB")
    flat = Image.new("RGB", im.size, ground)
    diff = ImageChops.difference(rgb, flat)
    r, g, b = diff.split()
    dist = ImageChops.lighter(ImageChops.lighter(r, g), b)  # max channel distance
    lut = [0 if d <= soft else 255 if d >= hard else int(255 * (d - soft) / (hard - soft)) for d in range(256)]
    alpha = dist.point(lut)
    # Close pinholes inside the body (the panda's white fur is near the ground colour):
    alpha = alpha.filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.MinFilter(5))
    return alpha.filter(ImageFilter.GaussianBlur(1.2))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--size", type=int, default=512)
    ap.add_argument("--pad", type=float, default=0.06)
    a = ap.parse_args()

    im = Image.open(a.src).convert("RGBA")
    ground = ground_colour(im)
    alpha = matte(im, ground)
    out = im.copy()
    out.putalpha(alpha)
    bbox = alpha.point(lambda v: 255 if v > 24 else 0).getbbox()
    if not bbox:
        sys.exit(f"{a.src}: matte found no content (ground sampled as {ground})")
    out = out.crop(bbox)
    pad = int(max(out.size) * a.pad)
    canvas = Image.new("RGBA", (out.width + 2 * pad, out.height + 2 * pad), (0, 0, 0, 0))
    canvas.paste(out, (pad, pad), out)
    scale = a.size / max(canvas.size)
    canvas = canvas.resize((round(canvas.width * scale), round(canvas.height * scale)), Image.LANCZOS)
    Path(a.dst).parent.mkdir(parents=True, exist_ok=True)
    canvas.save(a.dst, "WEBP", quality=88, method=6)
    print(f"{Path(a.src).name}: ground {ground} -> {a.dst} {canvas.size} {Path(a.dst).stat().st_size // 1024}KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 5: `scripts/companions/sheet.py`**

```python
"""Contact sheet for review: python scripts/companions/sheet.py <dir-with-pngs> <out.png>
Tiles every *.png in the folder (sorted) at 320px on a neutral grid with filenames."""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

src, dst = Path(sys.argv[1]), Path(sys.argv[2])
files = sorted(src.glob("*.png")) + sorted(src.glob("*.webp"))
if not files:
    sys.exit(f"no images in {src}")
tile, cols = 320, 4
rows = (len(files) + cols - 1) // cols
sheet = Image.new("RGB", (cols * tile, rows * (tile + 24)), (240, 236, 228))
d = ImageDraw.Draw(sheet)
for i, f in enumerate(files):
    im = Image.open(f).convert("RGBA")
    im.thumbnail((tile - 16, tile - 16))
    x, y = (i % cols) * tile + 8, (i // cols) * (tile + 24) + 8
    sheet.paste(im, (x, y), im)
    d.text((x, y + tile - 12), f.name, fill=(43, 43, 43))
sheet.save(dst)
print(dst, sheet.size, len(files), "images")
```

- [ ] **Step 6: Verify the scripts on an existing asset and commit**

```bash
python scripts/companions/cutout.py apps/mobile/assets/companions/generated/panda.webp C:/Users/khana/AppData/Local/Temp/claude/scratch-cutout-test.webp
python scripts/companions/sheet.py apps/mobile/assets/companions/generated C:/Users/khana/AppData/Local/Temp/claude/scratch-sheet-test.png
```
Expected: both print a result line, no traceback (the first is only a smoke test: the old cutout has transparency, so the matte sees the transparent ground as "content"; it must not crash). Then:
```bash
git add scripts/companions
git commit -m "chore(companions): painterly recipe, pose list, manifest, cutout + contact-sheet scripts

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2 (CONTROLLER): Reference renders — six animals

- [ ] **Step 1:** Build six prompts from `recipe.md` (base + identity line + `idle` pose line + negatives). Submit one `generate_image_batch` with indices 1–6 (`nano_banana`, `1:1`).
- [ ] **Step 2:** `jobs_wait`, download each PNG to `scratchpad/companions/ref/<Animal>.png`, run `sheet.py` on that folder, view the sheet.
- [ ] **Step 3:** Accept or reject per the recipe's acceptance list. Reject → regenerate that animal (same prompt, new seed) up to twice. Record every render in `manifest.json` (`role: reference`).
- [ ] **Step 4:** Commit the manifest: `git commit -m "chore(companions): reference renders accepted (6 animals)"` with the trailer. (PNGs stay in the scratchpad and `docs/mascot-candidates/companions-2026-09/` — see Task 5.)

### Task 3 (CONTROLLER): Pose renders — 36 + 2 extras, reference-locked

- [ ] **Step 1:** For each accepted reference, build the six pose prompts (base with the pose line, "same character … only the pose changes", negatives) and submit in batches of ≤12 with `medias: [{ role: "image_references", value: <reference job_id> }]`. Panda additionally gets `coffee` and `shield`.
- [ ] **Step 2:** Download to `scratchpad/companions/<Animal>/<pose>.png`; one contact sheet per animal; review identity consistency and pose readability.
- [ ] **Step 3:** Redo rejects (same reference), max 8 total. Record all in the manifest with status.
- [ ] **Step 4:** Commit the manifest: `git commit -m "chore(companions): pose renders accepted (36 + 2 panda extras)"`.

---

### Task 4: Cutouts, registry, `Companion` pose prop, `Panda` adapter

**Files:** Create `apps/mobile/assets/companions/generated/<Animal>/<pose>.webp` (44), rewrite `apps/mobile/assets/companions/generated/index.ts`, modify `apps/mobile/components/art/Companion.tsx`, rewrite `apps/mobile/components/art/Panda.tsx`, create `apps/mobile/lib/useCompanionAnimal.ts`, delete `apps/mobile/assets/companions/generated/panda-poses/` and the six old `<animal>.webp` files.

- [ ] **Step 1: Cut every accepted render** (controller hands the implementer the scratchpad folder path):

```bash
for A in Panda Elephant Fox Turtle Deer Owl; do
  for P in idle greet joy comfort curious sleepy; do
    python scripts/companions/cutout.py "<scratch>/$A/$P.png" "apps/mobile/assets/companions/generated/$A/$P.webp"
  done
done
python scripts/companions/cutout.py "<scratch>/Panda/coffee.png" apps/mobile/assets/companions/generated/Panda/coffee.webp
python scripts/companions/cutout.py "<scratch>/Panda/shield.png" apps/mobile/assets/companions/generated/Panda/shield.webp
```
Expected: 38 result lines, each ≤ 60 KB. Review `python scripts/companions/sheet.py apps/mobile/assets/companions/generated/Panda <scratch>/panda-cutouts.png` for matte quality (no oat halo, no eaten fur); if a cutout has a halo, re-run it with `--pad 0.06` and a tighter `soft` (edit the constant, e.g. 26) and report.

- [ ] **Step 2: Rewrite `apps/mobile/assets/companions/generated/index.ts`**

```ts
/**
 * Painterly companion set (DECISIONS §K.8, 2026-09-05): six animals × six poses (+ two
 * panda extras), generated on Higgsfield from one locked recipe with a reference image
 * per animal (scripts/companions/recipe.md, manifest.json), cut out locally by
 * scripts/companions/cutout.py, packed as ~40KB 512px RGBA WebP.
 *
 * Rendered by components/art/Companion.tsx on the ReactiveCompanion rig. `idle` is
 * required for every animal; any missing pose falls back to `idle` in Companion.
 * `scale` tunes visual weight per animal (cutouts are trimmed to content).
 */
import type { ImageSourcePropType } from 'react-native';

import type { CompanionAnimal } from '@/components/art/Companions';

export type CompanionPose = 'idle' | 'greet' | 'joy' | 'comfort' | 'curious' | 'sleepy' | 'coffee' | 'shield';

export type CompanionArtSet = {
  poses: Partial<Record<CompanionPose, ImageSourcePropType>> & { idle: ImageSourcePropType };
  scale: number;
};

const six = (dir: string) => ({
  idle: require(`./${dir}/idle.webp`),
  greet: require(`./${dir}/greet.webp`),
  joy: require(`./${dir}/joy.webp`),
  comfort: require(`./${dir}/comfort.webp`),
  curious: require(`./${dir}/curious.webp`),
  sleepy: require(`./${dir}/sleepy.webp`),
});
```
**Metro cannot resolve dynamic `require` templates** — write the six requires out literally per animal instead of the `six()` helper. The final file must read:
```ts
export const COMPANION_GENERATED: Record<CompanionAnimal, CompanionArtSet> = {
  Panda: {
    poses: {
      idle: require('./Panda/idle.webp'),
      greet: require('./Panda/greet.webp'),
      joy: require('./Panda/joy.webp'),
      comfort: require('./Panda/comfort.webp'),
      curious: require('./Panda/curious.webp'),
      sleepy: require('./Panda/sleepy.webp'),
      coffee: require('./Panda/coffee.webp'),
      shield: require('./Panda/shield.webp'),
    },
    scale: 1,
  },
  Elephant: { poses: { idle: require('./Elephant/idle.webp'), greet: require('./Elephant/greet.webp'), joy: require('./Elephant/joy.webp'), comfort: require('./Elephant/comfort.webp'), curious: require('./Elephant/curious.webp'), sleepy: require('./Elephant/sleepy.webp') }, scale: 1 },
  Fox: { poses: { idle: require('./Fox/idle.webp'), greet: require('./Fox/greet.webp'), joy: require('./Fox/joy.webp'), comfort: require('./Fox/comfort.webp'), curious: require('./Fox/curious.webp'), sleepy: require('./Fox/sleepy.webp') }, scale: 1 },
  Turtle: { poses: { idle: require('./Turtle/idle.webp'), greet: require('./Turtle/greet.webp'), joy: require('./Turtle/joy.webp'), comfort: require('./Turtle/comfort.webp'), curious: require('./Turtle/curious.webp'), sleepy: require('./Turtle/sleepy.webp') }, scale: 1 },
  Deer: { poses: { idle: require('./Deer/idle.webp'), greet: require('./Deer/greet.webp'), joy: require('./Deer/joy.webp'), comfort: require('./Deer/comfort.webp'), curious: require('./Deer/curious.webp'), sleepy: require('./Deer/sleepy.webp') }, scale: 1 },
  Owl: { poses: { idle: require('./Owl/idle.webp'), greet: require('./Owl/greet.webp'), joy: require('./Owl/joy.webp'), comfort: require('./Owl/comfort.webp'), curious: require('./Owl/curious.webp'), sleepy: require('./Owl/sleepy.webp') }, scale: 1 },
};
```
(delete the `six` helper and the `CompanionArtSet` sketch above it; keep the doc comment and the two type exports).

- [ ] **Step 3: `apps/mobile/lib/useCompanionAnimal.ts`**

```ts
import { useEffect, useState } from 'react';

import type { CompanionAnimal } from '@/components/art/Companions';
import { getCompanionAnimal } from '@/lib/session';

/** The stored growth-companion animal (null until read / when none chosen). Read once per mount —
 * the choice only changes on the companion step, which remounts everything after it. */
export function useCompanionAnimal(): CompanionAnimal | null {
  const [animal, setAnimal] = useState<CompanionAnimal | null>(null);
  useEffect(() => {
    let active = true;
    void getCompanionAnimal().then((a) => {
      if (active) setAnimal((a as CompanionAnimal | null) ?? null);
    });
    return () => {
      active = false;
    };
  }, []);
  return animal;
}
```

- [ ] **Step 4: `apps/mobile/components/art/Companion.tsx` — pose prop + crossfade.** Replace the file with:

```tsx
/**
 * Companion — THE single entry point for rendering the growth companion anywhere.
 * Asset strategy is hidden inside (DECISIONS §I.4 amended, §K.8): the painterly
 * generated set (assets/companions/generated, six animals × poses) on the in-house
 * ReactiveCompanion rig is the default; a Lottie file from assets/companions/registry.ts
 * overrides per-animal when dropped in; Fluent Emoji art remains the fallback.
 *
 * Pose: explicit via `pose`, else derived from the rig trigger while it plays
 * (greet/joy/celebrate/comfort/curious), else `sleepy` in the sleepy hour, else `idle`.
 * Pose changes crossfade (opacity only); reduced motion swaps instantly.
 */
import LottieView from 'lottie-react-native';
import { useEffect, useRef, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { SvgXml } from 'react-native-svg';

import { COMPANION_FLUENT } from '@/assets/companions/fluent';
import { COMPANION_GENERATED, type CompanionPose } from '@/assets/companions/generated';
import { COMPANION_LOTTIE } from '@/assets/companions/registry';
import { type CompanionAnimal } from '@/components/art/Companions';
import { ReactiveCompanion, type CompanionTrigger } from '@/components/art/ReactiveCompanion';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { character, duration, easing } from '@/theme/motion';

export type { CompanionPose, CompanionTrigger };

const TRIGGER_POSE: Record<NonNullable<CompanionTrigger>['kind'], CompanionPose> = {
  greet: 'greet',
  celebrate: 'joy',
  joy: 'joy',
  comfort: 'comfort',
  curious: 'curious',
};

/** How long a trigger-driven pose stays before easing back to idle. */
const TRIGGER_HOLD_MS: Record<NonNullable<CompanionTrigger>['kind'], number> = {
  greet: character.greet.duration + 400,
  celebrate: character.celebrate.duration + 600,
  joy: character.joy.duration + 400,
  comfort: character.comfort.duration,
  curious: character.curious.duration,
};

function isSleepyHour(): boolean {
  const h = new Date().getHours();
  return h >= character.sleepy.startHour || h < character.sleepy.endHour;
}

export function Companion({
  animal,
  size = 72,
  pose,
  waveTrigger = 0,
  trigger = null,
  interactive = false,
  onPress,
}: {
  /** null = no choice yet — the panda greets as the brand guide. */
  animal: CompanionAnimal | null;
  size?: number;
  /** Explicit pose (screens that want a fixed stance). Overrides trigger/sleepy derivation. */
  pose?: CompanionPose;
  /** Kept for API compatibility; the rig's `trigger` drives the wave now. */
  waveTrigger?: number;
  trigger?: CompanionTrigger;
  interactive?: boolean;
  onPress?: () => void;
}) {
  const reduced = useReducedMotion();
  const requested = animal ?? 'Panda';
  const resolved: CompanionAnimal = requested in COMPANION_FLUENT ? requested : 'Panda';
  const lottie = COMPANION_LOTTIE[resolved];
  const set = COMPANION_GENERATED[resolved];
  const fluent = COMPANION_FLUENT[resolved];
  void waveTrigger;

  // Trigger-driven pose with a hold, then back to the resting pose.
  const [triggerPose, setTriggerPose] = useState<CompanionPose | null>(null);
  const holdRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!trigger) return;
    setTriggerPose(TRIGGER_POSE[trigger.kind]);
    if (holdRef.current) clearTimeout(holdRef.current);
    holdRef.current = setTimeout(() => setTriggerPose(null), TRIGGER_HOLD_MS[trigger.kind]);
    return () => {
      if (holdRef.current) clearTimeout(holdRef.current);
    };
  }, [trigger]);

  const resting: CompanionPose = isSleepyHour() ? 'sleepy' : 'idle';
  const wanted: CompanionPose = pose ?? triggerPose ?? resting;
  const effective: CompanionPose = set.poses[wanted] ? wanted : 'idle';

  // Crossfade between the previous and current pose (opacity only).
  const [shown, setShown] = useState<CompanionPose>(effective);
  const [previous, setPrevious] = useState<CompanionPose | null>(null);
  const fade = useSharedValue(1); // 1 = current fully visible
  useEffect(() => {
    if (effective === shown) return;
    if (reduced) {
      setShown(effective);
      setPrevious(null);
      fade.value = 1;
      return;
    }
    setPrevious(shown);
    setShown(effective);
    fade.value = 0;
    fade.value = withTiming(1, { duration: duration.base, easing: easing.settle });
    const t = setTimeout(() => setPrevious(null), duration.base + 50);
    return () => clearTimeout(t);
    // reason: `shown`/`fade` are state we set here — effective is the only trigger
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effective, reduced]);
  const currentStyle = useAnimatedStyle(() => ({ opacity: fade.value }));
  const previousStyle = useAnimatedStyle(() => ({ opacity: 1 - fade.value }));

  const box = {
    width: size * set.scale,
    height: size * set.scale,
    margin: (size - size * set.scale) / 2,
  };

  const art = lottie ? (
    <LottieView source={lottie} autoPlay={!reduced} loop={!reduced} style={{ width: size, height: size }} />
  ) : set ? (
    <View style={box}>
      {previous ? (
        <Animated.Image
          source={set.poses[previous] ?? set.poses.idle}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
          style={[StyleSheet.absoluteFill, previousStyle]}
        />
      ) : null}
      <Animated.Image
        source={set.poses[shown] ?? set.poses.idle}
        resizeMode="contain"
        accessibilityIgnoresInvertColors
        style={[StyleSheet.absoluteFill, currentStyle]}
      />
    </View>
  ) : (
    <SvgXml
      xml={fluent.xml}
      width={size * fluent.scale}
      height={size * fluent.scale}
      style={{ margin: (size - size * fluent.scale) / 2 }}
    />
  );

  return (
    <ReactiveCompanion size={size} trigger={trigger} interactive={interactive} onPress={onPress}>
      {art}
    </ReactiveCompanion>
  );
}
```
Note `Image` is imported but unused after this rewrite — remove it from the import if tsc/grep says so. `Animated.Image` is provided by Reanimated.

- [ ] **Step 5: `apps/mobile/components/art/Panda.tsx` — thin adapter** (same export name and props so the twenty call sites need no edit):

```tsx
/**
 * Panda — legacy fixed-mascot entry point, now a thin adapter: renders the USER's
 * chosen companion (DECISIONS §I.5 "the chosen animal is the star") in the pose the
 * old panda vocabulary asked for. Kept so screens written against `<Panda pose=…>`
 * need no edits; new code should call `Companion` directly.
 */
import { Companion, type CompanionPose } from '@/components/art/Companion';
import { useCompanionAnimal } from '@/lib/useCompanionAnimal';

export type PandaPose = 'wave' | 'sleep' | 'excited' | 'coffee' | 'sad' | 'shield';

/** Legacy pose → painterly pose. `coffee`/`shield` exist for the panda only; other animals
 * take the nearest emotional pose. */
const LEGACY: Record<PandaPose, { panda: CompanionPose; other: CompanionPose }> = {
  wave: { panda: 'greet', other: 'greet' },
  sleep: { panda: 'sleepy', other: 'sleepy' },
  excited: { panda: 'joy', other: 'joy' },
  sad: { panda: 'comfort', other: 'comfort' },
  coffee: { panda: 'coffee', other: 'joy' },
  shield: { panda: 'shield', other: 'comfort' },
};

export function Panda({ pose = 'wave', size = 160 }: { pose?: PandaPose; size?: number }) {
  const animal = useCompanionAnimal();
  const mapped = LEGACY[pose];
  return <Companion animal={animal} size={size} pose={animal && animal !== 'Panda' ? mapped.other : mapped.panda} />;
}
```
Delete the rest of the old file (SVG panda, `SleepingPanda`, the `PANDA_POSES` import). Then delete `apps/mobile/assets/companions/generated/panda-poses/` (folder) and the six old top-level `<animal>.webp` files (`git rm`). `grep -rn "panda-poses\|PANDA_POSES" apps/mobile` must be empty.

- [ ] **Step 6: Typecheck, size check, commit**

```bash
cd apps/mobile && npx tsc --noEmit
du -ch assets/companions/generated/*/*.webp | tail -1   # expected: well under 2.5 MB total
git add assets/companions/generated components/art/Companion.tsx components/art/Panda.tsx lib/useCompanionAnimal.ts
git commit -m "feat(companion): painterly pose set for all six animals; Companion pose crossfade; Panda adapter renders the chosen animal

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Proof, archive, docs

- [ ] **Step 1 (controller): restart Expo with `-c`** (new asset files), then reset and run `connecting-experience`, `role-fork`, `member-screens` → PASS, 0 page errors (normal + reduced). Screenshot the companion step, the ready step, a chat-options flow (`Panda pose="shield"` site), the coffee screen, and the reflection screen; confirm the user's animal appears in every one and the crossfade is not visible as a flash under reduced motion.
- [ ] **Step 2 (implementer): archive originals** — copy the accepted full-res PNGs from the scratchpad into `docs/mascot-candidates/companions-2026-09/<Animal>/<pose>.png` **only if the folder convention already exists in `docs/mascot-candidates/`** (check `ls docs/mascot-candidates`); otherwise store just the contact sheets there (six PNGs) and rely on `manifest.json` job ids for re-download. Keep the repo lean: never commit more than ~3 MB of archive.
- [ ] **Step 3 (implementer): docs** — `CLAUDE.md` Stack table "Character art" row: replace `In-house SVG rig + AI-generated webp + 2.5D Tilt3D parallax` with `In-house rig + painterly generated pose set (6 animals × 6 poses, scripts/companions/) + 2.5D Tilt3D parallax`; Repo layout `assets/companions/` line → `companions/ (generated/<Animal>/<pose>.webp painterly set + registry; fluent/ SVG fallback)`; add to **Coding conventions**: `- **Companion art**: never hand-edit a cutout — regenerate from the recipe with the animal's reference (scripts/companions/recipe.md, manifest.json), re-cut with cutout.py.` `PROGRESS.md`: session 31c entry (credits spent, accepted/rejected counts, deviations). `docs/DECISIONS.md` §K.8: one sentence that the legacy `Panda` component now renders the chosen animal (closes the §I.5 exception noted in session 30's audit).
- [ ] **Step 4: Commit** `docs: companion pipeline shipped — painterly set, Panda adapter, progress` with the trailer.

---

## Self-review against the spec (§4)

- Locked recipe + pose list + manifest → Task 1. Reference render then six poses with the reference as image input → Tasks 2–3 (`image_references`, job id as `value`). Local cutout → `cutout.py` (Task 1, used in Task 4). Registry `animal × pose` + `Companion` reads the pose for the rig state → Task 4 (`TRIGGER_POSE`, sleepy hour, explicit `pose`). Unchanged public API: `Companion` gains only an optional prop; `Panda` keeps its signature. Scarf follows the accent by tint — **deviation**: the painterly renders bake a terracotta scarf; tinting a painted scarf is not feasible without a mask layer, so the scarf is fixed terracotta for every accent (record in PROGRESS; same trade-off the old set had with indigo). Reduced motion: the still idle pose and instant swaps → Task 4. Budget: 44 + ≤8 redos ≤ 52 → Tasks 2–3. Contact-sheet acceptance before use → recipe + Tasks 2–3.
- Type consistency: `CompanionPose` defined in the registry and re-exported from `Companion`; `Panda` imports it from `Companion`; `useCompanionAnimal` returns `CompanionAnimal | null` matching `Companion`'s `animal` prop.
- Placeholders: none. The `<scratch>` folder path is supplied by the controller when dispatching Task 4 (it is a session-specific path).
