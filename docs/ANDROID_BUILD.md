# Android build & self-hosted OTA — the no-EAS-cost path

> Goal: a **standalone installable APK** (no Expo Go) that **self-updates on shake**, with
> **$0 recurring cost**. This is the founder-chosen route (local build + self-hosted OTA).

## First, the cost myth — cleared up

- **Expo SDK is free and stays.** The whole app is built on it (`expo-router`, every
  `expo-*` module). "Removing Expo" = rewriting the app for zero benefit. It is **not**
  what costs money.
- **EAS** (Expo's *cloud* build + update service) is the paid part — and it's **optional**.
  Its free tier is generous (30 builds/mo, 1,000 monthly active users for OTA), but we
  avoid it entirely here:
  - **Local APK builds** — on your machine, free, unlimited.
  - **Self-hosted OTA** — a free open-source server speaking Expo's update protocol, so
    shake-to-update works without EAS Update.

| Path | Cost | Setup | OTA / shake-update |
|---|---|---|---|
| **This doc** (local + self-host) | $0 forever | Android SDK + a small server | ✅ |
| EAS free tier | $0 within limits | minimal | ✅ |
| EAS paid | $$ | minimal | ✅ |

The app is **already wired** for this: `expo-updates` is installed, the shake gesture
(`lib/useShakeToUpdate.ts`) and the manual "Check for updates" row (Profile) both call
`Updates.checkForUpdateAsync()` with **no URL typing** — they read the update URL baked
into the native build. The only missing piece is pointing that URL at your server (§4).

---

## 1. Prerequisites (one-time, Windows)

- **JDK 17** (Temurin/Adoptium). Set `JAVA_HOME`.
- **Android SDK** — easiest via **Android Studio** (installs SDK + platform-tools + an
  emulator). Set `ANDROID_HOME` (e.g. `C:\Users\<you>\AppData\Local\Android\Sdk`) and add
  `platform-tools` to `PATH` (gives you `adb`).
- A device with **USB debugging** on, or an emulator.

> **Windows note:** `eas build --local` is **not supported on Windows** — use the
> `expo prebuild` + Gradle path below (or build inside WSL2 if you prefer `--local`).

---

## 2. Generate the native project

From `apps/mobile`:

```powershell
npm install                         # applies patches/ via postinstall — required
npx expo prebuild --platform android
```

`prebuild` reads `app.json` and generates `android/`. It bakes in the `expo-updates`
config (the `updates` block from §4 when you add it), the package `com.mento.app`, FCM
(`google-services.json`), and permissions. Re-run it after any `app.json` change.

> The `.npmrc` (`legacy-peer-deps`) and `patches/` are device-compat fixes — never remove
> them. See the **teleport patch caveat** in §6.

---

## 3. Build the APK locally

**Quick test build** (debug — signed with the auto debug keystore, directly installable):

```powershell
cd android
./gradlew assembleDebug
# → android/app/build/outputs/apk/debug/app-debug.apk
```

**Release build** (smaller, production-signed — needed before distributing / for OTA to
match `runtimeVersion`):

```powershell
# one-time: create a release keystore
keytool -genkeypair -v -keystore mento-release.keystore -alias mento `
  -keyalg RSA -keysize 2048 -validity 10000
# put its path/passwords in android/gradle.properties (MENTO_UPLOAD_STORE_FILE, etc.)
# and wire signingConfigs.release in android/app/build.gradle, then:
cd android
./gradlew assembleRelease
# → android/app/build/outputs/apk/release/app-release.apk
```

**Install on a connected device:**

```powershell
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

At this point you have a **standalone APK with no Expo Go dependency**. Shake-to-update is
present but inert until you configure OTA (§4) — that's the intended "APK now, OTA when
ready" state.

---

## 4. Self-hosted OTA (make shake-to-update live)

### 4a. Stand up a free OTA server

Both speak Expo's official update protocol, so the client needs no code change:

- **[xprem / expo-open-ota](https://github.com/axelmarciano/expo-open-ota)** — single Go
  binary, stateless mode (no DB), your bucket/CDN. Recommended.
- **[Xavia OTA](https://github.com/xavia-io/xavia-ota)** — Next.js + Postgres, admin UI.

Deploy it anywhere you host (a small VM, DigitalOcean, etc.). Note its public base URL and
follow its README for the manifest endpoint and (if it signs updates) the code-signing
certificate.

### 4b. Add the `updates` block to `app.json`

Under `expo`, add (fill in your server; `channel` maps a build to a branch on the server):

```jsonc
"updates": {
  "enabled": true,
  "url": "https://YOUR-OTA-HOST/api/manifest",
  "fallbackToCacheTimeout": 0,
  "requestHeaders": { "expo-channel-name": "preview" },
  "codeSigningCertificate": "./certs/certificate.pem",     // if your server signs
  "codeSigningMetadata": { "keyid": "main", "alg": "rsa-v1_5-sha256" }
},
```

`runtimeVersion` is already `{"policy": "appVersion"}` — an update only installs on a build
with the same `version` (`0.1.0`). Bump `version` when you ship native changes so old
binaries don't pull incompatible JS.

Then **re-run `npx expo prebuild --platform android`** and rebuild (§3) so the URL is baked
into the APK.

### 4c. Publish an update

```powershell
npx expo export --platform android            # produces the update bundle in dist/
# upload dist/ to your server per its docs (xprem/Xavia both document this),
# or use `eas update --branch preview` if you point EXPO_UPDATE_URL at your server.
```

### 4d. Verify the loop

1. Install the APK, open the app.
2. Publish a small visible JS change (§4c) to the `preview` branch.
3. **Shake the phone** (or Profile → "Check for updates"). It should check → download →
   restart into the new JS — **no URL entry**. `lib/updates.ts` drives this; it short-
   circuits when `Updates.isEnabled` is false (i.e. before §4b), which is why it was inert
   in Expo Go.

---

## 5. eas.json note

`eas.json`'s `preview`/`production` profiles + `channel` are only used if you ever run EAS
Build/Update. For the **pure-local** path they're unused (Gradle doesn't read them). The
`channel` concept still matters for OTA — it's expressed via `updates.requestHeaders`
(`expo-channel-name`) in §4b, which your self-hosted server maps to a branch.

## 6. Teleport patch caveat

`patches/react-native-teleport+1.1.8.patch` replaces the native Fabric `PortalView` /
`PortalHost` with pass-through `View`s because **Expo Go's binary lacks them**. In a
**standalone build the real Fabric components ARE compiled in**, so this patch needlessly
downgrades "break out of parent" overlay behavior (overlays render inline instead). It's
functional, not a crash. If you rely on portal overlays breaking out of clipping parents,
remove/guard this patch before a standalone build; otherwise it's harmless to leave.

## 7. When EAS free tier is actually fine

If the self-hosted server is more ops than you want right now, EAS Build + Update **free
tier** (30 builds/mo, 1,000 MAU) gets you the same shake-to-update with near-zero setup —
`eas build -p preview` + `eas update --branch preview`, projectId `47a19df2-…` and owner
`geekspace` are already set in `app.json`. You only pay if you outgrow the free tier.
