/** Native suspension keeps one controller's in-memory pending ids. Foregrounding
 * never reconstructs a terminal/revoked client; explicit retry creates a new one.
 * No message/token persistence and no background send/read/presence work.
 */
export function createNativeOwnChatLifecycle(
  controller: { start(): unknown; pause(): void; dispose(): void },
  canResume: () => boolean,
  initial: { focused: boolean; foreground: boolean },
) {
  let { focused, foreground } = initial;
  let running = false;
  let disposed = false;
  function sync() {
    if (disposed) return;
    const next = focused && foreground && canResume();
    if (next === running) return;
    running = next;
    if (next) void controller.start();
    else controller.pause();
  }
  sync();
  return {
    setFocused(value: boolean) { focused = value; sync(); },
    setForeground(value: boolean) { foreground = value; sync(); },
    readable: () => !disposed && focused && foreground && canResume(),
    dispose() { if (!disposed) { disposed = true; controller.dispose(); } },
  };
}
