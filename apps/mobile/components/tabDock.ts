import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** The floating tab bar (app/(tabs)/_layout.tsx) lies over the screens instead of taking its
 * own row, so every tab screen leaves this much room at its foot. The pill is 68 tall and
 * the dock under it keeps at least 20 from the screen edge (more with a gesture bar). */
export const TAB_BAR_HEIGHT = 68;
export const TAB_DOCK_MIN_INSET = 20;

export function tabDockHeight(bottomInset: number): number {
  return TAB_BAR_HEIGHT + Math.max(bottomInset, TAB_DOCK_MIN_INSET);
}

export function useTabDockHeight(): number {
  return tabDockHeight(useSafeAreaInsets().bottom);
}
