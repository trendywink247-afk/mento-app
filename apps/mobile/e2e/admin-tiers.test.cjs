// Admin tier rules (lib/adminTiers.ts), DECISIONS R.4 / R.7.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const m = {};
vm.runInNewContext(
  ts.transpileModule(fs.readFileSync('lib/adminTiers.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
  { exports: m, require: () => ({}), Number, Math, Set },
);

test('documents grant the founder\'s tiers (option b)', () => {
  assert.equal(m.grantForDocument('id_card'), 'verified');
  assert.equal(m.grantForDocument('posting_letter'), 'verified');
  assert.equal(m.grantForDocument('other'), 'verified');
  for (const k of ['mains_admit_card', 'interview_letter', 'result']) assert.equal(m.grantForDocument(k), 'mentor');
});

test('counts parse to 0..20 and a Mentor needs prelims', () => {
  assert.deepEqual(m.parseCounts({ prelims: '2', mains: '', interview: 'x' }), { prelims: 2, mains: 0, interview: 0 });
  assert.equal(m.parseCount('99'), 20);
  assert.equal(m.canBeMentor({ prelims: 0, mains: 3, interview: 0 }), false);
  assert.equal(m.canBeMentor({ prelims: 1, mains: 0, interview: 0 }), true);
});

test('badge line reads PPP MM I', () => {
  assert.equal(m.badgeLine({ prelims: 3, mains: 2, interview: 1 }), 'PPP MM I');
  assert.equal(m.badgeLine({ prelims: 1, mains: 0, interview: 0 }), 'P');
  assert.equal(m.badgeLine(null), '');
});

test('roster filter by tier and state', () => {
  const rows = [
    { tier: 'listener', vetting_status: 'approved' },
    { tier: 'mentor', vetting_status: 'approved' },
    { tier: 'verified', vetting_status: 'suspended' },
    { vetting_status: 'approved' },
  ];
  const n = (f) => rows.filter((r) => m.rosterMatches(r, f)).length;
  assert.equal(n({ tier: 'all', state: 'active' }), 3);
  assert.equal(n({ tier: 'all', state: 'hidden' }), 1);
  assert.equal(n({ tier: 'listener', state: 'all' }), 2);
  assert.equal(n({ tier: 'verified', state: 'active' }), 0);
});
