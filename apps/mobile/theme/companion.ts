/**
 * Growth-companion COLOUR → accent token set (DECISIONS §B.6: the companion colour is
 * a per-user theme layered over the neutral light base; it is NOT the chat handle).
 *
 * Clay and Sage family (DECISIONS §K.5/§K.8). Every `accent` passes WCAG AA (≥4.5:1)
 * with white text AND as text on the oat ground; `accentEdge` is the pillow-key
 * underside; `accentTint` is the pale surface (ink text on it ≥10:1).
 * Verified by scripts/contrast_gate.py — run it after changing any value.
 */
export type CompanionColor =
  | 'terracotta'
  | 'sage'
  | 'sky'
  | 'rose'
  | 'mustard'
  | 'plum'
  | 'teal';

export type AccentSet = {
  accent: string;
  accentPress: string;
  accentEdge: string;
  accentTint: string;
  onAccent: string;
  /** The underside of an accent-TINT key (board: the accent mixed 60% toward white). */
  accentTintEdge: string;
};

export const COMPANION_COLORS: Record<CompanionColor, AccentSet> = {
  terracotta: { accent: '#A2533A', accentPress: '#984E33', accentEdge: '#7E3F2B', accentTint: '#F6D9CB', onAccent: '#FFFFFF', accentTintEdge: '#DABAB0' },
  sage: { accent: '#467054', accentPress: '#3F6549', accentEdge: '#33513C', accentTint: '#DCE6DD', onAccent: '#FFFFFF', accentTintEdge: '#B5C6BB' },
  sky: { accent: '#3B6D8F', accentPress: '#356282', accentEdge: '#2A4F69', accentTint: '#DCE8F2', onAccent: '#FFFFFF', accentTintEdge: '#B1C5D2' },
  rose: { accent: '#A24C61', accentPress: '#9A485C', accentEdge: '#7D3A4A', accentTint: '#F5DFE4', onAccent: '#FFFFFF', accentTintEdge: '#DAB7C0' },
  mustard: { accent: '#895F17', accentPress: '#825A16', accentEdge: '#674711', accentTint: '#F5E8C4', onAccent: '#FFFFFF', accentTintEdge: '#D0BFA2' },
  plum: { accent: '#6B4C8C', accentPress: '#61457F', accentEdge: '#4D3765', accentTint: '#E8DFF0', onAccent: '#FFFFFF', accentTintEdge: '#C4B7D1' },
  teal: { accent: '#286F6B', accentPress: '#246561', accentEdge: '#1C4F4C', accentTint: '#D8ECEA', onAccent: '#FFFFFF', accentTintEdge: '#A9C5C4' },
};

export const DEFAULT_COMPANION_COLOR: CompanionColor = 'terracotta';

export const COMPANION_COLOR_LABELS: Record<CompanionColor, string> = {
  terracotta: 'Terracotta',
  sage: 'Sage',
  sky: 'Sky',
  rose: 'Rose',
  mustard: 'Mustard',
  plum: 'Plum',
  teal: 'Teal',
};

export function accentFor(color: CompanionColor | string | null | undefined): AccentSet {
  if (color && color in COMPANION_COLORS) return COMPANION_COLORS[color as CompanionColor];
  return COMPANION_COLORS[DEFAULT_COMPANION_COLOR];
}
