/** Shake anywhere in the app to check EAS Update — a device-testing affordance
 * (v1 test pass, not a discoverable product feature — no onboarding hint, no
 * UI beyond a single haptic tick). Inert in Expo Go/dev server (no update
 * channel there, see lib/updates.ts) so the accelerometer subscription is
 * skipped entirely rather than spun up for nothing.
 */
import { Accelerometer } from 'expo-sensors';
import * as Updates from 'expo-updates';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { haptic } from './haptics';
import { checkAndApplyUpdate } from './updates';

const SHAKE_THRESHOLD = 2.2; // summed per-axis delta between samples — a deliberate shake, not a pocket jostle
const COOLDOWN_MS = 4000;

export function useShakeToUpdate(): void {
  const checking = useRef(false);

  useEffect(() => {
    if (Platform.OS === 'web' || !Updates.isEnabled) return;

    let last = { x: 0, y: 0, z: 0 };
    let lastFired = 0;

    Accelerometer.setUpdateInterval(200);
    const sub = Accelerometer.addListener(({ x, y, z }) => {
      const delta = Math.abs(x - last.x) + Math.abs(y - last.y) + Math.abs(z - last.z);
      last = { x, y, z };
      const now = Date.now();
      if (delta > SHAKE_THRESHOLD && now - lastFired > COOLDOWN_MS && !checking.current) {
        lastFired = now;
        checking.current = true;
        haptic.nudge();
        void checkAndApplyUpdate().finally(() => {
          checking.current = false;
        });
      }
    });

    return () => sub.remove();
  }, []);
}
