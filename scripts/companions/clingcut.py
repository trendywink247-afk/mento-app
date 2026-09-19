"""Cling-pose cut-out: the repo's scripts/companions/cutout.py matte (imported, unmodified)
plus per-side control of the final crop so a pose's contact line lands ON an image edge.

  python clingcut.py <in.png> <out.webp> --thresh 16 [--size 1024] [--pad 0.06]
        [--clip x0,y0,x1,y1]   keep only this raw-pixel box after matting (crop off a drawn ledge / body)
        [--fill x0,y0,x1,y1]   (repeatable) paint BACKGROUND-ONLY raw boxes with the ground colour before matting
        [--flush top,bottom,left,right]  sides that get NO padding (the contact edge)
Prints the final size and the alpha bbox so contact fractions can be reported.
"""
import argparse
import importlib.util
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

CUTOUT = Path(__file__).with_name("cutout.py")  # the repo matte, imported unmodified
spec = importlib.util.spec_from_file_location("cutout", CUTOUT)
cutout = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cutout)


def box(s: str) -> tuple[int, int, int, int]:
    a = [int(v) for v in s.split(",")]
    return a[0], a[1], a[2], a[3]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--size", type=int, default=1024)
    ap.add_argument("--pad", type=float, default=0.06)
    ap.add_argument("--thresh", type=int, default=16)
    ap.add_argument("--clip", type=box)
    ap.add_argument("--fill", type=box, action="append", default=[])
    ap.add_argument("--flush", default="")
    ap.add_argument("--deshadow", type=lambda s: tuple(int(v) for v in s.split(",")), action="append", default=[])
    ap.add_argument("--shadow-depth", dest="shadow_depth", type=int, default=80)
    ap.add_argument("--shadow-hue", dest="shadow_hue", type=int, default=12)
    ap.add_argument("--shadow-box", dest="shadow_box", type=box)
    ap.add_argument("--shadow-lo", dest="shadow_lo", type=int, default=45)
    ap.add_argument("--shadow-hi", dest="shadow_hi", type=int, default=95)
    ap.add_argument("--hole", type=lambda s: tuple(int(v) for v in s.split(",")), action="append", default=[])
    a = ap.parse_args()

    im = Image.open(a.src).convert("RGBA")
    ground = cutout.ground_colour(im)
    if a.fill:
        d = ImageDraw.Draw(im)
        for b in a.fill:
            d.rectangle(b, fill=ground + (255,))
    alpha = cutout.matte(im, ground, a.thresh)
    # Enclosed background pockets (e.g. the ring between a hanging cat's arms) are not reachable
    # from the border, so cutout.py leaves them opaque. Flood the same near-ground mask from an
    # explicit seed inside the pocket and knock that region out of the alpha.
    for hx, hy in a.hole:
        rgb = im.convert("RGB")
        r, g, b = ImageChops.difference(rgb, Image.new("RGB", im.size, ground)).split()
        dist = ImageChops.lighter(ImageChops.lighter(r, g), b)
        near = dist.point(lambda v: 128 if v <= a.thresh else 0)
        if near.getpixel((hx, hy)) != 128:
            sys.exit(f"hole seed {(hx, hy)} is not near-ground")
        ImageDraw.floodfill(near, (hx, hy), 255)
        pocket = near.point(lambda v: 255 if v == 255 else 0)
        if pocket.getpixel((1, 1)) == 255:
            sys.exit("hole seed leaked to the border: not an enclosed pocket")
        pocket = pocket.filter(ImageFilter.GaussianBlur(1.2))
        alpha = ImageChops.subtract(alpha, pocket)
    # Baked ground shadow: cutout.py keeps its darker core opaque (fine under a sitting pose on oat,
    # wrong for a pose pinned to a card edge). Flood the "ground, or ground darkened at the same
    # warmth" mask (cutout.shadow_like) from a seed inside the shadow and fade that region by its
    # distance from the ground colour, so only a faint contact shade survives under the feet.
    for sx, sy in a.deshadow:
        cutout.SHADOW_DEPTH, cutout.SHADOW_HUE_TOL = a.shadow_depth, a.shadow_hue  # matte() already ran
        rgb = im.convert("RGB")
        r, g, b = ImageChops.difference(rgb, Image.new("RGB", im.size, ground)).split()
        dist = ImageChops.lighter(ImageChops.lighter(r, g), b)
        near = dist.point(lambda v: 255 if v <= a.thresh else 0)
        cand = ImageChops.lighter(near, cutout.shadow_like(rgb, ground)).point(lambda v: 128 if v else 0)
        if cand.getpixel((sx, sy)) != 128:
            sys.exit(f"deshadow seed {(sx, sy)} is not shadow-like")
        if a.shadow_box:  # never let the fade reach warm-lit fur above the feet line
            lim = Image.new("L", im.size, 0)
            ImageDraw.Draw(lim).rectangle(a.shadow_box, fill=255)
            cand = ImageChops.multiply(cand, lim).point(lambda v: 128 if v else 0)
        ImageDraw.floodfill(cand, (sx, sy), 255)
        region = cand.point(lambda v: 255 if v == 255 else 0)
        lo, hi = a.shadow_lo, a.shadow_hi
        fade = dist.point([0 if d <= lo else 255 if d >= hi else int(255 * (d - lo) / (hi - lo)) for d in range(256)])
        faded = ImageChops.darker(alpha, fade)
        region = region.filter(ImageFilter.GaussianBlur(1.2))
        alpha = Image.composite(faded, alpha, region)
        print(f"   deshadow {(sx, sy)}: region {region.point(lambda v: 255 if v > 127 else 0).histogram()[255]} px")
    out = im.copy()
    out.putalpha(alpha)
    if a.clip:
        out = out.crop(a.clip)
    bbox = out.getchannel("A").point(lambda v: 255 if v > 24 else 0).getbbox()
    if not bbox:
        sys.exit("no content")
    out = out.crop(bbox)
    pad = int(max(out.size) * a.pad)
    flush = {s for s in a.flush.split(",") if s}
    pl = 0 if "left" in flush else pad
    pr = 0 if "right" in flush else pad
    pt = 0 if "top" in flush else pad
    pb = 0 if "bottom" in flush else pad
    canvas = Image.new("RGBA", (out.width + pl + pr, out.height + pt + pb), (0, 0, 0, 0))
    canvas.paste(out, (pl, pt), out)
    scale = a.size / max(canvas.size)
    canvas = canvas.resize((round(canvas.width * scale), round(canvas.height * scale)), Image.LANCZOS)
    Path(a.dst).parent.mkdir(parents=True, exist_ok=True)
    canvas.save(a.dst, "WEBP", quality=88, method=4)
    print(f"{Path(a.src).name}: ground {ground} raw-bbox(after clip) {bbox} -> {a.dst} {canvas.size} "
          f"{Path(a.dst).stat().st_size // 1024}KB flush={sorted(flush)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
