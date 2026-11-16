/**
 * EdgeSurface — the pillow-key look with no press physics, for surfaces that are
 * not tappable (message bubbles, status cards, notes). Same drawing as PressKey:
 * an edge under a face, offset by `travel`. Replaces the old soft card shadow.
 */
import { ReactNode } from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

import { useFlatSurfaces } from '@/theme/ThemeProvider';
import { radius as radiusTokens } from '@/theme/tokens';

export function EdgeSurface({
  children,
  edge,
  travel = 3,
  radius = radiusTokens.lg,
  faceRadiusStyle,
  style,
  containerStyle,
  testID,
}: {
  children: ReactNode;
  edge: string;
  travel?: 4 | 3 | 2;
  radius?: number;
  /** Per-corner radii for asymmetric faces (chat-bubble tails). Applied to BOTH the
   * face and the edge so they can never diverge. Overrides `radius` when given. */
  faceRadiusStyle?: Pick<
    ViewStyle,
    'borderTopLeftRadius' | 'borderTopRightRadius' | 'borderBottomLeftRadius' | 'borderBottomRightRadius'
  >;
  /** Face visuals only: background, padding, inner layout. Never sizing constraints. */
  style?: StyleProp<ViewStyle>;
  /** Outer box: margins, alignSelf, flex, maxWidth / flexShrink — every sizing
   * constraint goes here, because percentage widths on the face resolve against
   * PressKey's unsized wrapper and silently stop applying. */
  containerStyle?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const cornerStyle = faceRadiusStyle ? { borderRadius: radius, ...faceRadiusStyle } : { borderRadius: radius };
  // Light and Dark are flat (DECISIONS T.2); Pastel keeps the pillow edge.
  const travelPx = useFlatSurfaces() ? 0 : travel;

  return (
    <View style={[{ paddingBottom: travelPx }, containerStyle]} testID={testID}>
      {travelPx > 0 ? (
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { top: travelPx, backgroundColor: edge }, cornerStyle]}
        />
      ) : null}
      <View style={[style, cornerStyle]}>{children}</View>
    </View>
  );
}
