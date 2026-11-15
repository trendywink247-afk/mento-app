# OTA updates (self-hosted, no EAS)

JS-only changes reach installed apps over the air from our own server. Native changes always need a new APK (or store build).

## How it works

| Piece | What it does |
|---|---|
| `expo-updates` in the app | On launch (and Profile > Check for updates) asks `updates.url` for a manifest, sending `expo-platform`, `expo-runtime-version` (= app version, `appVersion` policy) and `expo-channel-name` (`preview` for QA, `production`). |
| `services/ota` | Small FastAPI service, Expo Updates protocol v1. Picks the newest live update for platform + runtime + channel and answers with a signed multipart manifest, or a signed directive (`noUpdateAvailable`, `rollBackToEmbedded`). Serves bundles and assets under `/assets/`. |
| Code signing | RSA-2048, `rsa-v1_5-sha256`, keyid `main`. The app embeds the certificate (`apps/mobile/certs/ota-<qa|prod>.pem`) and rejects any manifest not signed by its key. The private key never enters the repo. |
| Caddy | `qa-api.mento.chat/ota/*` → `127.0.0.1:18020` with the prefix stripped. App URL: `https://qa-api.mento.chat/ota/api/manifest`. |
| Data | `/srv/mento/ota-data/<channel>/<runtime>/<UTC-timestamp>-<sha7>/`: the `expo export` output plus `expoConfig.json` and `published.json`. Newest dir without `ROLLED_BACK` wins. |

## Publish (QA)

```bash
ops/ota-publish.sh qa -m "fix chat list fade"            # from origin/dev
ops/ota-publish.sh qa --commit feat/x -m "try branch"   # any ref
```

It builds in `~/aabbuild` under the APK build lock, then **refuses** if the commit's native fingerprint differs from the APK on `/downloads/` (`~/qa-apk-out/state/published_fp`). In that case ship a new APK first (merge to `dev`; the poller builds it, or `ops/qa-apk-poll.sh --force`). Public build values come from `~/.config/mento/qa-build.env` and, for Sentry, `.secrets/qa.env` (optional). Phones apply it on the next launch after download (relaunch once more if needed).

## Roll back

```bash
ops/ota-publish.sh --list preview 0.1.0
ops/ota-publish.sh --rollback preview 0.1.0     # newest live update gets ROLLED_BACK
```

Phones then get the previous live update; if none is left, they are told to go back to the bundle inside their APK. Undo with `rm <dir>/ROLLED_BACK`. Rollbacks need no restart of the service.

## One-time install on the QA box (root)

The QA signing key is already at `/srv/mento/ota-keys/qa-private-key.pem` (owner `agent`, 0600; made by `ops/ota-keygen.sh`) and `/srv/mento/ota-data` exists (owner `agent`, 755).

```bash
cd /srv/mento/mento-app            # on the merged branch
install -d -m 755 /opt/mento-ota
rm -rf /opt/mento-ota/src && cp -r services/ota /opt/mento-ota/src && chown -R root:root /opt/mento-ota/src
python3.12 -m venv /opt/mento-ota/venv
/opt/mento-ota/venv/bin/pip install -q -r /opt/mento-ota/src/requirements.txt
install -m 644 infra/systemd/mento-ota.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now mento-ota.service
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:18020/health         # 200
diff infra/caddy/Caddyfile /etc/caddy/Caddyfile   # expect only the OPERATOR_IP placeholder and the new /ota/* block
# add the /ota/* handle_path block to the qa-api site in /etc/caddy/Caddyfile, then:
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile && systemctl reload caddy
curl -s -o /dev/null -w '%{http_code}\n' https://qa-api.mento.chat/ota/health      # 200
```

Update the code later: repeat the `cp`/`pip` lines and `systemctl restart mento-ota`. The service runs as a systemd dynamic user, reads the data dir read-only, gets the key through `LoadCredential`, and cannot see the repo or the key dir.

## Production plan

1. The founder runs `ops/ota-keygen.sh prod apps/mobile/certs/ota-prod.pem <safe path>/prod-private-key.pem` on a trusted machine, commits only the certificate, and keeps the key in the password manager and on the prod host (`/srv/mento/ota-keys/prod-private-key.pem`, root 0600). The production app build embeds `ota-prod.pem`.
2. Same service and unit on the prod host, with `OTA_PUBLIC_URL=https://api.mento.chat/ota` and the prod key in `LoadCredential`; Caddy `handle_path /ota/*` on the `api.mento.chat` site.
3. Publishing: `OTA_EXPECT_FP=<fingerprint of the store build> ops/ota-publish.sh prod -m "..."` builds a tarball in `~/ota-out` and prints the root steps to unpack it on the prod host. No agent deploys it.

Never rotate a signing key casually: every installed build trusts only the certificate it shipped with, so a new key means a new store build.
