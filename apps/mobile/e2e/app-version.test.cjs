const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const read = rel => fs.readFileSync(path.join(__dirname, rel), 'utf8');

test('withAppVersion adds X-App-Version only when a version is known', () => {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(read('../lib/appVersion.ts'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports });
  const base = { 'Content-Type': 'application/json' };
  assert.deepEqual({ ...exports.withAppVersion(base, '1.2.3') },
    { 'Content-Type': 'application/json', 'X-App-Version': '1.2.3' });
  assert.deepEqual({ ...exports.withAppVersion(base, undefined) }, base);
  assert.deepEqual({ ...exports.withAppVersion(base, '') }, base);
  assert.equal(base['X-App-Version'], undefined, 'input headers are not mutated');
});

test('the one shared API fetch (mobile + web) sends the header and surfaces 426 as ApiError', () => {
  const api = read('../lib/api.ts');
  assert.ok(api.includes("import { withAppVersion } from './appVersion'"));
  assert.ok(api.includes('Constants.expoConfig?.version'));
  // Non-ok responses, including 426 upgrade_required, throw ApiError(status, detail, code, body).
  assert.ok(api.includes('throw new ApiError(res.status, detail, code, body)'));
  assert.equal((api.match(/\bfetch\(/g) || []).length, 1, 'API calls go through apiFetch only');
});
