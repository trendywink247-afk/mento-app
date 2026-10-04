const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('typescript');
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../lib/analyticsPolicy.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText, { exports: exportsObject });
const { safeEvent, createPrivateAnalytics, mayCaptureFirstMessage } = exportsObject;
const plain = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(setImmediate);
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

test('all existing approved event shapes survive the runtime boundary', () => {
  const shapes = {
    landing_viewed: undefined, onboarding_started: undefined,
    role_chosen: { role: 'mentee' }, onboarding_age_passed: undefined,
    onboarding_email_step: { skipped: true }, onboarding_companion_chosen: { companion: 'Panda' },
    onboarding_completed: undefined, path_chosen: { community: 'life' },
    match_requested: { mode: 'general' }, match_found: { wait_bucket: '<5s' },
    chat_first_message_sent: undefined, reflection_submitted: undefined,
    mentor_profile_viewed: undefined, mentor_favourited: { on: false },
  };
  for (const [event, props] of Object.entries(shapes)) {
    assert.deepEqual(plain(safeEvent(event, props)), props ?? {});
  }
  for (const companion of ['Panda', 'Elephant', 'Fox', 'Turtle', 'Deer', 'Owl', 'Dog', 'Cat', 'Capybara']) {
    assert.deepEqual(plain(safeEvent('onboarding_companion_chosen', { companion })), { companion });
  }
  for (const community of ['upsc', 'neet', 'jee', 'exams', 'life']) {
    assert.deepEqual(plain(safeEvent('path_chosen', { community })), { community });
  }
});

test('unknown/crisis events and malformed values never cross the boundary', () => {
  for (const event of ['crisis_flagged', 'message_sent', '__proto__', 'constructor', '', null, {}]) {
    assert.equal(safeEvent(event, { text: 'private' }), null);
  }
  for (const [event, props] of [
    ['role_chosen', { role: 'private-name' }], ['onboarding_companion_chosen', { companion: 'email@example.test' }],
    ['path_chosen', { community: 'phone:12345678' }], ['match_found', { wait_bucket: 0 }],
    ['onboarding_email_step', { skipped: 'yes' }], ['mentor_favourited', { on: 1 }],
    ['role_chosen', {}], ['role_chosen', Object.create({ role: 'mentee' })],
    ['landing_viewed', null], ['landing_viewed', []], ['landing_viewed', 'private'],
  ]) assert.equal(safeEvent(event, props), null);
});

test('first-message decision refuses crisis metadata without reading private contents', () => {
  assert.equal(mayCaptureFirstMessage({ id: 'message', text: 'ordinary' }), true);
  for (const message of [null, undefined, 'private', [], { crisis: { signal: 'private' } },
    { crisis: undefined }, Object.create({ crisis: {} })]) {
    assert.equal(mayCaptureFirstMessage(message), false);
  }
  const withGetter = Object.defineProperty({}, 'crisis', { get() { throw new Error('never read'); } });
  assert.equal(mayCaptureFirstMessage(withGetter), false);
});

test('extra private properties and serialization hooks are never read or serialized', () => {
  const props = { role: 'mentor', email: 'private@example.test', message: 'private' };
  Object.defineProperty(props, 'toJSON', { get() { throw new Error('must not inspect extras'); } });
  assert.deepEqual(plain(safeEvent('role_chosen', props)), { role: 'mentor' });
  const accessor = Object.defineProperty({}, 'role', { get() { throw new Error('must not inspect accessors'); } });
  assert.equal(safeEvent('role_chosen', accessor), null);
});

test('dark mode and rejected events do no identity or network work', async () => {
  let work = 0;
  const deps = { enabled: false, loadOrCreateId: async () => { work++; return 'id'; },
    forgetId: async () => {}, send: () => { work++; } };
  createPrivateAnalytics(deps).capture('landing_viewed');
  createPrivateAnalytics({ ...deps, enabled: true }).capture('crisis_flagged', { text: 'private' });
  await tick();
  assert.equal(work, 0);
});

test('payload snapshots resist mutation while asynchronous identity storage completes', async () => {
  const id = deferred(), sent = [];
  const analytics = createPrivateAnalytics({ enabled: true, loadOrCreateId: () => id.promise,
    forgetId: async () => {}, send: (event, props, identity) => sent.push({ event, props: plain(props), identity }) });
  const props = { role: 'mentee' };
  analytics.capture('role_chosen', props);
  props.role = 'private';
  props.email = 'private@example.test';
  id.resolve('analytics-id');
  await tick();
  assert.deepEqual(sent, [{ event: 'role_chosen', props: { role: 'mentee' }, identity: 'analytics-id' }]);
});

test('forget fences pending captures and waits for old identity write before removing it', async () => {
  const oldWrite = deferred(), operations = [], sent = [];
  let loads = 0;
  const analytics = createPrivateAnalytics({ enabled: true, loadOrCreateId: async () => {
    loads++;
    if (loads === 1) { operations.push('old-start'); await oldWrite.promise; operations.push('old-written'); return 'old'; }
    operations.push('new-written'); return 'new';
  }, forgetId: async () => { operations.push('removed'); }, send: (event, props, id) => sent.push(id) });
  analytics.capture('landing_viewed');
  await tick();
  const forgetting = analytics.forget();
  analytics.capture('landing_viewed'); // reset underway: telemetry stays dark
  oldWrite.resolve();
  await forgetting;
  await tick();
  assert.deepEqual(operations, ['old-start', 'old-written', 'removed']);
  assert.deepEqual(sent, []);
  analytics.capture('landing_viewed');
  await tick();
  assert.deepEqual(sent, ['new']);
});

test('failed reset keeps analytics dark until a successful storage removal', async () => {
  let fail = true, loads = 0, sent = 0;
  const analytics = createPrivateAnalytics({ enabled: true, loadOrCreateId: async () => { loads++; return 'id'; },
    forgetId: async () => { if (fail) throw new Error('unavailable'); }, send: () => { sent++; } });
  await analytics.forget();
  analytics.capture('landing_viewed');
  await tick();
  assert.equal(loads, 0);
  assert.equal(sent, 0);
  fail = false;
  await analytics.forget();
  analytics.capture('landing_viewed');
  await tick();
  assert.equal(sent, 1);
});

test('identity and transport failures stay silent and a later capture may retry', async () => {
  let loads = 0, sends = 0;
  const analytics = createPrivateAnalytics({ enabled: true, loadOrCreateId: async () => {
    loads++; if (loads === 1) throw new Error('storage unavailable'); return 'id';
  }, forgetId: async () => {}, send: () => { sends++; throw new Error('network unavailable'); } });
  assert.doesNotThrow(() => analytics.capture('landing_viewed'));
  await tick();
  assert.doesNotThrow(() => analytics.capture('landing_viewed'));
  await tick();
  assert.equal(loads, 2);
  assert.equal(sends, 1);
});

test('public analytics wrapper sends only sanitized data and rotates stored identity', async () => {
  const stored = new Map(), requests = [];
  const wrapper = {};
  vm.runInNewContext(ts.transpileModule(
    fs.readFileSync(path.join(__dirname, '../lib/analytics.ts'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText, {
    exports: wrapper,
    require: name => name === 'react-native' ? { Platform: { OS: 'web' } } : exportsObject,
    process: { env: { EXPO_PUBLIC_POSTHOG_KEY: 'test-key', EXPO_PUBLIC_POSTHOG_HOST: 'https://example.test' } },
    localStorage: { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value),
      removeItem: key => stored.delete(key) },
    fetch: async (url, options) => { requests.push({ url, body: JSON.parse(options.body) }); },
  });
  wrapper.capture('role_chosen', { role: 'mentee', email: 'private@example.test', text: 'private' });
  wrapper.capture('crisis_flagged', { text: 'private' });
  await tick();
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].body.properties, { role: 'mentee' });
  assert.equal(JSON.stringify(requests).includes('private'), false);
  wrapper.captureFirstMessage({ id: 'message', crisis: { signal: 'private' } });
  await tick();
  assert.equal(requests.length, 1);
  const oldId = requests[0].body.distinct_id;
  assert.equal(stored.get('mento.analytics_id'), oldId);
  await wrapper.forgetAnalyticsId();
  assert.equal(stored.has('mento.analytics_id'), false);
  wrapper.capture('landing_viewed');
  await tick();
  assert.notEqual(requests[1].body.distinct_id, oldId);
});
