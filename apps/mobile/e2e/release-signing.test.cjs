const assert = require('node:assert/strict');
const test = require('node:test');
const { transform } = require('../plugins/withReleaseSigning');

// Shape of the Gradle file `expo prebuild` generates for this SDK.
const GENERATED = `android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug
            minifyEnabled enableMinifyInReleaseBuilds
        }
    }
}
`;

test('release no longer signs with the debug key; upload key only from the environment', () => {
  const out = transform(GENERATED);
  const release = out.slice(out.indexOf('release {'));
  assert.ok(!release.includes('signingConfigs.debug'));
  assert.ok(release.includes('System.getenv("MENTO_UPLOAD_KEYSTORE") ? signingConfigs.upload : null'));
  // The debug build keeps its debug signing.
  assert.ok(out.slice(out.indexOf('debug {\n            signingConfig')).startsWith('debug {\n            signingConfig signingConfigs.debug'));
  // Passwords are read from the environment, never written into the file.
  assert.ok(out.includes('System.getenv("MENTO_UPLOAD_STORE_PASSWORD")'));
  assert.ok(!/storePassword '(?!android)/.test(out));
});

test('the transform is idempotent', () => {
  const once = transform(GENERATED);
  assert.equal(transform(once), once);
});

test('an unexpected Gradle layout fails loudly instead of shipping debug-signed', () => {
  assert.throws(() => transform('android { buildTypes { release { } } }'), /expected signing blocks/);
});
