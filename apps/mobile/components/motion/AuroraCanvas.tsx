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
import { NavigationContext } from '@react-navigation/native';
import { Canvas, Fill, Shader, Skia } from '@shopify/react-native-skia';
import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import { useDerivedValue, useFrameCallback, useSharedValue, withTiming } from 'react-native-reanimated';

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

// One sky time for the whole app: seconds since this module loaded. A canvas starts at the
// wall-clock phase (so a screen-hosted sky and the root sky agree), and after a pause it
// resumes from where IT stopped — never a jump in the blobs' positions.
const SKY_EPOCH = Date.now();

/** Focus of the screen hosting this canvas; `true` outside any navigator (the root sky). */
function useHostFocused(): boolean {
  const nav = useContext(NavigationContext);
  const [focused, setFocused] = useState(() => nav?.isFocused() ?? true);
  useEffect(() => {
    if (!nav) return;
    setFocused(nav.isFocused());
    const offFocus = nav.addListener('focus', () => setFocused(true));
    const offBlur = nav.addListener('blur', () => setFocused(false));
    return () => {
      offFocus();
      offBlur();
    };
  }, [nav]);
  return focused;
}

/**
 * `paused`: the root sky (components/motion/SkyGround) holds still while an opaque screen
 * covers it. Paused, focus-lost or reduced motion = the frame callback is OFF, so the
 * uniforms are constant and Skia draws nothing new — no shader work under a covered sky.
 */
export function AuroraCanvas({ paused = false }: { paused?: boolean }) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  // The frame, not the window: on a wide browser the sky fills the 480 app column.
  const { width, height } = useFrameSize();

  // expo-router keeps the previous screen mounted underneath the next one, so a
  // screen-hosted sky that lost focus stops its clock too.
  const focused = useHostFocused();
  const running = !paused && focused && !reduced;

  const skyT = useSharedValue((Date.now() - SKY_EPOCH) / 1000);
  const resumeFrom = useSharedValue(0); // sky seconds when the clock last started
  const startedAt = useSharedValue(-1); // frame timestamp of the first frame since then
  const tick = useFrameCallback((frame) => {
    if (startedAt.value < 0) startedAt.value = frame.timestamp;
    skyT.value = resumeFrom.value + (frame.timestamp - startedAt.value) / 1000;
  }, false);

  useEffect(() => {
    if (running) {
      resumeFrom.value = skyT.value;
      startedAt.value = -1;
    }
    tick.setActive(running);
    // reason: shared values and the frame-callback handle are stable refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

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
    const t = reduced ? FROZEN_T : skyT.value;
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
  }, [reduced, width, height, from, to]);

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
