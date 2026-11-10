// Pin and Archive on the chat list: the pure rules.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const mod = {};
vm.runInNewContext(
  ts.transpileModule(fs.readFileSync('lib/chatPrefsCore.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
  { exports: mod },
);
const plain = (v) => JSON.parse(JSON.stringify(v));

test('damaged or missing storage reads as nothing pinned and nothing archived', () => {
  for (const raw of [null, '', '{', '[]', '"x"', '{"pinned":5}']) assert.deepEqual(plain(mod.parsePrefs(raw)), { pinned: [], archived: [] });
});

test('only short strings are kept, and at most 500', () => {
  const p = mod.parsePrefs(JSON.stringify({ pinned: ['a', 3, '', 'b'], archived: Array.from({ length: 600 }, (_, i) => `c${i}`) }));
  assert.deepEqual(plain(p.pinned), ['a', 'b']);
  assert.equal(p.archived.length, 500);
});

test('pinning toggles, the newest pin is on top, and pinned and archived never overlap', () => {
  let p = mod.togglePin(mod.EMPTY_PREFS, 'a');
  p = mod.togglePin(p, 'b');
  assert.deepEqual(plain(p.pinned), ['b', 'a']);
  p = mod.toggleArchive(p, 'a'); // archiving a pinned chat unpins it
  assert.deepEqual(plain(p), { pinned: ['b'], archived: ['a'] });
  p = mod.togglePin(p, 'a'); // pinning an archived chat brings it back
  assert.deepEqual(plain(p), { pinned: ['a', 'b'], archived: [] });
  p = mod.togglePin(p, 'a');
  assert.deepEqual(plain(p.pinned), ['b']);
});

test('pinned chats lead and everything else keeps its order', () => {
  const items = ['x', 'y', 'z', 'w'].map((id) => ({ id }));
  const out = mod.pinnedFirst(items, { pinned: ['z', 'x'], archived: [] });
  assert.deepEqual(out.map((i) => i.id), ['z', 'x', 'y', 'w']);
});

test('a chat that is gone leaves no trace', () => {
  const p = mod.forgetMissing({ pinned: ['a', 'b'], archived: ['c', 'd'] }, ['b', 'c']);
  assert.deepEqual(plain(p), { pinned: ['b'], archived: ['c'] });
});
