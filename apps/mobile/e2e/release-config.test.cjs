const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const base = require('../app.json').expo;
function resolveConfig(variant, extra = {}, type = 'public') {
  const env = { ...process.env, EXPO_NO_DOTENV: '1' };
  delete env.MENTO_LOCAL_ACCEPTANCE;
  delete env.APP_VARIANT;
  if (variant !== undefined) env.APP_VARIANT = variant;
  Object.assign(env, extra);
  const output = execFileSync(process.execPath, ['node_modules/expo/bin/cli', 'config', '--type', type, '--json'], {
    cwd: root,
    env,
    encoding: 'utf8',
  });
  return JSON.parse(output);
}
const OTA = {
  preview: ['https://qa-api.mento.chat/ota/api/manifest', './certs/ota-qa.pem'],
  production: ['https://api.mento.chat/ota/api/manifest', './certs/ota-prod.pem'],
};
for (const variant of ['production', 'preview', 'development']) {
  const config = resolveConfig(variant);
  const properties = config.plugins.find(p => Array.isArray(p) && p[0] === 'expo-build-properties')[1];
  assert.equal(properties.android.usesCleartextTraffic, variant !== 'production');
  // The store build keeps the store ids; every other variant installs beside it as "Mento QA".
  const qa = variant !== 'production';
  assert.equal(config.ios.bundleIdentifier, qa ? 'chat.mento.app.qa' : 'chat.mento.app');
  assert.equal(config.android.package, qa ? `${base.android.package}.qa` : base.android.package);
  assert.equal(config.name, qa ? 'Mento QA' : 'Mento');
  assert.equal(config.android.googleServicesFile, './google-services.json');
  assert.deepEqual(config.runtimeVersion, base.runtimeVersion);
  assert.equal(config.scheme, base.scheme);
  // No Expo cloud anywhere: no EAS project, no owner, no u.expo.dev.
  assert.equal(config.extra?.eas, undefined);
  assert.equal(config.owner, undefined);
  assert.ok(!JSON.stringify(config).includes('expo.dev'));
  if (variant === 'development') {
    assert.equal(config.updates.enabled, false);
    assert.equal(config.updates.url, undefined);
    continue;
  }
  // Self-hosted OTA: own server, own channel, signed updates only.
  assert.equal(config.updates.enabled, true);
  assert.equal(config.updates.url, OTA[variant][0]);
  // The public config hides signing fields; the prebuild config is what the native build bakes in.
  const baked = resolveConfig(variant, {}, 'prebuild').updates;
  assert.equal(baked.codeSigningCertificate, OTA[variant][1]);
  assert.deepEqual(baked.codeSigningMetadata, { keyid: 'main', alg: 'rsa-v1_5-sha256' });
  assert.equal(config.updates.requestHeaders['expo-channel-name'], variant);
}
assert.equal(resolveConfig(undefined).updates.requestHeaders['expo-channel-name'], 'preview');
for (const invalid of ['', 'prod', 'staging', 'Production']) {
  assert.throws(() => resolveConfig(invalid), error => error.status === 1);
}
const local = {
  MENTO_LOCAL_ACCEPTANCE: '1',
  EXPO_PUBLIC_API_URL: 'http://localhost:18000/api/v1',
  EXPO_PUBLIC_OWN_CHAT_ACCEPTED: '1',
  EXPO_PUBLIC_OWN_CHAT_NATIVE_ACCEPTED: '1',
  EXPO_PUBLIC_STREAM_API_KEY: '', EXPO_PUBLIC_POSTHOG_KEY: '', EXPO_PUBLIC_SENTRY_DSN: '',
};
const isolated = resolveConfig('development', local);
assert.equal(isolated.android.package, 'com.mento.acceptance');
assert.equal(isolated.ios.bundleIdentifier, 'com.mento.acceptance');
assert.equal(isolated.scheme, 'mento-acceptance');
assert.equal(isolated.android.googleServicesFile, undefined);
assert.equal(isolated.extra.eas, undefined);
assert.equal(isolated.updates.enabled, false);
assert.equal(isolated.updates.checkAutomatically, 'NEVER');
assert.equal(isolated.updates.url, undefined);
assert.throws(() => resolveConfig('preview', local), error => error.status === 1);
for (const extra of [
  { EXPO_PUBLIC_API_URL: 'https://api.mento.chat/api/v1' },
  { EXPO_PUBLIC_OWN_CHAT_NATIVE_ACCEPTED: '' },
  { EXPO_PUBLIC_OWN_CHAT_ACCEPTED: '' },
  { EXPO_PUBLIC_STREAM_API_KEY: 'synthetic' },
  { EXPO_PUBLIC_POSTHOG_KEY: 'synthetic' },
  { EXPO_PUBLIC_SENTRY_DSN: 'synthetic' },
  { EXPO_NO_DOTENV: '0' },
  { MENTO_LOCAL_ACCEPTANCE: 'yes' },
]) assert.throws(() => resolveConfig('development', { ...local, ...extra }), error => error.status === 1);
console.log('PASS: per-variant self-hosted OTA url/channel/signing, no Expo cloud, safe variant resolution, stable runtime and native identities');
console.log('PASS: separate local acceptance install rejects provider, OTA, store and nonlocal API settings');

// Play release prep: a store version code, no debug-grade permissions, and the unsigned
// release plugin only on the production variant.
{
  const production = resolveConfig('production');
  assert.ok(Number.isInteger(production.android.versionCode) && production.android.versionCode >= 10);
  for (const permission of ['SYSTEM_ALERT_WINDOW', 'READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE']) {
    assert.ok(production.android.blockedPermissions.includes(`android.permission.${permission}`));
  }
  const signing = (config) => config.plugins.some(p => p === './plugins/withReleaseSigning');
  assert.ok(signing(production));
  assert.ok(!signing(resolveConfig('preview')));
  assert.ok(!signing(resolveConfig('development')));
}
