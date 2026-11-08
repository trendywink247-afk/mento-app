const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const eas = require('../eas.json');
const base = require('../app.json').expo;
function resolveConfig(variant, profile, extra = {}) {
  const env = { ...process.env, EXPO_NO_DOTENV: '1' };
  delete env.MENTO_LOCAL_ACCEPTANCE;
  delete env.APP_VARIANT;
  delete env.EAS_BUILD_PROFILE;
  if (variant !== undefined) env.APP_VARIANT = variant;
  if (profile !== undefined) env.EAS_BUILD_PROFILE = profile;
  Object.assign(env, extra);
  const output = execFileSync(process.execPath, ['node_modules/expo/bin/cli', 'config', '--type', 'public', '--json'], {
    cwd: root,
    env,
    encoding: 'utf8',
  });
  return JSON.parse(output);
}
for (const variant of ['production', 'preview', 'development']) {
  const profile = eas.build[variant];
  assert.equal(profile.environment, variant);
  assert.equal(profile.env.APP_VARIANT, variant);
  const config = resolveConfig(profile.env.APP_VARIANT, variant);
  assert.equal(config.updates.requestHeaders['expo-channel-name'], eas.build[variant].channel);
  const properties = config.plugins.find(p => Array.isArray(p) && p[0] === 'expo-build-properties')[1];
  assert.equal(properties.android.usesCleartextTraffic, variant !== 'production');
  // The store build keeps the store ids; every other variant installs beside it as "Mento QA".
  const qa = variant !== 'production';
  assert.equal(config.ios.bundleIdentifier, qa ? 'chat.mento.app.qa' : 'chat.mento.app');
  assert.equal(config.android.package, qa ? `${base.android.package}.qa` : base.android.package);
  assert.equal(config.name, qa ? 'Mento QA' : 'Mento');
  // google-services.json lists both packages, so every variant gets the push file.
  assert.equal(config.android.googleServicesFile, './google-services.json');
  assert.deepEqual(config.runtimeVersion, base.runtimeVersion);
  assert.equal(config.updates.url, base.updates.url);
  assert.equal(config.updates.enabled, base.updates.enabled);
  assert.equal(config.scheme, base.scheme);
}
assert.equal(resolveConfig(undefined).updates.requestHeaders['expo-channel-name'], 'preview');
// Store-distribution staging is distinct from internal/ad-hoc preview, while
// targeting the accepted preview update/environment policy on the same app IDs.
assert.equal(eas.build.staging.extends, 'preview');
assert.equal(eas.build.staging.distribution, 'store');
assert.equal(eas.build.staging.environment, 'preview');
assert.equal(eas.build.staging.env.APP_VARIANT, 'preview');
assert.equal(eas.build.staging.channel, 'preview');
assert.equal(eas.build.staging.android.buildType, 'app-bundle');
assert.deepEqual(resolveConfig(eas.build.staging.env.APP_VARIANT, 'staging'), resolveConfig('preview'));
for (const invalid of ['', 'prod', 'staging', 'Production']) {
  assert.throws(() => resolveConfig(invalid), error => error.status === 1);
}
assert.throws(() => resolveConfig(undefined, 'production'), error => error.status === 1);
assert.throws(() => resolveConfig('preview', 'production'), error => error.status === 1);
assert.throws(() => resolveConfig(undefined, 'staging'), error => error.status === 1);
assert.throws(() => resolveConfig('production', 'staging'), error => error.status === 1);
const local = {
  MENTO_LOCAL_ACCEPTANCE: '1',
  EXPO_PUBLIC_API_URL: 'http://localhost:18000/api/v1',
  EXPO_PUBLIC_OWN_CHAT_ACCEPTED: '1',
  EXPO_PUBLIC_OWN_CHAT_NATIVE_ACCEPTED: '1',
  EXPO_PUBLIC_STREAM_API_KEY: '', EXPO_PUBLIC_POSTHOG_KEY: '', EXPO_PUBLIC_SENTRY_DSN: '',
};
const isolated = resolveConfig('development', undefined, local);
assert.equal(isolated.android.package, 'com.mento.acceptance');
assert.equal(isolated.ios.bundleIdentifier, 'com.mento.acceptance');
assert.equal(isolated.scheme, 'mento-acceptance');
assert.equal(isolated.android.googleServicesFile, undefined);
assert.equal(isolated.extra.eas, undefined);
assert.equal(isolated.updates.enabled, false);
assert.equal(isolated.updates.checkAutomatically, 'NEVER');
assert.equal(isolated.updates.url, undefined);
assert.throws(() => resolveConfig('preview', undefined, local), error => error.status === 1);
assert.throws(() => resolveConfig('development', 'development', local), error => error.status === 1);
for (const extra of [
  { EXPO_PUBLIC_API_URL: 'https://api.mento.chat/api/v1' },
  { EXPO_PUBLIC_OWN_CHAT_NATIVE_ACCEPTED: '' },
  { EXPO_PUBLIC_OWN_CHAT_ACCEPTED: '' },
  { EXPO_PUBLIC_STREAM_API_KEY: 'synthetic' },
  { EXPO_PUBLIC_POSTHOG_KEY: 'synthetic' },
  { EXPO_PUBLIC_SENTRY_DSN: 'synthetic' },
  { EXPO_NO_DOTENV: '0' },
  { MENTO_LOCAL_ACCEPTANCE: 'yes' },
]) assert.throws(() => resolveConfig('development', undefined, { ...local, ...extra }), error => error.status === 1);
console.log('PASS: explicit profile environments/channels, safe variant resolution, stable runtime and native identities');
console.log('PASS: separate local acceptance install rejects provider, OTA, store and nonlocal API settings');

// Play release prep: a store version code, no debug-grade permissions, and the unsigned
// release plugin only on the production variant.
{
  const production = resolveConfig('production', 'production');
  assert.ok(Number.isInteger(production.android.versionCode) && production.android.versionCode >= 10);
  for (const permission of ['SYSTEM_ALERT_WINDOW', 'READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE']) {
    assert.ok(production.android.blockedPermissions.includes(`android.permission.${permission}`));
  }
  const signing = (config) => config.plugins.some(p => p === './plugins/withReleaseSigning');
  assert.ok(signing(production));
  assert.ok(!signing(resolveConfig('preview', 'preview')));
  assert.ok(!signing(resolveConfig('development', 'development')));
}
