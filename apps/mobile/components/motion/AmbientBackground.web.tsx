/**
 * AmbientBackground (web) — static gradient immediately; the Skia aurora only after
 * CanvasKit (~2.9MB gz WASM) loads lazily at idle, so web cold start never waits on
 * it. If the load fails (offline, CDN blocked) we simply stay on the gradient —
 * that IS the graceful degrade, with a console.warn, never an error.
 */
import { Suspense, lazy, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { StaticAmbient } from '@/components/motion/StaticAmbient';
import { duration } from '@/theme/motion';

// Must match @shopify/react-native-skia's canvaskit-wasm dependency version.
const CANVASKIT_CDN = 'https://cdn.jsdelivr.net/npm/canvaskit-wasm@0.39.1/bin/full/';

// Lazy so the Skia module (and its API surface) is only evaluated after CanvasKit is ready.
const AuroraCanvas = lazy(() => import('@/components/motion/AuroraCanvas'));

let skiaReady: Promise<boolean> | null = null;
// True once CanvasKit is in memory. A sky mounted after that (the next route's) starts WITH
// its aurora at full strength — only the app's first sky waits for idle and fades up from
// the flat gradient. Without this every route change restarted the sky from flat.
let skiaLoaded = false;
function loadSkia(): Promise<boolean> {
  skiaReady ??= (async () => {
    try {
      const { LoadSkiaWeb } = await import('@shopify/react-native-skia/lib/module/web');
      await LoadSkiaWeb({ locateFile: (file: string) => CANVASKIT_CDN + file });
      skiaLoaded = true;
      return true;
    } catch (e) {
      console.warn('Ambient aurora unavailable (CanvasKit failed to load); static gradient stays.', e);
      return false;
    }
  })();
  return skiaReady;
}

/** `paused`: see AuroraCanvas — the root sky holds still under an opaque screen. */
export function AmbientBackground({ paused = false }: { paused?: boolean }) {
  const [ready, setReady] = useState(skiaLoaded);
  const opacity = useSharedValue(skiaLoaded ? 1 : 0);

  useEffect(() => {
    if (skiaLoaded) return;
    let cancelled = false;
    const start = () => {
      void loadSkia().then((ok) => {
        if (ok && !cancelled) setReady(true);
      });
    };
    // Wait for idle so the WASM fetch never competes with first paint / bundling.
    const hasIdle = typeof window.requestIdleCallback === 'function';
    const idle = hasIdle ? window.requestIdleCallback(start) : window.setTimeout(start, 1500);
    return () => {
      cancelled = true;
      if (hasIdle) window.cancelIdleCallback(idle);
      else window.clearTimeout(idle);
    };
  }, []);

  useEffect(() => {
    if (ready) opacity.value = withTiming(1, { duration: duration.slow });
  }, [ready, opacity]);

  const fade = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <StaticAmbient />
      {ready ? (
        <Animated.View style={[StyleSheet.absoluteFill, fade]}>
          <Suspense fallback={null}>
            <AuroraCanvas paused={paused} />
          </Suspense>
        </Animated.View>
      ) : null}
    </View>
  );
}
