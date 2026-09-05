/** Web: no push, no handler, no taps (the web console/app never receives pushes). */
export function installNotificationHandler(): void {}
export function useNotificationTaps(): void {}
export function hasPendingTap(): boolean {
  return false;
}
