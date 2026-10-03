#!/usr/bin/env bash
# Run as root on VPS B with a reviewed directory containing the four named files.
# Installs delivery tooling only; does not deploy or restart the application.
set -euo pipefail
test "$(id -u)" = 0
source_dir=$(realpath "${1:?reviewed source directory required}")
for file in ci-receiver.py verify-safety.py ci-fixture.py restore-drill.sh staging-ci.pub; do
  test -f "$source_dir/$file"
done
ssh-keygen -l -f "$source_dir/staging-ci.pub" >/dev/null
if ! id mento-ci-staging >/dev/null 2>&1; then
  useradd --create-home --shell /bin/sh mento-ci-staging
fi
install -d -m 755 /usr/local/lib/mento-release
install -m 644 "$source_dir/ci-receiver.py" "$source_dir/verify-safety.py" "$source_dir/ci-fixture.py" /usr/local/lib/mento-release/
install -m 755 "$source_dir/restore-drill.sh" /usr/local/lib/mento-release/
install -d -m 700 -o mento-ci-staging -g mento-ci-staging /home/mento-ci-staging/.ssh
{
  printf 'restrict,port-forwarding,permitopen="127.0.0.1:443" '
  cat "$source_dir/staging-ci.pub"
} > /home/mento-ci-staging/.ssh/authorized_keys
chown root:mento-ci-staging /home/mento-ci-staging/.ssh/authorized_keys
chmod 640 /home/mento-ci-staging/.ssh/authorized_keys
cat > /etc/sudoers.d/mento-ci-staging <<'SUDO'
Defaults:mento-ci-staging env_keep += "SSH_ORIGINAL_COMMAND"
mento-ci-staging ALL=(root) NOPASSWD: /usr/bin/python3 /usr/local/lib/mento-release/ci-receiver.py staging
SUDO
chmod 440 /etc/sudoers.d/mento-ci-staging
visudo -cf /etc/sudoers.d/mento-ci-staging
cat > /etc/ssh/sshd_config.d/mento-ci-staging.conf <<'SSH'
Match User mento-ci-staging
    AuthenticationMethods publickey
    PasswordAuthentication no
    AllowTcpForwarding local
    PermitOpen 127.0.0.1:443
    PermitListen none
    AllowAgentForwarding no
    X11Forwarding no
    PermitTTY no
    ForceCommand /usr/bin/sudo -n /usr/bin/python3 /usr/local/lib/mento-release/ci-receiver.py staging
Match all
SSH
sshd -t
systemctl reload ssh
echo 'Installed staging-only receiver; app release unchanged'
