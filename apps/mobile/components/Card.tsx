import { ReactNode } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { EdgeSurface } from '@/components/EdgeSurface';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

/** The clay card: white (or tinted) face on a pillow edge. Replaces the shadow card. */
export function Card({
  children,
  tinted = false,
  style,
}: {
  children: ReactNode;
  /** Accent-tinted variant (info/footer cards). */
  tinted?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  return (
    <EdgeSurface
      edge={tinted ? colors.accentEdge : colors.edgeSurface}
      radius={radius.lg}
      style={[styles.card, { backgroundColor: tinted ? colors.accentTint : colors.surface }]}
      containerStyle={style}
    >
      {children}
    </EdgeSurface>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, padding: space.md },
});
