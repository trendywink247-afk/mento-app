/**
 * HandUnderline — the hand-drawn stroke under the landing's last word (board A01). It
 * "draws" left to right once the headline has landed. The reveal is transform-only: a
 * clipping window slides in from the left while the stroke inside it counter-slides, so
 * the stroke itself never moves on screen — only more of it shows. Reduced motion: the
 * whole stroke is simply there.
 */
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { useReducedMotion } from '@/lib/useReducedMotion';
import { easing, stage } from '@/theme/motion';

export function HandUnderline({ width, color }: { width: number; color: string }) {
  const reduced = useReducedMotion();
  const p = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    if (reduced) {
      p.value = 1;
      return;
    }
    p.value = withDelay(stage.underlineDelay, withTiming(1, { duration: stage.underlineDraw, easing: easing.settle }));
  }, [reduced, p]);

  const windowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: -width * (1 - p.value) }] }));
  const strokeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: width * (1 - p.value) }] }));

  if (width <= 0) return null;
  return (
    <View style={[styles.clip, { width }]} pointerEvents="none">
      <Animated.View style={[styles.clip, { width }, windowStyle]}>
        <Animated.View style={strokeStyle}>
          <Svg width={width} height={12} viewBox="0 0 214 12" preserveAspectRatio="none">
            <Path
              d="M3 8 C 50 2, 96 11, 140 6 S 196 3, 211 7"
              fill="none"
              stroke={color}
              strokeOpacity={0.55}
              strokeWidth={3}
              strokeLinecap="round"
            />
          </Svg>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { height: 12, overflow: 'hidden' },
});
