// Duplicate fetch bursts (an accept fired /listener/me x4, conversations x3, brief x2 in a second):
// one request however many screens ask, and pushed events settle into one fetch.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const load = (file) => {
  const mod = {};
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    { exports: mod, require: () => ({}) },
  );
  return mod;
};
const { createCoalescer, FRESH_MS } = load('lib/getCoalescer.ts');
const { createEventFetch, EVENT_SETTLE_MS } = load('lib/eventFetch.ts');

const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

test('N concurrent identical GETs -> one request, every caller gets the answer', async () => {
  const c = createCoalescer(() => 0);
  let calls = 0;
  const gate = deferred();
  const run = () => (calls++, gate.promise);
  const all = Promise.all(Array.from({ length: 5 }, () => c.get('tok /listener/me/conversations', '/listener/me/conversations', run)));
  gate.resolve(['row']);
  assert.deepEqual(await all, Array(5).fill(['row']));
  assert.equal(calls, 1);
});

test('lists are never served from memory; slow reads are, for a few seconds', async () => {
  let t = 0;
  const c = createCoalescer(() => t);
  let lists = 0, mes = 0;
  await c.get('k /listener/me/conversations', '/listener/me/conversations', async () => ++lists);
  await c.get('k /listener/me/conversations', '/listener/me/conversations', async () => ++lists);
  assert.equal(lists, 2); // a pushed change must always read fresh
  await c.get('k /listener/me', '/listener/me', async () => ++mes);
  t = FRESH_MS - 1;
  await c.get('k /listener/me', '/listener/me', async () => ++mes);
  assert.equal(mes, 1); // chat screen mounting right after the console: no second /me
  t = FRESH_MS + 1;
  await c.get('k /listener/me', '/listener/me', async () => ++mes);
  assert.equal(mes, 2);
});

test('a write forgets remembered reads, including one that was on the wire during the write', async () => {
  const c = createCoalescer(() => 0);
  let n = 0;
  await c.get('k /me', '/me', async () => ++n);
  c.invalidate();
  await c.get('k /me', '/me', async () => ++n);
  assert.equal(n, 2);
  const gate = deferred();
  const racing = c.get('k2 /me', '/me', () => gate.promise);
  c.invalidate(); // the write lands while the read is in flight
  gate.resolve('old');
  await racing;
  await c.get('k2 /me', '/me', async () => 'new');
  assert.equal(await c.get('k2 /me', '/me', async () => 'newer'), 'new');
});

test('different sessions never share an answer', async () => {
  const c = createCoalescer(() => 0);
  const a = await c.get('A /me', '/me', async () => 'member A');
  const b = await c.get('B /me', '/me', async () => 'member B');
  assert.deepEqual([a, b], ['member A', 'member B']);
});

function fakeClock() {
  let now = 0; const queue = [];
  return {
    now: () => now,
    timers: { set: (fn, ms) => { const h = { at: now + ms, fn }; queue.push(h); return h; }, clear: (h) => { const i = queue.indexOf(h); if (i >= 0) queue.splice(i, 1); } },
    advance(ms) { now += ms; for (const h of [...queue].sort((x, y) => x.at - y.at)) if (h.at <= now) { queue.splice(queue.indexOf(h), 1); h.fn(); } },
  };
}

test('a burst of pushed events settles into one fetch', () => {
  const clock = fakeClock();
  let fetches = 0;
  const f = createEventFetch(() => fetches++, clock);
  for (let i = 0; i < 4; i += 1) { f.onEvent(); clock.advance(20); }
  clock.advance(EVENT_SETTLE_MS);
  assert.equal(fetches, 1);
});

test('an event already covered by a read that started after it fetches nothing more', () => {
  const clock = fakeClock();
  let fetches = 0;
  const f = createEventFetch(() => fetches++, clock);
  f.onEvent(); // request.gone after an accept
  clock.advance(5);
  f.started(); // the accept's own refresh begins after the event
  clock.advance(EVENT_SETTLE_MS);
  assert.equal(fetches, 0);
});

test('an event after the last read is never dropped', () => {
  const clock = fakeClock();
  let fetches = 0;
  const f = createEventFetch(() => fetches++, clock);
  f.started();
  clock.advance(5);
  f.onEvent();
  clock.advance(EVENT_SETTLE_MS);
  assert.equal(fetches, 1);
  f.onEvent(); clock.advance(1); f.cancel(); clock.advance(EVENT_SETTLE_MS);
  assert.equal(fetches, 1); // a screen that left fetches nothing
});

test('GETs go through the coalescer and every write clears it; the console and live refresh settle events', () => {
  const api = fs.readFileSync('lib/api.ts', 'utf8');
  assert.match(api, /gets\.get<T>\(/);
  assert.match(api, /finally \{[\s\S]*?gets\.invalidate\(\)/);
  assert.match(fs.readFileSync('lib/useMentorConsole.ts', 'utf8'), /conversations\.onEvent\(\)/);
  assert.match(fs.readFileSync('lib/liveEvents.ts', 'utf8'), /settled\.current\?\.onEvent\(\)/);
});

test('no endless animation loop on the chat screen tree: breathing, presence ripple and pip rest', () => {
  for (const f of ['components/motion/useBreathing.ts', 'components/chat/ChatHeaderCard.tsx', 'components/chat/AllowanceMeter.tsx']) {
    const src = fs.readFileSync(f, 'utf8');
    assert.doesNotMatch(src, /withRepeat\([\s\S]{0,200}?,\s*-1\s*,/, `${f} still loops forever`);
  }
  const { breathHalves, BREATHS_BEFORE_REST } = load('components/motion/useBreathing.ts');
  assert.equal(breathHalves(BREATHS_BEFORE_REST) % 2, 0); // even: the reversing repeat ends at rest
  assert.ok(breathHalves(BREATHS_BEFORE_REST) > 0);
});
