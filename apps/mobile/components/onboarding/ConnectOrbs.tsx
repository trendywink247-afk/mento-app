/**
 * ConnectOrbs — the connecting scene (board A19 + T03): the member's companion in an orb on
 * the left, an empty breathing orb on the right, five dots lighting in turn between them.
 * On a match the right orb FILLS with the mentor's persona avatar (mentors are landscapes,
 * never an animal), the two orbs drift together and a soft halo opens behind them. The
 * orbs are shared elements — they never leave, they only move closer.
 *
 * Transform and opacity only. Reduced motion: no drift, no pulse — the found state is
 * simply drawn. An error leaves everything still (T&S #11).
 */
import { useEffect, useId, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

import { Companion, type CompanionTrigger } from '@/components/art/Companion';
import type { CompanionAnimal } from '@/components/art/Companions';
import { PersonaAvatar } from '@/components/art/PersonaAvatar';
import { SeekDots } from '@/components/motion/SeekDots';
import { useBreathing } from '@/components/motion/useBreathing';
import { useI18n } from '@/lib/i18n';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { breathe, duration, easing, stagger } from '@/theme/motion';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, type, wash, washEdge } from '@/theme/tokens';

/** Board metrics at a 342-wide column. */
const ORB_MAX = 120;
const SIDE = 10;
const DOTS_W = 82;
const DRIFT = 50;
const ORB_TOP = 52;
const LABEL_GAP = 12;
const LABEL_H = 36;

type Props = {
  width: number;
  animal: CompanionAnimal | null;
  /** The member's own persona, once the account exists. */
  memberName: string | null;
  /** Set on a match — fills the right orb and brings the two together. */
  mentorName: string | null;
  /** Error: every loop stops where it is. */
  still?: boolean;
};

export function ConnectOrbs({ width, animal, memberName, mentorName, still = false }: Props) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const reduced = useReducedMotion();
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const found = mentorName !== null;
  const orb = Math.min(ORB_MAX, Math.floor((width - SIDE * 2 - DOTS_W) / 2));
  const k = orb / ORB_MAX;
  const halo = orb * 2;

  const perch = useSharedValue(0);
  const fill = useSharedValue(0);
  const glow = useSharedValue(0);
  const seek = useSharedValue(1);
  const pulse = useSharedValue(0.5);
  const breathing = useBreathing(!still);
  const [joy, setJoy] = useState<CompanionTrigger>(null);

  useEffect(() => {
    if (!found) return;
    if (reduced) {
      perch.value = 1;
      fill.value = withTiming(1, { duration: 150 });
      glow.value = withTiming(1, { duration: 150 });
      seek.value = withTiming(0, { duration: 150 });
      return;
    }
    perch.value = withTiming(1, { duration: duration.slow, easing: easing.settle });
    seek.value = withTiming(0, { duration: duration.base, easing: easing.exit });
    fill.value = withDelay(stagger.unit * 3, withTiming(1, { duration: duration.gentle, easing: easing.settle }));
    glow.value = withDelay(stagger.unit * 4, withTiming(1, { duration: duration.gentle, easing: easing.settle }));
    // The member's companion is glad to see them.
    setJoy({ kind: 'celebrate', n: 1 });
  }, [found, reduced, perch, fill, glow, seek]);

  // The waiting orb breathes (scale + strength) until someone is there.
  useEffect(() => {
    if (reduced || still || found) {
      cancelAnimation(pulse);
      pulse.value = withTiming(0.5, { duration: 150 });
      return;
    }
    pulse.value = 0;
    pulse.value = withRepeat(withTiming(1, { duration: breathe.period, easing: easing.breathe }), -1, true);
    return () => cancelAnimation(pulse);
  }, [reduced, still, found, pulse]);

  const leftStyle = useAnimatedStyle(() => ({ transform: [{ translateX: perch.value * DRIFT * k }] }));
  const rightStyle = useAnimatedStyle(() => ({ transform: [{ translateX: -perch.value * DRIFT * k }] }));
  const emptyStyle = useAnimatedStyle(() => ({ opacity: seek.value }));
  const pulseStyle = useAnimatedStyle(() => ({
    opacity: interpolate(pulse.value, [0, 1], [0.65, 1]),
    transform: [{ scale: interpolate(pulse.value, [0, 1], [0.95, 1.04]) }],
  }));
  const fillStyle = useAnimatedStyle(() => ({
    opacity: fill.value,
    transform: [{ scale: reduced ? 1 : 0.9 + 0.1 * fill.value }],
  }));
  const fillLabelStyle = useAnimatedStyle(() => ({ opacity: fill.value }));
  const haloStyle = useAnimatedStyle(() => ({
    opacity: glow.value,
    transform: [{ scale: reduced ? 1 : 0.8 + 0.2 * glow.value }],
  }));

  const round = { width: orb, height: orb, borderRadius: orb / 2 };
  const edge = { ...round, position: 'absolute' as const, left: 0, top: 4 };

  return (
    <View style={{ width, height: ORB_TOP + orb + 4 + LABEL_GAP + LABEL_H }}>
      <Animated.View
        style={[styles.abs, { left: (width - halo) / 2, top: ORB_TOP + orb / 2 - halo / 2, width: halo, height: halo }, haloStyle]}
        pointerEvents="none"
      >
        <Svg width={halo} height={halo}>
          <Defs>
            <RadialGradient id={`halo${uid}`} cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor={colors.accent} stopOpacity={0.22} />
              <Stop offset="1" stopColor={colors.accent} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx={halo / 2} cy={halo / 2} r={halo / 2} fill={`url(#halo${uid})`} />
        </Svg>
      </Animated.View>

      <Animated.View
        style={[styles.abs, styles.dots, { left: SIDE + orb, width: width - (SIDE + orb) * 2, top: ORB_TOP + orb / 2 - 4 }, emptyStyle]}
        pointerEvents="none"
      >
        {still ? null : <SeekDots color={colors.accent} />}
      </Animated.View>

      {/* Right first: when the orbs meet, the member's orb sits in front (board z-order). */}
      <Animated.View style={[styles.abs, styles.col, { right: SIDE, top: ORB_TOP, width: orb }, rightStyle]}>
        <View style={{ width: orb, height: orb + 4 }}>
          <Animated.View style={[StyleSheet.absoluteFill, emptyStyle]}>
            <Animated.View
              style={[round, styles.emptyOrb, { backgroundColor: colors.surfaceAlt, borderColor: colors.dashIdle }, pulseStyle]}
            />
          </Animated.View>
          <Animated.View style={[StyleSheet.absoluteFill, fillStyle]}>
            <View style={[edge, { backgroundColor: washEdge.green }]} />
            <View style={[round, styles.orbFace, { backgroundColor: wash.green, borderColor: colors.bg }]}>
              {mentorName ? <PersonaAvatar name={mentorName} size={orb - 6} /> : null}
            </View>
            <View style={[styles.online, { backgroundColor: colors.success, borderColor: colors.bg }]} />
          </Animated.View>
        </View>
        <View style={styles.labelBox}>
          <Animated.View style={[styles.label, emptyStyle]}>
            <Text style={[type.caption, styles.name, { color: colors.ink }]} numberOfLines={1}>
              {t('connecting.orbMentor')}
            </Text>
            <Text style={[type.caption, { color: colors.inkMuted }]} numberOfLines={1}>
              {still ? '' : t('connecting.orbLooking')}
            </Text>
          </Animated.View>
          <Animated.View style={[styles.label, fillLabelStyle]}>
            <Text style={[type.caption, styles.name, { color: colors.ink }]} numberOfLines={1}>
              {mentorName ?? ''}
            </Text>
            <Text style={[type.caption, { color: colors.inkMuted }]} numberOfLines={1}>
              {t('connecting.orbYourMentor')}
            </Text>
          </Animated.View>
        </View>
      </Animated.View>

      <Animated.View style={[styles.abs, styles.col, { left: SIDE, top: ORB_TOP, width: orb }, leftStyle]}>
        <View style={{ width: orb, height: orb + 4 }}>
          <View style={[edge, { backgroundColor: colors.accentTintEdge }]} />
          <View style={[round, styles.orbFace, styles.companionFace, { backgroundColor: colors.accentTint, borderColor: colors.bg }]}>
            <Animated.View style={[styles.originBottom, breathing]}>
              <Companion animal={animal} size={106 * k} trigger={joy} awake />
            </Animated.View>
          </View>
        </View>
        <View style={styles.labelBox}>
          <View style={styles.label}>
            <Text style={[type.caption, styles.name, { color: colors.ink }]} numberOfLines={1}>
              {memberName ?? ''}
            </Text>
            <Text style={[type.caption, { color: colors.inkMuted }]} numberOfLines={1}>
              {t('connecting.orbYou')}
            </Text>
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  abs: { position: 'absolute' },
  col: { alignItems: 'center', gap: LABEL_GAP - 4 },
  dots: { height: 8, alignItems: 'center', justifyContent: 'center' },
  emptyOrb: { borderWidth: 2, borderStyle: 'dashed' },
  orbFace: { borderWidth: 3, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  companionFace: { justifyContent: 'flex-end' },
  originBottom: { transformOrigin: 'bottom' },
  online: {
    position: 'absolute',
    right: 8,
    bottom: 12,
    width: 18,
    height: 18,
    borderRadius: radius.pill,
    borderWidth: 3,
  },
  // The two right-hand labels share one box and cross-fade; names never wrap (they would
  // push the orbs apart) — a long persona simply overflows its 120 column, centred.
  labelBox: { height: LABEL_H, alignSelf: 'stretch' },
  label: { position: 'absolute', left: -40, right: -40, top: 0, alignItems: 'center' },
  // minHeight: the member's name arrives a moment after the step does — hold its line.
  name: { fontFamily: font.sansBold, minHeight: 18 },
});
