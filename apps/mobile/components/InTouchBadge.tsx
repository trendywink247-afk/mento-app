/**
 * InTouchBadge — the mark of a mentor who said yes to staying in touch (board A06 / A14 /
 * A25): a tinted pill, accent border, a 2px pillow edge, and two linked rings that breathe
 * toward each other at breathing tempo. Still under reduced motion.
 *
 * `LinkedRings` is exported on its own for the In touch tab and the "Ask to stay in touch" key.
 */
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useI18n } from '@/lib/i18n';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { breathe, easing } from '@/theme/motion';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius } from '@/theme/tokens';

/** Two rings that overlap. `still` draws them at rest (a long list of badges shares the
 * motion budget: only a caller that owns three movers or fewer lets them breathe). */
export function LinkedRings({ color, size = 12, still = false }: { color: string; size?: number; still?: boolean }) {
  const reduced = useReducedMotion();
  const t = useSharedValue(0.5);
  const moving = !reduced && !still;

  useEffect(() => {
    if (!moving) {
      cancelAnimation(t);
      t.value = 0.5;
      return;
    }
    t.value = 0;
    t.value = withRepeat(withTiming(1, { duration: breathe.period, easing: easing.breathe }), -1, true);
    return () => cancelAnimation(t);
  }, [moving, t]);

  // Board: ring A drifts -1 → +0.75, ring B +1 → -0.75 (at a 12px-high mark).
  const k = size / 12;
  const a = useAnimatedStyle(() => ({ transform: [{ translateX: (-1 + 1.75 * t.value) * k }] }));
  const b = useAnimatedStyle(() => ({ transform: [{ translateX: (1 - 1.75 * t.value) * k }] }));
  const d = Math.round(size * 0.78);
  const ring = {
    width: d,
    height: d,
    borderRadius: radius.pill,
    borderWidth: Math.max(1.5, size * 0.14),
    borderColor: color,
  };

  return (
    <View
      style={{ width: Math.round(d * 1.62), height: size, flexDirection: 'row', alignItems: 'center' }}
      pointerEvents="none"
      testID="linked-rings"
    >
      <Animated.View style={[ring, a]} />
      <Animated.View style={[ring, { marginLeft: -Math.round(d * 0.38) }, b]} />
    </View>
  );
}

export function InTouchBadge({ still = false, testID = 'in-touch-badge' }: { still?: boolean; testID?: string }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  return (
    <View style={styles.wrap} testID={testID}>
      <View pointerEvents="none" style={[styles.edge, { backgroundColor: colors.accent }]} />
      <View style={[styles.face, { backgroundColor: colors.accentTint, borderColor: colors.accent }]}>
        <LinkedRings color={colors.accent} still={still} />
        <Text style={[styles.label, { color: colors.accentEdge }]} numberOfLines={1}>
          {t('inTouch.badge')}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingBottom: 2, flexShrink: 0 },
  edge: { ...StyleSheet.absoluteFillObject, top: 2, borderRadius: radius.pill },
  face: {
    height: 22,
    paddingLeft: 6,
    paddingRight: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: radius.pill,
    borderWidth: 1.5,
  },
  label: { fontFamily: font.sansHeavy, fontSize: 11, lineHeight: 16, letterSpacing: 0.2 },
});
