# Google Play release runbook

Package `chat.mento.app`. Play needs a signed `.aab`. The build never signs with the debug key.

## One-time: upload key (on your own machine, not the server)

```bash
keytool -genkeypair -v -storetype PKCS12 -keystore mento-upload.jks \
  -alias mento-upload -keyalg RSA -keysize 2048 -validity 10000
```

Use a long password. Keep the `.jks` and the passwords in a password manager plus one offline
backup. Never commit them. Turn on **Play App Signing** when creating the app: Google holds the
real signing key, and a lost upload key can be reset through Play support.

## Each release

1. Raise `expo.android.versionCode` in `apps/mobile/app.json` (integer, never reused; store line
   starts at 10). Leave `version` alone while OTA runtime matching depends on it.
2. Build the bundle with the production variant, all ABIs (the QA APKs are arm64-only and Play
   will not take them). The production variant is https-only and uses the `production` update
   channel. The release block is unsigned unless `MENTO_UPLOAD_KEYSTORE` is set
   (`plugins/withReleaseSigning.js`):

   ```bash
   APP_VARIANT=production EXPO_PUBLIC_APP_ENV=<qa|production> EXPO_PUBLIC_API_URL=<api>/api/v1 \
   EXPO_PUBLIC_PUSH_DIRECT=1 EXPO_PUBLIC_STREAM_API_KEY=<public key> EXPO_PUBLIC_GIT_SHA=<sha> \
   SENTRY_DISABLE_AUTO_UPLOAD=true npx expo prebuild --platform android --clean
   cd android && ./gradlew bundleRelease
   ```

3. Sign the unsigned bundle on your PC with the upload key:

   ```bash
   jarsigner -keystore mento-upload.jks -sigalg SHA256withRSA -digestalg SHA-256 \
     app-release.aab mento-upload
   ```

4. Check before uploading: `bundletool dump manifest` shows `chat.mento.app`, the version code and
   no `SYSTEM_ALERT_WINDOW` or storage permissions; `jarsigner -verify -verbose` shows your key.
5. Upload to **Internal testing**, then **Closed testing**, then apply for production. Never
   upload straight to production.

`EXPO_PUBLIC_*` values ship inside the client, so they can never hold secrets.
