// The mentorship intake form's rules (DECISIONS R.14): marks per attempt, Mains/Optional only when
// Mains was reached, Interview only when reached, and no mark above the paper's maximum.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const mod = {};
vm.runInNewContext(
  ts.transpileModule(fs.readFileSync('lib/menteeForm.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
  { exports: mod, require: () => ({}), Number },
);
const f = mod;

test('fields follow the stage reached', () => {
  assert.deepEqual([...f.fieldsFor('prelims')], ['prelims_gs', 'prelims_csat']);
  assert.ok(f.fieldsFor('mains').includes('optional_2') && !f.fieldsFor('mains').includes('interview'));
  assert.ok(f.fieldsFor('interview').includes('interview'));
});

test('marks parse and stay within the paper maximum', () => {
  assert.equal(f.parseMark(''), null);
  assert.equal(f.parseMark('88.5'), 88.5);
  assert.ok(Number.isNaN(f.parseMark('8a')));
  assert.ok(f.markOk('prelims_gs', 200) && !f.markOk('prelims_gs', 201));
  assert.ok(f.markOk('interview', 275) && !f.markOk('mains_gs1', 251));
  assert.equal(f.attemptsOk([{ year: 2025, stage: 'prelims', prelims_csat: 250 }]), false);
});

test('a prelims-only attempt never sends Mains or Interview marks', () => {
  const out = f.cleanAttempt({ year: 2024, stage: 'prelims', prelims_gs: 90, mains_gs1: 100, interview: 150 });
  assert.equal(JSON.stringify(out), JSON.stringify({ year: 2024, stage: 'prelims', prelims_gs: 90 }));
});

test('an untouched form is empty, so Skip sends nothing', () => {
  assert.equal(f.isEmpty({ marks_visibility: 'mentors', help_with: [], attempts: [] }), true);
  assert.equal(f.isEmpty({ note: '  hi ' }), false);
  const p = f.toPayload({ note: '  ', optional_subject: ' Sociology ' });
  assert.equal(p.note, null);
  assert.equal(p.optional_subject, 'Sociology');
  assert.equal(p.marks_visibility, 'mentors');
});

test('a new attempt follows the newest year', () => {
  const now = new Date('2026-11-15');
  assert.equal(f.nextAttempt([], now).year, 2025);
  assert.equal(f.nextAttempt([{ year: 2023, stage: 'prelims' }], now).year, 2024);
  assert.equal(f.nextAttempt([{ year: 2026, stage: 'prelims' }], now).year, 2026);
});

test('marks are grouped under Prelims, Mains, Optional and Interview by the stage reached', () => {
  const g = (stage) => f.markGroups(stage).map((x) => `${x.group}:${x.fields.length}`).join(' ');
  assert.equal(g('prelims'), 'prelims:2');
  assert.equal(g('mains'), 'prelims:2 mains:4 optional:2');
  assert.equal(g('interview'), 'prelims:2 mains:4 optional:2 interview:1');
});
