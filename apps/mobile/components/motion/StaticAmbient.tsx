/**
 * StaticAmbient — the always-first-frame background: a soft vertical SVG gradient
 * built from the theme (cream → accent tint → lavender). This is what paints during
 * cold start, and the permanent fallback wherever the Skia aurora can't run.
 * Zero new dependencies (react-native-svg is already bundled).
 */
import { StyleSheet } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { useTheme } from '@/theme/ThemeProvider';

export function StaticAmbient() {
  const { colors } = useTheme();
  return (
    <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" pointerEvents="none">
      <Defs>
        <LinearGradient id="ambient" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={colors.accentTint} />
          <Stop offset="0.45" stopColor={colors.bg} />
          <Stop offset="1" stopColor={colors.bgLavender} />
        </LinearGradient>
      </Defs>
      <Rect width="100%" height="100%" fill="url(#ambient)" />
    </Svg>
  );
}
