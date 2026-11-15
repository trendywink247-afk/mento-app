# Mobile dependencies audit

Audited 2026-11-11 on `dev` 88a4c9a (Expo SDK 55, React Native 0.83, `apps/mobile`). Method: `npx expo-doctor`, `npx expo install --check`, `depcheck`, `npm audit --omit=dev`, `npm ls`, `expo export` for web and Android, and the native fingerprint.

**Native fingerprint is unchanged by this PR (`45704dda35e6`)**, so it needs no new APK and ships as a normal JS update.

## Summary

| Area | Result |
|---|---|
| Hermes | On (Android export is a `.hbc` bytecode bundle, 13 MB) |
| New architecture | On by default (mandatory since RN 0.82) |
| expo-doctor | 18/20 pass. Fails: `@expo/config-plugins` direct install; 2 patch versions behind |
| Bundles | Android 13 MB Hermes bytecode (31 MB export with assets). Web entry 5.8 MB JS + 0.4 MB lazy chunk (18 MB export with media) |
| `usesCleartextTraffic` | `true` in `app.json`, but `app.config.ts` forces it off for the production profile. Fine |

## npm audit (production deps): 21 findings, 8 high

Every high finding sits in a build-time tool, a Node-only package, or a deep-link parser. None is reachable by message content.

| Package | Brought in by | Reachable at runtime? | Risk | Action | Status |
|---|---|---|---|---|---|
| `follow-redirects` 1.16.0 | `stream-chat` > `axios` | No. Node HTTP adapter only; React Native and Metro use the XHR adapter | Low | npm override to 1.16.3 | **Done** (lockfile only) |
| `node-forge` 1.4.0 | `expo` CLI, `expo-updates` code-signing helper | No. Build/CLI side only | Low | npm override to 1.4.3 | **Done** (lockfile only) |
| `zod` 3.25.76 | `@expo/cli` | No. Build CLI only (memory exhaustion on oversized input we do not feed it) | Low | Fix needs zod 4, a major bump inside Expo's CLI. Wait for the next SDK patch | Report-only |
| `@expo/cli` and its `@expo/config*`, `fingerprint`, `metro-config`, `prebuild-config`, `glob`, `minimatch`, `xcode`, `uuid`, `deepmerge` | `expo` | No. Dev and build tooling | Low | `npm audit fix` suggests `expo@52`, which is a downgrade. Ignore. Moves with the Expo SDK | Report-only |
| `query-string` 7.1.3, `decode-uri-component` 0.2.2, `@react-navigation/core` 7.18.0 | `expo-router` > `@react-navigation/native` | **Yes.** They parse deep-link and route URLs | Low (a crafted `mento://` link with malformed percent-encoding can slow or crash the app. It does not leak data) | Override of `decode-uri-component` to 0.5.1 not applied: that version is ESM-only and `query-string` 7 `require()`s it. Real fix is a newer `expo-router` or `@react-navigation/core` | Report-only (native-adjacent: expo-router) |
| `expo-router`, `expo-updates`, `expo` (listed as vulnerable via the above) | n/a | n/a | n/a | Move with the Expo SDK | Report-only |

## Unused or misplaced packages

`depcheck` flags these as unused. All are native modules, so removing any changes the native fingerprint and forces a new APK. **Nothing was removed.**

| Package | Why it may still be needed | Suggested action |
|---|---|---|
| `@react-native-community/netinfo` | Optional peer of `stream-chat-expo` (offline detection) | Keep |
| `react-native-worklets` | Required peer of `react-native-reanimated` | Keep |
| `react-native-teleport` | Patched by `patches/react-native-teleport+1.1.8.patch`; used via a peer | Keep until the patch owner is checked |
| `expo-system-ui` | Needed for `userInterfaceStyle` on Android | Keep |
| `expo-dev-client` | Dev builds only | Candidate to move to `devDependencies` (native, with the next APK) |
| `expo-build-properties` | Used in `app.json` plugins (depcheck false positive) | Keep |

Also: `@react-navigation/native` and `@react-navigation/bottom-tabs` are imported by `components/motion/*` but not declared (they resolve through `expo-router`). Declare them at the versions `expo-router` uses next time `package.json` changes. `playwright` is used only by an e2e script and should be a dev dependency.

## Version drift

| Package | Installed | Expected by SDK | Action |
|---|---|---|---|
| `expo` | 55.0.31 | ~55.0.32 | Native. Bump with the next APK |
| `expo-dev-client` | 55.0.40 | ~55.0.41 | Native. Bump with the next APK |
| `@expo/config-plugins` | direct dep | should come from `expo/config-plugins` | Imported by `plugins/withReleaseSigning.js` and `withLocalAcceptanceCmakeVersion.js`; switch both to `expo/config-plugins`, then drop the dep (it is already in `expo.install.exclude`) |

## Permissions

`android.permissions` is empty, and `SYSTEM_ALERT_WINDOW` and external storage read and write are blocked. Permissions added by modules (such as notifications) are not visible without a prebuild; check the merged `AndroidManifest.xml` in the next APK build.

## Native-affecting items (each needs a new APK)

1. `expo` and `expo-dev-client` patch bumps.
2. Moving `expo-dev-client` to `devDependencies`.
3. Switching the two config plugins to `expo/config-plugins` (config only, but run the fingerprint to confirm).
4. A newer `expo-router` to fix the query-string chain (do it as part of the next SDK patch).

## What this change did

Two `overrides` in `apps/mobile/package.json` (`follow-redirects` 1.16.3, `node-forge` 1.4.3) and the matching lockfile lines. Verified: typecheck clean, 154/154 unit tests, route/question/placement/bubble tests pass, web and Android exports succeed, fingerprint identical before and after.
