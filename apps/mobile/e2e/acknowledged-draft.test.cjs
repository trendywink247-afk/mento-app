const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const exported = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,
  '../lib/acknowledgedDraft.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: exported });
const { clearAcknowledgedDraft } = exported;

test('late acknowledgement preserves a next draft typed while send was in flight', async () => {
  let current = 'first message';
  const submitted = current;
  let acknowledge;
  const sent = new Promise(resolve => { acknowledge = resolve; }).then(() => {
    current = clearAcknowledgedDraft(current, submitted);
  });
  current = 'next message';
  acknowledge();
  await sent;
  assert.equal(current, 'next message');
  assert.equal(clearAcknowledgedDraft('first message', submitted), '');
  assert.equal(clearAcknowledgedDraft('first message ', submitted), 'first message ');
});
