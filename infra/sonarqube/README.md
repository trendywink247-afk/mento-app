# SonarQube (self-hosted, root install)

Runs `compose.yml` here: SonarQube Community Build plus its own Postgres, on `127.0.0.1:9000` only.
Why and how to scan: [docs/SONARQUBE.md](../../docs/SONARQUBE.md).

## One-time, as root

```bash
# 1. SonarQube's search engine needs vm.max_map_count >= 524288. The box has 1048576 now; make it permanent.
echo 'vm.max_map_count=1048576' > /etc/sysctl.d/90-sonarqube.conf && sysctl --system >/dev/null

# 2. Database password, root-only. Never commit or print it.
install -d -m 700 /etc/mento
( umask 077; printf 'SONAR_DB_PASSWORD=%s\n' "$(openssl rand -hex 24)" > /etc/mento/sonarqube.env )

# 3. Start it.
docker compose -f /srv/mento/mento-app/infra/sonarqube/compose.yml \
  --env-file /etc/mento/sonarqube.env up -d
curl -s http://127.0.0.1:9000/api/system/status   # wait for "status":"UP" (1-3 min)
```

## One-time, founder in the browser

From your laptop: `ssh -L 9000:127.0.0.1:9000 <you>@129.121.171.140`, then open http://localhost:9000.

1. Log in as `admin` / `admin` and change the password at once (keep it in the password manager).
2. Create the project: key `mento`, main branch `dev`.
3. My Account, Security: generate a **project analysis token** for `mento`.
4. Store it for the scan script without putting it in shell history:

```bash
install -m 600 -o agent -g agent /dev/null /srv/mento/mento-app/.secrets/sonar.env
${EDITOR:-nano} /srv/mento/mento-app/.secrets/sonar.env
#   SONAR_HOST_URL=http://127.0.0.1:9000
#   SONAR_TOKEN=<the token>
```

## Operate (as root, from `/srv/mento/mento-app`)

Let `SQ="docker compose -f infra/sonarqube/compose.yml --env-file /etc/mento/sonarqube.env"`.

| Task | Command |
|---|---|
| Status | `$SQ ps` |
| Stop (frees about 2.5 GB) | `$SQ down` (analyses kept) |
| Upgrade | bump the pinned tag in `compose.yml`, `$SQ pull && $SQ up -d`, open `/setup` if it asks |
| Remove completely | `$SQ down -v` (deletes every analysis) |
