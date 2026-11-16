# Google Play release runbook

Package `chat.mento.app`. Play needs a signed `.aab`. The build never signs with the debug key.

Preview and development builds are a different app, "Mento QA" (`chat.mento.app.qa`), so a QA build and the Play build install side by side on one phone. Only the production variant is the store app. The QA package gets push once it is added as an Android app in the Firebase project and `google-services.json` is refreshed: `app.config.ts` attaches the Firebase file only when it lists the package.

## One-time: upload key (made 2026-11-15, on the build box)

The founder asked for the upload key to be made and used on the build box, so the store build is
signed by `ops/build-android.sh prod --aab` with no step on a PC. It lives in
`.secrets/play-upload.jks` with its passwords in `.secrets/play-upload.env` (git-ignored, 600):
PKCS12, alias `mento-upload`, RSA 4096, certificate SHA-256
`71:2D:79:6E:94:E0:4F:99:0E:A8:E5:70:98:88:16:4F:BC:87:5D:F9:77:24:E8:7D:B0:50:FE:4C:60:95:0C:33`.

Keep a copy of both files in the password manager and one offline backup; never commit them.
**Play App Signing** must be on: Google holds the real app-signing key, and a lost upload key can
be reset through the Play Console (App integrity, upload key reset, with a new certificate).
If an older upload key is already registered for `chat.mento.app`, use that same reset with this
key's certificate (`keytool -exportcert -rfc -alias mento-upload -keystore .secrets/play-upload.jks`).
This happened on 2026-11-16: Play had an older upload key (SHA-1 `8A:68:97…`, origin unknown, not on
this box). The reset to this key (SHA-1 `D0:14:1F…`) was requested and is valid from 2026-11-18 17:00.
In the current console: Test and release, App integrity, App signing, **Upload key** tab.

## Each release

1. Raise `expo.android.versionCode` in `apps/mobile/app.json` (integer, never reused; store line
   starts at 10). Leave `version` alone while OTA runtime matching depends on it.
2. Build and sign the bundle from a commit on `main` (production variant, all four ABIs,
   https-only, `production` update channel, signed with the upload key above):

   ```bash
   ops/build-android.sh prod --aab --sha <main sha>
   ```

   It lands in `~/build-out/prod/mento-prod-<version>-<code>-<sha>.aab` with a `.sha256` beside it.

3. Check before uploading: `jarsigner -verify -certs <aab>` says "jar verified" with the
   certificate above; the merged manifest (`android/app/build/intermediates/merged_manifest/release/`
   in `~/build/prod/apps/mobile`) shows `chat.mento.app`, the version code, and none of the blocked
   permissions (`SYSTEM_ALERT_WINDOW`, storage, `ACTIVITY_RECOGNITION`).

4. Record the build's native fingerprint for production OTA (`/opt/mento-prod/state/store_fp`,
   docs/OTA.md), so `ops/ota-publish.sh prod` only ships updates this build can run.

Play Console links: privacy policy `https://app.mento.chat/privacy`, delete account
`https://app.mento.chat/delete-account` (static pages in `apps/mobile/public/`, tested by
`e2e/public-pages.test.cjs`), contact geekspacetech02@gmail.com.

5. Upload to **Internal testing**, then **Closed testing**, then apply for production. Never
   upload straight to production.

`EXPO_PUBLIC_*` values ship inside the client, so they can never hold secrets.
