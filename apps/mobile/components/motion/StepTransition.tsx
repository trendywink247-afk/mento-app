/**
 * StepTransition — hands over between steps of an in-screen flow (the onboarding
 * journey). Outgoing and incoming children are stacked absolutely: out = a quick fade +
 * 12px drift up, in = fade + 16px rise that starts once the old step is nearly gone, so
 * two headlines are never readable at once. Transform/opacity only; reduced motion = a
 * quick 100ms cut.
 *
 * Every step is its own keyed `Layer` that owns its own visibility value, so the
 * outgoing step keeps ITS INSTANCE and simply fades from wherever it is. It used to be
 * re-rendered into a fresh layer, which remounted it — and a remounted step replays its
 * `Entrance` animations from opacity 0. On screen that was a blank flash followed by the
 * old headline ghosting back in through the new one (session 35, frame-by-frame capture).
 *
 * The host container must have a size of its own (flex: 1) — children fill it.
 * Manual shared values (no `entering=`/`exiting=`) for react-native-web parity.
 */
import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { useReducedMotion } from '@/lib/useReducedMotion';
import { duration, easing, stagger } from '@/theme/motion';

type Props<K extends string> = {
  activeKey: K;
  /** Renders the content for a step key. Called for the incoming and outgoing step. */
  render: (key: K) => ReactNode;
};

function Layer({
  active,
  startVisible,
  reduced,
  onGone,
  children,
}: {
  active: boolean;
  /** The step on screen at mount shows at once — it has nothing to hand over from. */
  startVisible: boolean;
  reduced: boolean;
  onGone: () => void;
  children: ReactNode;
}) {
  const visible = useSharedValue(startVisible ? 1 : 0);
  const leaving = useSharedValue(0); // picks the drift direction: rise in, drift up out
  const skipFirstEnter = useRef(startVisible);

  useEffect(() => {
    if (active) {
      // The step on screen at mount is already showing — nothing to animate, once.
      if (skipFirstEnter.current) {
        skipFirstEnter.current = false;
        return;
      }
      leaving.value = 0;
      visible.value = reduced
        ? withTiming(1, { duration: 100 })
        : withDelay(stagger.unit * 2, withTiming(1, { duration: duration.base, easing: easing.enter }));
      return;
    }
    leaving.value = 1;
    visible.value = withTiming(
      0,
      reduced ? { duration: 100 } : { duration: duration.fast, easing: easing.exit },
      (done) => {
        if (done) runOnJS(onGone)();
      }
    );
    // reason: fires only when this layer's role flips; shared values are stable refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const style = useAnimatedStyle(() => ({
    opacity: visible.value,
    transform: [
      { translateY: reduced ? 0 : (leaving.value ? -12 : 16) * (1 - visible.value) },
    ],
  }));

  return (
    <Animated.View pointerEvents={active ? 'auto' : 'none'} style={[StyleSheet.absoluteFill, style]}>
      {children}
    </Animated.View>
  );
}

export function StepTransition<K extends string>({ activeKey, render }: Props<K>) {
  const reduced = useReducedMotion();
  const firstKey = useRef(activeKey);
  const activeKeyRef = useRef(activeKey);
  activeKeyRef.current = activeKey;
  // Steps currently mounted, oldest first: the active one, plus any still fading out.
  const [mounted, setMounted] = useState<K[]>([activeKey]);

  useEffect(() => {
    setMounted((keys) => (keys.includes(activeKey) ? keys : [...keys, activeKey]));
  }, [activeKey]);

  const drop = useCallback((key: K) => setMounted((keys) => keys.filter((k) => k !== key)), []);

  return (
    <>
      {mounted.map((k) => (
        <Layer
          key={k}
          active={k === activeKey}
          startVisible={k === firstKey.current && mounted.length === 1 && k === activeKey}
          reduced={reduced}
          // A step that became active again mid-fade (back, then forward) must not be dropped.
          onGone={() => {
            if (k !== activeKeyRef.current) drop(k);
          }}
        >
          {render(k)}
        </Layer>
      ))}
    </>
  );
}
