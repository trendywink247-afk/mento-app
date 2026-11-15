// "Please update the app": only the server's 426 upgrade_required raises the screen.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const mod = {};
vm.runInNewContext(
  ts.transpileModule(fs.readFileSync('lib/upgradeGate.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
  { exports: mod, require: (n) => (n === 'react' ? { useSyncExternalStore: () => false } : require(n)) },
);

test('only 426 with the upgrade_required code means "update the app"', () => {
  assert.equal(mod.isUpgradeRefusal(426, 'upgrade_required'), true);
  assert.equal(mod.isUpgradeRefusal(426, null), false); // some other 426
  assert.equal(mod.isUpgradeRefusal(403, 'upgrade_required'), false);
  assert.equal(mod.isUpgradeRefusal(500, null), false);
});

test('raising sets the flag once and clearing lowers it', () => {
  assert.equal(mod.upgradeRequired(), false);
  mod.raiseUpgradeRequired();
  mod.raiseUpgradeRequired();
  assert.equal(mod.upgradeRequired(), true);
  mod.clearUpgradeRequired();
  assert.equal(mod.upgradeRequired(), false);
});

test('the request layer raises it on exactly that refusal', () => {
  const api = fs.readFileSync('lib/api.ts', 'utf8');
  assert.ok(api.includes('if (isUpgradeRefusal(res.status, code)) raiseUpgradeRequired();'));
});
