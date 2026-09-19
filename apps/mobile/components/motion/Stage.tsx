/**
 * Stage — the round, lit platform the board stands its hero art on (A01 landing scene,
 * A18 ready companion). A soft disc (white core falling to the accent tint), one or two
 * dotted rings turning in opposite directions with tiny satellites, three breathing
 * ripples, a slow sheen crossing the disc, and a few motes.
 *
 * All of it is AMBIENT: a ring turn takes over a minute and every element is
 * low-contrast, so none of it competes for attention (the ≤3-movers rule is about
 * attention-movers). Transform and opacity only; manual shared values; reduced motion
 * = every loop off, the stage simply drawn. Children are laid over the disc, centred.
 */
import { ReactNode, useEffect, useId } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';

import { useReducedMotion } from '@/lib/useReducedMotion';
import { COMPANION_COLORS } from '@/theme/companion';
import { breathe, easing, stage as stageMotion } from '@/theme/motion';
import { useTheme } from '@/theme/ThemeProvider';
import { wash, washEdge } from '@/theme/tokens';

type Props = {
  size: number;
  /** 1 = the outer dotted ring only (ready); 2 = plus the inner counter-rotating ring. */
  rings?: 1 | 2;
  ripples?: boolean;
  sheen?: boolean;
  motes?: boolean;
  /** 'sage' = the mentor side's green stage (board A34): sage ring + tint, and a pillow
   * rim under the disc instead of the soft accent floor shadow. Default: the accent. */
  tone?: 'accent' | 'sage';
  children?: ReactNode;
};

/** One 0→1 loop, linear, forever. Stops (and rests at `rest`) when disabled. */
function useLoop(period: number, on: boolean, rest = 0, offset = 0): SharedValue<number> {
  const v = useSharedValue(rest);
  useEffect(() => {
    if (!on) {
      cancelAnimation(v);
      v.value = rest;
      return;
    }
    // A negative CSS animation-delay = start part-way through the first cycle.
    v.value = offset;
    v.value = withTiming(1, { duration: period * (1 - offset), easing: Easing.linear }, (done) => {
      if (!done) return;
      v.value = 0;
      v.value = withRepeat(withTiming(1, { duration: period, easing: Easing.linear }), -1, false);
    });
    return () => cancelAnimation(v);
  }, [on, period, rest, offset, v]);
  return v;
}

function Ripple({ size, offset, on, color }: { size: number; offset: number; on: boolean; color: string }) {
  const p = useLoop(breathe.period, on, 0, offset);
  const style = useAnimatedStyle(() => ({
    opacity: on ? interpolate(p.value, [0, 0.18, 1], [0, 0.4, 0]) : 0,
    transform: [{ scale: interpolate(p.value, [0, 1], [0.35, 1.25]) }],
  }));
  const box = size * (2 / 3);
  return (
    <Animated.View
      style={[
        styles.abs,
        { left: (size - box) / 2, top: (size - box) / 2, width: box, height: box, borderRadius: box / 2, borderWidth: 1.5, borderColor: color },
        style,
      ]}
    />
  );
}

export function Stage({ size, rings = 2, ripples = false, sheen = false, motes = false, tone = 'accent', children }: Props) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const on = !reduced;
  const k = size / 360; // the board draws the landing stage at 360
  // Two stages can be in the document at once on web (the landing stays mounted under
  // the journey) — gradient ids must not collide.
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const sage = COMPANION_COLORS.sage.accent;
  const plum = COMPANION_COLORS.plum.accent;
  const green = tone === 'sage';
  const ringColor = green ? sage : colors.accent;
  const discTint = green ? wash.green : colors.accentTint;

  const spin = useLoop(stageMotion.ringSpin, on);
  const spinBack = useLoop(stageMotion.ringSpinBack, on && rings === 2);
  const sheenP = useLoop(stageMotion.sheen, on && sheen);
  const moteP = useSharedValue(0);
  useEffect(() => {
    if (!on || !motes) {
      cancelAnimation(moteP);
      moteP.value = 0.5;
      return;
    }
    moteP.value = 0;
    moteP.value = withRepeat(withTiming(1, { duration: stageMotion.motes, easing: easing.breathe }), -1, true);
    return () => cancelAnimation(moteP);
  }, [on, motes, moteP]);

  const spinStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.value * 360}deg` }] }));
  const spinBackStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${-spinBack.value * 360}deg` }] }));
  // Board keyframes: parked off to the left until 62%, crosses 62→88%, parked right after.
  const sheenStyle = useAnimatedStyle(() => ({
    opacity: interpolate(sheenP.value, [0, 0.62, 0.7, 0.88, 1], [0, 0, 0.9, 0, 0]),
    transform: [
      { translateX: interpolate(sheenP.value, [0, 0.62, 0.88, 1], [-260 * k, -260 * k, 420 * k, 420 * k]) },
      { rotate: '18deg' },
    ],
  }));
  const moteStyle = useAnimatedStyle(() => ({
    opacity: interpolate(moteP.value, [0, 1], [0.45, 1]),
    transform: [{ translateY: interpolate(moteP.value, [0, 1], [10 * k, -16 * k]) }],
  }));

  const inset = size * 0.05; // 18 of 360 (12 of 216 on the ready stage — the same 5%)
  const disc = size - inset * 2;
  const c = size / 2;
  const shadowPad = size * 0.2;

  return (
    <View style={{ width: size, height: size }} pointerEvents="box-none">
      {/* The disc's soft floor shadow (board: 0 24px 50px accent @ 0.22) — drawn, so it is
        * identical on web, iOS and Android (elevation cannot be tinted or this soft). */}
      {green ? (
        // The sage stage is a pillow: a rim under the disc, not a floor shadow.
        <View
          style={[
            styles.abs,
            { left: inset, top: inset + RIM, width: disc, height: disc, borderRadius: disc / 2, backgroundColor: washEdge.green },
          ]}
          pointerEvents="none"
        />
      ) : (
      <Svg
        width={size + shadowPad * 2}
        height={size + shadowPad * 2}
        style={[styles.abs, { left: -shadowPad, top: -shadowPad + size * 0.066 }]}
        pointerEvents="none"
      >
        <Defs>
          <RadialGradient id={`stageShadow${uid}`} cx="50%" cy="50%" r="50%">
            <Stop offset="0.62" stopColor={colors.accent} stopOpacity={0.2} />
            <Stop offset="1" stopColor={colors.accent} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={c + shadowPad} cy={c + shadowPad} r={disc / 2 + shadowPad * 0.7} fill={`url(#stageShadow${uid})`} />
      </Svg>
      )}

      <View
        style={[styles.abs, styles.clip, { left: inset, top: inset, width: disc, height: disc, borderRadius: disc / 2 }]}
        pointerEvents="none"
      >
        <Svg width={disc} height={disc}>
          <Defs>
            <RadialGradient id={`stageDisc${uid}`} cx="50%" cy="38%" r="62%" fx="50%" fy="38%">
              <Stop offset="0" stopColor={colors.surface} />
              <Stop offset="0.38" stopColor={colors.surface} />
              <Stop offset="1" stopColor={discTint} />
            </RadialGradient>
          </Defs>
          <Circle
            cx={disc / 2}
            cy={disc / 2}
            r={disc / 2 - (green ? 0.5 : 0)}
            fill={`url(#stageDisc${uid})`}
            stroke={green ? washEdge.green : undefined}
            strokeWidth={green ? 1 : 0}
          />
        </Svg>
        {sheen && on ? (
          <Animated.View style={[styles.abs, { left: 0, top: -40 * k, width: 70 * k, height: 420 * k }, sheenStyle]}>
            <Svg width={70 * k} height={420 * k}>
              <Defs>
                <LinearGradient id={`stageSheen${uid}`} x1="0" y1="0" x2="1" y2="0">
                  <Stop offset="0" stopColor={colors.surface} stopOpacity={0} />
                  <Stop offset="0.5" stopColor={colors.surface} stopOpacity={0.85} />
                  <Stop offset="1" stopColor={colors.surface} stopOpacity={0} />
                </LinearGradient>
              </Defs>
              <Rect width={70 * k} height={420 * k} fill={`url(#stageSheen${uid})`} />
            </Svg>
          </Animated.View>
        ) : null}
      </View>

      <Animated.View style={[styles.abs, styles.fill, spinStyle]} pointerEvents="none" renderToHardwareTextureAndroid>
        <Svg width={size} height={size} viewBox="0 0 360 360">
          <Circle cx={180} cy={180} r={176} fill="none" stroke={ringColor} strokeOpacity={0.38} strokeWidth={1.25 / k} strokeDasharray={[2 / k, 9 / k]} strokeLinecap="round" />
          <Circle cx={180} cy={4} r={5} fill={ringColor} />
          <Circle cx={332} cy={268} r={3.5} fill={green ? colors.accent : sage} />
        </Svg>
      </Animated.View>

      {rings === 2 ? (
        <Animated.View style={[styles.abs, styles.fill, spinBackStyle]} pointerEvents="none" renderToHardwareTextureAndroid>
          <Svg width={size} height={size} viewBox="0 0 360 360">
            <Circle cx={180} cy={180} r={150} fill="none" stroke={plum} strokeOpacity={0.3} strokeWidth={1 / k} strokeDasharray={[14, 10, 2, 10]} />
            <Circle cx={50} cy={105} r={4} fill={plum} />
          </Svg>
        </Animated.View>
      ) : null}

      {ripples && on ? (
        <>
          <Ripple size={size} offset={0} on={on} color={colors.accent} />
          <Ripple size={size} offset={1 / 3} on={on} color={colors.accent} />
          <Ripple size={size} offset={2 / 3} on={on} color={colors.accent} />
        </>
      ) : null}

      {motes ? (
        <Animated.View style={[styles.abs, styles.fill, moteStyle]} pointerEvents="none">
          <View style={[styles.mote, { left: 96 * k, top: 70 * k, width: 4, height: 4, backgroundColor: colors.accent, opacity: 0.6 }]} />
          <View style={[styles.mote, { left: 270 * k, top: 96 * k, width: 3, height: 3, backgroundColor: plum, opacity: 0.6 }]} />
          <View style={[styles.mote, { left: 180 * k, top: 44 * k, width: 3, height: 3, backgroundColor: sage, opacity: 0.6 }]} />
          <View style={[styles.mote, { left: 306 * k, top: 190 * k, width: 4, height: 4, backgroundColor: colors.accent, opacity: 0.5 }]} />
          <View style={[styles.mote, { left: 44 * k, top: 210 * k, width: 3, height: 3, backgroundColor: plum, opacity: 0.5 }]} />
        </Animated.View>
      ) : null}

      <View style={[styles.abs, styles.fill, styles.content]} pointerEvents="box-none">
        {children}
      </View>
    </View>
  );
}

/** The sage stage's pillow rim (board A34: 0 5px 0). */
const RIM = 5;

const styles = StyleSheet.create({
  abs: { position: 'absolute' },
  fill: { left: 0, top: 0, right: 0, bottom: 0 },
  clip: { overflow: 'hidden' },
  mote: { position: 'absolute', borderRadius: 999 },
  content: { alignItems: 'center', justifyContent: 'center' },
});
