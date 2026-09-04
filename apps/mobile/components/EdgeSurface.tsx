/**
 * EdgeSurface — the pillow-key look with no press physics, for surfaces that are
 * not tappable (message bubbles, status cards, notes). Same drawing as PressKey:
 * an edge under a face, offset by `travel`. Replaces the old soft card shadow.
 */
import { ReactNode } from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

import { radius as radiusTokens } from '@/theme/tokens';

export function EdgeSurface({
  children,
  edge,
  travel = 3,
  radius = radiusTokens.lg,
  style,
  containerStyle,
  testID,
}: {
  children: ReactNode;
  edge: string;
  travel?: 4 | 3 | 2;
  radius?: number;
  /** Face visuals (background, padding). */
  style?: StyleProp<ViewStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  return (
    <View style={[{ paddingBottom: travel }, containerStyle]} testID={testID}>
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { top: travel, borderRadius: radius, backgroundColor: edge }]}
      />
      <View style={[style, { borderRadius: radius }]}>{children}</View>
    </View>
  );
}
