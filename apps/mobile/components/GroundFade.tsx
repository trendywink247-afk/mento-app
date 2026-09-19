/**
 * GroundFade — the list dissolving into the oat ground above a floating key (board A06 /
 * A25: clear → 95% by a fifth of the way down → solid). Static, decorative, never touchable.
 */
import { useId } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { useTheme } from '@/theme/ThemeProvider';

/** `color`: the ground to dissolve into when the screen is not on `colors.bg` (A04's oat). */
export function GroundFade({ height, color }: { height: number; color?: string }) {
  const { colors } = useTheme();
  const ground = color ?? colors.bg;
  // reason: SVG gradient ids are document-global on web — mounted tabs must not share one.
  const id = `ground-fade-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <View pointerEvents="none" style={[styles.wrap, { height }]}>
      <Svg width="100%" height={height} viewBox="0 0 100 100" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={ground} stopOpacity={0} />
            <Stop offset="0.22" stopColor={ground} stopOpacity={0.95} />
            <Stop offset="1" stopColor={ground} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100" height="100" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 0 },
});
