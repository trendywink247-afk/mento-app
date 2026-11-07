import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView as RNKeyboardAvoidingView,
  Platform,
  StyleSheet,
  View,
  type KeyboardAvoidingViewProps,
} from 'react-native';

/**
 * Drop-in for React Native's KeyboardAvoidingView. iOS keeps the stock behaviour.
 *
 * On Android (edge-to-edge since SDK 55) the window no longer resizes for the IME and the
 * stock view only pads when told `behavior`, using parent-relative frames that are off by
 * the status bar — so forms (Journal, Feedback, Recover, Reflection) had their Save button
 * hidden under the keyboard. This pads the bottom by exactly how far the view's own bottom
 * edge sits below the keyboard top, both in screen coordinates (`measure`'s pageY and the
 * keyboard's screenY). The padding is inside the view, so its measured bottom never moves.
 */
export function KeyboardAvoidingView(props: KeyboardAvoidingViewProps) {
  if (Platform.OS !== 'android') return <RNKeyboardAvoidingView {...props} />;
  return <AndroidKeyboardAvoidingView {...props} />;
}

function AndroidKeyboardAvoidingView({
  style,
  children,
  onLayout,
  behavior: _behavior,
  keyboardVerticalOffset: _keyboardVerticalOffset,
  contentContainerStyle: _contentContainerStyle,
  enabled: _enabled,
  ...rest
}: KeyboardAvoidingViewProps) {
  const ref = useRef<View>(null);
  const keyboardTop = useRef<number | undefined>(undefined);
  const [pad, setPad] = useState(0);

  const update = useCallback(() => {
    const top = keyboardTop.current;
    if (top === undefined) {
      setPad(0);
      return;
    }
    ref.current?.measure((_x, _y, _w, height, _pageX, pageY) => {
      setPad(Math.max(0, pageY + height - top));
    });
  }, []);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (event) => {
      keyboardTop.current = event.endCoordinates.screenY;
      update();
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      keyboardTop.current = undefined;
      setPad(0);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, [update]);

  const base = StyleSheet.flatten(style)?.paddingBottom;
  return (
    <View
      {...rest}
      ref={ref}
      style={[style, { paddingBottom: (typeof base === 'number' ? base : 0) + pad }]}
      onLayout={(event) => {
        onLayout?.(event);
        update();
      }}
    >
      {children}
    </View>
  );
}
