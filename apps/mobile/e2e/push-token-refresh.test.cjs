const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(os, store, unregister) {
  const exports = {};
  const modules = {
    'expo-notifications': { unregisterForNotificationsAsync: unregister },
    'expo-secure-store': {
      getItemAsync: async (k) => store.get(k) ?? null,
      setItemAsync: async (k, v) => { store.set(k, v); },
    },
    'react-native': { Platform: { OS: os } },
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,
    '../lib/pushTokenRefresh.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports, require: (n) => { assert.ok(modules[n], n); return modules[n]; } });
  return exports;
}

test('android drops the FCM registration once, and concurrent callers share one run', async () => {
  const store = new Map(); let n = 0;
  const m = load('android', store, async () => { n++; });
  await Promise.all([m.refreshPushTokenOnce(), m.refreshPushTokenOnce()]);
  await m.refreshPushTokenOnce();
  assert.equal(n, 1);
  assert.equal(store.size, 1);
});

test('an install that already refreshed does nothing', async () => {
  const store = new Map([['mento.push.fcm-refresh.v1', '1']]); let n = 0;
  await load('android', store, async () => { n++; }).refreshPushTokenOnce();
  assert.equal(n, 0);
});

test('a failed refresh never throws and is retried next launch', async () => {
  const store = new Map();
  await load('android', store, async () => { throw new Error('unavailable'); }).refreshPushTokenOnce();
  assert.equal(store.size, 0);
});

test('other platforms are untouched', async () => {
  const store = new Map(); let n = 0;
  await load('ios', store, async () => { n++; }).refreshPushTokenOnce();
  assert.equal(n, 0);
  assert.equal(store.size, 0);
});
