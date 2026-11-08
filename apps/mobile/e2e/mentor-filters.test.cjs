const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const mod = {};
vm.runInNewContext(
  ts.transpileModule(fs.readFileSync('lib/mentorFilters.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText,
  { exports: mod },
);
const { roadChips, matchesRoad } = mod;
const plain = (v) => JSON.parse(JSON.stringify(v));
const names = { upsc: 'UPSC', ssc: 'SSC', gate: 'GATE', neet: 'NEET', life: 'Life' };

test('the member\'s road comes first, then the busiest roads, at most two', () => {
  const chips = roadChips(names, ['ssc', 'ssc', 'gate', 'neet', 'neet', 'neet', 'upsc'], 'upsc');
  assert.deepEqual(plain(chips).map((c) => c.slug), ['upsc', 'neet', 'ssc']);
  assert.equal(chips[0].key, 'road:upsc');
});

test('own road shows even with no mentor on it; no road, no road chips for it', () => {
  assert.deepEqual(plain(roadChips(names, [], 'gate')).map((c) => c.slug), ['gate']);
  assert.deepEqual(plain(roadChips(names, ['ssc'], null)).map((c) => c.slug), ['ssc']);
  assert.deepEqual(plain(roadChips(names, [], 'life')), []);
});

test('unknown or missing roads never become chips', () => {
  assert.deepEqual(plain(roadChips(names, [null, undefined, 'zzz', 'life'], 'zzz')), []);
});

test('filtering by a road or by life', () => {
  assert.equal(matchesRoad('road:ssc', 'ssc', []), true);
  assert.equal(matchesRoad('road:ssc', 'upsc', []), false);
  assert.equal(matchesRoad('road:ssc', null, []), false);
  assert.equal(matchesRoad('life', 'life', []), true);
  assert.equal(matchesRoad('life', 'upsc', ['life']), true);
  assert.equal(matchesRoad('life', 'upsc', []), false);
});
