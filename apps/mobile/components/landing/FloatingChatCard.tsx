/**
 * FloatingChatCard — one of the two chat bubbles that hover over the landing's stage
 * (board A01): the member's line in the accent, the mentor's reply on white with the
 * typing dots. Decorative (the headline carries the meaning), so hidden from assistive
 * tech. It bobs on a slow, unrelated period per card — transform only, still under
 * reduced motion. The pillow edge is the same drawing as every other surface.
 */
import { useEffect } from 'react';
import { StyleSheet, Text } from 'react-native';
import Animated, {
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { EdgeSurface } from '@/components/EdgeSurface';
import { TypingDots } from '@/components/motion/TypingDots';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { easing, stage } from '@/theme/motion';
import { useTheme } from '@/theme/ThemeProvider';
import { font } from '@/theme/tokens';

type Props = {
  text: string;
  /** member = accent bubble, tail bottom-left. mentor = white bubble, tail bottom-right, typing dots. */
  side: 'member' | 'mentor';
};

const TAIL = 6;
const ROUND = 18;

export function FloatingChatCard({ text, side }: Props) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const member = side === 'member';
  const p = useSharedValue(0);

  useEffect(() => {
    if (reduced) {
      cancelAnimation(p);
      p.value = 0;
      return;
    }
    p.value = withRepeat(
      withTiming(1, { duration: member ? stage.floatA : stage.floatB, easing: easing.breathe }),
      -1,
      true
    );
    return () => cancelAnimation(p);
  }, [reduced, member, p]);

  // Board: A floats 0→−10px while easing −3°→−1°; B floats −6→+6px, 2.5°→1°.
  const style = useAnimatedStyle(() => ({
    transform: member
      ? [
          { translateY: interpolate(p.value, [0, 1], [0, -10]) },
          { rotate: `${interpolate(p.value, [0, 1], [-3, -1])}deg` },
        ]
      : [
          { translateY: interpolate(p.value, [0, 1], [-6, 6]) },
          { rotate: `${interpolate(p.value, [0, 1], [2.5, 1])}deg` },
        ],
  }));

  return (
    <Animated.View
      style={[styles.float, { shadowColor: member ? colors.accent : colors.ink }, style]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
    >
      <EdgeSurface
        edge={member ? colors.accentEdge : colors.edgeSurface}
        travel={3}
        radius={ROUND}
        faceRadiusStyle={member ? { borderBottomLeftRadius: TAIL } : { borderBottomRightRadius: TAIL }}
        style={[
          styles.face,
          member
            ? { backgroundColor: colors.accent }
            : { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
        ]}
      >
        <Text style={[styles.text, { color: member ? colors.onAccent : colors.ink }]}>{text}</Text>
        {member ? null : <TypingDots color={colors.accent} />}
      </EdgeSurface>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // A floating layer (it hovers over the stage) — the one place a soft shadow belongs.
  float: { shadowOpacity: 0.18, shadowRadius: 13, shadowOffset: { width: 0, height: 14 } },
  face: { paddingVertical: 10, paddingHorizontal: 14, gap: 6 },
  text: { fontFamily: font.sansSemi, fontSize: 14, lineHeight: 20 },
});
