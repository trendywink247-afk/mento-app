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

test('a slash command is the last word: "/" plus letters or digits, alone or after other words', () => {
  assert.equal(mod.slashQuery('/'), '');
  assert.equal(mod.slashQuery('/Th'), 'th');
  assert.equal(mod.slashQuery('hello /th'), 'th');
  assert.equal(mod.slashQuery('hello\n/th'), 'th');
  assert.equal(mod.slashQuery('hello /'), '');
  assert.equal(mod.slashQuery('a/b'), null); // not at a word start
  assert.equal(mod.slashQuery('/th ank'), null); // the last word is not a command
  assert.equal(mod.slashQuery('hello'), null);
  assert.equal(mod.slashQuery(''), null);
  assert.deepEqual(plain(mod.slashTrigger('hello /th')), { query: 'th', start: 6 });
});

test('suggestions: shortcut prefix first, then words in the answer; pinned lead; none for plain text', () => {
  assert.deepEqual(plain(mod.suggest('/th', A).map((a) => a.id)), ['1', '3']);
  assert.deepEqual(plain(mod.suggest('Hello /th', A).map((a) => a.id)), ['1', '3']);
  assert.deepEqual(plain(mod.suggest('/', A).map((a) => a.id)), ['2', '1', '3']); // pinned, then by shortcut
  assert.deepEqual(plain(mod.suggest('/hurry', A).map((a) => a.id)), ['3']); // a word in the answer
  assert.deepEqual(plain(mod.suggest('hello', A)), []);
  assert.deepEqual(plain(mod.suggest('/zz', A)), []);
  assert.equal(mod.suggest('/', A, 2).length, 2);
});

test('choosing an answer replaces only the /word, keeping what was already typed', () => {
  assert.equal(mod.applyAnswer('/th', A[0]), 'Thank you for telling me this.');
  assert.equal(mod.applyAnswer('Hello, /th', A[0]), 'Hello, Thank you for telling me this.');
  assert.equal(mod.applyAnswer('no command', A[0]), 'Thank you for telling me this.');
});

test('a title is the first words of the body, shortened', () => {
  assert.equal(mod.titleFrom('  Take   your time  '), 'Take your time');
  assert.equal(mod.titleFrom('x'.repeat(100)).length, 60);
});

test('validation: shortcut length, body, duplicates, and a full list (no title needed)', () => {
  const ok = { shortcut: 'new', body: 'B' };
  assert.equal(mod.validateAnswer(ok, A), null);
  assert.equal(mod.validateAnswer({ ...ok, shortcut: 'x' }, A), 'shortcut');
  assert.equal(mod.validateAnswer({ ...ok, body: '' }, A), 'body');
  assert.equal(mod.validateAnswer({ ...ok, body: 'x'.repeat(501) }, A), 'body');
  assert.equal(mod.validateAnswer({ ...ok, shortcut: '/Rest' }, A), 'duplicate');
  assert.equal(mod.validateAnswer({ ...ok, shortcut: 'rest' }, A, '2'), null); // editing itself is fine
  assert.equal(mod.validateAnswer(ok, Array.from({ length: 30 }, (_, i) => ({ ...A[0], id: String(i), shortcut: 's' + i }))), 'full');
});
