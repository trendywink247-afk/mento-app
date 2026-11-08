import { useEffect, useRef, useState } from 'react';
import { Dimensions, Keyboard, Platform, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Bottom padding that lifts a bottom-anchored view above the Android keyboard.
 *
 * Under edge-to-edge the window no longer resizes for the IME, so the view must pad itself.
 * This needs only two numbers in the SAME screen space: the keyboard's top edge (the IME event's
 * `screenY`) and the screen height. It never measures the view, because measuring the view's top
 * came out wrong on Android 16 (the composer sat 336 px under the keyboard on a Nothing Phone 1).
 * The view's own bottom sits `bottomInset` above the screen bottom (the safe-area padding), and the
 * keyboard covers that inset, so the padding is `screenHeight - keyboardTop - bottomInset`.
 */
export function keyboardPad(screenHeight: number, keyboardTop: number, bottomInset: number): number | undefined {
  if (![screenHeight, keyboardTop, bottomInset].every(Number.isFinite)) return undefined;
  const covered = screenHeight - keyboardTop;
  // Android emits a transient IME top near the screen top while it hides and shows. A keyboard
  // never covers most of the screen, so that is not a usable bound: keep the last good value.
  if (covered <= 0 || covered > screenHeight * 0.6) return undefined;
  return Math.max(0, covered - bottomInset);
}

export function useKeyboardPad(): ViewStyle | undefined {
  const { bottom } = useSafeAreaInsets();
  const inset = useRef(bottom);
  inset.current = bottom;
  const lastGood = useRef(0);
  const [pad, setPad] = useState(0);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const show = Keyboard.addListener('keyboardDidShow', (event) => {
      const next = keyboardPad(Dimensions.get('screen').height, event.endCoordinates.screenY, inset.current);
      if (next !== undefined) lastGood.current = next;
      setPad(lastGood.current);
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => { lastGood.current = 0; setPad(0); });
    return () => { show.remove(); hide.remove(); };
  }, []);
  return Platform.OS === 'android' && pad > 0 ? { paddingBottom: pad } : undefined;
}
