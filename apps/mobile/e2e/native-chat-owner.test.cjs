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
const { requireNativeStreamOwner } = exportsObject;

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
