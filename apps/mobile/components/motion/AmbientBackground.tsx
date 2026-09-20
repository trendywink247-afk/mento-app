/**
 * AmbientBackground (native) — the persistent onboarding sky.
 * Layer 0: StaticAmbient SVG gradient (paints on the very first frame — protects the
 * <2s cold-start budget). Layer 1: the Skia aurora, mounted one frame later and
 * cross-faded over the gradient so the canvas never blocks first paint.
 */
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import AuroraCanvas, { AURORA_FADE_MS } from '@/components/motion/AuroraCanvas';
import { StaticAmbient } from '@/components/motion/StaticAmbient';

/** `paused`: see AuroraCanvas — the root sky holds still under an opaque screen. */
export function AmbientBackground({ paused = false }: { paused?: boolean }) {
  const [mountCanvas, setMountCanvas] = useState(false);
  const opacity = useSharedValue(0);

  useEffect(() => {
    // One frame of static gradient first; then the aurora arrives.
    const id = requestAnimationFrame(() => setMountCanvas(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    if (mountCanvas) opacity.value = withTiming(1, { duration: AURORA_FADE_MS });
  }, [mountCanvas, opacity]);

  const fade = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <StaticAmbient />
      {mountCanvas ? (
        <Animated.View style={[StyleSheet.absoluteFill, fade]}>
          <AuroraCanvas paused={paused} />
        </Animated.View>
      ) : null}
    </View>
  );
}
