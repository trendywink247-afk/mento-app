/**
 * Tab hand-over — tabs sit side by side, so a switch MOVES sideways in tab order instead
 * of cutting: the tab you leave slips toward its own side and clears fast, then the tab
 * you open settles in from its side. Built on the bottom-tab navigator's own per-scene
 * progress (-1 = parked left of the focused tab, 0 = focused, 1 = parked right), so the
 * direction always follows the bar's order. Transform + opacity only.
 *
 * Both scenes ride one ease-out clock, and each is fully clear past `tabSwitch.clear`:
 * the leaving tab is gone in the curve's quick first part and the arriving tab owns the
 * long soft tail — exits fast, arrivals slow, and the two never ghost through each other
 * (the ground shows between them, never two headlines at once).
 *
 * Reduced motion never reaches this file — the tabs layout sets `animation: 'none'`.
 */
import type { BottomTabNavigationOptions } from '@react-navigation/bottom-tabs';

import { duration, easing, tabSwitch } from '@/theme/motion';

type SceneInterpolator = NonNullable<BottomTabNavigationOptions['sceneStyleInterpolator']>;
type TransitionSpec = NonNullable<BottomTabNavigationOptions['transitionSpec']>;

export const tabSceneInterpolator: SceneInterpolator = ({ current }) => ({
  sceneStyle: {
    opacity: current.progress.interpolate({
      inputRange: [-1, -tabSwitch.clear, 0, tabSwitch.clear, 1],
      outputRange: [0, 0, 1, 0, 0],
    }),
    transform: [
      {
        translateX: current.progress.interpolate({
          inputRange: [-1, 0, 1],
          outputRange: [-tabSwitch.distance, 0, tabSwitch.distance],
        }),
      },
    ],
  },
});

export const tabTransitionSpec: TransitionSpec = {
  animation: 'timing',
  // reason: the navigator drives React Native's Animated, not Reanimated. `easing.enter`
  // is a plain (t) => number on the JS thread, which is all Animated.timing needs — so the
  // curve still comes from the motion tokens rather than a second, drifting copy.
  config: { duration: duration.base, easing: easing.enter },
};
