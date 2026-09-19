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
- Dog: "small golden-cream puppy dog with soft floppy ears, a white chest patch, a round black nose and gentle dark eyes" (added 2026-09-19)
- Cat: "round grey tabby cat with soft darker stripes, a white muzzle and white chest, pink nose, big green eyes and a fluffy tail curled around its side" (added 2026-09-19)
- Capybara: "round capybara with warm chestnut-brown fur, small rounded ears, a blunt gentle muzzle and calm friendly dark eyes" (added 2026-09-19)

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

## Notes from the 2026-09-19 batch (Dog / Cat / Capybara)
- `nano_banana` holds the reference pose hard: a plain "head tilted" curious line came back as idle for
  all three. What worked: "its whole head is cocked strongly sideways toward one shoulder … an
  unmistakably curious pose clearly different from sitting upright" (+ "one front paw lifted to its chin").
- Dog drifted breed on joy/curious (upright corgi ears, jumping). Restate the identity in the pose
  prompt: "same long soft FLOPPY drooping ears … SITTING on the ground (not jumping)".
- Capybara comfort grew a leaf prop; add "paws are EMPTY: it holds nothing".
- Dog cutouts need `cutout.py --thresh 12`: the cream forehead sits within the default 30 of the
  oat ground and touches the silhouette, so the flood fill eats a hole in the head.
- The batch endpoint rate-limits (429) around the 12th concurrent render — resubmit the failed index.

## HD slim re-render (2026-09-19, founder: "cute not obese, HD")
The first Cat and Capybara sets read as obese. They were re-rendered on `nano_banana_pro` (2 credits, 2048px)
with proportions spelled out, and the Fox reference passed **for style only**:
- Cat: "very cute young grey tabby kitten: SMALL SLENDER petite body, slim waist, dainty paws, a slightly
  oversized round head with big sparkling green eyes … Healthy and light, NOT fat, NOT chubby, not a round ball."
- Capybara: "very cute baby capybara pup: SMALL compact petite body with a slim tummy, short little legs, a
  slightly oversized head … big shiny dark eyes with catchlights … lighter cream-tan chest. NOT fat, no big belly."
- Pose prompts restate the identity in one parenthesis, then "Only the pose changes: …", and end "Still slim,
  NOT fat." All ten poses were accepted first try (the pro model follows pose text far better than `nano_banana`).
- Cut with `cutout.py --size 1024 --thresh 16`. Dog was re-cut at `--size 1024 --thresh 12` from its 1024px
  renders. The original six animals are still 512px `nano_banana` art — re-rendering them on the pro model for a
  uniform HD set is ~84 credits (6 × 7 × 2) and has not been done.

## Cling poses (2026-09-19 — OPTIONAL poses, Cat only so far)
The companion now appears in a different place on every screen, holding on to the UI
(`apps/mobile/lib/companionPlacement.ts` chooses, `components/art/PerchedCompanion.tsx` draws). Sitting
(`idle`), leaning (`curious`) and napping (`sleepy`) work for all nine animals with the poses above. Three more
ways of holding on need their own art — and **only the Cat has them**. An animal without the file simply never
gets that kind of slot; adding the file + one `require` line in `assets/companions/generated/index.ts` is all it
takes to widen its range (no code change).

| Pose | File | Size | Job id | Cut flags (all `--thresh 16`, WebP q88, longest side 1024) | Contact |
|---|---|---|---|---|---|
| hang | `Cat/hang.webp` | 429×1024 | `0379a78b-c9da-4770-8256-23226c7489ab` | `--flush top --hole 983,200` | paws touch the TOP edge — image top = the furniture's bottom edge; grip centre x=0.47, body to y=0.94 |
| peek | `Cat/peek.webp` | 1024×981 | `645df71f-aac5-42bb-b599-c31e42de70f5` | `--clip 0,0,2048,1262 --fill 380,1222,522,1270 --flush bottom` | BOTTOM edge is the paw line (head + paws only) — drawn ≈44px tall |
| dangle | `Cat/dangle.webp` | 802×1024 | `a993079e-b377-4027-8dd7-bdea7d568009` | `--fill 100,1645,515,1720 --fill 1575,1645,1950,1720` | seat line at 0.84 of the height; hind feet hang to 0.945 |

- Generated on Higgsfield, requested model `nano_banana_pro` (the API labels the jobs `nano_banana_2`, same as the
  accepted HD Cat reference), 1:1, 2k, identity reference = the accepted Cat idle render
  (`b5a482c5-47c8-49fd-a74c-7131794e6044` in `manifest.json`). Raws are 2048².
- **Cut with `clingcut.py`, not `cutout.py`.** It imports `cutout.py` and calls its `ground_colour()` and
  `matte()` unchanged, and adds what a contact pose needs: `--flush top|bottom` (no padding on the contact side,
  so the contact line IS the image edge), `--clip x0,y0,x1,y1` (rectangular crop after matting — cuts off a drawn
  ledge or the body below the paws), `--fill x0,y0,x1,y1` (repeatable: paint background-only boxes with the
  sampled ground colour before matting), `--hole x,y` (knock out an enclosed background pocket, e.g. between
  the raised arms). `python scripts/companions/clingcut.py <raw.png> <out.webp> --thresh 16 <flags from the table>`.
- The contact fractions the app uses live next to the art: `contact: { hang: 0, peek: 0.979, dangle: 0.84 }` in
  `assets/companions/generated/index.ts` (fraction of the square art box, from its top). Re-measure after any re-cut.
- Wording that worked — hang: "hanging by its two front paws from the TOP EDGE OF THE PICTURE FRAME itself, like a
  kitten hanging from a chin-up bar … No bar, no branch, no rope, no shelf is drawn". Peek: "the image is CUT OFF in
  a perfectly straight horizontal line just below the paws".
- Also generated, accepted, **not shipped** (the companion no longer travels): Cat `walk`, `climb`, `stretch`.
  **Not delivered:** Cat `nap` lying along an edge (three attempts failed: ghost reference head / a second kitten) —
  `nap` slots use the existing `sleepy` pose. **The other eight animals have no cling poses yet** (the Higgsfield
  balance was ~0.5 credits after this batch): ~3 poses × 8 animals × 2 credits ≈ 48 credits on the pro model.
