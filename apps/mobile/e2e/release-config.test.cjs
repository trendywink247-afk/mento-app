const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const eas = require('../eas.json');
for (const variant of ['production', 'preview']) {
  const output = execFileSync(process.execPath, ['node_modules/expo/bin/cli', 'config', '--type', 'public', '--json'], {
    cwd: root,
    env: { ...process.env, APP_VARIANT: variant, EXPO_NO_DOTENV: '1' },
    encoding: 'utf8',
  });
  const config = JSON.parse(output);
  assert.equal(config.updates.requestHeaders['expo-channel-name'], eas.build[variant].channel);
  const properties = config.plugins.find(p => Array.isArray(p) && p[0] === 'expo-build-properties')[1];
  assert.equal(properties.android.usesCleartextTraffic, variant !== 'production');
  assert.equal(config.ios.bundleIdentifier, 'com.mento.app');
}
console.log('PASS: production/preview update channels and cleartext policy');
