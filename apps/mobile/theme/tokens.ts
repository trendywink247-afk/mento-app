/**
 * Mento design tokens — single source of truth for colour, spacing, radius, typography,
 * and elevation, consumed by BOTH web and native (react-native + react-native-web).
 * Light-mode v1 only. Components consume these — never raw hex.
 *
 * Values follow DECISIONS §K.5 (Clay and Sage) and pass scripts/contrast_gate.py.
 *
 * The user's growth-companion COLOUR is layered on top as a per-user *accent* (see
 * theme/companion.ts + ThemeProvider). `brand*` below is the DEFAULT accent (terracotta);
 * at runtime, accent colours come from useTheme() so they reflect the chosen companion.
 */
export const colors = {
  // Neutral light base (fixed, never themed) — Clay and Sage (DECISIONS §K.5)
  bg: '#F4EFE6', // oat ground
  bgLavender: '#EFE9DF', // "ritual" screens keep a slightly deeper oat (companion picker, reflection, coffee, PIN)
  surface: '#FFFFFF',
  surfaceAlt: '#FBF8F2',
  ink: '#2B2B2B', // charcoal
  inkMuted: '#6B675F', // darkened from #6E6A64 to clear 4.5:1 on bgLavender too
  border: '#E6DFD3',
  onBrand: '#FFFFFF',
  scrim: 'rgba(43,43,43,0.4)',
  /** Under a board sheet (FINAL_SPEC: 0.35 over a screen settled back to 0.96). */
  scrimSheet: 'rgba(43,43,43,0.35)',
  /** The sheet's grab handle. Decorative. */
  handle: '#D9D1C2',

  /** Pillow-key edges (DECISIONS §K.8): the darker "underside" drawn beneath a face. */
  edgeSurface: '#E3DCCF', // under white / oat faces
  edgeAlt: '#D9D1C2', // under surfaceAlt faces
  edgeInk: '#141414', // under ink-toned pills

  /** Decorative, never text (board port 2026-09-19): an unlit step dot, and the dashed
   * rim of an orb that is still waiting for someone. */
  dotIdle: '#CFC6B5',
  dashIdle: '#B9AF9C',

  // Default accent (terracotta companion). Prefer useTheme().colors.accent in components.
  brand: '#A2533A',
  brandPress: '#984E33',
  brandTint: '#F6D9CB',

  /** Light clay terracotta — display accent words and decorative icon tints only
   * (3.0:1 on oat = large text only, never body copy). */
  accentSoft: '#C9744F',

  // Semantic (fixed) — each passes 4.5:1 on white and on oat as text.
  accentWarm: '#8F6318',
  success: '#38734B',
  warning: '#895F17', // darkened 4% from #8F6318 to clear 4.5:1 on bgLavender too
  danger: '#B8413A',

  /** Board port, inside a conversation (A05 / A20 / A21 / A22). `borderStrong` rims the
   * deeper-oat crisis card and the held send key; `held*` is the send key while the
   * allowance asks for a pause — quiet, never red (decorative glyph, not text);
   * `successWashBorder` rims the "Saved" chip; the danger-wash trio is the "End and wipe"
   * key (ink on wash.danger = 6.6:1). `scrimSheet` (defined above) is the board's 0.35 sheet scrim. */
  borderStrong: '#DDD4C4',
  heldFace: '#EAE3D6',
  heldInk: '#857E72',
  successWashBorder: '#BFD2C3',
  dangerWashBorder: '#EBC3BF',
  dangerWashEdge: '#E2B2AD',
  dangerInk: '#8E2F2A',
} as const;

/** Pastel clay washes for IconBadge — fixed, not themed by the companion accent. */
export const wash = {
  accent: '#F6D9CB',
  indigo: '#E8DFF0',
  orange: '#F5E8C4',
  green: '#DCE6DD',
  danger: '#F8DEDC',
  /** Board port (mentor side): the sky wash behind the safety shield. */
  sky: '#DCE8F2',
} as const;
export type Wash = keyof typeof wash;

/** Pillow undersides for wash faces (decorative, never text). Only the ones in use. */
export const washEdge = {
  green: '#C3D2C5',
} as const;

/** Text ON a wash (state chips: Active / Waiting, a door's icon) — each ≥ 4.5:1 on its wash. */
export const washInk = {
  green: '#2C5C3C',
  orange: '#674711',
  /** The deep clay red: text on the danger wash, the face of a destructive key (white
   * text on it 8.6:1), and `dangerKeyEdge` beneath it. */
  danger: '#8E2F2A',
} as const;

/** Pillow underside of a destructive key (board A32). Decorative. */
export const dangerKeyEdge = '#6B2320';

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
  /** A board sheet's top corners. */
  xl: 28,
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
  displaySerif: { fontSize: 30, fontFamily: font.serifBold, lineHeight: 42 },
  /** The landing's three-line hero headline (board A01). */
  displayHero: { fontSize: 34, fontFamily: font.sansHeavy, lineHeight: 44 },
  /** Onboarding / Mentor Home headlines — replaces the per-step hand-rolled 28–30px styles. */
  displayHeadline: { fontSize: 28, fontFamily: font.sansHeavy, lineHeight: 40 },
  title: { fontSize: 22, fontFamily: font.sansBold, lineHeight: 28 },
  titleSerif: { fontSize: 22, fontFamily: font.serifBold, lineHeight: 28 },
  body: { fontSize: 16, fontFamily: font.sans, lineHeight: 24 },
  bodySemi: { fontSize: 16, fontFamily: font.sansSemi, lineHeight: 24 },
  label: { fontSize: 14, fontFamily: font.sansBold, lineHeight: 20 },
  /** Pillow-key labels on the board's 56–58px keys. */
  key: { fontSize: 18, fontFamily: font.sansBold, lineHeight: 24 },
  keyDense: { fontSize: 16, fontFamily: font.sansBold, lineHeight: 24 },
  /** Row / card titles (promise rows, wait cards) and their quiet second line. */
  rowTitle: { fontSize: 15, fontFamily: font.sansBold, lineHeight: 20 },
  /** A door's / card's second line (board 15/21). */
  bodySmall: { fontSize: 15, fontFamily: font.sans, lineHeight: 21 },
  note: { fontSize: 14, fontFamily: font.sans, lineHeight: 20 },
  caption: { fontSize: 13, fontFamily: font.sans, lineHeight: 18, color: colors.inkMuted },
  /** Board small print: a row's second line, a time, a state chip, a badge. */
  micro: { fontSize: 12, fontFamily: font.sans, lineHeight: 16 },
  chip: { fontSize: 11, fontFamily: font.sansBold, lineHeight: 14 },
  /** A deeper page's title (board A25 "Mentors") and a sheet's title. */
  pageTitle: { fontSize: 26, fontFamily: font.sansHeavy, lineHeight: 32 },
  sheetTitle: { fontSize: 24, fontFamily: font.sansHeavy, lineHeight: 32 },
  /** Section headings on the web-only console surfaces (listener console, admin cockpit). */
  titleSmSerif: { fontSize: 20, fontFamily: font.serifBold, lineHeight: 26 },
  /** Big cockpit stat numerals (admin overview tiles) — pair with tabular-nums. */
  stat: { fontSize: 26, fontFamily: font.serifBold, lineHeight: 32 },
  /** Board port (mentor side): the small uppercase line over a headline or a section. */
  eyebrow: { fontSize: 13, fontFamily: font.sansBold, lineHeight: 18, letterSpacing: 0.5, textTransform: 'uppercase' },
  /** A card row's title on the mentor side (board 16/22 bold). */
  cardTitle: { fontSize: 16, fontFamily: font.sansBold, lineHeight: 22 },
} as const;

/**
 * Shadows are now reserved for FLOATING layers (tab bar, sheets, FAB). Cards and
 * buttons use the pillow-key edge (components/motion/PressKey.tsx,
 * components/EdgeSurface.tsx) instead.
 */
export const elevation = {
  none: {},
  sm: {
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  md: {
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 18,
    elevation: 6,
  },
  lg: {
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 12,
  },
} as const;

export const theme = { colors, wash, space, radius, type, elevation, font };
export type Theme = typeof theme;
