/**
 * AuroraCanvas — the living sky behind onboarding: one full-screen SkSL shader with
 * three soft colour blobs drifting on very slow orbits (drift, not lava lamp). The
 * blob palette derives from the companion accent, and re-colouring is animated —
 * picking a colour washes the whole sky over ~900ms (the signature moment).
 *
 * Performance contract: ONE draw call, no Skia blur/backdrop (softness comes from
 * smoothstep falloffs in the shader), uniforms driven off the JS thread. Under
 * reduced motion the clock is frozen — still a pretty gradient, no drift.
 *
 * On web this component must only render AFTER LoadSkiaWeb() resolves — it is
 * lazy-imported by AmbientBackground.web.tsx for that reason.
 */
import { useIsFocused } from '@react-navigation/native';
import { Canvas, Fill, Shader, Skia, useClock } from '@shopify/react-native-skia';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import { useDerivedValue, useSharedValue, withTiming } from 'react-native-reanimated';

import { ambientLift } from '@/components/motion/ambientLift';
import { hexToRgba01, mixHex01, mixRgba, type Rgba } from '@/components/motion/color';
import { useFrameSize } from '@/lib/useFrameSize';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { duration, easing } from '@/theme/motion';
import { useTheme } from '@/theme/ThemeProvider';

const SKSL = `
uniform float uTime;
uniform float2 uSize;
uniform float uLift;
uniform half4 uBase;
uniform half4 uA;
uniform half4 uB;
uniform half4 uC;

half4 main(float2 pos) {
  float2 uv = pos / uSize;
  float aspect = uSize.x / max(uSize.y, 1.0);
  float2 p = float2(uv.x * aspect, uv.y);

  // Three blob centres on slow, phase-offset orbits (full orbit ~45-90s).
  float2 c1 = float2(0.30 * aspect, 0.22) + 0.10 * float2(sin(uTime * 0.11), cos(uTime * 0.09));
  float2 c2 = float2(0.85 * aspect, 0.40) + 0.09 * float2(cos(uTime * 0.07 + 2.0), sin(uTime * 0.13 + 1.0));
  float2 c3 = float2(0.45 * aspect, 0.92) + 0.11 * float2(sin(uTime * 0.05 + 4.0), cos(uTime * 0.08 + 3.0));

  float w1 = smoothstep(0.70, 0.0, distance(p, c1));
  float w2 = smoothstep(0.60, 0.0, distance(p, c2));
  float w3 = smoothstep(0.80, 0.0, distance(p, c3));

  half4 col = uBase;
  col = mix(col, uA, w1 * 0.85);
  col = mix(col, uB, w2 * 0.60);
  col = mix(col, uC, w3 * 0.50);
  // The "found someone" beat lifts the whole sky toward the accent wash.
  col = mix(col, uB, uLift);
  return col;
}
`;

type Palette = { base: Rgba; a: Rgba; b: Rgba; c: Rgba };

/** Pastel blob colours derived from the current accent set. */
function paletteFor(colors: { bg: string; accent: string; accentSoft: string }): Palette {
  return {
    base: hexToRgba01(colors.bg),
    a: mixHex01(colors.bg, colors.accent, 0.2),
    b: mixHex01('#FFFFFF', colors.accent, 0.3),
    c: mixHex01(colors.bg, colors.accentSoft, 0.25),
  };
}

function mixPalette(from: Palette, to: Palette, t: number): Palette {
  return {
    base: mixRgba(from.base, to.base, t),
    a: mixRgba(from.a, to.a, t),
    b: mixRgba(from.b, to.b, t),
    c: mixRgba(from.c, to.c, t),
  };
}

// Frozen clock value (seconds) under reduced motion — an arbitrary pleasant pose.
const FROZEN_T = 40;

// One sky time for the whole app. Every canvas reads the SAME clock (ms since this module
// loaded), so the sky a route mounts is at exactly the phase of the sky the last route was
// showing — landing → journey no longer restarts the drift from zero.
const SKY_EPOCH = Date.now();

export function AuroraCanvas() {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  // The frame, not the window: on a wide browser the sky fills the 480 app column.
  const { width, height } = useFrameSize();
  const clock = useClock();

  // `useClock` counts from this canvas's mount; the offset turns it into shared sky time.
  const [mountOffset] = useState(() => Date.now() - SKY_EPOCH);

  // Focus pause: expo-router keeps the previous screen mounted underneath the next
  // one, so two shader canvases would animate at once. While unfocused the shader time
  // holds still (constant uniforms = no redraws). On refocus it rejoins the shared sky
  // time — which is where the sky on the screen you just came back FROM had got to, so
  // there is no jump in either direction.
  const isFocused = useIsFocused();
  const pausedAt = useSharedValue(-1); // clock ms when the screen blurred; -1 = running

  useEffect(() => {
    if (!isFocused) {
      if (pausedAt.value < 0) pausedAt.value = clock.value;
    } else {
      pausedAt.value = -1;
    }
  }, [isFocused, clock, pausedAt]);

  const effect = useMemo(() => {
    const e = Skia.RuntimeEffect.Make(SKSL);
    if (!e) throw new Error('Aurora shader failed to compile');
    return e;
  }, []);

  // Accent wash: hold from/to palettes and animate progress on accent change.
  const target = useMemo(() => paletteFor(colors), [colors]);
  const [palettes, setPalettes] = useState({ from: target, to: target });
  const progress = useSharedValue(1);
  const firstRun = useRef(true);

  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    setPalettes((p) => ({
      // Start the wash from wherever the previous wash currently is — no snap.
      from: mixPalette(p.from, p.to, Math.min(Math.max(progress.value, 0), 1)),
      to: target,
    }));
    progress.value = 0;
    progress.value = withTiming(1, { duration: 900, easing: easing.settle });
    // reason: progress is a stable shared-value ref
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  const { from, to } = palettes;
  const uniforms = useDerivedValue(() => {
    const clockMs = pausedAt.value >= 0 ? pausedAt.value : clock.value;
    const t = reduced ? FROZEN_T : (clockMs + mountOffset) / 1000;
    const k = progress.value;
    const mix4 = (a: Rgba, b: Rgba) => [
      a[0] + (b[0] - a[0]) * k,
      a[1] + (b[1] - a[1]) * k,
      a[2] + (b[2] - a[2]) * k,
      1,
    ];
    return {
      uTime: t,
      uSize: [width, height],
      uLift: ambientLift.value,
      uBase: mix4(from.base, to.base),
      uA: mix4(from.a, to.a),
      uB: mix4(from.b, to.b),
      uC: mix4(from.c, to.c),
    };
  }, [reduced, width, height, from, to, mountOffset]);

  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      <Fill>
        <Shader source={effect} uniforms={uniforms} />
      </Fill>
    </Canvas>
  );
}

export default AuroraCanvas;

/** The crossfade duration AmbientBackground uses when the canvas arrives. */
export const AURORA_FADE_MS = duration.slow;
