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
powershell -File scripts/build-android-release.ps1
# → android/app/build/outputs/apk/release/app-release.apk
```

The script sets `NODE_ENV=production` for you so the build reads `apps/mobile/.env.production`
(never the dev `.env` — see §8f for why this matters) and re-runs `expo prebuild` so any
`app.json` change is picked up. Create `.env.production` once (gitignored, shape in
`.env.example`) and never hand-edit `.env` for a prod build again.

**Install on a connected device:**

```powershell
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

At this point you have a **standalone APK with no Expo Go dependency**. Shake-to-update is
present but inert until you configure OTA (§4) — that's the intended "APK now, OTA when
ready" state.

---

## 4. OTA — DECIDED (session 31f): EAS Update free tier

Rebuild-and-install per JS fix proved too slow on the device day, so the founder switched
shake-to-update on via **EAS Update's free tier** (1,000 MAU, $0; this is EAS *Update* only —
local Gradle builds stay, no EAS cloud builds). Configured with `eas update:configure`:
`updates.url = https://u.expo.dev/47a19df2-…`, `enabled: true`, `fallbackToCacheTimeout: 0`,
and — because a local Gradle build never reads `eas.json`'s channel —
`updates.requestHeaders["expo-channel-name"] = "preview"` in `app.json`. `runtimeVersion`
stays `{"policy": "appVersion"}` (`0.1.0`): bump `version` whenever native code changes.

**One-time gotcha (session 31f):** `eas update:configure` creates the `preview` channel but does
**not** point it at a branch — `eas channel:view preview` showed "No branches are pointed to
this channel", which means every check-for-updates finds nothing. Link it once:
`npx eas-cli channel:edit preview --branch preview`.

**Ship a JS-only change (from `apps/mobile`, reads `.env.production`):**

```powershell
npx eas-cli update --branch preview --message "what changed"
```

Then shake the phone (or Profile → Check for updates) → download → restart into the new JS.
Native changes (new modules, `app.json` plugins, permissions, the notification colour) still
need §3 + `adb install`. The self-hosted path below is kept for reference only.

## 4-alt. Self-hosted OTA (reference — not the chosen route)

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

---

## 8. Troubleshooting — gotchas hit in practice (session 27, Windows + local build)

Every one of these cost real time getting a `release` APK onto a physical device. Read
this before repeating the investigation.

### 8a. Gradle fails with `Could not move temporary workspace ... to immutable location`

**Symptom:** `java.io.UncheckedIOException` / underlying `AccessDeniedException`, 100%
reproducible on the very first build inside a folder Windows Defender protects (Desktop is
a default-protected folder).

**Real cause:** Windows' **Controlled Folder Access** (ransomware protection), a *separate*
feature from real-time-scan exclusions. `Add-MpPreference -ExclusionPath` does **not**
disable it.

**The trap:** on Windows 11 with Tamper Protection on, PowerShell/registry attempts to fix
this (`Add-MpPreference -ControlledFolderAccessAllowedApplications`, `settings put global
...`) **silently no-op** — no error, but no effect either. Only changes made through the
**Windows Security GUI** actually apply.

**Fix:** Windows Security → Virus & threat protection → Manage settings → **Exclusions**
(add the project folder) **and** → Ransomware protection → Manage ransomware protection →
Controlled folder access → **Allow an app** (add the JDK's `java.exe`, e.g.
`C:\Program Files\Eclipse Adoptium\jdk-17.x\bin\java.exe`).

### 8b. Build fails ~15–40 minutes in with "not enough space on the disk"

Android Studio (~3.3GB) + SDK (~2.5GB) + Gradle's global cache (~4.4GB) is enough to push a
nearly-full drive to 0 bytes free mid-build. Check `Get-PSDrive C` for real headroom
(tens of GB) **before** starting a from-scratch build, not after a failure.

### 8c. `react-native-reanimated`'s native build fails: `ninja: error: mkdir(...) No such file or directory`

**Symptom:** `buildCMakeRelWithDebInfo[armeabi-v7a]` fails; the path in the error is the
project's own absolute path mirrored a *second* time inside the CMake object-file
directory — trivially exceeds Windows' 260-char `MAX_PATH` when the repo lives somewhere
like `C:\Users\<you>\Desktop\Mento\apps\mobile\...`.

**Dead ends (do not retry these):**
- `LongPathsEnabled=1` registry key alone — legacy tools like `ninja.exe` aren't
  manifested for long-path awareness and ignore it.
- **NTFS directory junctions** (`mklink /J C:\m C:\...\Mento`) — the JVM that Gradle/CMake
  run on transparently *canonicalizes* junctions back to the real path
  (`File.getCanonicalPath()`), so `ninja`'s own "Entering directory" log still shows the
  original long path even when you invoke `gradlew` from `C:\m\...`.
- **`subst` drive letters** (`subst M: C:\...\Mento`) — same outcome, same reason. Proven
  by direct inspection: CMake's *configure*-time warning showed the short `M:\...` path,
  but the actual ninja *build* invocation still resolved back to the long path.

**The only fix that actually works:** physically **copy the project to a short real path**
(e.g. `C:\mento-build`), not a virtual alias of any kind, and build from there.
`robocopy C:\Users\<you>\Desktop\Mento\apps\mobile C:\mento-build\mobile /E /XD ".cxx"`.

### 8d. After relocating with robocopy: `Cannot find module '...\build\index.js'`

**Cause:** an over-broad `/XD "build"` exclusion (meant to skip Android's
`android/build` output) also deletes legitimate npm packages' own `build/` output
directories anywhere in `node_modules` (e.g. `expo-modules-autolinking/build/index.js`) —
`/XD` matches by directory name at *any* depth, not just the top level.

**Fix:** only exclude `.cxx` at copy time (a CMake-specific name, safe everywhere). To
also skip stale Android build output, filter *after* copying:
```powershell
Get-ChildItem C:\mento-build\mobile -Recurse -Directory |
  Where-Object { $_.FullName -match '\\android\\(build|\.cxx)$' } |
  Remove-Item -Recurse -Force
```

### 8e. Rebuild at the new path still uses the OLD long path — stale generated config

If `android/build` (or any node_module's own `android/build`) gets copied over from a
prior failed attempt, its generated `autolinking.json` / CMake config can carry a
**hardcoded absolute path from the original project location**. Gradle may treat that
generated file as up-to-date and silently build against the wrong path even when invoked
from the new short one. **Always purge every `android/build` and `android/.cxx` under the
copy** (the filter in 8d) before the first build there.

### 8f. Release build: app falls back to `localhost` — `EXPO_PUBLIC_*` never got inlined

**Symptom:** the compiled bundle contains the literal string `EXPO_PUBLIC_API_URL` (the
variable *name*) instead of its real value — `process.env.EXPO_PUBLIC_API_URL` evaluates
to `undefined` at runtime (Hermes has no real `process.env`), so the code falls through to
whatever hardcoded default exists (`lib/api.ts`: `?? 'http://localhost:8000/api/v1'`) —
meaning the app tries to reach **its own device's localhost**, not any real server. This
reads exactly like a generic connectivity failure with no hint the URL is wrong.

**Cause:** `eas build` sets `NODE_ENV=production` automatically, which
`babel-preset-expo`'s inline-env-vars transform requires to substitute
`process.env.EXPO_PUBLIC_*` with literal values at bundle time. Invoking `gradlew
assembleRelease` directly does **not** set it.

**Diagnostic:** `Select-String` the compiled bundle
(`android/app/build/generated/assets/createBundleReleaseJsAndAssets/index.android.bundle`)
for the expected literal value (e.g. your IP). If you find the bare variable **name**
instead, the inline transform never fired.

**Fix:** `$env:NODE_ENV = "production"` before `gradlew assembleRelease`.

### 8g. Release build: OkHttp refuses `http://` even though `curl` succeeds

**Symptom:** the app's own network stack times out / errors on plain-HTTP requests;
`curl` (run via `adb shell`) reaches the exact same URL instantly. This is misleading —
`curl` runs as a different process/UID, entirely unbound by the *app's* manifest-level
Network Security Config.

**Cause:** the stock React Native template ships `android:usesCleartextTraffic="true"`
**only** in `android/app/src/debug/AndroidManifest.xml` (with `tools:replace`), so local
dev can talk to Metro over HTTP. `app.json`'s `android.usesCleartextTraffic: true` did
**not** propagate into the base manifest (`src/main/AndroidManifest.xml`) in this Expo SDK
52 setup, so `release` inherits Android's default (block all cleartext for API 28+
targets) with no override.

**Diagnostic:** check the actual *packaged* manifest, not `app.json`:
`android/app/build/intermediates/packaged_manifests/release/processReleaseManifestForPackage/AndroidManifest.xml`.

**Fix (interim):** add `android:usesCleartextTraffic="true"` directly to the
`<application>` tag in `android/app/src/main/AndroidManifest.xml` so every variant
inherits it. **Not yet root-caused:** why the config-plugin doesn't honor `app.json` here
for the base manifest — worth a proper fix, or just target HTTPS-only backends in
production to sidestep the whole class of bug.

### 8h. Diagnosing "the app times out but the network is fine" on a real device

- **Never trust `adb shell curl`** as proof the app itself can connect — different
  UID/process, unbound by the app's Network Security Config *and* unbound by per-app VPN
  routing.
- **Add temporary `console.error` logging** in the actual catch block if the app doesn't
  already log network failures — `adb logcat -d --pid=$(adb shell pidof <pkg>)` only shows
  what the app chooses to print. Silence is not proof of health.
- **To watch raw sockets:** poll `/proc/net/tcp` / `/proc/net/tcp6` for the destination
  (hex, byte-reversed IP + port) at high frequency, in **one** `adb shell` call with an
  internal loop (`for i in $(seq 1 N); do cat /proc/net/tcp*; sleep 0.3; done`) — spawning
  a fresh `adb.exe` process per sample has too much overhead (~0.5–1s) and will miss
  short-lived connections.
- TCP state `02` = `SYN_SENT` (sent, never acknowledged, retrying). Critically, the
  **local address field of the socket reveals which physical interface it's actually
  bound to** — comparing it against your VPN tunnel's own address vs. your plain WiFi
  address is definitive proof of a routing problem, not a guess.

### 8i. Split-tunnel VPNs (Tailscale, etc.) can silently exclude a newly-installed app

`adb shell dumpsys connectivity` shows the VPN's `NetworkAgentInfo` with a literal
`Uids: <{0-10260, 10262-10366, ...}>` allow-list — gaps in that range are excluded UIDs. A
freshly-installed app's UID can land in a gap until the VPN fully reconnects (toggling an
in-app "split tunneling" setting is often not enough to trigger a UID-range recompute).

Even after confirming the UID was included, and after forcing Android's system-level
**Always-on VPN + Block-connections-without-VPN** (lockdown) via
`adb shell settings put global always_on_vpn_app <pkg>` /
`always_on_vpn_lockdown 1`, one specific device+Tailscale combination in this session
**still** routed the app's socket over plain WiFi instead of the tunnel (proven via 8h's
socket-source check) — not fully root-caused, flag as unreliable on that device rather
than re-litigating it every session.

**Reliable fallback that sidesteps all of it:** a `cloudflared tunnel --url
http://localhost:8000` quick tunnel (zero signup, real public HTTPS — also fixes 8g for
free since it's HTTPS, not cleartext). Point `EXPO_PUBLIC_API_URL` at the printed
`https://*.trycloudflare.com` URL and rebuild. **Ephemeral** — the URL changes every time
the tunnel process restarts, and it only exists while that process is running. Fine to
unblock a testing session; not a permanent answer. See also **mento-crisis-webhook**,
which uses the same tool for a different purpose.
