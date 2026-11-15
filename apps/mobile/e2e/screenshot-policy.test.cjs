// Chats block screenshots everywhere except the QA app (lib/screenshotPolicy.ts).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const mod = {};
vm.runInNewContext(
  ts.transpileModule(fs.readFileSync('lib/screenshotPolicy.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
  { exports: mod, require: () => ({}), Set },
);

test('the store app and unknown ids block screenshots', () => {
  for (const id of ['chat.mento.app', undefined, null, '', 'chat.mento.app.qa.evil', 'x.qa']) {
    assert.equal(mod.blocksScreenshots(id), true, String(id));
  }
});

test('only the QA app is exempt', () => {
  assert.equal(mod.blocksScreenshots('chat.mento.app.qa'), false);
});
