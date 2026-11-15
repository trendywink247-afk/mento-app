# Builds: Android and iOS, by hand, no cloud build service

Every app build is a script in `ops/`, run on our own machines. There is no EAS and no Expo account in the path. JS-only fixes go to phones over the air from our own update server ([OTA.md](OTA.md)); a native change needs a new build from here.

## Scripts

| Script | Builds | Runs on |
|---|---|---|
| `ops/build-android.sh qa` | QA APK (`chat.mento.app.qa`, "Mento QA", installs beside the store app) | this box |
| `ops/build-android.sh prod --aab` | Play bundle, signed with the upload key | this box |
| `ops/build-ios.sh <qa\|prod>` | `.ipa` (ad-hoc for QA, App Store for prod) | the remote Mac, over SSH |
| `ops/qa-apk.sh` | `build-android.sh qa` + the QA web export, staged as a web release for `/downloads/` | this box (the APK poller calls it) |

All three read the same per-environment settings from `ops/lib/build-env.sh` (API address, `APP_VARIANT`, the `EXPO_PUBLIC_*` flags), so QA and prod cannot drift.

| | QA | Prod |
|---|---|---|
| `APP_VARIANT` | `preview` | `production` |
| API | `https://qa-api.mento.chat/api/v1` | `https://api.mento.chat/api/v1` |
| Update server and certificate | QA server, `certs/ota-qa.pem` | prod server, `certs/ota-prod.pem` (must exist or the build refuses) |
| Android signing | the generated project's key, as every QA build so far | Play upload key only |
| Cleartext http | allowed | off |

## Android

```bash
ops/build-android.sh qa                       # APK from HEAD
ops/build-android.sh qa --sha <commit>        # a specific commit
ops/build-android.sh prod --aab --sha <commit> --version-code <n>
```

- Builds in a clean checkout (`~/build/<env>`, created as a git worktree the first time), never in your working copy. `--version-code` changes the build checkout only.
- Output: `~/build-out/<env>/mento-<env>-<version>-<code>-<sha>.<apk|aab>` plus `.sha256`; the build log sits beside it.
- Needs JDK 17 and the Android SDK (`~/toolchain/jdk17`, `~/toolchain/android`, or `JAVA_HOME` / `ANDROID_HOME`).
- Upload to Play Console is the founder's step ([PLAY_RELEASE.md](PLAY_RELEASE.md)).

## iOS (remote Mac)

```bash
ops/build-ios.sh qa --check                  # is the Mac ready? (ssh, Xcode, CocoaPods, Node, npm, rsync)
ops/build-ios.sh qa --dry-run                # the plan, nothing touched
ops/build-ios.sh prod --sha <commit> --build-number <n>
```

The script sends a `git archive` of the commit to the Mac, runs `npm ci`, `expo prebuild`, `pod install`, `xcodebuild archive` and `-exportArchive` there, and fetches the `.ipa` to `~/build-out/<env>/`. It never prints the Mac's address or any key.

Prerequisites on the Mac (one time): Xcode with command-line tools, CocoaPods, Node 20+, the founder's Apple Developer team signed in to Xcode (or an App Store Connect API key on the Mac), and an SSH key for this box in `~/.ssh/authorized_keys`.

Push on iOS is not wired yet: it needs an APNs key uploaded to Firebase and the Firebase iOS SDK in the app. Until then an iOS build runs, but receives no notifications.

Upload to App Store Connect or TestFlight is the founder's step (Transporter or Xcode Organizer).

## Secrets

All in `/srv/mento/mento-app/.secrets/` (git-ignored; rules in [SECRETS.md](SECRETS.md)). The scripts read only the keys listed here, never `source` the files, and never print values. A missing optional key switches its feature off; it never breaks a QA build.

| File | Keys | Needed for |
|---|---|---|
| `qa.env`, `prod.env` | `EXPO_PUBLIC_STREAM_API_KEY`, `EXPO_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`, optional `SENTRY_URL` | Stream key: required. Sentry: optional |
| `play-upload.jks` + `play-upload.env` | `MENTO_UPLOAD_STORE_PASSWORD`, `MENTO_UPLOAD_KEY_ALIAS`, `MENTO_UPLOAD_KEY_PASSWORD` | Prod Android, required |
| `mac.env` | `MAC_SSH_HOST`, `MAC_SSH_USER`, `MAC_SSH_KEY` (path here), `MAC_WORKDIR`, `APPLE_TEAM_ID`; optional `MAC_SSH_PORT`, `IOS_EXPORT_METHOD`, `MAC_KEYCHAIN_PASSWORD`, `APPLE_API_KEY_PATH` / `_ID` / `APPLE_API_ISSUER` | iOS |

QA's Stream key may also stay in `~/.config/mento/qa-build.env`, where QA builds always read it.

## Sentry symbols

With `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` and `SENTRY_PROJECT` set, each build uploads the JS sourcemap (release = short commit sha, which the app reports; dist = versionCode or iOS build number), Android native symbols and ProGuard mapping when present, and iOS dSYMs. A failed upload is a warning; the build is kept.
