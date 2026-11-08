// Prepared answers: the pure rules behind the slash shortcut.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const mod = {};
vm.runInNewContext(
  ts.transpileModule(fs.readFileSync('lib/preparedAnswersCore.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
  { exports: mod },
);
const plain = (v) => JSON.parse(JSON.stringify(v));
const A = [
  { id: '1', shortcut: 'thanks', title: 'Thank you for sharing this', body: 'Thank you for telling me this.' },
  { id: '2', shortcut: 'rest', title: 'Rest is part of preparing', body: 'Rest between papers helps.', pinned: true },
  { id: '3', shortcut: 'the', title: 'There is no hurry', body: 'Take all the time you need.' },
];

test('a shortcut is lower case letters and digits, never the slash', () => {
  assert.equal(mod.cleanShortcut('/Thanks!'), 'thanks');
  assert.equal(mod.cleanShortcut('  Re st '), 'rest');
  assert.equal(mod.cleanShortcut('averyveryverylongshortcut').length, 12);
});

test('only "/" plus letters or digits is a slash command', () => {
  assert.equal(mod.slashQuery('/'), '');
  assert.equal(mod.slashQuery('/Th'), 'th');
  assert.equal(mod.slashQuery('hello /th'), null);
  assert.equal(mod.slashQuery('/th ank'), null);
  assert.equal(mod.slashQuery('/th\nx'), null);
  assert.equal(mod.slashQuery(''), null);
});

test('suggestions: shortcut prefix first, then title words; pinned lead; nothing for plain text', () => {
  assert.deepEqual(plain(mod.suggest('/th', A).map((a) => a.id)), ['1', '3']);
  assert.deepEqual(plain(mod.suggest('/', A).map((a) => a.id)), ['2', '1', '3']); // pinned, then by shortcut
  assert.deepEqual(plain(mod.suggest('/hurry', A).map((a) => a.id)), ['3']); // title word
  assert.deepEqual(plain(mod.suggest('hello', A)), []);
  assert.deepEqual(plain(mod.suggest('/zz', A)), []);
  assert.equal(mod.suggest('/', A, 2).length, 2);
});

test('choosing an answer fills its body and sends nothing', () => {
  assert.equal(mod.fill(A[0]), 'Thank you for telling me this.');
});

test('validation: shortcut length, title, body, duplicates, and a full list', () => {
  const ok = { shortcut: 'new', title: 'T', body: 'B' };
  assert.equal(mod.validateAnswer(ok, A), null);
  assert.equal(mod.validateAnswer({ ...ok, shortcut: 'x' }, A), 'shortcut');
  assert.equal(mod.validateAnswer({ ...ok, title: ' ' }, A), 'title');
  assert.equal(mod.validateAnswer({ ...ok, body: '' }, A), 'body');
  assert.equal(mod.validateAnswer({ ...ok, body: 'x'.repeat(501) }, A), 'body');
  assert.equal(mod.validateAnswer({ ...ok, shortcut: '/Rest' }, A), 'duplicate');
  assert.equal(mod.validateAnswer({ ...ok, shortcut: 'rest' }, A, '2'), null); // editing itself is fine
  assert.equal(mod.validateAnswer(ok, Array.from({ length: 30 }, (_, i) => ({ ...A[0], id: String(i), shortcut: 's' + i }))), 'full');
});
