/**
 * Production variant only (app.config.ts adds it): the generated release build signs with
 * the public debug key, which Google Play rejects and anyone could forge. This swaps it so
 * the release bundle is UNSIGNED by default, to be signed offline with the Play upload key
 * (docs/PLAY_RELEASE.md). If MENTO_UPLOAD_KEYSTORE is set at build time, Gradle signs with
 * that keystore instead; the passwords come from the environment and are never written into
 * the generated project. The debug config stays for debug builds.
 */
const { withAppBuildGradle } = require('@expo/config-plugins');

const UPLOAD_CONFIG = [
  '        if (System.getenv("MENTO_UPLOAD_KEYSTORE")) {',
  '            upload {',
  '                storeFile file(System.getenv("MENTO_UPLOAD_KEYSTORE"))',
  '                storePassword System.getenv("MENTO_UPLOAD_STORE_PASSWORD")',
  '                keyAlias System.getenv("MENTO_UPLOAD_KEY_ALIAS")',
  '                keyPassword System.getenv("MENTO_UPLOAD_KEY_PASSWORD")',
  '            }',
  '        }',
].join('\n');
const RELEASE_SIGNING =
  'signingConfig System.getenv("MENTO_UPLOAD_KEYSTORE") ? signingConfigs.upload : null';

/** Pure text transform of android/app/build.gradle; idempotent. */
function transform(contents) {
  if (contents.includes('MENTO_UPLOAD_KEYSTORE')) return contents;
  const withUpload = contents.replace(
    /(signingConfigs \{\n\s+debug \{[\s\S]*?\n\s+\}\n)/,
    `$1${UPLOAD_CONFIG}\n`,
  );
  const withRelease = withUpload.replace(
    /(release \{\n(?:\s*\/\/[^\n]*\n)*\s*)signingConfig signingConfigs\.debug/,
    `$1${RELEASE_SIGNING}`,
  );
  if (withRelease === withUpload || withUpload === contents) {
    throw new Error('withReleaseSigning: build.gradle did not have the expected signing blocks');
  }
  return withRelease;
}

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (modConfig) => {
    if (modConfig.modResults.language !== 'groovy') return modConfig;
    modConfig.modResults.contents = transform(modConfig.modResults.contents);
    return modConfig;
  });
};
module.exports.transform = transform;
