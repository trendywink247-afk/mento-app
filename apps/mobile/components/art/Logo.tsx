import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

import { useTheme } from '@/theme/ThemeProvider';
import { font } from '@/theme/tokens';

/**
 * Mento logo: two people talking over a table (vector re-creation of the mockup mark —
 * one ink figure, one lavender figure, cups between them) + lowercase wordmark.
 */
export function LogoMark({ size = 72 }: { size?: number }) {
  const ink = '#1D2142';
  const lavender = '#9D94DD';
  return (
    <Svg width={size * 1.45} height={size} viewBox="0 0 116 80" accessibilityLabel="Mento — two people talking">
      {/* table */}
      <Line x1="38" y1="46" x2="78" y2="46" stroke={ink} strokeWidth="3" strokeLinecap="round" />
      <Line x1="58" y1="46" x2="58" y2="70" stroke={ink} strokeWidth="3" strokeLinecap="round" />
      <Line x1="50" y1="70" x2="66" y2="70" stroke={ink} strokeWidth="3" strokeLinecap="round" />
      {/* cups */}
      <Rect x="46" y="40" width="7" height="6" rx="1.5" fill={ink} />
      <Rect x="63" y="40" width="7" height="6" rx="1.5" fill={lavender} />
      {/* left figure (ink) — head, body leaning in, gesturing arm */}
      <Circle cx="24" cy="16" r="7.5" fill={ink} />
      <Path d="M14 64 V44 q0 -14 11 -17 q8 -2 12 6 l5 8 -3.5 2.5 -6 -8 q-2 14 -2 28 Z" fill={ink} />
      {/* left chair */}
      <Line x1="10" y1="44" x2="10" y2="72" stroke={ink} strokeWidth="3" strokeLinecap="round" />
      <Line x1="10" y1="58" x2="26" y2="58" stroke={ink} strokeWidth="3" strokeLinecap="round" />
      <Line x1="24" y1="58" x2="24" y2="72" stroke={ink} strokeWidth="3" strokeLinecap="round" />
      {/* right figure (lavender) — thoughtful, hand to chin */}
      <Circle cx="92" cy="18" r="7.5" fill={lavender} />
      <Path d="M102 64 V44 q0 -14 -11 -16 q-8 -1.5 -11 6 l-2.5 7 3.5 1.5 4 -7 q1.5 14 1.5 28 Z" fill={lavender} />
      {/* right chair */}
      <Line x1="106" y1="44" x2="106" y2="72" stroke={lavender} strokeWidth="3" strokeLinecap="round" />
      <Line x1="90" y1="58" x2="106" y2="58" stroke={lavender} strokeWidth="3" strokeLinecap="round" />
      <Line x1="92" y1="58" x2="92" y2="72" stroke={lavender} strokeWidth="3" strokeLinecap="round" />
    </Svg>
  );
}

/** Horizontal lockup: mark + lowercase "mento" wordmark (landing/age/email headers). */
export function LogoLockup({ markSize = 44 }: { markSize?: number }) {
  const { colors } = useTheme();
  return (
    <View style={styles.row}>
      <LogoMark size={markSize} />
      <Text style={[styles.wordmark, { color: colors.ink, fontSize: markSize * 0.82 }]}>mento</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  wordmark: { fontFamily: font.sansSemi, letterSpacing: 0.5 },
});
