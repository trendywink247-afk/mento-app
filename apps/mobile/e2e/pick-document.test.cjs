// Verification upload: the size rule behind the document picker.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const mod = {};
vm.runInNewContext(
  ts.transpileModule(fs.readFileSync('lib/pickDocument.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
  { exports: mod, require },
);

test('the decoded size of a base64 string, with and without padding', () => {
  assert.equal(mod.decodedBytes(Buffer.from('abc').toString('base64')), 3); // no padding
  assert.equal(mod.decodedBytes(Buffer.from('abcd').toString('base64')), 4); // one pad
  assert.equal(mod.decodedBytes(Buffer.from('abcde').toString('base64')), 5); // two pads
  assert.equal(mod.decodedBytes(''), 0);
});

test('the limit is 3 MB, the same as the server', () => {
  assert.equal(mod.MAX_DOCUMENT_BYTES, 3 * 1024 * 1024);
});

test('without the native picker the app says it is unavailable instead of failing', async () => {
  const r = await mod.pickDocument();
  assert.deepEqual(JSON.parse(JSON.stringify(r)), { ok: false, reason: 'unavailable' });
});
