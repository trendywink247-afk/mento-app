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
