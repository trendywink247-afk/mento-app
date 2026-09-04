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
