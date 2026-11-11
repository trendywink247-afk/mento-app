# SonarQube

Static analysis for the whole repo: bugs, vulnerabilities, security hotspots, code smells, duplication and API test coverage, tracked over time per branch. It sits beside the security scanners (bandit, semgrep, pip-audit, gitleaks), not instead of them.

## Where it runs

| | |
|---|---|
| What | SonarQube Community Build `26.9.0.129388-community` + its own Postgres 16 (`infra/sonarqube/compose.yml`) |
| Host | The QA box, `127.0.0.1:9000` only. No public site. Reach it with `ssh -L 9000:127.0.0.1:9000 …` or over Tailscale |
| Isolation | Own compose project (`mento-sonarqube`), network and volumes. Never touches the QA or production databases |
| Cost | Capped at 2 GB (SonarQube) + 512 MB (Postgres), 3 CPUs total. Idle use is about 1.5 GB. Stop it any time without losing data |
| Install | Root, once: [infra/sonarqube/README.md](../infra/sonarqube/README.md). The founder sets the admin password and makes the token |
| Token | `/srv/mento/mento-app/.secrets/sonar.env` (`SONAR_HOST_URL`, `SONAR_TOKEN`). Rules: [SECRETS.md](SECRETS.md) |

The box has 15 GB RAM and 8 cores (measured 2026-11-11, about 11 GB available). Once production shares the box, give production priority: stop SonarQube during load tests or a launch, or move it with the other tools when production gets its own instance.

## Scanning

```bash
ops/sonar-scan.sh                 # current checkout: API tests with coverage, then the scan
ops/sonar-scan.sh --no-tests      # issues only, fast
ops/sonar-scan.sh --dir ~/aabbuild --branch dev
```

- Exits 0 with a note when the token file is missing or the server is down, so it is safe to call from `ops/ci.sh`.
- The API tests run under `/srv/mento/locks/testdb.lock`. If the test database cannot be set up, the scan still runs, without API coverage, and the script never resets the database.
- Uses the `sonar-scanner-cli` docker image when the user can reach Docker, otherwise the official Python launcher (`pysonar`). Both are pinned in the script.
- Writes only to `~/.cache/mento-sonar`, never into the checkout.

What is scanned is set in [`sonar-project.properties`](../sonar-project.properties): `apps/mobile/{app,components,lib,theme}`, `services/api/app`, `services/recovery_receiver`. Excluded: migrations, assets, mockups, archive, generated native projects, build output.

**Mobile coverage is not reported yet.** The node unit tests load `lib/` through vm-transpiled copies, so Node's coverage maps hits to the test files, not the sources. Making it real means loading the sources through a coverage-aware TypeScript loader; until then `apps/mobile/**` is excluded from the coverage figure only (issues are still reported).

### GitHub Actions

`.github/workflows/sonar.yml` runs only when the repository has a `SONAR_TOKEN` secret and a `SONAR_HOST_URL` variable pointing at a server GitHub can reach (a tunnelled one, or SonarQube Cloud). Otherwise it notes a skip and passes. Today the box-local script is the path that works.

## Quality gate (proposal)

Start non-blocking. Watch for two weeks, then turn on blocking for new code only.

| Stage | Rule |
|---|---|
| Now | Report only. No check fails on Sonar |
| After baseline | Sonar way on new code: no new bugs or vulnerabilities rated worse than A, every new security hotspot reviewed, duplication on new code under 3% |
| Later | API new-code coverage at least 70%; add mobile once coverage is real |

Findings that touch the crisis scan, age gate, deletion or anonymity go through the usual review rule in CLAUDE.md, whatever Sonar rates them.
