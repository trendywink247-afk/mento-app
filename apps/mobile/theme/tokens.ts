/**
 * Mento design tokens — single source of truth for colour, spacing, radius, typography,
 * and elevation, consumed by BOTH web and native (react-native + react-native-web).
 * Light-mode v1 only (indigo/lavender from the approved mockups + CLAUDE.md). Components
 * consume these — never raw hex.
 *
 * The user's growth-companion COLOUR is layered on top as a per-user *accent* (see
 * theme/companion.ts + ThemeProvider). `brand*` below is the DEFAULT accent (purple);
 * at runtime, accent colours come from useTheme() so they reflect the chosen companion.
 */
export const colors = {
  // Neutral light base (fixed, never themed)
  bg: '#F6F4FB',
  surface: '#FFFFFF',
  surfaceAlt: '#EFEBFA',
  ink: '#1E1B39',
  inkMuted: '#6B6880',
  border: '#E6E2F2',
  onBrand: '#FFFFFF',
  scrim: 'rgba(30,27,57,0.4)', // modal/sheet backdrop

  // Default accent (purple companion). Prefer useTheme().colors.accent in components.
  brand: '#5B4FE3',
  brandPress: '#4A3FC9',
  brandTint: '#ECE9FD',

  // Semantic (fixed)
  accentWarm: '#F2A65A',
  success: '#3FB97A',
  warning: '#E6A23C',
  danger: '#E5534B',
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

/**
 * Elevation as RN shadow style objects (react-native-web maps these to box-shadow,
 * Android uses `elevation`). Use sparingly — the mockups favour soft, low shadows.
 */
export const elevation = {
  none: {},
  sm: {
    shadowColor: '#1E1B39',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  md: {
    shadowColor: '#1E1B39',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 18,
    elevation: 6,
  },
  lg: {
    shadowColor: '#1E1B39',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 12,
  },
} as const;

export const theme = { colors, space, radius, type, elevation };
export type Theme = typeof theme;
