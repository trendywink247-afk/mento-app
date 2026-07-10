/**
 * Tiny colour math for shader uniforms: hex → [r,g,b,a] in 0..1, and mixing.
 * Kept dependency-free; used by the ambient aurora to derive pastel blob colours
 * from the companion accent set.
 */
export type Rgba = [number, number, number, number];

export function hexToRgba01(hex: string): Rgba {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
}

export function mixRgba(a: Rgba, b: Rgba, t: number): Rgba {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
    1,
  ];
}

/** mix two hex colours in linear-ish RGB and return the 0..1 vec4. */
export function mixHex01(a: string, b: string, t: number): Rgba {
  return mixRgba(hexToRgba01(a), hexToRgba01(b), t);
}
