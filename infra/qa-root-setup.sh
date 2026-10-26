#!/usr/bin/env bash
# One-shot root install of the QA ops tooling on this box. Idempotent; safe to rerun.
#
#   sudo infra/qa-root-setup.sh --recovery-recipient age1... [--remote <rclone dest>] [--enable] [--dry-run]
#
# Installs from the checkout this script lives in (use the dev checkout):
#   ops/qa-deploy-api.sh, qa-backup.sh, qa-restore-drill.sh -> /usr/local/sbin/ (qa-deploy-api, qa-backup, qa-restore-drill)
#   infra/systemd/mento-*.{service,timer}                  -> /etc/systemd/system/
#   /etc/mento/age/qa.recipients  = this box's QA public key + the recovery recipient (public keys only)
#   /etc/mento/qa-backup.env      = QA_BACKUP_REMOTE=<dest>   (only with --remote)
# Then, as the repo owner, seeds the CI poller so old branches are not re-tested.
#
# Without --enable nothing is scheduled. With --enable it runs one backup and one restore
# drill and enables the three timers only if both pass. It never deletes the old plaintext
# dump in /opt/mento-backups; retire that yourself after a passing drill.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KEY=/etc/mento/age/qa.key
RECIPIENTS=/etc/mento/age/qa.recipients
ENVFILE=/etc/mento/qa-backup.env
OWNER="${QA_REPO_OWNER:-agent}"
RECOVERY="" REMOTE="" ENABLE=0 DRY=0

die() { echo "qa-root-setup: $*" >&2; exit 1; }
say() { echo "qa-root-setup: $*"; }
run() { if [ "$DRY" -eq 1 ]; then echo "  [dry-run] $*"; else "$@"; fi; }

while [ $# -gt 0 ]; do
    case "$1" in
        --recovery-recipient) RECOVERY="${2:-}"; shift 2 ;;
        --remote) REMOTE="${2:-}"; shift 2 ;;
        --enable) ENABLE=1; shift ;;
        --dry-run) DRY=1; shift ;;
        *) die "unknown argument: $1" ;;
    esac
done

[ "$DRY" -eq 1 ] || [ "$(id -u)" -eq 0 ] || die "run as root (or use --dry-run)"
[[ -z $RECOVERY || $RECOVERY =~ ^age1[a-z0-9]{50,}$ ]] || die "--recovery-recipient must be an age public key (age1...)"
[[ -z $REMOTE || $REMOTE =~ ^[A-Za-z0-9_.-]+:[A-Za-z0-9_./-]*$ ]] || die "--remote must look like name:path (an rclone destination)"
for f in ops/qa-deploy-api.sh ops/qa-backup.sh ops/qa-restore-drill.sh ops/ci-poll.sh; do [ -f "$REPO/$f" ] || die "missing $REPO/$f (run from an up-to-date dev checkout)"; done
if [ "$DRY" -eq 0 ]; then
    command -v age >/dev/null && command -v age-keygen >/dev/null || die "age / age-keygen not installed"
    [ -r "$KEY" ] || die "cannot read $KEY"
    [ "$ENABLE" -eq 0 ] || command -v docker >/dev/null || die "docker not found"
    [ -z "$REMOTE" ] || command -v rclone >/dev/null || die "rclone not installed (needed for --remote)"
fi

# 1. Recipients: public keys only. The recovery key's private half stays in the password manager.
if [ -s "$RECIPIENTS" ] && [ -z "$RECOVERY" ]; then
    say "keeping existing $RECIPIENTS"
else
    [ -n "$RECOVERY" ] || die "no $RECIPIENTS yet: pass --recovery-recipient age1..."
    say "writing $RECIPIENTS (server key + recovery key)"
    if [ "$DRY" -eq 0 ]; then
        { age-keygen -y "$KEY"; echo "$RECOVERY"; } > "$RECIPIENTS.tmp"
        chmod 644 "$RECIPIENTS.tmp"; mv -f "$RECIPIENTS.tmp" "$RECIPIENTS"
    fi
fi

# 2. Optional off-box destination for the backup unit (EnvironmentFile=-/etc/mento/qa-backup.env).
if [ -n "$REMOTE" ]; then
    say "setting QA_BACKUP_REMOTE=$REMOTE in $ENVFILE"
    [ "$DRY" -eq 1 ] || { umask 077; printf 'QA_BACKUP_REMOTE=%s\n' "$REMOTE" > "$ENVFILE"; }
fi

# 3. Scripts and units.
for pair in qa-deploy-api:qa-deploy-api qa-backup:qa-backup qa-restore-drill:qa-restore-drill; do
    run install -o root -g root -m 755 "$REPO/ops/${pair%%:*}.sh" "/usr/local/sbin/${pair##*:}"
done
for u in "$REPO"/infra/systemd/mento-*; do run install -o root -g root -m 644 "$u" /etc/systemd/system/; done
run systemctl daemon-reload

# 4. Seed the CI poller as the repo owner.
run sudo -u "$OWNER" "$REPO/ops/ci-poll.sh" --seed

# 5. Optionally prove the backup, then schedule everything.
if [ "$ENABLE" -eq 1 ]; then
    say "first backup"; run /usr/local/sbin/qa-backup
    say "first restore drill"; run /usr/local/sbin/qa-restore-drill
    run systemctl enable --now mento-qa-backup.timer mento-qa-restore-drill.timer mento-ci-poll.timer
    say "timers enabled. Next: retire the plaintext dumps in /opt/mento-backups once you are happy."
else
    say "installed, nothing scheduled. Rerun with --enable to prove a backup + drill and start the timers."
fi
