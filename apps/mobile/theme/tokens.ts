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
 * Typography. Two families (loaded in app/_layout.tsx via expo-font):
 *  - Nunito (rounded humanist sans) — body/UI and the big onboarding headlines.
 *  - Lora (serif) — hub titles, persona names, celebratory headlines
 *    ("My Chats", "Mento space ready!", "Purple Valley").
 * Each weight is its own family name (expo-google-fonts convention) — do not add
 * fontWeight next to fontFamily or Android will ignore the custom face.
 */
export const font = {
  sans: 'Nunito_400Regular',
  sansSemi: 'Nunito_600SemiBold',
  sansBold: 'Nunito_700Bold',
  sansHeavy: 'Nunito_800ExtraBold',
  serif: 'Lora_500Medium',
  serifBold: 'Lora_600SemiBold',
} as const;

export const type = {
  /** Big onboarding headlines (sans, heavy) — "A place to talk with a peer…" */
  display: { fontSize: 30, fontFamily: font.sansHeavy, lineHeight: 40 },
  /** Serif display — hub titles + celebratory headlines ("My Chats"). */
  displaySerif: { fontSize: 30, fontFamily: font.serifBold, lineHeight: 38 },
  title: { fontSize: 22, fontFamily: font.sansBold, lineHeight: 28 },
  titleSerif: { fontSize: 22, fontFamily: font.serifBold, lineHeight: 28 },
  body: { fontSize: 16, fontFamily: font.sans, lineHeight: 24 },
  bodySemi: { fontSize: 16, fontFamily: font.sansSemi, lineHeight: 24 },
  label: { fontSize: 14, fontFamily: font.sansBold, lineHeight: 20 },
  caption: { fontSize: 13, fontFamily: font.sans, lineHeight: 18, color: colors.inkMuted },
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
