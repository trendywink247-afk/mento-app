/**
 * Dynamic layer over app.json (Expo passes app.json in as `config`). One job today:
 * Android cleartext (plain http://) traffic is allowed only outside production.
 *
 * Development talks to a LAN API over http:// (CLAUDE.md "Phone testing"), so every
 * non-production build keeps cleartext on. A production build — the EAS `production`
 * profile, or `scripts/build-android-release.ps1` — sets APP_VARIANT=production and
 * gets Android's default block-all-cleartext policy: prod is https-only.
 */
import type { ConfigContext, ExpoConfig } from 'expo/config';

const isProduction = process.env.APP_VARIANT === 'production';

export default ({ config }: ConfigContext): ExpoConfig => {
  const plugins = (config.plugins ?? []).map((plugin) => {
    if (!Array.isArray(plugin) || plugin[0] !== 'expo-build-properties') return plugin;
    const [name, props = {}] = plugin;
    return [name, { ...props, android: { ...props.android, usesCleartextTraffic: !isProduction } }];
  });
  // reason: `config` is app.json, which always carries name + slug; ConfigContext types
  // it as Partial<ExpoConfig> only because a bare app.config.ts may have no app.json.
  // Local prebuilds do not receive EAS Build's channel injection. Keep production
  // binaries on the same channel declared by the production EAS profile.
  const updates = isProduction
    ? { ...config.updates, requestHeaders: { ...config.updates?.requestHeaders, 'expo-channel-name': 'production' } }
    : config.updates;
  return { ...config, plugins, updates } as ExpoConfig;
};
