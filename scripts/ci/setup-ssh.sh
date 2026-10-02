#!/usr/bin/env bash
set -euo pipefail
test -n "${DEPLOY_KEY:-}" && test -n "${KNOWN_HOSTS:-}" || {
  echo 'Missing environment-specific deploy key or pinned host key'; exit 1;
}
install -d -m 700 "$HOME/.ssh"
umask 077
printf '%s\n' "$DEPLOY_KEY" > "$HOME/.ssh/mento-release"
printf '%s\n' "$KNOWN_HOSTS" > "$HOME/.ssh/known_hosts"
