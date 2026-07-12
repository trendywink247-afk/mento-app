import { useId } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';

import { useTheme } from '@/theme/ThemeProvider';
import { font } from '@/theme/tokens';

/**
 * Mento logo: a chat bubble holding a heart — "talking that cares" in one glyph.
 * Indigo→lavender gradient (brand tokens by VALUE — SVG gradients can't consume
 * useTheme, and the mark must not re-tint with the user accent; it's the brand).
 * Chosen 2026-07-13 (founder-approved "enhance modestly"; concept B of four —
 * see docs/superpowers/specs/2026-07-13-landing-enhance-design.md).
 */
export function LogoMark({ size = 72 }: { size?: number }) {
  // Unique per instance: multiple lockups can be in the DOM at once (the journey
  // keeps prior screens mounted), and duplicate SVG gradient ids break url(#…)
  // resolution on web. Colons from useId are invalid inside url() refs.
  const gradientId = `mento-mark-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <Svg width={size} height={size} viewBox="0 0 48 56" accessibilityLabel="Mento">
      <Defs>
        <LinearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#5847D6" />
          <Stop offset="1" stopColor="#8177C9" />
        </LinearGradient>
      </Defs>
      {/* bubble with a soft tail, bottom-left */}
      <Path
        d="M24 2 C10.7 2 0 11.8 0 24 C0 36.2 10.7 46 24 46 L27 46 L23 54 L34 47 C44.5 43.9 48 34.7 48 24 C48 11.8 37.3 2 24 2 Z"
        fill={`url(#${gradientId})`}
      />
      {/* heart, slightly above optical center */}
      <Path
        d="M24 33 C22 31 14 26.5 14 20.7 C14 17 17 14.4 20.2 14.4 C22 14.4 23.3 15.3 24 16.4 C24.7 15.3 26 14.4 27.8 14.4 C31 14.4 34 17 34 20.7 C34 26.5 26 31 24 33 Z"
        fill="#FFFFFF"
      />
    </Svg>
  );
}

/** Horizontal lockup: mark + lowercase "mento" wordmark (landing/age/email headers). */
export function LogoLockup({ markSize = 44 }: { markSize?: number }) {
  const { colors } = useTheme();
  return (
    <View style={styles.row}>
      <LogoMark size={markSize} />
      <Text style={[styles.wordmark, { color: colors.ink, fontSize: markSize * 0.78 }]}>mento</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  wordmark: { fontFamily: font.serifBold, letterSpacing: 0.25 },
});
