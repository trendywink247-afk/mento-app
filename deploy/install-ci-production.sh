#!/usr/bin/env bash
# Root-only installation of reviewed tooling. Does not enable or deploy a release.
set -euo pipefail
test "$(id -u)" = 0
test -x /usr/bin/python3
source_dir=$(realpath "${1:?reviewed source directory required}")
test -f "$source_dir/ci-receiver.py"
test -f "$source_dir/production-ci.pub"
test ! -e /etc/mento-release/production-enabled
test ! -L /etc/mento-release/production-enabled
# Only one plain Ed25519 public key is accepted; no key options or extra lines.
python3 - "$source_dir/production-ci.pub" <<'PY'
import pathlib, re, sys
key = pathlib.Path(sys.argv[1]).read_text().strip()
if not re.fullmatch(r'ssh-ed25519 [A-Za-z0-9+/]+={0,3}(?: [^\r\n]+)?', key):
    raise SystemExit('Expected one plain Ed25519 public key')
PY
ssh-keygen -l -f "$source_dir/production-ci.pub" >/dev/null
if id mento-ci-production >/dev/null 2>&1; then
  echo 'Account already exists; audit existing configuration before changing it' >&2
  exit 1
fi
test ! -e /etc/sudoers.d/mento-ci-production
test ! -e /etc/ssh/sshd_config.d/mento-ci-production.conf
test ! -e /home/mento-ci-production
sshd -t
useradd --create-home --shell /bin/sh mento-ci-production
# Root owns the entire key path, so the CI account cannot replace its restrictions.
chown root:root /home/mento-ci-production
chmod 755 /home/mento-ci-production
install -d -m 755 /usr/local/lib/mento-release /etc/mento-release
install -m 644 "$source_dir/ci-receiver.py" /usr/local/lib/mento-release/ci-receiver.py
install -d -m 755 /home/mento-ci-production/.ssh
{
  printf 'restrict,command="/usr/bin/sudo -n /usr/bin/python3 /usr/local/lib/mento-release/ci-receiver.py production" '
  cat "$source_dir/production-ci.pub"
} > /home/mento-ci-production/.ssh/authorized_keys
chmod 644 /home/mento-ci-production/.ssh/authorized_keys
cat > /etc/sudoers.d/mento-ci-production <<'SUDO'
Defaults:mento-ci-production env_keep += "SSH_ORIGINAL_COMMAND"
mento-ci-production ALL=(root) NOPASSWD: /usr/bin/python3 /usr/local/lib/mento-release/ci-receiver.py production
SUDO
chmod 440 /etc/sudoers.d/mento-ci-production
visudo -cf /etc/sudoers.d/mento-ci-production
cat > /etc/ssh/sshd_config.d/mento-ci-production.conf <<'SSH'
Match User mento-ci-production
    AuthenticationMethods publickey
    PasswordAuthentication no
    DisableForwarding yes
    PermitTTY no
    ForceCommand /usr/bin/sudo -n /usr/bin/python3 /usr/local/lib/mento-release/ci-receiver.py production
Match all
SSH
sshd -t
systemctl reload ssh
echo 'Production receiver installed, promotion locked; application unchanged'
