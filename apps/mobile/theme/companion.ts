/**
 * Growth-companion COLOUR → accent token set (DECISIONS §B.6: the companion colour is
 * a per-user theme layered over the neutral light base; it is NOT the chat handle).
 *
 * Each accent is chosen so white text on it meets WCAG AA (~4.5:1) for the CTA labels.
 * Mirrors the colour swatches in mockup #58 (Purple/Blue/Green/Pink/Orange/Teal/Indigo).
 */
export type CompanionColor =
  | 'purple'
  | 'blue'
  | 'green'
  | 'pink'
  | 'orange'
  | 'teal'
  | 'indigo';

export type AccentSet = {
  accent: string;
  accentPress: string;
  accentTint: string;
  onAccent: string;
};

export const COMPANION_COLORS: Record<CompanionColor, AccentSet> = {
  // Purple is calibrated against the mockup CTA/swatch pixels (scripts/sample_mockup_colors.py).
  purple: { accent: '#5847D6', accentPress: '#4736B8', accentTint: '#ECE6F8', onAccent: '#FFFFFF' },
  blue: { accent: '#2657C7', accentPress: '#1F49A8', accentTint: '#E4ECFE', onAccent: '#FFFFFF' },
  green: { accent: '#0B7A4F', accentPress: '#096540', accentTint: '#DCF1E7', onAccent: '#FFFFFF' },
  pink: { accent: '#C13B72', accentPress: '#A6315F', accentTint: '#FBE6EF', onAccent: '#FFFFFF' },
  orange: { accent: '#B85C12', accentPress: '#9C4D0E', accentTint: '#FBE9D8', onAccent: '#FFFFFF' },
  teal: { accent: '#0C7B7B', accentPress: '#096666', accentTint: '#DCF0F0', onAccent: '#FFFFFF' },
  indigo: { accent: '#4338CA', accentPress: '#372EA8', accentTint: '#E6E4FA', onAccent: '#FFFFFF' },
};

export const DEFAULT_COMPANION_COLOR: CompanionColor = 'purple';

export const COMPANION_COLOR_LABELS: Record<CompanionColor, string> = {
  purple: 'Purple',
  blue: 'Blue',
  green: 'Green',
  pink: 'Pink',
  orange: 'Orange',
  teal: 'Teal',
  indigo: 'Indigo',
};

export function accentFor(color: CompanionColor | string | null | undefined): AccentSet {
  if (color && color in COMPANION_COLORS) return COMPANION_COLORS[color as CompanionColor];
  return COMPANION_COLORS[DEFAULT_COMPANION_COLOR];
}
