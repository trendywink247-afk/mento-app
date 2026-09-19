/**
 * BoardSheet — the board's one sheet choreography (FINAL_SPEC / T06 "sheets and depth"):
 * the screen underneath settles back to 0.96, a 0.35 scrim dims it, and the sheet rises
 * from the bottom edge — all three driven by ONE shared value, `sheetProgress`, so they can
 * never drift apart.
 *
 * The sheet itself is a screens-backed `transparentModal` ROUTE (CLAUDE.md gotcha: RN
 * <Modal> renders blank on Android under the new arch), so the screen underneath is a
 * different route: it wraps its body in <SettleBack> and reads the same module-level value.
 *
 * Leaving: `close(then)` plays the value back to 0 and only then runs `then` (usually
 * `router.back()`), so the scrim never pops. Reduced motion: nothing travels or scales —
 * a short fade only, the screen underneath stays where it is.
 */
import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import Animated, {
  makeMutable,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useReducedMotion } from '@/lib/useReducedMotion';
import { duration, easing, press, sheet as sheetMotion } from '@/theme/motion';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

/** 0 = no sheet · 1 = a sheet is fully up. One value for scrim, sheet and the screen below. */
export const sheetProgress = makeMutable(0);

const openListeners = new Set<(open: boolean) => void>();
let sheetsOpen = 0;
function setOpen(delta: 1 | -1) {
  sheetsOpen = Math.max(0, sheetsOpen + delta);
  openListeners.forEach((fn) => fn(sheetsOpen > 0));
}

/** True while any BoardSheet is up — the screen underneath hides its perched companion. */
export function useSheetOpen(): boolean {
  const [open, setOpenState] = useState(sheetsOpen > 0);
  useEffect(() => {
    openListeners.add(setOpenState);
    return () => {
      openListeners.delete(setOpenState);
    };
  }, []);
  return open;
}

/** Wrap the body of a screen that a BoardSheet can open over. */
export function SettleBack({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const reduced = useReducedMotion();
  const { colors } = useTheme();
  const open = useSheetOpen();

  const settled = useAnimatedStyle(() => ({
    transform: reduced
      ? []
      : [
          { translateY: sheetMotion.settleShift * sheetProgress.value },
          { scale: 1 - (1 - sheetMotion.settleScale) * sheetProgress.value },
        ],
  }));
  // The rounded corners are a state flip, not an animation (transform/opacity only).
  return (
    <Animated.View
      style={[
        styles.settle,
        { backgroundColor: colors.bg },
        open && !reduced ? styles.settleOpen : null,
        style,
        settled,
      ]}
    >
      {children}
    </Animated.View>
  );
}

export type BoardSheetHandle = { close: (then?: () => void) => void };

export function BoardSheet({
  children,
  onDismiss,
  dismissLabel,
  testID,
  backdropTestID,
  controller,
  top,
}: {
  children: ReactNode;
  /** Scrim tap / hardware back: runs AFTER the sheet has gone down. */
  onDismiss: () => void;
  dismissLabel: string;
  testID?: string;
  backdropTestID?: string;
  /** Filled with `close` so rows inside the sheet can leave through the same exit. */
  controller?: React.MutableRefObject<BoardSheetHandle | null>;
  /** Drawn on the sheet's top edge (the perched companion's slot). */
  top?: ReactNode;
}) {
  const reduced = useReducedMotion();
  const { colors, elevation } = useTheme();
  const insets = useSafeAreaInsets();
  const height = useSharedValue(640);
  const closing = useRef(false);

  useEffect(() => {
    setOpen(1);
    sheetProgress.value = 0;
    sheetProgress.value = reduced
      ? withTiming(1, { duration: press.reduced })
      : withTiming(1, { duration: duration.gentle, easing: easing.settle });
    return () => {
      setOpen(-1);
      // A sheet that unmounts without its exit (a route replace) must not leave the
      // screen underneath settled back.
      sheetProgress.value = 0;
    };
    // reason: a sheet rises exactly once, on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = useCallback(
    (then?: () => void) => {
      if (closing.current) return;
      closing.current = true;
      const done = then ?? onDismiss;
      sheetProgress.value = withTiming(
        0,
        reduced ? { duration: press.reduced } : { duration: duration.base, easing: easing.exit },
        (finished) => {
          if (finished) runOnJS(done)();
        },
      );
    },
    [onDismiss, reduced],
  );
  if (controller) controller.current = { close };

  const dim = useAnimatedStyle(() => ({ opacity: sheetProgress.value }));
  const rise = useAnimatedStyle(() => ({
    opacity: reduced ? sheetProgress.value : 1,
    transform: [{ translateY: reduced ? 0 : (1 - sheetProgress.value) * height.value }],
  }));

  return (
    <View style={styles.fill}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrimSheet }, dim]} />
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={() => close()}
        accessibilityRole="button"
        accessibilityLabel={dismissLabel}
        testID={backdropTestID}
      />
      <Animated.View
        onLayout={(e) => {
          height.value = e.nativeEvent.layout.height;
        }}
        accessibilityViewIsModal
        testID={testID}
        style={[
          styles.sheet,
          elevation.lg,
          { backgroundColor: colors.bg, paddingBottom: 28 + insets.bottom },
          rise,
        ]}
      >
        {top}
        <View style={[styles.handle, { backgroundColor: colors.handle }]} />
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: 'flex-end' },
  settle: { flex: 1 },
  settleOpen: { borderRadius: radius.lg, overflow: 'hidden' },
  sheet: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: 12,
    paddingHorizontal: space.lg,
    gap: 14,
  },
  handle: { alignSelf: 'center', width: 44, height: 5, borderRadius: radius.pill },
});
