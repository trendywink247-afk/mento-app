/**
 * The size a screen may draw into. On web above `layout.columnMax` that is the app
 * column, not the browser window — so NEVER size from `useWindowDimensions` in a
 * screen or a piece of art; use this. Native, phone-width web and /admin have no
 * frame, and this falls through to the window.
 */
import { createContext, useContext } from 'react';
import { useWindowDimensions } from 'react-native';

export type FrameSize = { width: number; height: number };

/** null = unframed (native, phone-width web, /admin). Provided by components/WebFrame.web. */
export const FrameSizeContext = createContext<FrameSize | null>(null);

export function useFrameSize(): FrameSize {
  const frame = useContext(FrameSizeContext);
  const { width, height } = useWindowDimensions();
  return frame ?? { width, height };
}
