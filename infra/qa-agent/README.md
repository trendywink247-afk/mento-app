# QA agent helpers (root-owned, run by the build agent through sudo)

`apk-publish.sh` publishes the newest QA APK to https://qa-api.mento.chat/downloads/ after
`ops/qa-apk.sh` has built and staged it. One-time install, as root:

```bash
install -m 0750 -o root -g root infra/qa-agent/apk-publish.sh /usr/local/sbin/qa-agent/apk-publish.sh
echo 'agent ALL=(root) NOPASSWD: /usr/local/sbin/qa-agent/apk-publish.sh' > /etc/sudoers.d/qa-agent-apk
visudo -cf /etc/sudoers.d/qa-agent-apk
```

Without it, publishing is one command for root: `sudo qa-install-web <tarball>` (printed by `ops/qa-apk.sh`).
Roll back with `sudo qa-install-web --rollback`.

## Automatic APK builds

`ops/qa-apk-poll.sh` runs every 15 minutes (`infra/systemd/mento-qa-apk-poll.timer`). It hashes the native layer
of `origin/dev` (`@expo/fingerprint`, version code neutralised) and, only when that differs from the hash of the
APK on /downloads/, builds the next build number and publishes it through `apk-publish.sh`. JS-only changes never
trigger a build; they reach phones over the air. Check it with `ops/qa-apk-poll.sh --status`; force a rebuild with
`ops/qa-apk-poll.sh --force`. A failed build leaves the current APK live and is not retried until the native layer
changes or `--force` is used.

One-time install, as root (after the helper above is installed):

```bash
install -m 644 /srv/mento/mento-app/infra/systemd/mento-qa-apk-poll.{service,timer} /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now mento-qa-apk-poll.timer
```

Then, once, as `agent` after a manual publish: `ops/qa-apk-poll.sh --seed` (records the published APK's fingerprint).
