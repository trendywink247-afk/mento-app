const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('typescript');
const exported = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,
  '../lib/nativeOwnChatLifecycle.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: exported });
const { createNativeOwnChatLifecycle } = exported;

function fixture(initial = { focused: true, foreground: true }) {
  const calls = [];
  let terminal = false;
  const controller = { start: () => calls.push('start'), pause: () => calls.push('pause'),
    dispose: () => calls.push('dispose') };
  const lifecycle = createNativeOwnChatLifecycle(controller, () => !terminal, initial);
  return { calls, lifecycle, revoke: () => { terminal = true; } };
}

test('native background closes transport and suppresses reads, foreground reuses controller', () => {
  const { calls, lifecycle } = fixture();
  assert.equal(lifecycle.readable(), true);
  lifecycle.setForeground(false);
  lifecycle.setForeground(false);
  assert.equal(lifecycle.readable(), false);
  lifecycle.setForeground(true);
  assert.deepEqual(calls, ['start', 'pause', 'start']);
});

test('opening a safety sheet pauses focus and cannot resume in background', () => {
  const { calls, lifecycle } = fixture();
  lifecycle.setFocused(false);
  lifecycle.setForeground(false);
  lifecycle.setFocused(true);
  assert.equal(lifecycle.readable(), false);
  assert.deepEqual(calls, ['start', 'pause']);
  lifecycle.setForeground(true);
  assert.deepEqual(calls, ['start', 'pause', 'start']);
});

test('background startup has no socket until both focused and foreground', () => {
  const { calls, lifecycle } = fixture({ focused: false, foreground: false });
  lifecycle.setForeground(true);
  assert.deepEqual(calls, []);
  lifecycle.setFocused(true);
  assert.deepEqual(calls, ['start']);
});

test('revoked or ended controller never restarts on native focus/foreground', () => {
  const { calls, lifecycle, revoke } = fixture();
  revoke();
  lifecycle.setForeground(false);
  lifecycle.setForeground(true);
  lifecycle.setFocused(false);
  lifecycle.setFocused(true);
  assert.equal(lifecycle.readable(), false);
  assert.deepEqual(calls, ['start', 'pause']);
});

test('unmount or account reset disposes once and cannot restart', () => {
  const { calls, lifecycle } = fixture();
  lifecycle.dispose(); lifecycle.dispose();
  lifecycle.setFocused(false); lifecycle.setFocused(true);
  lifecycle.setForeground(true);
  assert.equal(lifecycle.readable(), false);
  assert.deepEqual(calls, ['start', 'dispose']);
});
