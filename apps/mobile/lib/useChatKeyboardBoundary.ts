import { useEffect, useState } from 'react';
import { Dimensions, Keyboard, Platform, type ViewStyle } from 'react-native';

// Opt-in CI geometry only: never log draft text, identities or channel metadata.
function trace(event: string, top?: number, keyboardTop?: number) {
  if (process.env.EXPO_PUBLIC_NATIVE_LAYOUT_DIAGNOSTICS !== '1') return;
  console.log('[ChatKeyboard]', JSON.stringify({ event, top, keyboardTop,
    visible: Keyboard.isVisible(), metricTop: Keyboard.metrics()?.screenY,
    windowHeight: Dimensions.get('window').height,
    screenHeight: Dimensions.get('screen').height }));
}

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
      trace('show', undefined, event.endCoordinates.screenY);
      setKeyboardTop(event.endCoordinates.screenY);
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      trace('hide');
      setKeyboardTop(undefined);
    });
    trace('mount');
    setKeyboardTop(Keyboard.metrics()?.screenY);
    return () => { trace('unmount'); show.remove(); hide.remove(); };
  }, []);
  useEffect(() => { trace('boundary', top, keyboardTop); }, [top, keyboardTop]);
  if (Platform.OS !== 'android' || keyboardTop === undefined) return undefined;
  // Channel contains a height:'100%' child: maxHeight alone leaves its percentage
  // basis indefinite under Yoga and can collapse the thread's hit-test bounds.
  return { flex: 0, height: Math.max(0, keyboardTop - top) };
}
