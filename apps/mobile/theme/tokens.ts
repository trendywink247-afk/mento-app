/**
 * Mento design tokens — single source of truth for colour, spacing, radius, typography,
 * and elevation, consumed by BOTH web and native (react-native + react-native-web).
 * Light-mode v1 only. Components consume these — never raw hex.
 *
 * Colour values are CALIBRATED against the mockup pixels (docs/Mockups) via
 * scripts/sample_mockup_colors.py — see the sample labels referenced in comments.
 *
 * The user's growth-companion COLOUR is layered on top as a per-user *accent* (see
 * theme/companion.ts + ThemeProvider). `brand*` below is the DEFAULT accent (purple);
 * at runtime, accent colours come from useTheme() so they reflect the chosen companion.
 */
export const colors = {
  // Neutral light base (fixed, never themed)
  bg: '#FDF8F5', // warm cream — landing/age/email/connecting/mentors bg (≈#FDF8F5)
  bgLavender: '#F6F2FA', // "ritual" screens: companion picker, reflection, coffee, PIN
  surface: '#FFFFFF',
  surfaceAlt: '#F3EFFA',
  ink: '#1D2142', // headline + navy CTA (sampled #1C213F–#1D2242)
  inkMuted: '#6E6B84',
  border: '#EDE7F0',
  onBrand: '#FFFFFF',
  scrim: 'rgba(29,33,66,0.4)', // modal/sheet backdrop

  // Default accent (purple companion). Prefer useTheme().colors.accent in components.
  brand: '#5847D6', // companion CTA core #4C34C3 / swatch #6148D8
  brandPress: '#4736B8',
  brandTint: '#ECE6F8', // sent-bubble tint (sampled #ECE6F5)

  /** Soft brand lavender — headline accent words ("understands.", "anonymous.") and
   * illustration washes. Fixed (not the companion accent); sampled #7E79AF–#827BCB. */
  accentSoft: '#8177C9',

  // Semantic (fixed)
  accentWarm: '#F2A65A',
  success: '#3FB97A',
  warning: '#E6A23C',
  danger: '#E5534B',
} as const;

/**
 * Pastel icon washes for IconBadge (sampled from the Conversation Options sheet's
 * tinted icon circles). Fixed — not themed by the companion accent.
 */
export const wash = {
  accent: '#EFE9F8',
  indigo: '#E6E7F8',
  orange: '#FBEEDC',
  green: '#E2F0E6',
  danger: '#FBE7E6',
} as const;
export type Wash = keyof typeof wash;

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

/**
 * Typography — ONE family, Baloo 2 (DECISIONS §K.6), loaded in app/_layout.tsx.
 * Each weight is its own family name (expo-google-fonts convention) — never add
 * fontWeight next to fontFamily or Android ignores the custom face.
 * `serif*` / `devanagari*` names are kept so no call site changes; they now map to
 * Baloo weights (renaming to display- and hindi-prefixed names is a follow-up).
 */
export const font = {
  sans: 'Baloo2_400Regular',
  sansSemi: 'Baloo2_600SemiBold',
  sansBold: 'Baloo2_700Bold',
  sansHeavy: 'Baloo2_800ExtraBold',
  serif: 'Baloo2_600SemiBold',
  serifBold: 'Baloo2_700Bold',
  devanagari: 'Baloo2_400Regular',
  devanagariBold: 'Baloo2_700Bold',
} as const;

export const type = {
  /** Big onboarding headlines (sans, heavy) — "A place to talk with a peer…" */
  display: { fontSize: 30, fontFamily: font.sansHeavy, lineHeight: 40 },
  /** Serif display — hub titles + celebratory headlines ("My Chats"). */
  displaySerif: { fontSize: 30, fontFamily: font.serifBold, lineHeight: 40 },
  /** Onboarding / Mentor Home headlines — replaces the per-step hand-rolled 28–30px styles. */
  displayHeadline: { fontSize: 28, fontFamily: font.sansHeavy, lineHeight: 36 },
  title: { fontSize: 22, fontFamily: font.sansBold, lineHeight: 28 },
  titleSerif: { fontSize: 22, fontFamily: font.serifBold, lineHeight: 28 },
  body: { fontSize: 16, fontFamily: font.sans, lineHeight: 24 },
  bodySemi: { fontSize: 16, fontFamily: font.sansSemi, lineHeight: 24 },
  label: { fontSize: 14, fontFamily: font.sansBold, lineHeight: 20 },
  caption: { fontSize: 13, fontFamily: font.sans, lineHeight: 18, color: colors.inkMuted },
  /** Section headings on the web-only console surfaces (listener console, admin cockpit). */
  titleSmSerif: { fontSize: 20, fontFamily: font.serifBold, lineHeight: 26 },
  /** Big cockpit stat numerals (admin overview tiles) — pair with tabular-nums. */
  stat: { fontSize: 26, fontFamily: font.serifBold, lineHeight: 32 },
} as const;

/**
 * Elevation as RN shadow style objects (react-native-web maps these to box-shadow,
 * Android uses `elevation`). Use sparingly — the mockups favour soft, low shadows
 * on borderless cards.
 */
export const elevation = {
  none: {},
  sm: {
    shadowColor: '#1D2142',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  md: {
    shadowColor: '#1D2142',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 18,
    elevation: 6,
  },
  lg: {
    shadowColor: '#1D2142',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 12,
  },
} as const;

export const theme = { colors, wash, space, radius, type, elevation, font };
export type Theme = typeof theme;
