/**
 * Mento haptic vocabulary — one verb per MEANING, used sparingly (Apple HIG: haptics
 * carry meaning, never decoration). All no-op on web and swallow errors on devices
 * without a haptic engine. Do not call expo-haptics directly from components — add a
 * verb here if a genuinely new meaning appears.
 *
 * What is deliberately absent: there is no error / warning / limit verb. When something
 * goes wrong, or a member reaches a limit, the app goes STILL (T&S #11) — stillness is
 * the signal; nothing buzzes at a struggling person. Never add one.
 *
 * Android reality: many mid-range phones render every impact style as the same short
 * buzz, so a haptic is never the only signal — PressKey pairs each with key travel.
 */
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

const native = Platform.OS !== 'web';

export const haptic = {
  /** A choice was made: DOB wheel change, animal/colour swatch, button press. */
  tick() {
    if (native) Haptics.selectionAsync().catch(() => {});
  },
  /** A step forward in a flow (onboarding advance) and ordinary navigation keys. */
  advance() {
    if (native) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  },
  /** The member commits to something: a primary button (start, send request, save). */
  commit() {
    if (native) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  },
  /** A two-state control flipped (online / away, a setting). Softer than a commit. */
  toggle() {
    if (native) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft).catch(() => {});
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
