/**
 * Ambient pieces for the Path screens (board A07 / A26). Both are low-contrast and very slow,
 * so they sit under the three-movers budget the way the sky does; transform and opacity only;
 * reduced motion = drawn once, nothing loops.
 *
 *   StageSheen — a soft band of light crossing the stage panel every nine seconds.
 *   SkyBlob    — a pale wash of the member's accent drifting in the Pathfinder's top corner.
 */
import { useEffect, useId } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';

import { hexToRgba01, mixRgba } from '@/components/motion/color';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { drift, duration, easing, stage as stageMotion } from '@/theme/motion';
import { useTheme } from '@/theme/ThemeProvider';

/** The accent taken most of the way to white — the face of a CHOSEN route row (board A26:
 * paler than `accentTint`, which is kept for the chosen moment). Derived, never a raw hex. */
export function useAccentWash(): string {
  const { colors } = useTheme();
  const [r, g, b] = mixRgba(hexToRgba01(colors.accent), hexToRgba01(colors.surface), 0.93);
  return `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
}

const BAND_W = 46;
const BAND_H = 160;

export function StageSheen() {
  const reduced = useReducedMotion();
  const { colors } = useTheme();
  const p = useSharedValue(0);
  // reason: SVG gradient ids are document-global on web.
  const id = `stage-sheen-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;

  useEffect(() => {
    if (reduced) {
      cancelAnimation(p);
      p.value = 0;
      return;
    }
    p.value = withDelay(
      duration.slow + duration.gentle,
      withRepeat(withTiming(1, { duration: stageMotion.sheen, easing: Easing.inOut(Easing.quad) }), -1, false),
    );
    return () => cancelAnimation(p);
  }, [reduced, p]);

  const style = useAnimatedStyle(() => ({
    opacity: interpolate(p.value, [0, 0.58, 0.68, 0.86, 1], [0, 0, 0.75, 0, 0]),
    transform: [
      { translateX: interpolate(p.value, [0, 0.58, 0.86, 1], [-120, -120, 380, 380]) },
      { rotate: '16deg' },
    ],
  }));

  if (reduced) return null;
  return (
    <Animated.View pointerEvents="none" style={[styles.band, style]}>
      <Svg width={BAND_W} height={BAND_H} viewBox="0 0 100 100" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={colors.surface} stopOpacity={0} />
            <Stop offset="0.5" stopColor={colors.surface} stopOpacity={0.8} />
            <Stop offset="1" stopColor={colors.surface} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100" height="100" fill={`url(#${id})`} />
      </Svg>
    </Animated.View>
  );
}

const BLOB_W = 520;
const BLOB_H = 460;

export function SkyBlob() {
  const reduced = useReducedMotion();
  const { colors } = useTheme();
  const p = useSharedValue(0);
  const id = `sky-blob-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;

  useEffect(() => {
    if (reduced) {
      cancelAnimation(p);
      p.value = 0;
      return;
    }
    p.value = withRepeat(withTiming(1, { duration: drift.period, easing: easing.breathe }), -1, true);
    return () => cancelAnimation(p);
  }, [reduced, p]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: -46 * p.value }, { translateY: 30 * p.value }, { scale: 1 + 0.1 * p.value }],
  }));

  return (
    <View pointerEvents="none" style={styles.sky}>
      <Animated.View style={[styles.blob, style]}>
        <Svg width={BLOB_W} height={BLOB_H} viewBox="0 0 100 100" preserveAspectRatio="none">
          <Defs>
            <RadialGradient id={id} cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor={colors.accentTint} stopOpacity={1} />
              <Stop offset="1" stopColor={colors.accentTint} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width="100" height="100" fill={`url(#${id})`} />
        </Svg>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  band: { position: 'absolute', left: 0, top: -30, width: BAND_W, height: BAND_H },
  sky: { ...StyleSheet.absoluteFillObject, overflow: 'hidden' },
  blob: { position: 'absolute', right: -210, top: -220, width: BLOB_W, height: BLOB_H },
});
