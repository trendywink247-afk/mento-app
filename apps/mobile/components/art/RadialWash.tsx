/**
 * RadialWash — one soft, still pool of colour behind a screen (the boards' radial washes:
 * A23's accent tint top-left and sage glow right, A39's sky and plum). Decorative only:
 * never takes a tap, hidden from assistive tech, does not move.
 */
import { useId } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import Svg, { Defs, Ellipse, RadialGradient, Stop } from 'react-native-svg';

type Pool = {
  /** Box of the ellipse, as the board places it (left/top or right/top). */
  left?: number;
  right?: number;
  top: number;
  width: number;
  height: number;
  color: string;
  /** Centre opacity; it fades to nothing at the rim. */
  opacity?: number;
};

export function RadialWash({ pools }: { pools: Pool[] }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" aria-hidden importantForAccessibility="no-hide-descendants">
      {pools.map((p, i) => {
        const box: ViewStyle = { position: 'absolute', top: p.top, width: p.width, height: p.height };
        if (p.left !== undefined) box.left = p.left;
        if (p.right !== undefined) box.right = p.right;
        return (
          <View key={i} style={box}>
            <Svg width={p.width} height={p.height}>
              <Defs>
                <RadialGradient id={`wash${uid}${i}`} cx="50%" cy="50%" rx="50%" ry="50%">
                  <Stop offset="0" stopColor={p.color} stopOpacity={p.opacity ?? 1} />
                  <Stop offset="1" stopColor={p.color} stopOpacity={0} />
                </RadialGradient>
              </Defs>
              <Ellipse cx={p.width / 2} cy={p.height / 2} rx={p.width / 2} ry={p.height / 2} fill={`url(#wash${uid}${i})`} />
            </Svg>
          </View>
        );
      })}
    </View>
  );
}
