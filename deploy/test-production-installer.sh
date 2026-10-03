#!/usr/bin/env bash
# Run ONLY in a disposable root Linux container with openssh-server and sudo.
set -euo pipefail
test -f /.dockerenv
test "$(id -u)" = 0
test ! -e /home/mento-ci-production
source_root=$(cd "$(dirname "$0")/.." && pwd)
temp=$(mktemp -d)
ssh-keygen -q -t ed25519 -N '' -f "$temp/key"
cp "$temp/key.pub" "$temp/production-ci.pub"
cp "$source_root/deploy/ci-receiver.py" "$temp/ci-receiver.py"
cp "$source_root/deploy/deploy.sh" "$temp/deploy.sh"
mkdir -p /run/sshd
ssh-keygen -A >/dev/null
# Containers have no systemd; configuration validation and SSH are real.
mkdir "$temp/bin"
printf '#!/bin/sh\n[ "$*" = "reload ssh" ]\n' > "$temp/bin/systemctl"
chmod +x "$temp/bin/systemctl"
PATH="$temp/bin:$PATH" bash "$source_root/deploy/install-ci-production.sh" "$temp"
test ! -e /etc/mento-release/production-enabled
cmp "$temp/deploy.sh" /usr/local/lib/mento-release/operator-deploy.sh
test "$(stat -c '%u:%a' /usr/local/lib/mento-release/operator-deploy.sh)" = '0:644'
if PATH="$temp/bin:$PATH" bash "$source_root/deploy/install-ci-production.sh" "$temp"; then
  echo 'Existing account was unexpectedly overwritten' >&2; exit 1
fi
/usr/sbin/sshd
ssh_args=(-F /dev/null -i "$temp/key" -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o "UserKnownHostsFile=$temp/known_hosts")
if ssh "${ssh_args[@]}" mento-ci-production@127.0.0.1 'echo unrestricted-shell' >"$temp/out" 2>&1; then
  echo 'Unrestricted command unexpectedly succeeded' >&2; exit 1
fi
grep -q 'Expected receive|deploy|accept|verify' "$temp/out"
if ssh "${ssh_args[@]}" mento-ci-production@127.0.0.1 "deploy $(printf 'a%.0s' {1..40})" >"$temp/out" 2>&1; then
  echo 'Locked production deploy unexpectedly succeeded' >&2; exit 1
fi
grep -q 'Production promotion remains locked on this server' "$temp/out"
if ssh "${ssh_args[@]}" -W 127.0.0.1:22 mento-ci-production@127.0.0.1 >"$temp/out" 2>&1; then
  echo 'Forwarding unexpectedly succeeded' >&2; exit 1
fi
grep -q 'administratively prohibited' "$temp/out"
if sudo -u mento-ci-production test -w /home/mento-ci-production/.ssh/authorized_keys; then
  echo 'CI identity can replace its key restrictions' >&2; exit 1
fi
if sudo -u mento-ci-production sudo -n /bin/true 2>/dev/null; then
  echo 'CI identity has arbitrary sudo' >&2; exit 1
fi
echo 'Installer and real SSH isolation checks passed; production gate remains absent'
