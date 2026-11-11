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

## SonarQube

`sonarqube.sh up|down|status|logs [n]|pull` runs only the root-owned copy of `infra/sonarqube/compose.yml`, so the
agent can operate SonarQube without Docker access (the `docker` group would be root-equivalent). It creates
`/etc/mento/sonarqube.env` (database password, root-only) on first run and never deletes volumes.
One-time install, as root, from the repo checkout (re-run the first line after any change to the compose file):

```bash
install -D -m 644 -o root -g root infra/sonarqube/compose.yml /usr/local/lib/mento/sonarqube/compose.yml
install -m 0750 -o root -g root infra/qa-agent/sonarqube.sh /usr/local/sbin/qa-agent/sonarqube.sh
echo 'vm.max_map_count=1048576' > /etc/sysctl.d/90-sonarqube.conf && sysctl --system >/dev/null
echo 'agent ALL=(root) NOPASSWD: /usr/local/sbin/qa-agent/sonarqube.sh' > /etc/sudoers.d/qa-agent-sonarqube
visudo -cf /etc/sudoers.d/qa-agent-sonarqube
```
