const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { StreamChat } = require('stream-chat');
const output = {};
vm.runInNewContext(ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../lib/streamRecovery.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
).outputText, { exports: output });
const { subscribeToRecoveredMessages, mergeRecoveredMessages } = output;
const plain = value => JSON.parse(JSON.stringify(value));
function fixture() {
  // Exercise the installed SDK event/state implementation without any network.
  const client = new StreamChat('synthetic-key', { browser: true });
  client.userID = 'synthetic-member';
  return { client, channel: client.channel('messaging', 'synthetic-room') };
}
const raw = (id, second, extra = {}) => ({ id, text: id,
  user: { id: 'synthetic-mentor' }, created_at: new Date(`2026-10-05T00:00:${second}.000Z`), ...extra });
const project = message => ({ id: message.id, text: message.text, at: message.created_at.toISOString() });

test('missed SDK history reaches the thread on recovery without message.new', () => {
  const { client, channel } = fixture();
  let rows = [project(raw('older-loaded-page', '01')), project(raw('newer-live', '30'))];
  let newEvents = 0;
  channel.on('message.new', () => newEvents++);
  const stop = subscribeToRecoveredMessages(client, channel, messages => {
    rows = mergeRecoveredMessages(rows, messages.map(project));
  });
  // This is Stream recoverState's contract: update channel state, then emit one
  // client-level event. It does not replay message.new for recovered messages.
  channel.state.addMessagesSorted([raw('missed-offline', '20'), raw('newer-live', '30')]);
  client.dispatchEvent({ type: 'connection.recovered' });
  assert.equal(newEvents, 0);
  assert.deepEqual(plain(rows).map(row => row.id), ['older-loaded-page', 'missed-offline', 'newer-live']);
  client.dispatchEvent({ type: 'connection.recovered' });
  assert.equal(rows.length, 3);
  stop();
});

test('recovered server safety metadata remains available to the crisis renderer', () => {
  const { client, channel } = fixture();
  let received;
  const stop = subscribeToRecoveredMessages(client, channel, messages => { received = messages; });
  channel.state.addMessagesSorted([raw('safety', '20', { crisis: { signal: 'suicidal', helplines: [] } })]);
  client.dispatchEvent({ type: 'connection.recovered' });
  assert.equal(received[0].crisis.signal, 'suicidal');
  assert.notEqual(received, channel.state.messages);
  stop();
});

test('recovered content replaces its matching projection without mutating old state', () => {
  const original = [project(raw('same', '20', { text: 'older projection' }))];
  const next = mergeRecoveredMessages(original, [project(raw('same', '20', { text: '[number hidden]' }))]);
  assert.equal(next.length, 1);
  assert.equal(next[0].text, '[number hidden]');
  assert.equal(original[0].text, 'older projection');
});

test('cleanup prevents old screens receiving recovery and removes the SDK listener', () => {
  const { client, channel } = fixture();
  let calls = 0;
  const stop = subscribeToRecoveredMessages(client, channel, () => calls++);
  const queuedListener = client.listeners['connection.recovered'][0];
  stop();
  stop();
  client.dispatchEvent({ type: 'connection.recovered' });
  queuedListener({ type: 'connection.recovered' });
  assert.equal(calls, 0);
  assert.equal(client.listeners['connection.recovered'].length, 0);
});

test('each recovery observer reads only its own conversation', () => {
  const { client, channel } = fixture();
  const other = client.channel('messaging', 'other-room');
  channel.state.addMessagesSorted([raw('first-room', '10')]);
  other.state.addMessagesSorted([raw('other-room', '20')]);
  const seen = [];
  const a = subscribeToRecoveredMessages(client, channel, messages => seen.push(messages.map(m => m.id)));
  const b = subscribeToRecoveredMessages(client, other, messages => seen.push(messages.map(m => m.id)));
  client.dispatchEvent({ type: 'connection.recovered' });
  assert.deepEqual(plain(seen), [['first-room'], ['other-room']]);
  a(); b();
});
