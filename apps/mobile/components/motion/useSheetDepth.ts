/**
 * useSheetDepth — the board's sheet choreography (FINAL_SPEC, T06): a sheet rises over a
 * screen that SETTLES BACK — the screen scales to 0.96 and sinks 8px under a 0.35 scrim.
 *
 * ONE shared value (`progress`, 0 → 1) drives all three: the screen behind (`backStyle`),
 * the scrim's opacity and the sheet's rise (the sheet reads `progress` itself). Transform +
 * opacity only, tokens only. Reduced motion: no scale, no rise — a plain ≤150 ms fade.
 *
 * `shown` stays true until the closing run has finished, so the sheet can leave the way
 * it came instead of vanishing.
 */
import { useEffect, useState } from 'react';
import type { ViewStyle } from 'react-native';
import {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type AnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';

import { useReducedMotion } from '@/lib/useReducedMotion';
import { chat, duration, easing, press } from '@/theme/motion';

export type SheetDepth = {
  progress: SharedValue<number>;
  /** Put this on the Animated.View that wraps the screen's own content. */
  backStyle: AnimatedStyle<ViewStyle>;
  /** Mounted: open, or still on its way out. */
  shown: boolean;
  reduced: boolean;
};

export function useSheetDepth(open: boolean): SheetDepth {
  const reduced = useReducedMotion();
  const progress = useSharedValue(0);
  const [shown, setShown] = useState(open);

  useEffect(() => {
    if (open) setShown(true);
    progress.value = withTiming(
      open ? 1 : 0,
      reduced ? { duration: press.reduced } : { duration: duration.gentle, easing: easing.settle },
      (finished) => {
        if (finished && !open) runOnJS(setShown)(false);
      },
    );
  }, [open, reduced, progress]);

  const backStyle = useAnimatedStyle<ViewStyle>(() =>
    reduced
      ? { transform: [{ scale: 1 }, { translateY: 0 }] }
      : {
          transform: [
            { scale: 1 - (1 - chat.sheetBack.scale) * progress.value },
            { translateY: chat.sheetBack.shift * progress.value },
          ],
        },
  );

  return { progress, backStyle, shown, reduced };
}
