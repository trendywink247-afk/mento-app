// Sentry for web + native. Pure (no SDK import) so a node test can assert the exact
// options. Mento is an emotional-support app: nothing a member typed, no screen
// capture and no IP may leave the device through an error report.

type SentryEvent = Record<string, unknown>;

// APP_ENV -> Sentry environment (prod is an alias for production). Anything else (dev, unset, a typo) = Sentry off, so a
// misconfigured build can never report as production.
const ENVIRONMENTS: Record<string, 'qa' | 'production'> = {
  qa: 'qa',
  staging: 'qa',
  prod: 'production',
  production: 'production',
};

const KEEP_TOP = ['event_id', 'timestamp', 'platform', 'level', 'sdk', 'release', 'environment'];
const KEEP_FRAME = ['filename', 'abs_path', 'function', 'module', 'lineno', 'colno', 'in_app'];
const KEEP_TAGS = ['runtime', 'handled', 'mechanism'];
const KEEP_CONTEXTS = ['runtime', 'os', 'device'];
// device.name is the owner's chosen device name ("Asha's phone"): never keep it.
const KEEP_DEVICE = ['family', 'model', 'model_id', 'simulator', 'arch'];
// A path segment that is an id: all digits, a UUID, or 12+ hex chars (ObjectIds, tokens).
const ID_SEGMENT = /^(?:\d+|[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}|[0-9a-f]{12,})$/i;
export const SCRUBBED = '[scrubbed]';

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const pick = (src: Record<string, unknown>, keys: string[]) => {
  const out: Record<string, unknown> = {};
  for (const key of keys) if (key in src) out[key] = src[key];
  return out;
};

// Literal journal sub-routes (app/journal/write.tsx, organize.tsx): not member data.
const JOURNAL_LITERALS = ['write', 'organize'];

/** Journal routes carry the entry's category (can be health information) and a day:
 * `journal/<channel>` -> `journal/{channel}`, `journal/day/<date>` -> `journal/{date}`. */
function scrubJournalSegments(segments: string[]): string[] {
  const out = [...segments];
  for (let i = 0; i < out.length - 1; i++) {
    if (out[i].toLowerCase() !== 'journal') continue;
    if (out[i + 1] === 'day') {
      if (i + 2 < out.length && out[i + 2] !== '') out[i + 2] = '{date}';
    } else if (out[i + 1] !== '' && !JOURNAL_LITERALS.includes(out[i + 1])) {
      out[i + 1] = '{channel}';
    }
  }
  return out;
}

/** Scheme + host + path with id segments replaced by `{id}`, journal channel/date by
 * `{channel}`/`{date}`; no userinfo, query or fragment. */
function scrubUrl(url: string): string {
  const absolute = /^([a-z][a-z0-9+.-]*:\/\/)([^/?#]*)([^?#]*)/i.exec(url);
  const origin = absolute ? absolute[1] + (absolute[2].split('@').pop() ?? '') : '';
  const path = absolute ? absolute[3] : url.split(/[?#]/)[0];
  const segments = path.split('/').map(seg => (ID_SEGMENT.test(seg) ? '{id}' : seg));
  return origin + scrubJournalSegments(segments).join('/');
}

function scrubContexts(contexts: Record<string, unknown>): Record<string, unknown> {
  const out = pick(contexts, KEEP_CONTEXTS);
  if ('device' in out) out.device = isObject(out.device) ? pick(out.device, KEEP_DEVICE) : {};
  return out;
}

function scrubException(exc: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = { value: SCRUBBED }; // a message can quote member text
  if (!isObject(exc)) return out;
  if (typeof exc.type === 'string') out.type = exc.type;
  if (typeof exc.module === 'string') out.module = exc.module;
  if (isObject(exc.mechanism)) out.mechanism = pick(exc.mechanism, ['type', 'handled']);
  const frames = isObject(exc.stacktrace) ? exc.stacktrace.frames : undefined;
  if (Array.isArray(frames)) {
    // No vars / context lines: locals and source text can hold content.
    out.stacktrace = { frames: frames.filter(isObject).map(f => pick(f, KEEP_FRAME)) };
  }
  return out;
}

/** `beforeSend`: rebuild the event from an allowlist. Kept: id, time, level, release,
 * environment, exception type + frames, the route/screen name, method + URL with id
 * path segments replaced by `{id}`, journal channel/date by `{channel}`/`{date}`, no query; device context limited to
 * family/model/model_id/simulator/arch. Dropped: messages, breadcrumbs, request headers/body/cookies, user + IP,
 * extra, `_meta`. Fails closed (returns null) if scrubbing throws. */
export function scrubSentryEvent<T>(event: T): T | null {
  try {
    if (!isObject(event)) return null;
    const out: SentryEvent = pick(event, KEEP_TOP);
    if (typeof event.transaction === 'string') out.transaction = scrubUrl(event.transaction);
    const values = isObject(event.exception) ? event.exception.values : undefined;
    if (Array.isArray(values)) out.exception = { values: values.map(scrubException) };
    if (event.message || event.logentry) out.logentry = { message: SCRUBBED };
    if (isObject(event.request)) {
      const req: SentryEvent = {};
      if (typeof event.request.method === 'string') req.method = event.request.method;
      if (typeof event.request.url === 'string') {
        req.url = scrubUrl(event.request.url);
      }
      out.request = req;
    }
    if (isObject(event.tags)) out.tags = pick(event.tags, KEEP_TAGS);
    if (isObject(event.contexts)) out.contexts = scrubContexts(event.contexts);
    return out as T;
  } catch {
    return null;
  }
}

export function sentryEnvironment(appEnv: string | undefined): 'qa' | 'production' | null {
  return ENVIRONMENTS[(appEnv ?? '').trim().toLowerCase()] ?? null;
}

/** Options for `Sentry.init`, or null = leave Sentry off (no DSN, or APP_ENV is not
 * qa/staging/prod/production). `release` is the git sha, omitted when not supplied. */
export function sentryInitOptions(input: {
  dsn?: string;
  appEnv?: string;
  gitSha?: string;
}): Record<string, unknown> | null {
  const environment = sentryEnvironment(input.appEnv);
  if (!input.dsn || !environment) return null;
  return {
    dsn: input.dsn,
    environment,
    ...(input.gitSha ? { release: input.gitSha } : {}),
    sendDefaultPii: false,
    attachScreenshot: false,
    attachViewHierarchy: false,
    replaysSessionSampleRate: 0, // never: a replay would capture chat screens
    replaysOnErrorSampleRate: 0,
    tracesSampleRate: 0,
    enableAutoSessionTracking: false,
    // JS-only reporting: the JS beforeSend never reaches the native SDKs, so native crash
    // events would bypass the scrubber. Revisit when a native scrubber exists.
    enableNative: false,
    maxBreadcrumbs: 0,
    beforeSend: scrubSentryEvent,
    beforeSendTransaction: () => null,
    beforeBreadcrumb: () => null,
  };
}
