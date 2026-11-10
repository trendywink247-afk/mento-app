/**
 * "Please update the app": set when the server answers 426 `upgrade_required` (a build below its
 * MIN_APP_VERSION). One flag for the whole app; the root layout shows one calm screen while it is set.
 * Nothing is lost: the person's chats and account are untouched, the old build simply cannot talk to the server.
 */
import { useSyncExternalStore } from 'react';

let needed = false;
const listeners = new Set<() => void>();

export function raiseUpgradeRequired(): void {
  if (needed) return;
  needed = true;
  listeners.forEach((l) => l());
}

export function upgradeRequired(): boolean {
  return needed;
}

/** Test and sign-out helper: clear the flag. */
export function clearUpgradeRequired(): void {
  needed = false;
  listeners.forEach((l) => l());
}

export function useUpgradeRequired(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => needed,
    () => false,
  );
}

/** True for the server's refusal that means "this build is too old". */
export function isUpgradeRefusal(status: number, code: string | null): boolean {
  return status === 426 && code === 'upgrade_required';
}
