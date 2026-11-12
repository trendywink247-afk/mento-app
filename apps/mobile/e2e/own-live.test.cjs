// ownLive: the mentor's row state for an own chat comes from the server's own fields.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const mod = {};
vm.runInNewContext(
  ts.transpileModule(fs.readFileSync('lib/ownLive.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
  { exports: mod, require: () => ({}) },
);
const plain = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const own = { chat_backend: 'own', status: 'active', waiting_since: '2026-11-08T13:00:00Z', unread: 2 };

test('an active own chat carries unread and the waiting time', () => {
  assert.deepEqual(plain(mod.ownLive(own)), { unread: 2, preview: null, typing: false, waitingSince: Date.parse('2026-11-08T13:00:00Z') });
});
test('nobody waiting, or an unreadable time, means no wait', () => {
  assert.equal(mod.ownLive({ ...own, waiting_since: null }).waitingSince, null);
  assert.equal(mod.ownLive({ ...own, waiting_since: 'nonsense' }).waitingSince, null);
  assert.equal(mod.ownLive({ ...own, unread: undefined }).unread, 0);
});
test('Stream chats and ended chats are not ours to fill in', () => {
  assert.equal(mod.ownLive({ ...own, chat_backend: 'stream' }), undefined);
  assert.equal(mod.ownLive({ ...own, chat_backend: undefined }), undefined);
  assert.equal(mod.ownLive({ ...own, status: 'ended' }), undefined);
});

test('an own row shows the server-cut last line; none when absent', () => {
  assert.equal(mod.ownLive({ ...own, last_message_preview: 'thank you' }).preview, 'thank you');
  assert.equal(mod.ownLive({ ...own, last_message_preview: null }).preview, null);
});

test('only active Stream rooms are mirrored from Stream (no rows -> no Stream connect)', () => {
  const rows = [
    { id: 'a', status: 'active', chat_backend: 'own', stream_channel_id: null },
    { id: 'b', status: 'active', chat_backend: 'stream', stream_channel_id: 'ch-b' },
    { id: 'c', status: 'active', stream_channel_id: 'ch-c' }, // an older server: Stream
    { id: 'd', status: 'ended', chat_backend: 'stream', stream_channel_id: 'ch-d' },
    { id: 'e', status: 'active', chat_backend: 'stream', stream_channel_id: null },
  ];
  assert.deepEqual(mod.streamRooms(rows).map((r) => r.id), ['b', 'c']);
  assert.equal(mod.streamRooms(rows.filter((r) => r.chat_backend === 'own')).length, 0);
});

test('the console opens own chats without a channel; a wiped or channel-less Stream chat stays shut', () => {
  assert.equal(mod.canOpenConsoleChat({ status: 'active', chat_backend: 'own', stream_channel_id: null }), true);
  assert.equal(mod.canOpenConsoleChat({ status: 'ended', chat_backend: 'own', stream_channel_id: null }), true);
  assert.equal(mod.canOpenConsoleChat({ status: 'active', chat_backend: 'stream', stream_channel_id: 'x' }), true);
  assert.equal(mod.canOpenConsoleChat({ status: 'active', chat_backend: 'stream', stream_channel_id: null }), false);
  assert.equal(mod.canOpenConsoleChat({ status: 'wiped', chat_backend: 'own', stream_channel_id: null }), false);
});

test('the mentor console connects to Stream only after finding a Stream room', () => {
  const src = fs.readFileSync('lib/useMentorConsole.ts', 'utf8');
  const guard = src.indexOf('streamRooms(convos)');
  const connect = src.indexOf('ensureListenerConnected(');
  assert.ok(guard > 0 && connect > guard, 'streamRooms check must come before the Stream connect');
  assert.match(src.slice(guard, connect), /if \(active\.length === 0\)[\s\S]*return;/);
});

test('the legacy web console opens rows through canOpenConsoleChat, not stream_channel_id alone', () => {
  const src = fs.readFileSync('components/listener/ListenerConsole.web.tsx', 'utf8');
  assert.match(src, /if \(!canOpenConsoleChat\(c\)\) return;/);
  assert.doesNotMatch(src, /!c\.stream_channel_id\) return/);
});
