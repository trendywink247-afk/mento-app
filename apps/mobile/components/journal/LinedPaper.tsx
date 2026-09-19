/**
 * LinedPaper — ruled lines behind journal text (board A28 `.lined`, A29 `.lined28`): one
 * hairline at the foot of every text row, so the writing sits ON the line. The rules are
 * drawn for however tall the content turns out to be (measured), and never move.
 * Decorative: hidden from assistive tech, never touchable.
 */
import { ReactNode, useState } from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';

export function LinedPaper({
  children,
  rule,
  style,
}: {
  children: ReactNode;
  /** The text's line height — one rule per row. */
  rule: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const [height, setHeight] = useState(0);
  const rows = Math.floor(height / rule);

  return (
    <View style={style} onLayout={(e) => setHeight(e.nativeEvent.layout.height)}>
      <View
        pointerEvents="none"
        style={StyleSheet.absoluteFill}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        aria-hidden
      >
        {Array.from({ length: rows }).map((_, i) => (
          <View key={i} style={[styles.rule, { top: (i + 1) * rule - 1, backgroundColor: colors.border }]} />
        ))}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  rule: { position: 'absolute', left: 0, right: 0, height: 1 },
});
