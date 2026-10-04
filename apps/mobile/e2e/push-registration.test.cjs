const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function fixture(extra, permissions = 'granted') {
  const calls = [];
  const requests = [];
  const credential = { member: 'member-a', listener: 'listener-a' };
  const gates = {};
  const exports = {};
  const state = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,
    '../lib/pushRegistrationState.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports: state });
  const modules = {
    'expo-constants': { default: { expoConfig: { extra } } },
    'expo-device': { isDevice: true },
    'expo-notifications': {
      async getPermissionsAsync() { calls.push('permission-read'); await gates.permissions; return { status: permissions }; },
      async requestPermissionsAsync() { calls.push('prompt'); return { status: 'granted' }; },
      async getExpoPushTokenAsync() { calls.push('token'); await gates.token; return { data: 'synthetic-token' }; },
    },
    'react-native': { Platform: { OS: 'android' } },
    './api': { currentMemberToken: async () => credential.member,
      async apiRequest(route, options = {}, getToken) {
        const bearer = await getToken();
        const role = route.startsWith('/listener/') ? 'listener' : 'member';
        if (!options.method) {
          calls.push(`identity-${role}`); await gates.identity;
          return { id: `${bearer}-account` };
        }
        calls.push(`${options.method === 'POST' ? 'register' : 'delete'}-${role}`);
        requests.push({ role, bearer, method: options.method });
        if (options.method === 'POST') await gates.post;
        return { status: 'ok' };
      } },
    './session': { getSessionToken: async () => credential.member },
    './listenerSession': { getListenerToken: async () => credential.listener },
    './pushRegistrationState': state,
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,
    '../lib/pushNotifications.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports, require: name => { assert.ok(modules[name], name); return modules[name]; } });
  return { calls, requests, credential, gates, state, modules, ...exports,
    replace(role, bearer) {
      const generation = state.beginPushIdentityChange(role);
      credential[role] = bearer;
      state.finishPushIdentityChange(role, generation);
    } };
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
  assert.deepEqual(h.calls, ['identity-member', 'permission-read', 'prompt', 'token', 'register-member']);
});

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const tick = () => new Promise(setImmediate);

test('same-role account switch registers unchanged device token for the new account', async () => {
  const h = fixture({ eas: { projectId: 'synthetic-project' } });
  await h.registerPush('member'); await h.registerPush('member');
  assert.equal(h.requests.length, 1);
  h.replace('member', 'member-b'); await h.registerPush('member');
  assert.deepEqual(h.requests.map(row => row.bearer), ['member-a', 'member-b']);
  await h.registerPush('listener'); await h.registerPush('member'); await h.registerPush('listener');
  assert.equal(h.requests.length, 3); // successful cache per role, not one shared pair
});

test('same-account access-token rotation retains owner-scoped deduplication', async () => {
  const h = fixture({ eas: { projectId: 'synthetic-project' } });
  await h.registerPush('member');
  // Different bearer, same server identity, no identity-generation transition.
  h.modules['./api'].apiRequest = async (route, options = {}, getToken) => {
    if (!options.method) return { id: 'member-a-account' };
    h.requests.push({ bearer: await getToken() });
  };
  h.credential.member = 'member-a-refreshed';
  await h.registerPush('member');
  assert.equal(h.requests.length, 1);
});

for (const stage of ['identity', 'permissions', 'token']) {
  test(`account replacement during ${stage} fences the old asynchronous registration`, async () => {
    const h = fixture({ eas: { projectId: 'synthetic-project' } });
    const gate = deferred(); h.gates[stage] = gate.promise;
    const old = h.registerPush('member'); await tick();
    h.replace('member', 'member-b');
    gate.resolve(); await old;
    assert.equal(h.requests.length, 0);
    await h.registerPush('member');
    assert.deepEqual(h.requests.map(row => row.bearer), ['member-b']);
  });
}

test('late old registration success cannot cache over the replacement and new write follows old', async () => {
  const h = fixture({ eas: { projectId: 'synthetic-project' } });
  const gate = deferred(); h.gates.post = gate.promise;
  const old = h.registerPush('member'); await tick();
  assert.deepEqual(h.requests.map(row => row.bearer), ['member-a']);
  h.replace('member', 'member-b');
  const next = h.registerPush('member'); await tick();
  assert.equal(h.requests.length, 1);
  gate.resolve(); await Promise.all([old, next]);
  assert.deepEqual(h.requests.map(row => row.bearer), ['member-a', 'member-b']);
  await h.registerPush('member');
  assert.equal(h.requests.length, 2);
});

test('concurrent remounts share registration and logout suppresses later work', async () => {
  const h = fixture({ eas: { projectId: 'synthetic-project' } });
  await Promise.all([h.registerPush('member'), h.registerPush('member')]);
  assert.equal(h.requests.length, 1);
  h.state.beginPushIdentityChange('member');
  await h.registerPush('member');
  assert.equal(h.requests.length, 1);
});

test('Start Fresh waits for prior registration, deletes with pinned roles and stays suppressed', async () => {
  const h = fixture({ eas: { projectId: 'synthetic-project' } });
  const gate = deferred(); h.gates.post = gate.promise;
  const old = h.registerPush('member'); await tick();
  const erased = h.unregisterPush(); await tick();
  await h.registerPush('member');
  assert.equal(h.requests.some(row => row.method === 'DELETE' && row.role === 'member'), false);
  gate.resolve(); await Promise.all([old, erased]);
  assert.deepEqual(h.requests.map(row => `${row.method}:${row.bearer}`),
    ['POST:member-a', 'DELETE:listener-a', 'DELETE:member-a']);
  await h.registerPush('member'); assert.equal(h.requests.length, 3);
});

function loadStorageSession(h, name, store) {
  const exports = {};
  const modules = {
    'expo-secure-store': store,
    'react-native': { Platform: { OS: 'android' } },
    './screenCache': { screenCache: { clear() {} } },
    './ownChatLifecycle': { forgetOwnChats() {} },
    './pushRegistrationState': h.state,
    './streamClient': { disconnectStreamClient: async () => {} },
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,
    `../lib/${name}.ts`), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports, require: module => { assert.ok(modules[module], module); return modules[module]; } });
  return exports;
}

test('real session save/clear fences registrations before storage writes, rotation preserves generation', async () => {
  const h = fixture({ eas: { projectId: 'synthetic-project' } });
  const gate = deferred();
  const data = new Map();
  const store = { async setItemAsync(key, value) {
    if (key === 'mento.session_token') await gate.promise;
    data.set(key, value);
  }, async getItemAsync(key) { return data.get(key) ?? null; },
  async deleteItemAsync(key) { data.delete(key); } };
  const session = loadStorageSession(h, 'session', store);
  const saving = session.saveSession('member-b', 'stream-b', { id: 'b' });
  const generation = h.state.pushGeneration('member');
  assert.equal(h.state.pushScopeActive('member', generation), false);
  await h.registerPush('member'); assert.deepEqual(h.calls, []);
  gate.resolve(); await saving;
  assert.equal(h.state.pushScopeActive('member', generation), true);
  await session.saveTokenPair('rotated-access', 'rotated-refresh');
  assert.equal(h.state.pushGeneration('member'), generation);
  await session.clearSession();
  assert.equal(h.state.pushScopeActive('member', h.state.pushGeneration('member')), false);
  await h.registerPush('member'); assert.deepEqual(h.calls, []);
});

test('real listener session lifecycle resets its role without invalidating member cache', async () => {
  const h = fixture({ eas: { projectId: 'synthetic-project' } });
  await h.registerPush('member');
  const memberGeneration = h.state.pushGeneration('member');
  const store = { async setItemAsync() {}, async getItemAsync() { return null; }, async deleteItemAsync() {} };
  const session = loadStorageSession(h, 'listenerSession', store);
  await session.saveListenerToken('listener-b');
  const listenerGeneration = h.state.pushGeneration('listener');
  assert.equal(h.state.pushScopeActive('listener', listenerGeneration), true);
  assert.equal(h.state.pushGeneration('member'), memberGeneration);
  await h.registerPush('member'); assert.equal(h.requests.length, 1);
  await session.clearListenerSession();
  assert.equal(h.state.pushScopeActive('listener', h.state.pushGeneration('listener')), false);
});
