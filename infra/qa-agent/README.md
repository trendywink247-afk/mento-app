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
