/**
 * Mento haptic vocabulary — four meanings, used sparingly (Apple HIG: haptics carry
 * meaning, never decoration). All no-op on web and swallow errors on devices without
 * a haptic engine. Do not call expo-haptics directly from components — add a verb
 * here if a genuinely new meaning appears.
 */
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

const native = Platform.OS !== 'web';

export const haptic = {
  /** A choice was made: DOB wheel change, animal/colour swatch, button press. */
  tick() {
    if (native) Haptics.selectionAsync().catch(() => {});
  },
  /** A step forward in a flow (onboarding advance). */
  advance() {
    if (native) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  },
  /** A moment of arrival: match found. */
  success() {
    if (native) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  },
  /** A passive gesture was recognized and a background action silently kicked
   * off (shake-to-check-for-update) — acknowledges the input, not a choice. */
  nudge() {
    if (native) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  },
};
