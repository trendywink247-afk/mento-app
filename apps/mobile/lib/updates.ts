/** EAS Update check-and-apply — shared by the Profile "Check for updates" row
 * and the shake gesture (lib/useShakeToUpdate.ts). No auto-check-on-launch: a
 * silent mid-session app restart would be a jarring surprise, not a Calm-
 * register interaction — every check is a deliberate user action.
 */
import * as Updates from 'expo-updates';

export type UpdateStatus = 'checking' | 'downloading' | 'restarting' | 'upToDate' | 'checkFailed';

/** Resolves to the terminal status. On a real update it calls `reloadAsync()`,
 * which restarts the JS context — callers after that point never run. */
export async function checkAndApplyUpdate(
  onStatus?: (status: UpdateStatus) => void,
): Promise<UpdateStatus> {
  if (!Updates.isEnabled) return 'upToDate'; // Expo Go / dev server — no update channel
  onStatus?.('checking');
  try {
    const check = await Updates.checkForUpdateAsync();
    if (!check.isAvailable) {
      onStatus?.('upToDate');
      return 'upToDate';
    }
    onStatus?.('downloading');
    await Updates.fetchUpdateAsync();
    onStatus?.('restarting');
    await Updates.reloadAsync();
    return 'restarting'; // unreachable after reload; kept for type completeness
  } catch {
    onStatus?.('checkFailed');
    return 'checkFailed';
  }
}

/** What JS is running right now — the built-in bundle or an over-the-air update.
 * Shown under the Profile update row so a device test can prove OTA landed
 * (session 31f: "You're up to date" alone could not distinguish the two). */
export function runningUpdate(): { kind: 'embedded' | 'ota' | 'dev'; id: string | null; at: Date | null } {
  if (!Updates.isEnabled) return { kind: 'dev', id: null, at: null };
  return {
    kind: Updates.isEmbeddedLaunch ? 'embedded' : 'ota',
    id: Updates.updateId ? Updates.updateId.slice(0, 8) : null,
    at: Updates.createdAt ?? null,
  };
}
