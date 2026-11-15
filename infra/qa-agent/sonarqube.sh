#!/usr/bin/env bash
# Root-owned helper: lets the build agent start, stop and inspect the SonarQube stack, and nothing else.
# It only ever runs the root-owned compose file installed next to it, so the agent cannot change what
# Docker runs (no mounts, no images of its choosing). It never deletes volumes.
# Install (root): see infra/qa-agent/README.md, section "SonarQube".
set -euo pipefail
COMPOSE=/usr/local/lib/mento/sonarqube/compose.yml
ENVF=/etc/mento/sonarqube.env

[ -f "$COMPOSE" ] || { echo "missing $COMPOSE (root install step)" >&2; exit 1; }
if [ ! -f "$ENVF" ]; then
  install -d -m 700 /etc/mento
  ( umask 077; printf 'SONAR_DB_PASSWORD=%s\n' "$(openssl rand -hex 24)" > "$ENVF" )
fi
dc() { docker compose -p mento-sonarqube -f "$COMPOSE" --env-file "$ENVF" "$@"; }

case "${1:-}" in
  up)     dc up -d ;;
  down)   dc down ;;                       # keeps analyses (no -v)
  status) dc ps; curl -fsS http://127.0.0.1:9000/api/system/status || true; echo ;;
  logs)   n="${2:-100}"; [[ "$n" =~ ^[0-9]{1,3}$ ]] || n=100
          dc logs --tail "$n" --no-color sonarqube ;;
  pull)   dc pull ;;
  *) echo "usage: $0 up|down|status|logs [lines]|pull" >&2; exit 2 ;;
esac
