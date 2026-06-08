/**
 * Light-mode design tokens (indigo / lavender). Single source of truth for colour,
 * spacing, radius, and type. Components consume these — never raw hex.
 * Mirrors CLAUDE.md → "Light-mode colour tokens". Calibrate hex against the mockups.
 */
export const colors = {
  bg: '#F6F4FB',
  surface: '#FFFFFF',
  surfaceAlt: '#EFEBFA',
  ink: '#1E1B39',
  inkMuted: '#6B6880',
  brand: '#5B4FE3',
  brandPress: '#4A3FC9',
  brandTint: '#ECE9FD',
  accentWarm: '#F2A65A',
  success: '#3FB97A',
  warning: '#E6A23C',
  danger: '#E5534B',
  border: '#E6E2F2',
  onBrand: '#FFFFFF',
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radius = {
  sm: 8,
  md: 14,
  lg: 22,
  pill: 999,
} as const;

export const type = {
  display: { fontSize: 30, fontWeight: '700' as const, lineHeight: 36 },
  title: { fontSize: 22, fontWeight: '700' as const, lineHeight: 28 },
  body: { fontSize: 16, fontWeight: '400' as const, lineHeight: 24 },
  label: { fontSize: 14, fontWeight: '600' as const, lineHeight: 20 },
  caption: { fontSize: 13, fontWeight: '400' as const, lineHeight: 18, color: colors.inkMuted },
} as const;

export const theme = { colors, space, radius, type };
export type Theme = typeof theme;
