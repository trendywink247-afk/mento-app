/**
 * WebFrame (web) — on a wide window the whole app sits in a centered column over a
 * still ambient ground (spec 2026-09-19-desktop-web-layout §4). The navigator lives
 * INSIDE the column, so the tab bar, transparent-modal sheets and absolutely
 * positioned art are contained for free.
 *
 * The tree shape never changes — only styles do — so resizing across the breakpoint
 * or opening /admin never remounts the navigator. No animation: the frame's first
 * frame is its only frame. The backdrop is deliberately static; a second live
 * aurora behind the app's own would break "≤ 3 simultaneous movers".
 */
import { useSegments } from 'expo-router';
import { useMemo, type ReactNode } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';

import { StaticAmbient } from '@/components/motion/StaticAmbient';
import { FrameSizeContext, type FrameSize } from '@/lib/useFrameSize';
import { useTheme } from '@/theme/ThemeProvider';
import { layout } from '@/theme/layout';

export function WebFrame({ children }: { children: ReactNode }) {
  const { width, height } = useWindowDimensions();
  const segments = useSegments();
  const { colors } = useTheme();

  // /admin keeps its own wide layout; at phone width the window IS the column.
  const framed = width > layout.columnMax && segments[0] !== 'admin';
  const frameSize = useMemo<FrameSize | null>(
    () => (framed ? { width: layout.columnMax, height } : null),
    [framed, height],
  );

  return (
    <View style={styles.window}>
      {framed ? <StaticAmbient /> : null}
      <View
        testID="web-frame-column"
        style={[
          styles.column,
          framed && {
            maxWidth: layout.columnMax,
            backgroundColor: colors.bg,
            borderColor: colors.border,
            borderLeftWidth: StyleSheet.hairlineWidth,
            borderRightWidth: StyleSheet.hairlineWidth,
          },
        ]}
      >
        <FrameSizeContext.Provider value={frameSize}>{children}</FrameSizeContext.Provider>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  window: { flex: 1 },
  column: { flex: 1, width: '100%', alignSelf: 'center', overflow: 'hidden' },
});
