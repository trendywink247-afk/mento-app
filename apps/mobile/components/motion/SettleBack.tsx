/**
 * SettleBack — the board's one sheet choreography (FINAL_SPEC / T06): the screen behind
 * settles back to 0.96 (and 8px down) under a 0.35 scrim while the sheet rises from the
 * bottom edge. Rendered in-screen rather than as a route, because the screen behind has
 * to MOVE (a transparentModal route cannot reach it). Transform + opacity only; reduced
 * motion: nothing moves, the scrim and sheet fade in ≤150 ms.
 */
import { ReactNode, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useReducedMotion } from '@/lib/useReducedMotion';
import { useFrameSize } from '@/lib/useFrameSize';
import { duration, easing } from '@/theme/motion';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

const SCRIM = 0.35;
const SETTLE = 0.04;
const SETTLE_DROP = 8;
const REDUCED_MS = 150;

export function SettleBack({
  open,
  onDismiss,
  dismissLabel,
  sheet,
  sheetLabel,
  children,
}: {
  open: boolean;
  onDismiss: () => void;
  dismissLabel: string;
  sheet: ReactNode;
  sheetLabel: string;
  children: ReactNode;
}) {
  const { colors, elevation } = useTheme();
  const reduced = useReducedMotion();
  const insets = useSafeAreaInsets();
  const { height } = useFrameSize();
  const p = useSharedValue(0);
  // Kept mounted while the sheet travels back down.
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) setMounted(true);
    const cfg = reduced ? { duration: REDUCED_MS } : { duration: duration.gentle, easing: easing.settle };
    p.value = withTiming(open ? 1 : 0, cfg, (done) => {
      if (done && !open) runOnJS(setMounted)(false);
    });
  }, [open, reduced, p]);

  const backStyle = useAnimatedStyle(() =>
    reduced ? {} : { transform: [{ translateY: SETTLE_DROP * p.value }, { scale: 1 - SETTLE * p.value }] }
  );
  const scrimStyle = useAnimatedStyle(() => ({ opacity: SCRIM * p.value }));
  const sheetStyle = useAnimatedStyle(() =>
    reduced ? { opacity: p.value } : { transform: [{ translateY: (1 - p.value) * height }] }
  );

  return (
    <View style={styles.root}>
      <Animated.View style={[styles.root, backStyle]} importantForAccessibility={open ? 'no-hide-descendants' : 'auto'}>
        {children}
      </Animated.View>
      {mounted ? (
        <>
          <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.ink }, scrimStyle]}>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={onDismiss}
              accessibilityRole="button"
              accessibilityLabel={dismissLabel}
              testID="sheet-scrim"
            />
          </Animated.View>
          <Animated.View
            style={[
              styles.sheet,
              elevation.lg,
              { backgroundColor: colors.bg, paddingBottom: 28 + insets.bottom },
              sheetStyle,
            ]}
            accessibilityViewIsModal
            accessibilityLabel={sheetLabel}
          >
            <View style={[styles.grabber, { backgroundColor: colors.edgeAlt }]} />
            {sheet}
          </Animated.View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 12,
    paddingHorizontal: space.lg,
    gap: space.md,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
  },
  grabber: { alignSelf: 'center', width: 44, height: 5, borderRadius: radius.pill },
});
