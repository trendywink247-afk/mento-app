const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const eas = require('../eas.json');
const base = require('../app.json').expo;
function resolveConfig(variant, profile) {
  const env = { ...process.env, EXPO_NO_DOTENV: '1' };
  delete env.APP_VARIANT;
  delete env.EAS_BUILD_PROFILE;
  if (variant !== undefined) env.APP_VARIANT = variant;
  if (profile !== undefined) env.EAS_BUILD_PROFILE = profile;
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
  assert.equal(config.ios.bundleIdentifier, 'com.mento.app');
  assert.equal(config.android.package, base.android.package);
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
console.log('PASS: explicit profile environments/channels, safe variant resolution, stable runtime and native identities');
