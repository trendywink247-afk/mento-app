const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function fixture(extra, permissions = 'granted') {
  const calls = [];
  const exports = {};
  const modules = {
    'expo-constants': { default: { expoConfig: { extra } } },
    'expo-device': { isDevice: true },
    'expo-notifications': {
      async getPermissionsAsync() { calls.push('permission-read'); return { status: permissions }; },
      async requestPermissionsAsync() { calls.push('prompt'); return { status: 'granted' }; },
      async getExpoPushTokenAsync() { calls.push('token'); return { data: 'synthetic-token' }; },
    },
    'react-native': { Platform: { OS: 'android' } },
    './api': { api: { async registerPushToken() { calls.push('register-member'); },
      async deletePushToken() { calls.push('delete-member'); } } },
    './listenerApi': { listenerApi: { async registerPushToken() { calls.push('register-listener'); },
      async deletePushToken() { calls.push('delete-listener'); } } },
    './listenerSession': { getListenerToken: async () => 'synthetic-listener' },
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,
    '../lib/pushNotifications.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports, require: name => { assert.ok(modules[name], name); return modules[name]; } });
  return { calls, ...exports };
}

test('local acceptance skips permission, token and API calls even with inherited project id', async () => {
  const h = fixture({ localAcceptance: true, eas: { projectId: 'synthetic-project' } }, 'denied');
  await h.registerPush('member'); await h.registerPush('listener'); await h.unregisterPush();
  assert.deepEqual(h.calls, []);
});

test('absent or malformed provider project skips useless notification prompts', async () => {
  for (const extra of [undefined, {}, { eas: {} }, { eas: { projectId: '' } }, { eas: { projectId: 7 } }]) {
    const h = fixture(extra, 'denied');
    await h.registerPush('member'); await h.unregisterPush();
    assert.deepEqual(h.calls, []);
  }
});

test('configured normal native app retains permission and registration behavior', async () => {
  const h = fixture({ eas: { projectId: 'synthetic-project' } }, 'denied');
  await h.registerPush('member');
  assert.deepEqual(h.calls, ['permission-read', 'prompt', 'token', 'register-member']);
});
