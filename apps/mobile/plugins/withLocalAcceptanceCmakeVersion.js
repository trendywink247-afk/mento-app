/**
 * Local acceptance only, Windows only: pins a newer CMake for the app module's
 * native build. The Android SDK's default CMake 3.22.1 bundles a ninja whose
 * self-regeneration check loops forever ("manifest still dirty after 100
 * tries") on this machine, and separately hard-fails past Windows' 260-char
 * MAX_PATH on object files nested under a deep worktree checkout path. CMake
 * 3.31.6's bundled ninja does neither (install it first: `sdkmanager
 * "cmake;3.31.6"`). EAS/CI builds and non-Windows machines are unaffected.
 */
const { withAppBuildGradle } = require('@expo/config-plugins');

const PIN = [
  '    externalNativeBuild {',
  '        cmake {',
  '            version "3.31.6"',
  '        }',
  '    }',
  '',
].join('\n');

module.exports = function withLocalAcceptanceCmakeVersion(config) {
  if (process.env.MENTO_LOCAL_ACCEPTANCE !== '1' || process.platform !== 'win32') return config;
  return withAppBuildGradle(config, (modConfig) => {
    if (modConfig.modResults.language !== 'groovy') return modConfig;
    if (modConfig.modResults.contents.includes('version "3.31.6"')) return modConfig;
    modConfig.modResults.contents = modConfig.modResults.contents.replace(
      /android \{\n/,
      `android {\n${PIN}`,
    );
    return modConfig;
  });
};
