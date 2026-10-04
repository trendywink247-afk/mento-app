import { useEffect, useRef, useState } from 'react';
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
  const containerTop = useRef(top);
  containerTop.current = top;
  const lastValid = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const show = Keyboard.addListener('keyboardDidShow', (event) => {
      trace('show', undefined, event.endCoordinates.screenY);
      const candidate = event.endCoordinates.screenY;
      // Android can emit a transient IME top above the chat header during
      // hide/show (observed 48.76 vs header 92.19). That is not a usable bound:
      // applying it collapses the whole thread and removes the send hit target.
      if (Number.isFinite(candidate) && candidate > containerTop.current) {
        lastValid.current = candidate;
        setKeyboardTop(candidate);
      } else {
        trace('ignored-invalid-show', containerTop.current, candidate);
        setKeyboardTop(lastValid.current);
      }
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      trace('hide');
      setKeyboardTop(undefined);
    });
    trace('mount');
    const initial = Keyboard.metrics()?.screenY;
    if (initial !== undefined && Number.isFinite(initial) && initial > containerTop.current) {
      lastValid.current = initial;
      setKeyboardTop(initial);
    } else setKeyboardTop(undefined);
    let screen = Dimensions.get('screen');
    const dimensions = Dimensions.addEventListener('change', (event) => {
      // IME window resizing is expected; invalidate only actual screen changes.
      if (event.screen.width !== screen.width || event.screen.height !== screen.height) {
        lastValid.current = undefined;
        setKeyboardTop(undefined);
      }
      screen = event.screen;
    });
    return () => { trace('unmount'); show.remove(); hide.remove(); dimensions.remove(); };
  }, []);
  useEffect(() => { trace('boundary', top, keyboardTop); }, [top, keyboardTop]);
  if (Platform.OS !== 'android' || keyboardTop === undefined || keyboardTop <= top) return undefined;
  // Channel contains a height:'100%' child: maxHeight alone leaves its percentage
  // basis indefinite under Yoga and can collapse the thread's hit-test bounds.
  return { flex: 0, height: Math.max(0, keyboardTop - top) };
}
