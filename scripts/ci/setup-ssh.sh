#!/usr/bin/env bash
set -euo pipefail
test -n "${DEPLOY_KEY:-}" && test -n "${KNOWN_HOSTS:-}" || {
  echo 'Missing environment-specific deploy key or pinned host key'; exit 1;
}
install -d -m 700 "$HOME/.ssh"
umask 077
printf '%s\n' "$DEPLOY_KEY" | tr -d '\r' > "$HOME/.ssh/mento-release"
printf '%s\n' "$KNOWN_HOSTS" | tr -d '\r' > "$HOME/.ssh/known_hosts"
# Reject malformed or encrypted unattended keys before any deployment attempt.
# Never print the derived public key or the private material.
ssh-keygen -y -P '' -f "$HOME/.ssh/mento-release" >/dev/null
