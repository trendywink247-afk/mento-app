const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../lib/ownChatClient.ts'), 'utf8');
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: exportsObject });
const { createOwnChatClient } = exportsObject;
const settle = () => new Promise(setImmediate);
const plain = value => JSON.parse(JSON.stringify(value));
const member = { conversationId: 'conversation-a', actorId: 'member-a', role: 'member' };
function message(seq, extra = {}) {
  return { id: `message-${seq}`, seq, sender: 'mentor-a', sender_kind: 'mentor',
    client_id: `client-${seq}`, text: `reply ${seq}`, ts: '2026-10-04T00:00:00+00:00', ...extra };
}
function harness(options = {}) {
  let now = 0, nextTimer = 0, tokens = 0;
  const scheduled = new Map(), sockets = [], historyCalls = [], changes = [], tokenScopes = [];
  const store = options.store ?? [];
  const timers = {
    set(fn, ms) { const id = ++nextTimer; scheduled.set(id, { at: now + ms, fn }); return id; },
    clear(id) { scheduled.delete(id); },
  };
  const client = createOwnChatClient(options.scope ?? member, {
    timers, random: () => 0.5,
    onChange: state => changes.push(plain(state)),
    getToken: async scope => {
      tokenScopes.push(plain(scope));
      return options.getToken ? options.getToken(scope) : `fresh-${++tokens}`;
    },
    createSocket(scope) {
      assert.equal(Object.keys(scope).sort().join(','), 'actorId,conversationId,role');
      const socket = { onopen: null, onmessage: null, onclose: null, onerror: null, sent: [], closed: false,
        send(raw) { this.sent.push(JSON.parse(raw)); },
        close() { this.closed = true; },
        open() { return this.onopen?.(); },
        frame(frame) { this.onmessage?.({ data: JSON.stringify(frame) }); },
        disconnect(code = 1006) { this.onclose?.({ code }); },
      };
      sockets.push(socket);
      return socket;
    },
    history: async (scope, after, token) => {
      historyCalls.push({ scope: plain(scope), after, token });
      if (options.history) return options.history(after);
      return { messages: store.filter(m => m.seq > after).slice(0, 200), last_seq: store.at(-1)?.seq ?? 0 };
    },
  });
  async function advance(ms) {
    await settle(); // Real promise continuations run before the next timer turn.
    const end = now + ms;
    for (let step = 0; step < 200; step++) {
      const next = [...scheduled.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) { now = end; return; }
      scheduled.delete(next[0]); now = next[1].at; next[1].fn(); await settle();
    }
    throw new Error('timer loop did not settle');
  }
  async function open(lastSeq = 0) {
    const socket = sockets.at(-1);
    await socket.open();
    socket.frame({ t: 'hello', side: (options.scope ?? member).role, last_seq: lastSeq, peer_online: true, read: {} });
    await settle();
    return socket;
  }
  return { client, sockets, historyCalls, changes, tokenScopes, store, scheduled, advance, open,
    state: () => plain(client.snapshot()) };
}

test('authentication is the first frame and state is isolated by role/account/conversation', async () => {
  const h = harness(); await h.client.start();
  assert.equal(h.sockets[0].sent.length, 0);
  await h.open();
  assert.deepEqual(h.sockets[0].sent[0], { t: 'hello', token: 'fresh-1', after: 0 });
  assert.equal(h.state().status, 'ready');
  const mentor = harness({ scope: { ...member, role: 'mentor' } });
  assert.notEqual(h.state().scopeKey, mentor.state().scopeKey);
  h.client.send('same', 'private member draft');
  assert.equal(mentor.state().pending.length, 0);
  h.client.forget(); mentor.client.forget();
});

test('slow token refresh finishes before opening a socket and stop fences a late token', async () => {
  let resolve;
  const h = harness({ getToken: () => new Promise(r => { resolve = r; }) });
  const starting = h.client.start();
  await h.advance(6000); assert.equal(h.sockets.length, 0);
  resolve('fresh-after-refresh'); await starting;
  await h.sockets[0].open();
  assert.equal(h.sockets[0].sent[0].token, 'fresh-after-refresh');
  h.client.forget();
  let resolveLate;
  const other = harness({ getToken: () => new Promise(r => { resolveLate = r; }) });
  const lateStart = other.client.start(); other.client.stop();
  resolveLate('too-late'); await lateStart;
  assert.equal(other.sockets.length, 0);
  assert.equal(other.state().status, 'stopped'); other.client.forget();
});

test('catch-up pages beyond 200 without advancing over a live sequence gap', async () => {
  const h = harness({ store: Array.from({ length: 610 }, (_, i) => message(i + 1)) });
  await h.client.start(); const socket = h.sockets[0]; await socket.open();
  socket.frame({ t: 'hello', side: 'member', last_seq: 550, read: {} });
  socket.frame({ t: 'message', message: message(610) });
  assert.equal(h.state().after, 0);
  await settle();
  assert.deepEqual(h.historyCalls.map(c => c.after), [0, 200, 400, 600]);
  assert.equal(h.state().after, 610);
  assert.equal(h.state().messages.length, 610);
  assert.equal(h.state().status, 'ready');
  h.client.forget();
});

test('REST establishes retained gaps and live gaps trigger a new catch-up', async () => {
  const h = harness({ store: [message(501), message(502)] });
  await h.client.start(); const socket = await h.open(502);
  assert.equal(h.state().after, 502);
  h.store.push(message(503), message(504));
  socket.frame({ t: 'message', message: message(504) });
  await settle();
  assert.deepEqual(h.state().messages.map(m => m.seq), [501, 502, 503, 504]);
  assert.equal(h.historyCalls.at(-1).after, 502);
  h.client.forget();
});

test('ack reconciles only the sending identity and repeats never duplicate a message', async () => {
  const h = harness(); await h.client.start(); const socket = await h.open();
  h.client.send('a1', 'hello');
  socket.frame({ t: 'message', message: message(1, { client_id: 'a1' }) });
  assert.equal(h.state().pending.length, 1);
  const ack = message(2, { sender: member.actorId, sender_kind: 'member', client_id: 'a1', text: 'redacted hello' });
  socket.frame({ t: 'message', message: ack }); socket.frame({ t: 'message', message: ack });
  assert.equal(h.state().pending.length, 0);
  assert.equal(h.state().messages.length, 2);
  assert.equal(h.state().messages[1].text, 'redacted hello');
  h.client.forget();
});

test('reconnect gets fresh auth and sends an unconfirmed message with the same client id', async () => {
  const h = harness(); await h.client.start(); const socket = await h.open();
  h.client.send('stable-id', 'hello'); socket.disconnect(); await h.advance(500);
  const again = await h.open();
  assert.equal(again.sent[0].token, 'fresh-2');
  assert.deepEqual(again.sent[1], { t: 'send', client_id: 'stable-id', text: 'hello' });
  h.client.forget();
});

test('lost ack triggers bounded reconnection and history acknowledgement before resend', async () => {
  const h = harness(); await h.client.start(); await h.open();
  h.client.send('stored', 'hello');
  h.store.push(message(1, { sender: member.actorId, sender_kind: 'member', client_id: 'stored' }));
  await h.advance(15_500);
  const again = await h.open(1);
  assert.equal(h.state().pending.length, 0);
  assert.equal(again.sent.filter(f => f.t === 'send').length, 0);
  assert.equal(h.state().messages.length, 1);
  h.client.forget();
});

test('held and failed messages require explicit retry even after reconnect', async () => {
  const h = harness(); await h.client.start(); const socket = await h.open();
  h.client.send('held', 'wait'); h.client.send('failed', 'again');
  socket.frame({ t: 'held', client_id: 'held', allowance: { held: true, reason: 'daily' } });
  socket.frame({ t: 'error', client_id: 'failed', code: 'rate_limited' });
  socket.disconnect(); await h.advance(500); const again = await h.open();
  assert.equal(again.sent.filter(f => f.t === 'send').length, 0);
  assert.deepEqual(h.state().pending.map(p => p.status), ['held', 'failed']);
  h.client.retry('held');
  assert.equal(again.sent.at(-1).client_id, 'held');
  assert.equal(h.state().pending[0].status, 'sending');
  h.client.forget();
});

test('wiped/ended events and ambiguous end/auth close clear local history and pending bodies', async () => {
  for (const ending of ['wiped', 'ended', 4403, 4410]) {
    const h = harness({ store: [message(1)] }); await h.client.start(); const socket = await h.open(1);
    h.client.send('pending', 'private');
    if (typeof ending === 'string') socket.frame({ t: ending }); else socket.disconnect(ending);
    assert.equal(h.state().status, 'terminal');
    assert.equal(h.state().messages.length, 0); assert.equal(h.state().pending.length, 0);
    assert.equal(h.scheduled.size, 0);
    await h.client.start(); assert.equal(h.sockets.length, 1);
  }
});

test('a message with persistently missing acknowledgement exhausts its retry budget', async () => {
  const h = harness(); await h.client.start(); await h.open(); h.client.send('unconfirmed', 'hello');
  for (let attempt = 0; attempt < 5; attempt++) {
    await h.advance(15_500); await h.open();
  }
  assert.equal(h.sockets.flatMap(socket => socket.sent).filter(frame => frame.t === 'send').length, 5);
  assert.equal(h.state().pending[0].status, 'failed');
  assert.equal(h.state().pending[0].code, 'delivery_unconfirmed');
  h.client.retry('unconfirmed');
  assert.equal(h.state().pending[0].status, 'sending');
  assert.equal(h.sockets.at(-1).sent.at(-1).client_id, 'unconfirmed');
  h.client.forget();
});

test('terminal refusal and replaced close cannot reconnect or keep sending', async () => {
  const h = harness(); await h.client.start(); const socket = await h.open(); h.client.send('a', 'hello');
  socket.frame({ t: 'error', client_id: 'a', code: 'member_banned' });
  assert.equal(h.state().reason, 'member_banned');
  assert.throws(() => h.client.send('b', 'no'), /conversation_closed/);
  const other = harness(); await other.client.start(); const second = await other.open();
  second.disconnect(4409); await other.advance(120_000);
  assert.equal(other.sockets.length, 1); assert.equal(other.state().reason, 'replaced');
});

test('stopping fences delayed history responses and retains only memory pending', async () => {
  let resolve;
  const h = harness({ history: () => new Promise(r => { resolve = r; }) });
  await h.client.start(); await h.open(1); h.client.send('draft', 'unsent'); h.client.stop();
  resolve({ messages: [message(1)], last_seq: 1 }); await settle();
  assert.equal(h.state().status, 'stopped'); assert.equal(h.state().messages.length, 0);
  assert.equal(h.state().pending[0].status, 'queued');
  h.client.forget(); assert.equal(h.state().pending.length, 0);
});

test('stop settles a start waiting on unavailable auth instead of leaving it hung', async () => {
  const h = harness({ getToken: () => new Promise(() => {}) });
  const starting = h.client.start(); h.client.stop(); await starting;
  assert.equal(h.state().status, 'stopped'); assert.equal(h.sockets.length, 0);
  assert.equal(h.scheduled.size, 0); h.client.forget();
});

test('connection attempts stop after the bounded retry budget', async () => {
  const h = harness(); await h.client.start(); await h.advance(400_000);
  assert.equal(h.sockets.length, 9);
  assert.equal(h.state().reason, 'reconnect_exhausted');
  assert.equal(h.scheduled.size, 0);
  h.client.forget();
});

test('heartbeat timeout reconnects; pong keeps a healthy socket alive', async () => {
  const h = harness(); await h.client.start(); const socket = await h.open();
  await h.advance(25_000); assert.equal(socket.sent.at(-1).t, 'ping');
  socket.frame({ t: 'pong' }); await h.advance(15_000);
  assert.equal(h.state().status, 'ready');
  await h.advance(25_500); assert.equal(h.sockets.length, 2);
  h.client.forget();
});

test('a healthy receiver repairs a lost final pubsub event on the next heartbeat', async () => {
  const h = harness(); await h.client.start(); const socket = await h.open();
  h.store.push(message(1)); // no socket event and no later sequence to reveal a gap
  await h.advance(25_000); socket.frame({ t: 'pong' }); await settle();
  assert.equal(h.state().messages.length, 1); assert.equal(h.state().after, 1);
  assert.equal(h.sockets.length, 1); assert.equal(h.state().status, 'ready');
  h.client.forget();
});

test('authoritative history regression clears bodies when terminal events were lost', async () => {
  const h = harness({ store: [message(1)] }); await h.client.start(); const socket = await h.open(1);
  h.store.length = 0; // wipe/full retention, with no delivered terminal frames
  await h.advance(25_000); socket.frame({ t: 'pong' }); await settle();
  assert.equal(h.state().reason, 'history_reset'); assert.equal(h.state().messages.length, 0);
  assert.equal(h.state().status, 'terminal'); assert.equal(h.scheduled.size, 0);
  const other = harness({ store: [message(1)] }); await other.client.start(); const first = await other.open(1);
  first.disconnect(); await other.advance(500); await other.open(0);
  assert.equal(other.state().reason, 'history_reset'); assert.equal(other.state().messages.length, 0);
});

test('history timeout and an incomplete page never claim caught-up state', async () => {
  for (const history of [() => new Promise(() => {}), async () => ({ messages: [], last_seq: 2 })]) {
    const h = harness({ history }); await h.client.start(); await h.open(2); await h.advance(10_000);
    assert.notEqual(h.state().status, 'ready'); assert.equal(h.state().after, 0);
    h.client.forget();
  }
});

test('read markers are monotonic, typing expires, and queue validation is bounded', async () => {
  const h = harness({ store: [message(1)] }); await h.client.start(); const socket = await h.open(1);
  socket.frame({ t: 'read', by: 'mentor-a', seq: 1 }); socket.frame({ t: 'read', by: 'mentor-a', seq: 0 });
  assert.equal(h.state().read['mentor-a'], 1);
  h.client.markRead(100); assert.equal(socket.sent.at(-1).seq, 1);
  socket.frame({ t: 'typing', from: 'mentor-a', on: true }); assert.equal(h.state().peerTyping, true);
  await h.advance(6000); assert.equal(h.state().peerTyping, false);
  h.client.stop();
  assert.throws(() => h.client.send(' id ', 'hello'), /invalid_message/);
  for (let i = 0; i < 50; i++) h.client.send(`draft-${i}`, 'hello');
  assert.throws(() => h.client.send('more', 'hello'), /pending_full/);
  assert.throws(() => h.client.send('draft-0', 'changed'), /client_id_reused/);
  h.client.forget();
});
