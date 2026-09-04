import { StyleSheet, View } from 'react-native';
import Svg, { Circle, ClipPath, Defs, G, LinearGradient, Path, Stop } from 'react-native-svg';

import { useTheme } from '@/theme/ThemeProvider';
import { radius } from '@/theme/tokens';

/**
 * Anonymous persona avatar: a deterministic nature scene (mountain / lake / forest /
 * night sky) derived from the persona name. Replaces the mockups' photo landscapes —
 * licence-safe, anonymity-safe, and consistent at any size. Presence dot optional.
 */

type SceneKind = 'mountain' | 'lake' | 'forest' | 'night';

const SCENES: SceneKind[] = ['mountain', 'lake', 'forest', 'night'];

/** Persona landscapes — a small categorical set on the Clay and Sage family (not the
 * companion accent: a persona's avatar must stay stable across the viewer's theme). */
const PALETTES = [
  { sky1: '#F6D9CB', sky2: '#FBEFE4', land: '#A2533A', land2: '#C9744F' }, // terracotta dusk
  { sky1: '#DCE6DD', sky2: '#F1F5EE', land: '#467054', land2: '#7F9C86' }, // sage hills
  { sky1: '#DCE8F2', sky2: '#EEF3F7', land: '#3B6D8F', land2: '#6F95B5' }, // sky lake
  { sky1: '#4D3765', sky2: '#6B4C8C', land: '#2F2140', land2: '#3E2D55' }, // plum night
];

function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

export function PersonaAvatar({
  name,
  size = 48,
  online,
}: {
  name: string;
  size?: number;
  online?: boolean;
}) {
  const { colors } = useTheme();
  const h = hash(name || 'mento');
  const scene = SCENES[h % SCENES.length];
  const p = PALETTES[(h >>> 3) % PALETTES.length];
  const gid = `g${h % 9973}`; // unique-enough gradient id per name

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox="0 0 48 48" accessibilityLabel={`${name} avatar`}>
        <Defs>
          <LinearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={p.sky1} />
            <Stop offset="1" stopColor={p.sky2} />
          </LinearGradient>
          <ClipPath id={`c${gid}`}>
            <Circle cx="24" cy="24" r="24" />
          </ClipPath>
        </Defs>
        <G clipPath={`url(#c${gid})`}>
          <Circle cx="24" cy="24" r="24" fill={`url(#${gid})`} />
          {scene === 'mountain' && (
            <>
              <Circle cx="33" cy="14" r="5" fill="#FFF6E8" opacity={0.9} />
              <Path d="M-2 48 L14 22 L24 38 L33 26 L50 48 Z" fill={p.land2} />
              <Path d="M-2 48 L10 32 L20 44 L30 34 L50 48 Z" fill={p.land} />
            </>
          )}
          {scene === 'lake' && (
            <>
              <Circle cx="16" cy="13" r="4.5" fill="#FFF6E8" opacity={0.9} />
              <Path d="M-2 30 L12 16 L24 30 L36 18 L50 30 V48 H-2 Z" fill={p.land2} />
              <Path d="M-2 30 H50 V48 H-2 Z" fill={p.land} opacity={0.85} />
              <Path d="M8 36 h8 M26 40 h10 M14 43 h7" stroke={p.sky2} strokeWidth="1.6" strokeLinecap="round" opacity={0.7} />
            </>
          )}
          {scene === 'forest' && (
            <>
              <Path d="M10 48 V30 M24 48 V26 M38 48 V32" stroke={p.land} strokeWidth="3" />
              <Path d="M10 12 L18 30 H2 Z" fill={p.land2} />
              <Path d="M24 8 L33 28 H15 Z" fill={p.land} />
              <Path d="M38 14 L46 32 H30 Z" fill={p.land2} />
              <Path d="M-2 48 Q24 40 50 48 Z" fill={p.land} />
            </>
          )}
          {scene === 'night' && (
            <>
              <Circle cx="32" cy="13" r="6" fill="#F4EDD8" />
              <Circle cx="29.5" cy="11.5" r="5" fill={p.sky1} />
              <Circle cx="12" cy="10" r="1.2" fill="#FFF" opacity={0.9} />
              <Circle cx="20" cy="18" r="0.9" fill="#FFF" opacity={0.7} />
              <Circle cx="40" cy="24" r="1" fill="#FFF" opacity={0.8} />
              <Path d="M-2 48 L12 30 L24 42 L36 32 L50 48 Z" fill={p.land2} />
              <Path d="M-2 48 Q24 38 50 48 Z" fill={p.land} />
            </>
          )}
        </G>
      </Svg>
      {online !== undefined ? (
        <View
          style={[
            styles.dot,
            {
              width: size * 0.28,
              height: size * 0.28,
              backgroundColor: online ? colors.success : colors.warning,
              borderColor: colors.surface,
            },
          ]}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  dot: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    borderRadius: radius.pill,
    borderWidth: 2,
  },
});
