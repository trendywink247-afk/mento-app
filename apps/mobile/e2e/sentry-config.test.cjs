const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('typescript');

const exportsObject = {};
vm.runInNewContext(ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../lib/sentryConfig.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText, { exports: exportsObject });
const { sentryInitOptions, scrubSentryEvent, SCRUBBED } = exportsObject;
const plain = value => JSON.parse(JSON.stringify(value));

const DSN = 'https://k@o.example/1';
const TEXT = 'i have been feeling hopeless since monday';

test('init options never allow replay, screenshots, view hierarchy, PII or tracing', () => {
  const opts = sentryInitOptions({ dsn: DSN, appEnv: 'production', gitSha: 'abc123' });
  assert.equal(opts.sendDefaultPii, false);
  assert.equal(opts.attachScreenshot, false);
  assert.equal(opts.attachViewHierarchy, false);
  assert.equal(opts.replaysSessionSampleRate, 0);
  assert.equal(opts.replaysOnErrorSampleRate, 0);
  assert.equal(opts.tracesSampleRate, 0);
  assert.equal(opts.maxBreadcrumbs, 0);
  assert.equal(opts.beforeSend, scrubSentryEvent);
  assert.equal(opts.beforeBreadcrumb({ message: TEXT }), null);
  assert.equal(opts.beforeSendTransaction({}), null);
  assert.equal(opts.dsn, DSN);
  assert.equal(opts.release, 'abc123');
});

test('no replay integration is configured', () => {
  const opts = sentryInitOptions({ dsn: DSN, appEnv: 'qa' });
  assert.equal('integrations' in opts, false);
  assert.equal('release' in opts, false);
});

test('environment: qa and staging report as qa, production as production', () => {
  for (const [appEnv, want] of [['qa', 'qa'], ['staging', 'qa'], ['production', 'production'], ['prod', 'production'], ['PROD', 'production'], ['QA', 'qa']]) {
    assert.equal(sentryInitOptions({ dsn: DSN, appEnv }).environment, want);
  }
});

test('anything else, or no DSN, leaves Sentry off', () => {
  for (const appEnv of [undefined, '', 'dev', 'test', 'prodution', 'produc']) {
    assert.equal(sentryInitOptions({ dsn: DSN, appEnv }), null, String(appEnv));
  }
  assert.equal(sentryInitOptions({ appEnv: 'production' }), null);
  assert.equal(sentryInitOptions({ dsn: '', appEnv: 'production' }), null);
});

const loaded = () => ({
  event_id: 'e1', level: 'error', release: 'abc123', environment: 'qa',
  message: TEXT,
  logentry: { message: 'bad %s', params: [TEXT] },
  transaction: 'ChatScreen',
  exception: { values: [{
    type: 'TypeError', value: `bad input: ${TEXT}`,
    mechanism: { type: 'onerror', handled: false, data: TEXT },
    stacktrace: { frames: [{
      filename: 'app/chat.tsx', function: 'send', lineno: 9, in_app: true,
      vars: { text: TEXT }, context_line: `throw new Error("${TEXT}")`, pre_context: [TEXT],
    }] },
  }] },
  breadcrumbs: [{ category: 'ui.input', message: TEXT }],
  extra: { draft: TEXT },
  user: { id: 'u1', ip_address: '203.0.113.9', email: 'a@b.c' },
  tags: { runtime: 'hermes', free_text: TEXT },
  contexts: {
    os: { name: 'Android' },
    device: {
      name: "Asha's Pixel", family: 'Pixel', model: 'Pixel 8', model_id: 'abc', simulator: false,
      arch: 'arm64', memory_size: 8, boot_time: 'x', timezone: 'Asia/Kolkata', locale: 'en_IN',
    },
    custom: { text: TEXT },
  },
  _meta: { message: { '': { val: TEXT } } },
  request: {
    method: 'POST', url: 'https://qa-app.mento.chat/chat?draft=hello#x',
    data: TEXT, cookies: 'a=b', query_string: 'draft=hello',
    headers: { 'X-Forwarded-For': '203.0.113.9', Authorization: 'Bearer x' },
  },
});

test('scrubber removes message content, identifiers and IPs from every field', () => {
  const out = scrubSentryEvent(loaded());
  const blob = JSON.stringify(out);
  assert.ok(!blob.includes(TEXT));
  assert.ok(!blob.includes('hopeless'));
  assert.ok(!blob.includes('203.0.113.9'));
  assert.ok(!blob.includes('a@b.c'));
  assert.ok(!blob.includes('Bearer') && !blob.includes('draft=hello'));
  for (const gone of ['breadcrumbs', 'extra', 'user', '_meta', 'message']) {
    assert.equal(gone in out, false, gone);
  }
  assert.deepEqual(Object.keys(out.request).sort(), ['method', 'url']);
});

test('scrubber keeps what debugging needs', () => {
  const out = plain(scrubSentryEvent(loaded()));
  assert.equal(out.release, 'abc123');
  assert.equal(out.transaction, 'ChatScreen');
  assert.deepEqual(out.exception.values[0].mechanism, { type: 'onerror', handled: false });
  assert.equal(out.exception.values[0].type, 'TypeError');
  assert.equal(out.exception.values[0].value, SCRUBBED);
  assert.deepEqual(out.exception.values[0].stacktrace.frames,
    [{ filename: 'app/chat.tsx', function: 'send', lineno: 9, in_app: true }]);
  assert.deepEqual(out.tags, { runtime: 'hermes' });
  assert.deepEqual(out.contexts.os, { name: 'Android' });
  assert.equal('custom' in out.contexts, false);
  assert.equal(out.request.url, 'https://qa-app.mento.chat/chat');
});

test('scrubber fails closed on malformed events', () => {
  assert.equal(scrubSentryEvent(null), null);
  assert.equal(scrubSentryEvent('boom'), null);
  const hostile = loaded();
  Object.defineProperty(hostile, 'exception', { get() { throw new Error('x'); }, enumerable: true });
  assert.equal(scrubSentryEvent(hostile), null);
});

test('device context keeps only family, model, model_id, simulator, arch', () => {
  const out = plain(scrubSentryEvent(loaded()));
  assert.deepEqual(out.contexts.device,
    { family: 'Pixel', model: 'Pixel 8', model_id: 'abc', simulator: false, arch: 'arm64' });
  assert.ok(!JSON.stringify(out).includes('Asha'));
  const odd = plain(scrubSentryEvent({ contexts: { device: 'Asha' } }));
  assert.deepEqual(odd.contexts.device, {});
});

test('request URLs: numeric, UUID and long-hex segments become {id}; userinfo/query/fragment go', () => {
  const urlOf = url => plain(scrubSentryEvent({ request: { method: 'GET', url } })).request.url;
  const cases = [
    ['https://h.example/chat/123/messages', 'https://h.example/chat/{id}/messages'],
    ['https://h.example/u/3f2b8c1e-9a4d-4e0b-8f6a-1c2d3e4f5a6b/notes', 'https://h.example/u/{id}/notes'],
    ['https://h.example/s/0123456789abcdef0123456789abcdef', 'https://h.example/s/{id}'],
    ['https://h.example/s/507F1F77BCF86CD799439011/x', 'https://h.example/s/{id}/x'],
    ['https://h.example/path/home', 'https://h.example/path/home'],
    ['https://h.example/feed/facade', 'https://h.example/feed/facade'],
    ['https://u:pw@h.example:8443/a/7?token=abc#frag', 'https://h.example:8443/a/{id}'],
    ['/chat/42?draft=hi', '/chat/{id}'],
    ['app:///chat/42', 'app:///chat/{id}'],
  ];
  for (const [input, want] of cases) assert.equal(urlOf(input), want, input);
});
