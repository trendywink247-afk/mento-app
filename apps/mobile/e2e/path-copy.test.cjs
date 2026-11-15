const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const exported = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../lib/pathCopy.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: exported, require: () => ({}) });
const { pathCopy, PATH_COPY_HI } = exported;

// The stages open at launch: UPSC and the general three (services/api/app/services/paths_data.py).
const OPEN = ['foundation', 'mid_prep', 'prelims_wait', 'mains_stage', 'interview_stage', 'after_setback',
  'heavy_days', 'crossroads', 'open_door'];
const server = fs.readFileSync(path.join(__dirname, '../../../services/api/app/services/paths_data.py'), 'utf8');
const unesc = (s) => s.replace(/\\"/g, '"');

function stageStrings(key) {
  const m = server.match(new RegExp(`"${key}": \\{\\s+"title": "([^"]+)",\\s+"blurb": "((?:[^"\\\\]|\\\\.)+)",\\s+"prompts": \\[([\\s\\S]*?)\\]`));
  assert.ok(m, `stage ${key} not found in paths_data.py`);
  const prompts = [...m[3].matchAll(/"((?:[^"\\]|\\.)+)"/g)].map((x) => unesc(x[1]));
  return [unesc(m[1]), unesc(m[2]), ...prompts];
}

test('every open stage title, blurb and starter has Hindi', () => {
  for (const key of OPEN) {
    for (const en of stageStrings(key)) {
      assert.ok(PATH_COPY_HI[en], `no Hindi for ${key}: ${en}`);
    }
  }
});

test('Hindi entries are Devanagari and differ from the English', () => {
  for (const [en, hi] of Object.entries(PATH_COPY_HI)) {
    assert.match(hi, /[ऀ-ॿ]/, `not Devanagari: ${en}`);
    assert.notEqual(hi, en);
  }
});

test('English stays English; unknown text falls back to itself', () => {
  assert.equal(pathCopy('en', 'The interview wait'), 'The interview wait');
  assert.equal(pathCopy('hi', 'A brand new stage'), 'A brand new stage');
  assert.equal(pathCopy('hi', 'The interview wait'), 'इंटरव्यू का इंतज़ार');
});
