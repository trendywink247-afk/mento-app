# Security audit: automated scans and the IDOR matrix

Run 2026-11-11 on `dev` at 88a4c9a. No secret value appears below; findings are named by file and rule only.
Scanners run in CI by `.github/workflows/security.yml` (weekly and on every PR, non-blocking for now) and locally with the same pinned versions.

| Scan | Tool | Result |
|---|---|---|
| Python code | bandit 1.9.4 | 18 findings, 0 real. 3 touched code (hash, 2 SQL strings, bind address) and now carry a reviewed `nosec`; 15 are low-noise (see below). Clean after triage. |
| Python code and app TypeScript | semgrep 1.185 (p/python, p/owasp-top-ten, p/typescript) | 6 findings, 0 real. All explained below. |
| Python dependencies | pip-audit 2.10.1 | API: **13 advisories, all in `cryptography 46.0.3`** (real, needs a bump). Recovery receiver: none. |
| Mobile dependencies | osv-scanner 2.7.1 and `npm audit` | 8 packages with advisories (21 total, 8 high). 0 critical. None is server-side. Details below. |
| Secrets in all 1051 commits | gitleaks 8.30.1 | 5 hits, 0 real secrets. All allowlisted in `.gitleaks.toml` with reasons. |
| Config (Dockerfile, compose, workflows) | trivy 0.76.2 | 1 high (no `USER` in a test-only Dockerfile), 1 low. Not production images. |
| Cross-user access (IDOR) | `services/api/tests/test_idor_matrix.py` | 55 id routes enumerated from the live OpenAPI. 50 attacked (198 attacks), 5 exempt with reasons. **0 IDORs found.** |

ZAP was not run: it needs a live target and the QA host was off limits for this pass.

## Real and needs a decision

| # | Finding | Why it matters | Proposed fix |
|---|---|---|---|
| 1 | `cryptography==46.0.3` has 13 advisories (PYSEC-2026-35, -36, -2141, -3552, -3553, -3554, GHSA-537c-gmf6-5ccf). Fixed from 46.0.7 up to 50.0.0. | It encrypts every own-chat message (AES-256-GCM). | Bump to the current 50.x in its own PR, run the message-crypto and chat suites and a decrypt-old-rows check on QA before release. Not done here: it touches the chat key path. |
| 2 | Mobile: `expo-router` (direct) plus transitive `@react-navigation/core`, `query-string`, `decode-uri-component`, `zod`, `follow-redirects`, `node-forge` (via `@expo/cli`), `uuid`, `glob`, `minimatch`, `deepmerge`. | Mostly ReDoS and build-tool issues. `node-forge`, `follow-redirects` and `glob` live in the Expo CLI, so build machines only. The router and navigation ones run in the app (deep-link and query parsing). | Dependabot ignores all Expo and React Native packages by design, so these need the Expo SDK step (`npx expo install --fix`) with native acceptance. Tracked for the React Native packages phase. |
| 3 | `test-ci` and `api-ci` have no dependency or secret scan. | Nothing stopped a bad dependency or a committed key. | Added `security.yml`. |

## Triage of findings that are not real

| Tool | Where | Rule | Verdict and why |
|---|---|---|---|
| bandit | `services/api/app/services/care_prompts.py` | B324 (sha1) | Picks one of a few prompt strings from a conversation id; not a security use. Now `usedforsecurity=False`. Output unchanged. |
| bandit, semgrep | `app/jobs/retention.py` (3 places) | B608, avoid-sqlalchemy-text | `DROP TABLE` and `CREATE TABLE ... PARTITION OF` take a partition name taken from the catalog or built from a date; DDL cannot bind identifiers. `nosec` plus a reason. No logic change. |
| bandit | `services/recovery_receiver/__main__.py` | B104 | Binding `0.0.0.0` needs the explicit `--host` flag; the default is loopback. |
| bandit | `app/main.py`, `services/fcm.py`, `services/sessions.py` | B105 | Names like a token URL, an OAuth scope and a lock; not passwords. Skipped in `.bandit`. |
| bandit | 8 places | B110 try/except/pass | Best-effort cleanups. Skipped in `.bandit`; revisit if one starts hiding errors. |
| bandit | `chat_hub.py`, `mentor_face.py` | B101 assert | Start-up and invariant checks, not input validation. Skipped. |
| semgrep | `app/security.py` | unverified-jwt-decode | `_peek_role` reads the role claim only to choose which secret to verify with; the token is then fully verified. |
| gitleaks | `apps/mobile/google-services.json` (2 commits) | gcp-api-key | Firebase client config, not a secret (Google's guidance). **Keep the key restricted to the app package and signing SHA-1 in Google Cloud.** |
| gitleaks | `deploy/staging/release.json` | generic-api-key | Commit ids and sha256 digests. |
| gitleaks | `deploy/test-caddy.sh` | generic-api-key | The RFC 6455 sample WebSocket key. |
| gitleaks | `apps/mobile/e2e/session-refresh.e2e.js` | generic-api-key | A throwaway test token. |
| trivy | `deploy/production-installer-test.Dockerfile` | DS-0002 (no USER), DS-0026 | A test image the drills build and discard. |

## The IDOR matrix

`tests/test_idor_matrix.py` takes every route with an id in its path from the app's OpenAPI document and attacks it.

- **Victims:** member A, mentor M1, and a conversation, a personal request, a mentor link, a journal entry and a verification document between them.
- **Attackers:** member B and mentor M2 (unrelated), the wrong role (a mentor on a member route, a member on a mentor route, a member or mentor on an admin route), a token for a non-admin id on admin routes, and no token at all.
- **Pass means:** 401/403/404 on owner routes, strictly 401/403 on admin routes (the role gate runs before any lookup), and every victim row unchanged afterwards.
- **A new route fails the suite** until it is added to `PLAN` (and attacked) or `EXEMPT` (with a reason). A 422 counts as a failure: it means the attack never reached the check.
- A second test proves the rightful owner still gets through, so a matrix that passes only because everything is 404 would be caught.

Exempt, with reasons: `GET /listeners/{id}` (public mentor profile), `POST` and `DELETE /listeners/{id}/favourite` (the caller's own list), `POST /listeners/{id}/request` (creates the caller's own request), `POST /listener/dev/token/{id}` (404 unless ENV is dev, tested in `test_listener_console.py`).

Not covered: routes that take the id in a body or query string, and the WebSocket path. Add them when a body-id route appears.

## Running it

```bash
# CI does this; locally (tools in any venv, versions pinned in security.yml)
bandit --ini .bandit -r services/api/app services/recovery_receiver -x "*/tests/*"
pip-audit -r services/api/requirements.txt
gitleaks detect --source . --config .gitleaks.toml --redact
cd services/api && flock /srv/mento/locks/testdb.lock .venv/bin/python -m pytest tests/test_idor_matrix.py
```

Making a scan blocking: remove its `continue-on-error: true` in `security.yml` once its findings are fixed or allowlisted. Do gitleaks and bandit first (both are clean now); pip-audit after the `cryptography` bump.
