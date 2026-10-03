import { useEffect, useState } from 'react';
import { Keyboard, Platform, type ViewStyle } from 'react-native';

/** Bound the entire Android thread above the IME in screen coordinates.
 * Stream's nested percentage-height child can remain underneath the keyboard
 * when its internal height avoidance races Android window resizing.
 */
export function useChatKeyboardBoundary(top: number): ViewStyle | undefined {
  const [keyboardTop, setKeyboardTop] = useState<number | undefined>(
    () => Keyboard.metrics()?.screenY,
  );
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const show = Keyboard.addListener('keyboardDidShow', (event) => {
      setKeyboardTop(event.endCoordinates.screenY);
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardTop(undefined));
    setKeyboardTop(Keyboard.metrics()?.screenY);
    return () => { show.remove(); hide.remove(); };
  }, []);
  if (Platform.OS !== 'android' || keyboardTop === undefined) return undefined;
  return { maxHeight: Math.max(0, keyboardTop - top) };
}
