/**
 * Wheel — one pillow wheel of the date tray (board A16): a quiet label, then a white
 * key-shaped card holding an up target (chevron + the previous value), the selected value
 * large in the accent on its tint, and a down target (the next value + chevron). Clamped,
 * never wrapped: at either end the target dims and stops.
 *
 * Tap steps once; press-and-hold keeps stepping (a birth year is many steps away, and
 * nobody should have to tap forty times). The press is a 3px travel of the target's own
 * content — transform only; under reduced motion it is a short opacity dip instead.
 */
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { EdgeSurface } from '@/components/EdgeSurface';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { easing, press as pressTiming } from '@/theme/motion';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, type } from '@/theme/tokens';

/** Hold-to-repeat cadence (intervals, not animation durations). */
const HOLD_DELAY_MS = 350;
const HOLD_EVERY_MS = 90;

type Props = {
  label: string;
  value: string;
  /** '' at a clamped end — the target dims and does nothing. */
  prev: string;
  next: string;
  onStep: (dir: -1 | 1) => void;
  upA11y: string;
  downA11y: string;
  /** Short phones: shallower up/down targets (still ≥ 48 tall) so the step fits. */
  compact?: boolean;
  testID: string;
};

function Target({
  dir,
  text,
  a11y,
  onStep,
  compact,
  testID,
}: {
  dir: -1 | 1;
  text: string;
  a11y: string;
  onStep: (dir: -1 | 1) => void;
  compact?: boolean;
  testID: string;
}) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const enabled = text !== '';
  const pressed = useSharedValue(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  // The repeat must always call the LATEST step (the clamp moves with the value).
  const stepRef = useRef(onStep);
  stepRef.current = onStep;

  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };
  useEffect(() => stop, []);
  useEffect(() => {
    if (!enabled) stop();
  }, [enabled]);

  const style = useAnimatedStyle(() => ({
    opacity: (enabled ? 1 : 0.3) * (reduced ? 1 - pressed.value * 0.3 : 1),
    transform: [{ translateY: reduced ? 0 : pressed.value * 3 }],
  }));

  return (
    <Pressable
      disabled={!enabled}
      onPress={() => stepRef.current(dir)}
      delayLongPress={HOLD_DELAY_MS}
      onLongPress={() => {
        stop();
        timer.current = setInterval(() => stepRef.current(dir), HOLD_EVERY_MS);
      }}
      onPressIn={() => {
        pressed.value = withTiming(1, { duration: pressTiming.light, easing: easing.enter });
      }}
      onPressOut={() => {
        stop();
        pressed.value = withTiming(0, { duration: pressTiming.reduced, easing: easing.enter });
      }}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ disabled: !enabled }}
      testID={testID}
      style={[styles.target, compact && styles.targetCompact]}
    >
      <Animated.View style={[styles.targetInner, style]}>
        {dir === -1 ? <Ionicons name="chevron-up" size={20} color={colors.inkMuted} /> : null}
        <Text style={[styles.neighbour, { color: colors.inkMuted }]}>{text}</Text>
        {dir === 1 ? <Ionicons name="chevron-down" size={20} color={colors.inkMuted} /> : null}
      </Animated.View>
    </Pressable>
  );
}

export function Wheel({ label, value, prev, next, onStep, upA11y, downA11y, compact, testID }: Props) {
  const { colors } = useTheme();
  // Long month names in some scripts are wider than the cell at the full display size.
  const long = value.length > 4;

  return (
    <View style={styles.col}>
      <Text style={[type.caption, styles.label, { color: colors.inkMuted }]}>{label}</Text>
      <EdgeSurface
        edge={colors.edgeSurface}
        travel={4}
        radius={radius.md}
        style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
      >
        <Target dir={-1} text={prev} a11y={upA11y} onStep={onStep} compact={compact} testID={`${testID}-up`} />
        <View style={styles.selectedRow}>
          <View style={[styles.selected, { backgroundColor: colors.accentTint }]}>
            <Text
              style={[styles.value, long && styles.valueLong, { color: colors.accent }]}
              numberOfLines={1}
              accessibilityLiveRegion="polite"
              testID={`${testID}-value`}
            >
              {value}
            </Text>
          </View>
        </View>
        <Target dir={1} text={next} a11y={downA11y} onStep={onStep} compact={compact} testID={`${testID}-down`} />
      </EdgeSurface>
    </View>
  );
}

const styles = StyleSheet.create({
  col: { gap: 6 },
  label: { textAlign: 'center', fontFamily: font.sansBold },
  card: { borderWidth: 1, overflow: 'hidden' },
  target: { height: 68 },
  targetCompact: { height: 52 },
  targetInner: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 },
  neighbour: { minHeight: 24, fontFamily: font.sansSemi, fontSize: 17, lineHeight: 24 },
  selectedRow: { height: 60, paddingHorizontal: 6 },
  selected: { flex: 1, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  value: { fontFamily: font.sansHeavy, fontSize: 30, lineHeight: 38 },
  valueLong: { fontSize: 24, lineHeight: 34 },
});
