const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const exported = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../lib/chatDay.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: exported });
const { chatDayLabel } = exported;
const labels = { today: 'Today', yesterday: 'Yesterday' };
const now = new Date(2026, 9, 28, 1, 30);

test('same calendar day reads Today, even just after midnight', () => {
  assert.equal(chatDayLabel(new Date(2026, 9, 28, 0, 5), now, labels, 'en-US'), 'Today');
});
test('the previous calendar day reads Yesterday', () => {
  assert.equal(chatDayLabel(new Date(2026, 9, 27, 23, 59), now, labels, 'en-US'), 'Yesterday');
});
test('older dates are short and never an ISO string', () => {
  const out = chatDayLabel(new Date(2026, 9, 20, 12), now, labels, 'en-US');
  assert.equal(out, 'Oct 20');
  assert.doesNotMatch(out, /T\d\d:\d\d/);
});
test('a date from another year carries the year', () => {
  assert.match(chatDayLabel(new Date(2025, 11, 31, 12), now, labels, 'en-US'), /2025/);
});
