/**
 * Dynamic layer over app.json: explicit profile channels and production cleartext
 * policy. Default preview preserves local/CI builds without an explicit variant.
 *
 * Development talks to a LAN API over http:// (CLAUDE.md "Phone testing"), so every
 * non-production build keeps cleartext on. A production build — the EAS `production`
 * profile, or `scripts/build-android-release.ps1` — sets APP_VARIANT=production and
 * gets Android's default block-all-cleartext policy: prod is https-only.
 */
import type { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => {
  const variant = process.env.APP_VARIANT ?? 'preview';
  if (!['development', 'preview', 'production'].includes(variant)) {
    throw new Error('APP_VARIANT must be development, preview or production');
  }
  const easProfile = process.env.EAS_BUILD_PROFILE;
  const profileVariant = easProfile === 'staging' ? 'preview' : easProfile;
  if (profileVariant && ['development', 'preview', 'production'].includes(profileVariant)
      && process.env.APP_VARIANT !== profileVariant) {
    throw new Error('APP_VARIANT must match the selected EAS_BUILD_PROFILE');
  }
  const isProduction = variant === 'production';
  const plugins = (config.plugins ?? []).map((plugin) => {
    if (!Array.isArray(plugin) || plugin[0] !== 'expo-build-properties') return plugin;
    const [name, props = {}] = plugin;
    return [name, { ...props, android: { ...props.android, usesCleartextTraffic: !isProduction } }];
  });
  // reason: `config` is app.json, which always carries name + slug; ConfigContext types
  // it as Partial<ExpoConfig> only because a bare app.config.ts may have no app.json.
  // Local prebuilds do not receive EAS Build's channel injection. Every profile
  // must resolve the same channel locally and on EAS; development never inherits
  // app.json's preview channel. Runtime policy and native identities stay stable.
  const updates = {
    ...config.updates,
    requestHeaders: { ...config.updates?.requestHeaders, 'expo-channel-name': variant },
  };
  const localAcceptance = process.env.MENTO_LOCAL_ACCEPTANCE;
  if (localAcceptance !== undefined && localAcceptance !== '0' && localAcceptance !== '1') {
    throw new Error('MENTO_LOCAL_ACCEPTANCE must be 0 or 1');
  }
  if (localAcceptance === '1') {
    // Separate synthetic install: never replace a member's app or load an OTA.
    // This is intentionally not an EAS/store profile or provider-push build.
    if (variant !== 'development' || easProfile
        || process.env.EXPO_NO_DOTENV !== '1'
        || process.env.EXPO_PUBLIC_API_URL !== 'http://localhost:18000/api/v1'
        || process.env.EXPO_PUBLIC_OWN_CHAT_ACCEPTED !== '1'
        || process.env.EXPO_PUBLIC_OWN_CHAT_NATIVE_ACCEPTED !== '1'
        || ['EXPO_PUBLIC_STREAM_API_KEY', 'EXPO_PUBLIC_POSTHOG_KEY', 'EXPO_PUBLIC_SENTRY_DSN']
          .some(key => Boolean(process.env[key]))) {
      throw new Error('Local acceptance requires isolated own-chat settings and no provider keys');
    }
    const { googleServicesFile: _androidServices, ...android } = config.android ?? {};
    const { googleServicesFile: _iosServices, ...ios } = config.ios ?? {};
    const { eas: _eas, ...extra } = config.extra ?? {};
    // eslint-disable-next-line @typescript-eslint/no-var-requires -- plugin module, not a type import
    const withLocalAcceptanceCmakeVersion = require('./plugins/withLocalAcceptanceCmakeVersion');
    return {
      ...config, plugins: [...plugins, withLocalAcceptanceCmakeVersion],
      name: 'Mento Acceptance', scheme: 'mento-acceptance',
      android: { ...android, package: 'com.mento.acceptance' },
      ios: { ...ios, bundleIdentifier: 'com.mento.acceptance' },
      extra: { ...extra, localAcceptance: true },
      updates: { enabled: false, checkAutomatically: 'NEVER' },
    } as ExpoConfig;
  }
  return { ...config, plugins, updates } as ExpoConfig;
};
