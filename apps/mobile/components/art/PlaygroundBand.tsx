/**
 * PlaygroundBand — the role fork's full-bleed art band (board A02): the companions at
 * play. A still is ALWAYS drawn first (poster), the silent loop plays underneath it,
 * and the poster lifts once frames are really advancing — so the band is never empty
 * and never flashes. Reduced motion: the still only; no player is created at all.
 *
 * The film's ground is pinned to the oat colour. The board fades the band's top and
 * bottom 44px into the ground so it has no edges; the app's ground is the living sky,
 * so a soft oat wash also extends past the band and lets the sky give way to it.
 */
import { useCallback, useEffect, useId, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { SCENES } from '@/assets/scenes';
import { PlaygroundLoop } from '@/components/art/PlaygroundLoop';
import { useI18n } from '@/lib/i18n';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { duration, easing } from '@/theme/motion';
import { useTheme } from '@/theme/ThemeProvider';

/** Board: the inner fades are 44px; the outer wash is ours (see above). */
const FADE = 44;
export const PLAYGROUND_WASH = 56;
/** The film is 780×586 — the board draws it 390×293. */
export const PLAYGROUND_ASPECT = 390 / 293;

function Fade({ width, height, from, id }: { width: number; height: number; from: 'top' | 'bottom'; id: string }) {
  const { colors } = useTheme();
  return (
    <Svg width={width} height={height} pointerEvents="none">
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={colors.bg} stopOpacity={from === 'top' ? 1 : 0} />
          <Stop offset="1" stopColor={colors.bg} stopOpacity={from === 'top' ? 0 : 1} />
        </LinearGradient>
      </Defs>
      <Rect width={width} height={height} fill={`url(#${id})`} />
    </Svg>
  );
}

export function PlaygroundBand({
  width,
  height,
  startAfter = 0,
}: {
  width: number;
  height: number;
  /** Mount the film only after this long (ms, from motion tokens): the band ARRIVES with a
   * fade + settle, and a native video surface ignores its parent's opacity — it would show
   * at full strength (or black) through the fade. Until then the still stands in. */
  startAfter?: number;
}) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const reduced = useReducedMotion();
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const poster = useSharedValue(1);
  const posterStyle = useAnimatedStyle(() => ({ opacity: poster.value }));
  const [armed, setArmed] = useState(startAfter === 0);
  useEffect(() => {
    if (armed) return;
    const t = setTimeout(() => setArmed(true), startAfter);
    return () => clearTimeout(t);
  }, [armed, startAfter]);

  const onPlaying = useCallback(() => {
    if (poster.value === 1) poster.value = withTiming(0, { duration: duration.base, easing: easing.enter });
  }, [poster]);

  return (
    <View
      style={{ width, height }}
      accessible
      accessibilityRole="image"
      accessibilityLabel={t('onboarding.role.artA11y')}
      pointerEvents="none"
      testID="playground-band"
    >
      {/* The sky gives way to the oat ground just outside the band. */}
      <View style={[styles.abs, { top: -PLAYGROUND_WASH }]}>
        <Fade width={width} height={PLAYGROUND_WASH} from="bottom" id={`pgWashT${uid}`} />
      </View>
      <View style={[styles.abs, { top: height }]}>
        <Fade width={width} height={PLAYGROUND_WASH} from="top" id={`pgWashB${uid}`} />
      </View>

      <View style={[styles.band, { width, height, backgroundColor: colors.bg }]}>
        {reduced || !armed ? null : <PlaygroundLoop onPlaying={onPlaying} />}
        <Animated.View style={[StyleSheet.absoluteFill, reduced ? null : posterStyle]}>
          <Image source={SCENES.playgroundStill} style={styles.fill} resizeMode="cover" testID="playground-still" />
        </Animated.View>
        <View style={[styles.abs, { top: 0 }]}>
          <Fade width={width} height={FADE} from="top" id={`pgFadeT${uid}`} />
        </View>
        <View style={[styles.abs, { bottom: 0 }]}>
          <Fade width={width} height={FADE} from="bottom" id={`pgFadeB${uid}`} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  abs: { position: 'absolute', left: 0 },
  band: { overflow: 'hidden' },
  fill: { width: '100%', height: '100%' },
});
