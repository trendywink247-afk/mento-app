"""Cut a companion render out of its flat oat ground and export a trimmed WebP.

    python scripts/companions/cutout.py <in.png> <out.webp> [--size 512] [--pad 0.06]

The renders sit on a near-uniform #F4EFE6 ground. We sample the four corners for the
actual ground colour, threshold "near-ground" pixels, then FLOOD-FILL that set from the
image border. Only the border-connected near-ground region becomes transparent â€” a cream
owl face, pale elephant skin or the panda's white fur are near the ground colour too, but
they are enclosed by the body, so a plain colour-distance matte punched holes in them
(the bug this replaced). The soft contact shadow under the character mostly reads as
ground and drops away; its darker core stays attached to the feet (invisible on the app's
oat surfaces). Edges get a short blur for anti-aliasing. Output: RGBA WebP, quality 88.
"""
import argparse
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

SHADOW_DEPTH = 80  # how far below the ground colour a contact-shadow pixel may sit
SHADOW_HUE_TOL = 12  # allowed drift of (r - b) from the ground's warmth
RAMP_HI = 70  # ground distance at which a shadow-like edge pixel is fully opaque
SHADOW_RADIUS = 11  # half-res px; the body core used to protect pale fur from the ramp


def ground_colour(im: Image.Image) -> tuple[int, int, int]:
    w, h = im.size
    pts = [(2, 2), (w - 3, 2), (2, h - 3), (w - 3, h - 3)]
    px = [im.getpixel(p)[:3] for p in pts]
    return tuple(sum(c[i] for c in px) // len(px) for i in range(3))  # type: ignore[return-value]


def shadow_like(rgb: Image.Image, ground: tuple[int, int, int]) -> Image.Image:
    """Binary mask of pixels that read as the ground colour darkened (same warmth).
    Covers the baked contact shadow — but also pale fur/skin in shade, so it is never
    used alone; see `matte`."""
    gr, gg, gb = ground
    r0, g0, b0 = rgb.split()
    ok_r = r0.point(lambda v: 255 if gr - SHADOW_DEPTH <= v <= gr + 2 else 0)
    ok_g = g0.point(lambda v: 255 if gg - SHADOW_DEPTH <= v <= gg + 2 else 0)
    ok_b = b0.point(lambda v: 255 if gb - SHADOW_DEPTH <= v <= gb + 2 else 0)
    warm = ImageChops.subtract(r0, b0, scale=1, offset=128).point(  # (r - b) + 128
        lambda v: 255 if abs(v - 128 - (gr - gb)) <= SHADOW_HUE_TOL else 0
    )
    return ImageChops.multiply(ImageChops.multiply(ok_r, ok_g), ImageChops.multiply(ok_b, warm))


def matte(im: Image.Image, ground: tuple[int, int, int], thresh: int = 30) -> Image.Image:
    """Alpha 255 everywhere except (a) the border-connected region within `thresh` of the
    ground and (b) shadow-like pixels near the silhouette, which fade by ground distance (soft shadow)."""
    rgb = im.convert("RGB")
    flat = Image.new("RGB", im.size, ground)
    r, g, b = ImageChops.difference(rgb, flat).split()
    dist = ImageChops.lighter(ImageChops.lighter(r, g), b)  # max per-channel distance
    # 128 = near-ground candidate, 0 = clearly character. Flood turns connected 128s into 255.
    near = dist.point(lambda d: 128 if d <= thresh else 0)
    w, h = near.size
    seeds = [(1, 1), (w - 2, 1), (1, h - 2), (w - 2, h - 2), (w // 2, 1), (w // 2, h - 2), (1, h // 2), (w - 2, h // 2)]
    for s in seeds:
        if near.getpixel(s) == 128:
            ImageDraw.floodfill(near, s, 128 + 127)
    body = near.point(lambda v: 0 if v == 255 else 255)  # character + its baked shadow
    # The baked contact shadow is a fat, warm, pale ellipse — the same description fits the
    # panda's shaded belly or a light-rimmed elephant ear, so no colour or shape rule can
    # delete it safely. Instead: shadow-like pixels that sit outside the opened body core
    # (i.e. near the silhouette) get alpha ramped by their distance from the ground colour.
    # The shadow (dist ~30-55) becomes a soft translucent contact shadow; a pale belly edge
    # only gets a couple of px of extra feathering; everything inside the core stays opaque.
    k = 2 * (SHADOW_RADIUS // 2) + 1
    small = body.resize((w // 2, h // 2), Image.BOX).point(lambda v: 255 if v > 127 else 0)
    core = small.filter(ImageFilter.MinFilter(k)).filter(ImageFilter.MaxFilter(k)).filter(ImageFilter.MaxFilter(5))
    core = core.resize((w, h), Image.NEAREST)
    keep = ImageChops.lighter(core, ImageChops.invert(shadow_like(rgb, ground)))
    lo, hi = thresh, RAMP_HI
    ramp = dist.point([0 if d <= lo else 255 if d >= hi else int(255 * (d - lo) / (hi - lo)) for d in range(256)])
    alpha = ImageChops.multiply(body, Image.composite(Image.new("L", (w, h), 255), ramp, keep))
    # Drop specks the flood could not reach through (stray near-ground noise on the ground).
    alpha = alpha.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(3))
    return alpha.filter(ImageFilter.GaussianBlur(1.2))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--size", type=int, default=512)
    ap.add_argument("--pad", type=float, default=0.06)
    ap.add_argument("--thresh", type=int, default=30)
    a = ap.parse_args()

    im = Image.open(a.src).convert("RGBA")
    ground = ground_colour(im)
    alpha = matte(im, ground, a.thresh)
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
    canvas.save(a.dst, "WEBP", quality=88, method=4)
    print(f"{Path(a.src).name}: ground {ground} -> {a.dst} {canvas.size} {Path(a.dst).stat().st_size // 1024}KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
