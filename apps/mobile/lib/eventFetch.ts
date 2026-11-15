/**
 * A pushed event asks for one list to be read again. Bursts are common (an accept pushes
 * `request.gone` and `conversation.changed` while the screen is already refreshing), so:
 *   - events are gathered for EVENT_SETTLE_MS, then ONE fetch runs;
 *   - that fetch is skipped when a read of the same list STARTED after the latest event, because
 *     such a read already sees the change (the refresh an action triggers usually is that read).
 * A fetch is only ever skipped when a newer one exists; an event is never dropped. Pure (clock
 * and timers injected) so a node test can count requests.
 */
export const EVENT_SETTLE_MS = 300;

type Timers = { set: (fn: () => void, ms: number) => unknown; clear: (h: unknown) => void };
const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export type EventFetch = {
  /** An event arrived for this list. */
  onEvent(): void;
  /** A read of this list is starting now (from anywhere: focus, an action, this fetcher). */
  started(): void;
  /** Stop: the screen has gone. */
  cancel(): void;
};

export function createEventFetch(
  fetch: () => unknown,
  { now = Date.now, timers = realTimers, settleMs = EVENT_SETTLE_MS }: { now?: () => number; timers?: Timers; settleMs?: number } = {},
): EventFetch {
  let lastStarted = -Infinity;
  let latestEvent = -Infinity;
  let timer: unknown = null;
  const self: EventFetch = {
    onEvent() {
      latestEvent = now();
      if (timer != null) return;
      timer = timers.set(() => {
        timer = null;
        if (lastStarted > latestEvent) return; // a newer read already covers every event
        self.started();
        void fetch();
      }, settleMs);
    },
    started() {
      lastStarted = now();
    },
    cancel() {
      if (timer != null) timers.clear(timer);
      timer = null;
    },
  };
  return self;
}
