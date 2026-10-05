const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('typescript');
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,
  '../lib/ownChatScreenController.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: exportsObject });
const { createOwnChatScreenController, ownMessageForScreen, ownMessageRead } = exportsObject;
const plain = value => JSON.parse(JSON.stringify(value));
const scope = { role: 'member', actorId: 'member', conversationId: 'room' };
const message = { id: 'm1', sender: 'member', sender_kind: 'member', seq: 7,
  client_id: 'c1', text: 'hello', ts: '2026-10-05T00:00:00Z' };
test('existing thread receives server timestamp, sender identity and validated crisis metadata', () => {
  const crisis = { support: 'support', signal: 'risk', helplines: [{ name: 'help', number: '123', hours: 'always' }] };
  assert.deepEqual(plain(ownMessageForScreen({ ...message, crisis })), {
    id: 'm1', text: 'hello', user: { id: 'member' }, created_at: message.ts, crisis,
  });
  assert.equal(ownMessageForScreen({ ...message, crisis: { helplines: 'bad' } }).crisis, undefined);
  assert.equal(Object.hasOwn(ownMessageForScreen(message), 'crisis'), false);
  assert.equal(Object.hasOwn(ownMessageForScreen({ ...message, crisis: { helplines: 'bad' } }), 'crisis'), true);
});
test('read status comes from peer sequence, never wall clock or self read', () => {
  const state = { messages: [message], read: { member: 99, mentor: 6 } };
  assert.equal(ownMessageRead(state, 'm1', 'member'), false);
  state.read.mentor = 7;
  assert.equal(ownMessageRead(state, 'm1', 'member'), true);
  assert.equal(ownMessageRead(state, 'unknown', 'member'), false);
});
function harness() {
  let listener, pending = [], messages = [], fails = true;
  const sent = [], read = [], discarded = [];
  const client = { start() {}, stop() { listener({ status: 'stopped', messages: [], read: {}, after: 0 }); },
    dispose() {}, typing() {}, markRead(seq) { read.push(seq); },
    snapshot: () => ({ pending, messages }),
    retry() {}, discard(id) { discarded.push(id); pending = pending.filter(p => p.clientId !== id); },
    async sendAndWait(id, text) {
      sent.push({ id, text }); pending = [{ clientId: id, status: 'sending' }];
      if (fails) throw new Error('send_timeout');
      pending = []; return { ...message, client_id: id, text };
    },
  };
  const controller = createOwnChatScreenController(scope, onChange => { listener = onChange; return client; }, () => {});
  return { controller, sent, read, discarded, succeed() { fails = false; },
    emit(state) { listener(state); }, hold() { pending[0].status = 'held'; },
    recoverEcho() { messages = [{ ...message, client_id: sent[0].id, text: '[redacted]' }]; pending = []; } };
}
test('an ambiguous screen retry reuses its id, and a completed new draft gets a new id', async () => {
  const h = harness();
  await assert.rejects(h.controller.sendMessage({ text: 'hello' }), /timeout/);
  h.succeed(); await h.controller.sendMessage({ text: 'hello' });
  assert.equal(h.sent[0].id, h.sent[1].id);
  await h.controller.sendMessage({ text: 'hello' });
  assert.notEqual(h.sent[1].id, h.sent[2].id);
});
test('edited drafts cannot silently enqueue a second message while the first is ambiguous', async () => {
  const h = harness();
  await assert.rejects(h.controller.sendMessage({ text: 'original' }));
  await assert.rejects(h.controller.sendMessage({ text: 'edited' }), /previous_send_pending/);
  assert.equal(h.sent.length, 1);
  h.hold(); h.succeed(); await h.controller.sendMessage({ text: 'edited' });
  assert.equal(h.discarded[0], h.sent[0].id);
  assert.notEqual(h.sent[0].id, h.sent[1].id);
});
test('read publication is monotonic and avoids read-event loops', () => {
  const h = harness();
  h.emit({ status: 'ready', after: 7, messages: [], read: {} });
  h.controller.markRead(); h.controller.markRead();
  h.emit({ status: 'ready', after: 8, messages: [], read: {} });
  h.controller.markRead();
  assert.deepEqual(h.read, [7, 8]);
});
test('a late recovered redacted acknowledgement completes retry without another send', async () => {
  const h = harness();
  await assert.rejects(h.controller.sendMessage({ text: 'original private draft' }));
  h.recoverEcho();
  const response = await h.controller.sendMessage({ text: 'original private draft' });
  assert.equal(response.message.text, '[redacted]');
  assert.equal(h.sent.length, 1);
});

test('native pause preserves the ambiguous draft id for foreground retry', async () => {
  const h = harness();
  await assert.rejects(h.controller.sendMessage({ text: 'background pending draft' }));
  h.controller.pause(); h.controller.start();
  h.succeed();
  await h.controller.sendMessage({ text: 'background pending draft' });
  assert.equal(h.sent[0].id, h.sent[1].id);
});
