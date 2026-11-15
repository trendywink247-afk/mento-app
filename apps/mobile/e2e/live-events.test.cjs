const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const core = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../lib/liveEventsCore.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: core, URL, Promise, JSON, Math, setTimeout, clearTimeout });

const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

function harness({ token = 'tok-a', app = 'active', random = () => 0.5 } = {}) {
  const sockets = [];
  const timers = new Map();
  let nextTimer = 1;
  const appListeners = new Set();
  const netListeners = new Set();
  const refreshes = [];
  const state = { app, token };
  const deps = {
    url: 'wss://qa-api.example/api/v1/events',
    createSocket(url) {
      const s = { url, sent: [], closed: null, onopen: null, onmessage: null, onclose: null, onerror: null,
        send(d) { this.sent.push(JSON.parse(d)); }, close(code) { this.closed = code ?? 1000; } };
      sockets.push(s);
      return s;
    },
    getToken: async () => state.token,
    refreshToken: async (role) => { refreshes.push(role); state.token = 'tok-b'; },
    appState: { current: () => state.app, subscribe(cb) { appListeners.add(cb); return () => appListeners.delete(cb); } },
    network: { subscribe(cb) { netListeners.add(cb); return () => netListeners.delete(cb); } },
    timers: {
      set(cb, ms) { const id = nextTimer++; timers.set(id, { cb, ms }); return id; },
      clear(id) { timers.delete(id); },
    },
    random,
  };
  const conn = core.createLiveConnection('listener', deps);
  return {
    conn, sockets, timers, refreshes, state,
    last: () => sockets[sockets.length - 1],
    setApp(s) { state.app = s; for (const cb of [...appListeners]) cb(s); },
    setNet(on) { for (const cb of [...netListeners]) cb(on); },
    /** Fire the only pending timer whose delay matches `ms` (or the first pending one). */
    fire(ms) {
      const entry = [...timers.entries()].find(([, t]) => ms === undefined || t.ms === ms);
      assert.ok(entry, `no timer${ms === undefined ? '' : ` of ${ms} ms`} pending: ${[...timers.values()].map(t => t.ms)}`);
      timers.delete(entry[0]);
      entry[1].cb();
    },
    pending: () => [...timers.values()].map(t => t.ms),
  };
}

async function open(h) {
  await flush();
  const s = h.last();
  s.onopen();
  s.onmessage({ data: JSON.stringify({ t: 'hello' }) });
  return s;
}

test('the events URL follows the API origin, wss only for remote hosts, nothing in the URL', () => {
  assert.equal(core.liveEventsUrl('https://qa-api.mento.chat/api/v1'), 'wss://qa-api.mento.chat/api/v1/events');
  assert.equal(core.liveEventsUrl('http://localhost:8000/api/v1/'), 'ws://localhost:8000/api/v1/events');
  assert.throws(() => core.liveEventsUrl('http://qa-api.mento.chat/api/v1'));
  assert.throws(() => core.liveEventsUrl('https://u:p@qa-api.mento.chat/api/v1'));
  assert.throws(() => core.liveEventsUrl('https://qa-api.mento.chat/api/v1?x=1'));
});

test('no subscriber, no socket; a subscriber in the foreground opens one and authenticates in the first frame', async () => {
  const h = harness();
  await flush();
  assert.equal(h.sockets.length, 0);
  const seen = [];
  h.conn.subscribe(['resync', 'request.new'], e => seen.push(e.t));
  await flush();
  assert.equal(h.sockets.length, 1);
  assert.equal(h.last().url, 'wss://qa-api.example/api/v1/events'); // token never in the URL
  assert.equal(h.conn.status(), 'connecting');
  h.last().onopen();
  assert.deepEqual(h.last().sent, [{ t: 'auth', token: 'tok-a', role: 'listener' }]);
  h.last().onmessage({ data: JSON.stringify({ t: 'hello' }) });
  assert.equal(h.conn.status(), 'live');
  assert.deepEqual(seen, ['resync']); // one catch-up per connect
  h.last().onmessage({ data: JSON.stringify({ t: 'request.new', id: 'r1' }) });
  h.last().onmessage({ data: JSON.stringify({ t: 'something.else' }) }); // unknown: ignored
  h.last().onmessage({ data: JSON.stringify({ t: 'resync' }) }); // the server can never fake it
  h.last().onmessage({ data: 'not json' });
  assert.deepEqual(seen, ['resync', 'request.new']);
});

test('nothing is delivered before hello', async () => {
  const h = harness();
  const seen = [];
  h.conn.subscribe(['request.new'], e => seen.push(e.t));
  await flush();
  h.last().onopen();
  h.last().onmessage({ data: JSON.stringify({ t: 'request.new', id: 'x' }) });
  assert.deepEqual(seen, []);
});

test('background: no socket and none opened; foreground: opens', async () => {
  const h = harness({ app: 'background' });
  h.conn.subscribe(['resync'], () => {});
  await flush();
  assert.equal(h.sockets.length, 0);
  assert.equal(h.conn.status(), 'offline');
  h.setApp('active');
  await open(h);
  assert.equal(h.conn.status(), 'live');
  h.setApp('background');
  assert.equal(h.last().closed, 1000);
  assert.equal(h.conn.status(), 'offline');
  assert.deepEqual(h.pending(), []); // no retry scheduled while in the background
});

test('no session: stays shut without retrying', async () => {
  const h = harness({ token: null });
  h.conn.subscribe(['resync'], () => {});
  await flush();
  assert.equal(h.sockets.length, 0);
  assert.equal(h.conn.status(), 'offline');
  assert.deepEqual(h.pending(), []);
});

test('every reconnect emits resync again, and backoff resets on hello', async () => {
  const h = harness({ random: () => 0.999 });
  let resyncs = 0;
  h.conn.subscribe(['resync'], () => { resyncs++; });
  await open(h);
  h.last().onclose({ code: 1006 });
  assert.equal(h.conn.status(), 'connecting');
  assert.deepEqual(h.pending(), [999]);
  h.fire(999);
  await open(h);
  assert.equal(resyncs, 2);
  h.last().onclose({ code: 1006 });
  assert.deepEqual(h.pending(), [999]); // attempt counter was reset by the hello
});

test('backoff is full jitter, exponential, floored and capped at 60 s', () => {
  for (let attempt = 0; attempt < 30; attempt++) {
    const ceiling = Math.min(60_000, 1_000 * 2 ** attempt);
    assert.equal(core.backoffDelay(attempt, () => 0), 250);
    const high = core.backoffDelay(attempt, () => 0.999999);
    assert.ok(high <= ceiling && high >= 250, `${attempt}: ${high}`);
  }
  assert.equal(core.backoffDelay(3, () => 0.5), 4_000);
  assert.ok(core.backoffDelay(50, () => 0.999999) <= 60_000);
});

test('repeated failures grow the delay (once the server has been seen live)', async () => {
  const h = harness({ random: () => 0.999999 });
  h.conn.subscribe(['resync'], () => {});
  await open(h);
  const delays = [];
  for (let i = 0; i < 8; i++) {
    h.last().onclose({ code: 1006 });
    delays.push(h.pending()[0]);
    h.fire();
    await flush();
  }
  assert.deepEqual(delays, [999, 1999, 3999, 7999, 15999, 31999, 59999, 59999]);
});

test('4401: refresh the token once and reconnect; a second 4401 gives up until the next foreground', async () => {
  const h = harness();
  h.conn.subscribe(['resync'], () => {});
  await flush();
  h.last().onopen();
  h.last().onclose({ code: 4401 });
  await flush();
  assert.deepEqual(h.refreshes, ['listener']);
  assert.equal(h.sockets.length, 2);
  h.last().onopen();
  assert.equal(h.last().sent[0].token, 'tok-b');
  h.last().onclose({ code: 4401 });
  await flush();
  assert.equal(h.sockets.length, 2);
  assert.deepEqual(h.pending(), []);
  assert.equal(h.conn.status(), 'offline');
  h.setApp('background'); h.setApp('active');
  await flush();
  assert.equal(h.sockets.length, 3);
});

test('4409 (replaced by a newer socket): never reconnects on its own', async () => {
  const h = harness();
  h.conn.subscribe(['resync'], () => {});
  await open(h);
  h.last().onclose({ code: 4409 });
  await flush();
  assert.equal(h.sockets.length, 1);
  assert.deepEqual(h.pending(), []);
  assert.equal(h.conn.status(), 'offline');
});

test('a server without the endpoint becomes "unavailable" and is retried only every 5 minutes', async () => {
  const h = harness({ random: () => 0 });
  h.conn.subscribe(['resync'], () => {});
  await flush();
  for (let i = 0; i < core.UNAVAILABLE_AFTER_STRIKES; i++) {
    h.last().onclose({ code: 1006 }); // closed before any hello (e.g. a 404 upgrade)
    if (i < core.UNAVAILABLE_AFTER_STRIKES - 1) { h.fire(); await flush(); }
  }
  assert.equal(h.conn.status(), 'unavailable');
  assert.deepEqual(h.pending(), [300_000]);
  // Sticky across a background: coming back does not hammer an old server.
  h.setApp('background');
  assert.equal(h.conn.status(), 'unavailable');
  h.setApp('active');
  await flush();
  assert.deepEqual(h.pending(), [300_000]);
  const before = h.sockets.length;
  h.fire(300_000);
  await open(h);
  assert.equal(h.sockets.length, before + 1);
  assert.equal(h.conn.status(), 'live'); // the server was upgraded meanwhile
});

test('no hello within the timeout counts as a failed connect', async () => {
  const h = harness();
  h.conn.subscribe(['resync'], () => {});
  await flush();
  h.last().onopen();
  h.fire(core.HELLO_TIMEOUT_MS);
  assert.equal(h.sockets[0].closed, 1000);
  assert.equal(h.conn.status(), 'connecting');
  assert.equal(h.pending().length, 1);
});

test('offline: closes and does not retry; back online: reconnects at once', async () => {
  const h = harness();
  h.conn.subscribe(['resync'], () => {});
  await open(h);
  h.setNet(false);
  assert.equal(h.last().closed, 1000);
  assert.equal(h.conn.status(), 'offline');
  assert.deepEqual(h.pending(), []);
  h.setNet(true);
  await flush();
  assert.equal(h.sockets.length, 2);
});

test('the last unsubscribe closes after a linger; a quick resubscribe keeps the same socket', async () => {
  const h = harness();
  const off = h.conn.subscribe(['resync'], () => {});
  await open(h);
  off();
  assert.deepEqual(h.pending(), [core.LINGER_MS]);
  const again = h.conn.subscribe(['resync'], () => {});
  assert.deepEqual(h.pending(), []);
  assert.equal(h.last().closed, null);
  again();
  h.fire(core.LINGER_MS);
  assert.equal(h.last().closed, 1000);
  assert.equal(h.conn.status(), 'offline');
});

test('an identity change drops the old socket and reconnects with the new token', async () => {
  const h = harness();
  h.conn.subscribe(['resync'], () => {});
  await open(h);
  h.state.token = 'tok-new';
  h.conn.resetIdentity();
  assert.equal(h.sockets[0].closed, 1000);
  await flush();
  h.last().onopen();
  assert.equal(h.last().sent[0].token, 'tok-new');
});

test('status listeners hear each change once', async () => {
  const h = harness();
  const heard = [];
  h.conn.onStatus(s => heard.push(s));
  h.conn.subscribe(['resync'], () => {});
  await open(h);
  assert.deepEqual(heard, ['connecting', 'live']);
});
