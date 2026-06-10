import { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

/**
 * The mockups' card language: borderless white (or tinted) surface, large radius,
 * soft shadow. Replaces the old 1px-bordered cards.
 */
export function Card({
  children,
  tinted = false,
  style,
}: {
  children: ReactNode;
  /** Lavender-tinted variant (footer/info cards in the mockups). */
  tinted?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors, elevation } = useTheme();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: tinted ? colors.accentTint : colors.surface },
        !tinted && elevation.sm,
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, padding: space.md },
});
