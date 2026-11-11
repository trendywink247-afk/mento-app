#!/usr/bin/env bash
# Scan a checkout with the self-hosted SonarQube (infra/sonarqube, docs/SONARQUBE.md).
#
#   ops/sonar-scan.sh [--dir <checkout>] [--no-tests] [--branch <name>]
#
# Reads SONAR_HOST_URL and SONAR_TOKEN from /srv/mento/mento-app/.secrets/sonar.env. No file
# means no server is set up yet: say so and exit 0, so callers (ops/ci.sh) never fail on it.
# The token travels only in the environment, never on a command line, in a log or in output.
#
# Coverage: API from pytest-cov (full suite, under the shared test-DB lock). If the test
# database cannot be set up (for example it is stamped by another branch's migration) the
# scan goes ahead without API coverage and says so; this script never resets the database.
# Mobile: the node unit tests load lib/ through vm-transpiled copies, which Node's coverage
# cannot attribute to the source files, so no mobile coverage is sent (see docs/SONARQUBE.md).
#
# Everything the scan writes goes to ~/.cache/mento-sonar, never into the checkout.
set -euo pipefail
set +x

SECRETS="${SONAR_ENV_FILE:-/srv/mento/mento-app/.secrets/sonar.env}"
SCANNER_IMAGE=sonarsource/sonar-scanner-cli:12.2.0.4256_8.1.0
PYSONAR_VERSION=1.9.0.5762
PYTEST_COV_VERSION=6.0.0
LOCK=/srv/mento/locks/testdb.lock

ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
RUN_TESTS=1
BRANCH=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dir) ROOT="$(cd "$2" && pwd)"; shift 2 ;;
    --no-tests) RUN_TESTS=0; shift ;;
    --branch) BRANCH="$2"; shift 2 ;;
    -h|--help) sed -n 2,16p "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [ ! -r "$SECRETS" ]; then
  echo "sonar-scan: no $SECRETS yet; SonarQube is not set up (infra/sonarqube/README.md). Skipping."
  exit 0
fi
set -a
# shellcheck disable=SC1090
. "$SECRETS"
set +a
if [ -z "${SONAR_HOST_URL:-}" ] || [ -z "${SONAR_TOKEN:-}" ]; then
  echo "sonar-scan: $SECRETS must set SONAR_HOST_URL and SONAR_TOKEN. Skipping." >&2
  exit 0
fi
export SONAR_HOST_URL SONAR_TOKEN

if ! curl -fsS --max-time 5 "$SONAR_HOST_URL/api/system/status" 2>/dev/null | grep -q '"status":"UP"'; then
  echo "sonar-scan: $SONAR_HOST_URL is not UP; skipping (start it: infra/sonarqube/README.md)." >&2
  exit 0
fi

WORK="${XDG_CACHE_HOME:-$HOME/.cache}/mento-sonar"
mkdir -p "$WORK"
chmod 700 "$WORK"
SHA="$(git -C "$ROOT" rev-parse HEAD)"
[ -n "$BRANCH" ] || BRANCH="$(git -C "$ROOT" rev-parse --abbrev-ref HEAD)"
PROPS=(
  "-Dsonar.projectBaseDir=$ROOT"
  "-Dsonar.working.directory=$WORK/scannerwork"
  "-Dsonar.projectVersion=${SHA:0:12}"
  "-Dsonar.scm.revision=$SHA"
)

# ---- API coverage --------------------------------------------------------------------
API="$ROOT/services/api"
COV_XML="$WORK/api-coverage.xml"
rm -f "$COV_XML"
if [ "$RUN_TESTS" = 1 ] && [ -x "$API/.venv/bin/python" ]; then
  if [ ! -d "$WORK/pytools/pytest_cov" ]; then
    "$API/.venv/bin/python" -m pip install -q --disable-pip-version-check \
      --target "$WORK/pytools" "pytest-cov==$PYTEST_COV_VERSION"
  fi
  echo "sonar-scan: API tests with coverage (waits for the test-DB lock)..."
  set +e
  ( cd "$API" && PYTHONPATH="$WORK/pytools" flock "$LOCK" .venv/bin/python -m pytest -q \
      -p no:cacheprovider --cov=app --cov-report="xml:$COV_XML" >"$WORK/api-tests.log" 2>&1 )
  rc=$?
  set -e
  # 0 = passed, 1 = some tests failed (coverage still valid). Anything else = setup or usage error.
  if { [ "$rc" = 0 ] || [ "$rc" = 1 ]; } && [ -s "$COV_XML" ]; then
    PROPS+=("-Dsonar.python.coverage.reportPaths=$COV_XML")
    [ "$rc" = 1 ] && echo "sonar-scan: some API tests failed (see $WORK/api-tests.log); coverage still sent."
  else
    echo "sonar-scan: API tests could not run (exit $rc, see $WORK/api-tests.log); scanning without API coverage." >&2
  fi
elif [ "$RUN_TESTS" = 1 ]; then
  echo "sonar-scan: no $API/.venv; scanning without API coverage." >&2
fi

# ---- Scan ----------------------------------------------------------------------------
echo "sonar-scan: scanning $BRANCH @ ${SHA:0:12} -> $SONAR_HOST_URL"
if docker info >/dev/null 2>&1; then
  docker run --rm --network host -u "$(id -u):$(id -g)" \
    -e SONAR_HOST_URL -e SONAR_TOKEN \
    -v "$ROOT:$ROOT:ro" -v "$WORK:$WORK" -w "$ROOT" \
    "$SCANNER_IMAGE" "${PROPS[@]}"
else
  # No docker access for this user: the official Python launcher downloads the same scanner
  # engine and a JRE from the server itself.
  if [ ! -x "$WORK/pysonar/bin/pysonar" ]; then
    python3 -m venv "$WORK/pysonar"
    "$WORK/pysonar/bin/pip" install -q --disable-pip-version-check "pysonar==$PYSONAR_VERSION"
  fi
  ( cd "$ROOT" && SONAR_USER_HOME="$WORK/sonar-home" "$WORK/pysonar/bin/pysonar" "${PROPS[@]}" )
fi
echo "sonar-scan: done. Results: $SONAR_HOST_URL/dashboard?id=mento"
