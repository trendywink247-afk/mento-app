import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { useEffect } from 'react';

import { blocksScreenshots } from '@/lib/screenshotPolicy';

// expo-screen-capture is a native module: a build made before it was added does not have it, and
// requiring it there throws. Load it defensively so the same JavaScript runs on both (the block
// is simply inactive on the older build).
type ScreenCapture = {
  preventScreenCaptureAsync: (key?: string) => Promise<void>;
  allowScreenCaptureAsync: (key?: string) => Promise<void>;
};
let capture: ScreenCapture | null = null;
try {
  // reason: a static import would crash a build that lacks the native module.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  capture = require('expo-screen-capture') as ScreenCapture;
} catch {
  capture = null;
}

const KEY = 'mento-chat';

const cfg = Constants.expoConfig;
const APP_ID = Platform.OS === 'ios' ? cfg?.ios?.bundleIdentifier : cfg?.android?.package;
const BLOCK = blocksScreenshots(APP_ID);

/** Inside a conversation the screen cannot be captured or shown in the recent-apps view
 * (founder, 2026-11-10: "only inside chats"). Everywhere else, screenshots stay allowed.
 * The QA app is exempt (lib/screenshotPolicy.ts). */
export function usePreventScreenshots(active = true): void {
  useEffect(() => {
    if (!capture || !active || !BLOCK) return;
    void capture.preventScreenCaptureAsync(KEY).catch(() => {});
    return () => {
      void capture?.allowScreenCaptureAsync(KEY).catch(() => {});
    };
  }, [active]);
}
