/**
 * One request, however many screens ask (lib/api.ts apiRequest).
 *
 * The same GET for the same session, asked while one is already on the wire, shares that one
 * request (an accept used to fire `/listener/me` four times in a second: the console refresh,
 * the pushed events, the catch-up and the chat screen mounting). A short list of slow-moving
 * reads (who I am, a member brief) is also served from a few seconds' memory, so a screen that
 * mounts right after another does not ask again. Lists that events update (requests,
 * conversations) are never served from memory: a pushed change must always read fresh.
 * Any write clears the memory, so nothing stale outlives an action the person took.
 * Pure (clock injected) so a node test can hold it to that.
 */
export const FRESH_MS = 5_000;

/** Reads that change only when the person acts (status, line, profile) or rarely (a brief). */
export const FRESH_PATHS: readonly RegExp[] = [
  /^\/me$/,
  /^\/listener\/me$/,
  /^\/listener\/me\/conversations\/[^/?]+\/brief$/,
];

export type Coalescer = {
  get<T>(key: string, path: string, run: () => Promise<T>): Promise<T>;
  /** A write happened (or the session changed): forget every remembered answer. */
  invalidate(): void;
};

export function createCoalescer(now: () => number = Date.now, freshMs = FRESH_MS): Coalescer {
  const inFlight = new Map<string, Promise<unknown>>();
  const remembered = new Map<string, { at: number; value: unknown }>();
  let epoch = 0;
  return {
    get<T>(key: string, path: string, run: () => Promise<T>): Promise<T> {
      const fresh = FRESH_PATHS.some((re) => re.test(path));
      if (fresh) {
        const hit = remembered.get(key);
        if (hit && now() - hit.at < freshMs) return Promise.resolve(hit.value as T);
      }
      const pending = inFlight.get(key);
      if (pending) return pending as Promise<T>;
      const started = epoch;
      const p = run().then(
        (value) => {
          // A write that landed while this read was on the wire makes its answer suspect.
          if (fresh && started === epoch) remembered.set(key, { at: now(), value });
          return value;
        },
      ).finally(() => {
        if (inFlight.get(key) === p) inFlight.delete(key);
      });
      inFlight.set(key, p);
      return p;
    },
    invalidate() {
      epoch += 1;
      remembered.clear();
    },
  };
}
