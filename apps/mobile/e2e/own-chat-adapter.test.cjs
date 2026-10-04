const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('typescript');
const cache = new Map();
function load(name) {
  if (cache.has(name)) return cache.get(name);
  const exports = {};
  cache.set(name, exports);
  const source = fs.readFileSync(path.join(__dirname, `../lib/${name}.ts`), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports, require: name => load(name.replace('./', '')), URL, setTimeout, clearTimeout });
  return exports;
}
const { createOwnChatAdapter, ownChatSocketUrl, selectChatTransport } = load('ownChatAdapter');
const { forgetOwnChats, registerOwnChat } = load('ownChatLifecycle');
const scope = { actorId: 'member-a', role: 'member', conversationId: 'room-a' };
const tick = () => new Promise(setImmediate);
function harness(extra = {}) {
  let token = 'member-token';
  const requests = [], sockets = [], states = [];
  const client = createOwnChatAdapter(extra.scope ?? scope, { transport: 'own', ownAccepted: true }, {
    apiBase: 'https://staging.mento.chat/api/v1',
    getToken: async role => { requests.push({ role }); return token; },
    request: async (path, bearer) => {
      requests.push({ path, bearer });
      if (extra.request) return extra.request(path, bearer);
      if (path === '/me' || path === '/listener/me') return { id: extra.actorId ?? scope.actorId };
      return { messages: [], last_seq: 0 };
    },
    createSocket(url) {
      const socket = { url, sent: [], closed: false,
        send(frame) { this.sent.push(JSON.parse(frame)); }, close() { this.closed = true; } };
      sockets.push(socket); return socket;
    },
    onChange: state => states.push(state),
  });
  return { client, requests, sockets, states, token(value) { token = value; } };
}

test('provider stays Stream by default and never silently falls back for an own room', () => {
  assert.equal(selectChatTransport(), 'stream');
  assert.equal(selectChatTransport('stream', true), 'stream');
  assert.throws(() => selectChatTransport('own'), /not_accepted/);
  assert.throws(() => selectChatTransport('unknown', true), /unknown/);
});
test('socket origin has no credentials/query, uses TLS and safely encodes room ids', () => {
  assert.equal(ownChatSocketUrl('https://example.test/api/v1/', 'a/b?token=x'),
    'wss://example.test/api/v1/chat/ws/a%2Fb%3Ftoken%3Dx');
  assert.equal(ownChatSocketUrl('http://10.0.2.2:8000/api/v1', 'room'),
    'ws://10.0.2.2:8000/api/v1/chat/ws/room');
  for (const origin of ['http://example.test/api/v1', 'https://user:secret@example.test/api/v1',
    'https://example.test/api/v1?token=secret', 'https://example.test/api/v1#secret']) {
    assert.throws(() => ownChatSocketUrl(origin, 'room'));
  }
  for (const room of ['', '.', '..', 'room\nsecret']) {
    assert.throws(() => ownChatSocketUrl('https://example.test/api/v1', room));
  }
});
test('verified role identity precedes socket creation and bearer is only first frame', async () => {
  const h = harness();
  try {
    await h.client.start();
    assert.equal(h.requests.find(r => r.path).path, '/me');
    assert.equal(h.sockets[0].url.includes('member-token'), false);
    h.sockets[0].onopen();
    assert.equal(h.sockets[0].sent[0].token, 'member-token');
    h.sockets[0].onmessage({ data: JSON.stringify({ t: 'hello', side: 'member', last_seq: 1 }) });
    await tick();
    assert.equal(h.requests.find(r => r.path?.includes('/messages')).bearer, 'member-token');
  } finally { h.client.dispose(); }
});
test('mentor authentication uses the mentor endpoint and token source', async () => {
  const h = harness({ scope: { ...scope, role: 'mentor' } });
  try {
    await h.client.start();
    assert.equal(h.requests.find(r => r.path).path, '/listener/me');
    assert.ok(h.requests.filter(r => r.role).every(r => r.role === 'mentor'));
  } finally { h.client.dispose(); }
});
test('wrong account or missing bearer prevents any socket creation', async () => {
  for (const missing of [false, true]) {
    const h = harness({ actorId: 'someone-else' });
    if (missing) h.token(null);
    try { await h.client.start(); assert.equal(h.sockets.length, 0); }
    finally { h.client.dispose(); }
  }
});
test('account replacement during identity request cannot open a socket', async () => {
  let resolve;
  const h = harness({ request: () => new Promise(r => { resolve = r; }) });
  const started = h.client.start(); await tick();
  h.token('another-account-token'); resolve({ id: scope.actorId });
  await started;
  try { assert.equal(h.sockets.length, 0); } finally { h.client.dispose(); }
});
test('role logout clears messages and pending bodies, closes only that role', async () => {
  const member = harness(), mentor = harness({ scope: { ...scope, role: 'mentor' } });
  try {
    await member.client.start(); await mentor.client.start();
    forgetOwnChats('member');
    assert.equal(member.sockets[0].closed, true);
    assert.equal(member.client.snapshot().status, 'terminal');
    assert.equal(member.client.snapshot().messages.length, 0);
    assert.equal(member.client.snapshot().pending.length, 0);
    assert.equal(mentor.sockets[0].closed, false);
  } finally { member.client.dispose(); mentor.client.dispose(); }
});
test('logout during identity lookup prevents stale authentication/socket publication', async () => {
  let resolve;
  const h = harness({ request: () => new Promise(r => { resolve = r; }) });
  const started = h.client.start(); await tick();
  forgetOwnChats('member'); resolve({ id: scope.actorId });
  await started; await tick();
  assert.equal(h.sockets.length, 0);
  assert.equal(h.client.snapshot().status, 'terminal');
  h.client.dispose();
});
test('history response from a replaced account never publishes its transcript', async () => {
  let resolve;
  const h = harness({ request: path => path === '/me' ? Promise.resolve({ id: scope.actorId }) :
    new Promise(r => { resolve = r; }) });
  try {
    await h.client.start(); h.sockets[0].onopen();
    h.sockets[0].onmessage({ data: JSON.stringify({ t: 'hello', side: 'member', last_seq: 1 }) });
    await tick();
    h.token('new-account-token');
    resolve({ last_seq: 1, messages: [{ id: 'm1', seq: 1, sender: 'mentor', sender_kind: 'mentor',
      client_id: 'c1', text: 'private transcript', ts: '2026-10-05T00:00:00Z' }] });
    await tick();
    assert.equal(h.client.snapshot().messages.length, 0);
  } finally { h.client.dispose(); }
});
test('one failing cleanup observer never blocks remaining clients from forgetting', () => {
  let cleaned = false;
  registerOwnChat('member', () => { throw new Error('observer failure'); });
  registerOwnChat('member', () => { cleaned = true; });
  assert.doesNotThrow(() => forgetOwnChats('member'));
  assert.equal(cleaned, true);
});
async function ready(h) {
  await h.client.start();
  h.sockets[0].onopen();
  h.sockets[0].onmessage({ data: JSON.stringify({ t: 'hello', side: 'member', last_seq: 0 }) });
  await tick();
}
function echo(h, clientId = 'send-1') {
  const message = { id: 'm1', seq: 1, sender: scope.actorId, sender_kind: 'member',
    client_id: clientId, text: 'hello', ts: '2026-10-05T00:00:00Z' };
  h.sockets.at(-1).onmessage({ data: JSON.stringify({ t: 'message', message }) });
  return message;
}
test('awaitable send resolves only after its persisted acknowledgement', async () => {
  const h = harness();
  try {
    await ready(h);
    let resolved = false;
    const sent = h.client.sendAndWait('send-1', 'hello').then(m => { resolved = true; return m; });
    await tick(); assert.equal(resolved, false);
    echo(h);
    assert.equal((await sent).id, 'm1');
    assert.equal((await h.client.sendAndWait('send-1', 'hello')).id, 'm1');
    assert.equal(h.sockets[0].sent.filter(f => f.t === 'send').length, 1);
  } finally { h.client.dispose(); }
});
test('awaitable held send preserves draft and returns allowance without claiming success', async () => {
  const h = harness();
  try {
    await ready(h);
    const sent = h.client.sendAndWait('send-1', 'hello');
    h.sockets[0].onmessage({ data: JSON.stringify({ t: 'held', client_id: 'send-1',
      code: 'pause', allowance: { remaining: 0 } }) });
    await assert.rejects(sent, e => e.code === 'pause' && e.allowance.remaining === 0);
    assert.equal(h.client.snapshot().pending[0].text, 'hello');
  } finally { h.client.dispose(); }
});
test('timeout is ambiguous and a same-id retry awaits acknowledgement without a new send', async () => {
  const h = harness();
  try {
    await ready(h);
    await assert.rejects(h.client.sendAndWait('send-1', 'hello', { timeoutMs: 5 }), e => e.code === 'send_timeout');
    const retry = h.client.sendAndWait('send-1', 'hello');
    echo(h); await retry;
    assert.equal(h.sockets[0].sent.filter(f => f.t === 'send').length, 1);
  } finally { h.client.dispose(); }
});
test('abort/discard/revocation reject waiting sends and never turn cancellation into success', async () => {
  for (const action of ['abort', 'discard', 'revoke', 'dispose']) {
    const h = harness();
    try {
      await ready(h);
      const controller = new AbortController();
      const sent = h.client.sendAndWait('send-1', 'hello', { signal: controller.signal });
      if (action === 'abort') controller.abort();
      if (action === 'discard') h.client.discard('send-1');
      if (action === 'revoke') h.sockets[0].onclose({ code: 4403 });
      if (action === 'dispose') h.client.dispose();
      await assert.rejects(sent, e => ['send_cancelled', 'not_authorized', 'chat_disposed'].includes(e.code));
      if (action === 'revoke') {
        assert.equal(h.client.snapshot().pending.length, 0);
        assert.equal(h.client.snapshot().status, 'terminal');
      }
    } finally { h.client.dispose(); }
  }
});
test('disconnect keeps acknowledgement waiter pending until explicit stop cancels it', async () => {
  const h = harness();
  try {
    await ready(h);
    let done = false;
    const sent = h.client.sendAndWait('send-1', 'hello').finally(() => { done = true; });
    h.sockets[0].onclose({ code: 1006 });
    await tick(); assert.equal(done, false);
    h.client.stop();
    await assert.rejects(sent, e => e.code === 'connection_lost' || e.code === 'send_stopped');
  } finally { h.client.dispose(); }
});
test('duplicate acknowledgement observers remain bounded and disposal settles every one', async () => {
  const h = harness();
  try {
    await ready(h);
    const pending = Array.from({ length: 50 }, () => h.client.sendAndWait('send-1', 'hello')
      .then(() => 'success', e => e.code));
    await assert.rejects(h.client.sendAndWait('send-1', 'hello'), e => e.code === 'send_waiters_full');
    h.client.dispose();
    assert.ok((await Promise.all(pending)).every(code => code === 'chat_disposed'));
  } finally { h.client.dispose(); }
});
