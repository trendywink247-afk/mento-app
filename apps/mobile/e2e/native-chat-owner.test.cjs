const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,
  '../lib/nativeChatOwner.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: exportsObject });
const { requireNativeStreamOwner, nativeChatRenderer } = exportsObject;

test('stored Stream owner permits native provider connection', async () => {
  await requireNativeStreamOwner(async () => ({ chat_backend: 'stream' }));
});

for (const backend of ['own', undefined, 'other']) {
  test(`native refuses ${backend} before any provider can connect`, async () => {
    let connections = 0;
    await assert.rejects(async () => {
      await requireNativeStreamOwner(async () => ({ chat_backend: backend }));
      connections++;
    }, /own_native_not_accepted|unknown_chat_owner/);
    assert.equal(connections, 0);
  });
}

test('authorization failure cannot fall back to a route channel', async () => {
  const denied = new Error('member_suspended');
  await assert.rejects(requireNativeStreamOwner(async () => { throw denied; }),
    error => error === denied);
});

test('native own requires both explicit flags, while Stream owner always stays Stream', () => {
  for (const own of [undefined, '0', 'true', '1']) for (const native of [undefined, '0', 'true', '1']) {
    assert.equal(nativeChatRenderer('stream', { own, native }), 'stream');
    if (own === '1' && native === '1') assert.equal(nativeChatRenderer('own', { own, native }), 'own');
    else assert.throws(() => nativeChatRenderer('own', { own, native }), /own_native_not_accepted/);
  }
  assert.throws(() => nativeChatRenderer(undefined, { own: '1', native: '1' }), /unknown_chat_owner/);
  assert.throws(() => nativeChatRenderer('other', { own: '1', native: '1' }), /unknown_chat_owner/);
});
