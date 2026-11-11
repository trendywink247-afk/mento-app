#!/usr/bin/env bash
# One-time (idempotent) root setup for PRODUCTION on this box, beside QA. Runbook: docs/PRODUCTION.md.
#
#   sudo bash infra/prod-root-setup.sh [--dry-run] [--recovery-recipient age1...] [--admin-ip <ip/cidr>]
#                                      [--with-caddy [--force-caddy]]
#
# Creates (never overwrites existing secrets):
#   /opt/mento-prod/{compose.yml, secrets/{api.env,db.env,files/}, web-releases/, ota-data/, state/}
#   /opt/mento-backups/{prod-encrypted,prod-predeploy}/   /etc/mento/age/{prod-backup.key,prod.recipients}
#   /usr/local/sbin/{prod-backup,prod-restore-drill} + timers   mento-ota-prod.service (enabled once its key exists)
# With --with-caddy (only after app/api/admin.mento.chat resolve to this box): installs
#   /etc/caddy/mento-prod.caddy, appends one import line to /etc/caddy/Caddyfile, validates the
#   whole config and restores the old file if validation fails.
# Generated secrets (DB password, three distinct JWT secrets) are written straight to root-only
# files and never printed. It starts no application container: the first
# `sudo ops/prod-release.sh <main sha> --yes-production` does that.
set -euo pipefail

SRC=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
P=/opt/mento-prod
DRY=0 RECOVERY="" ADMIN_IP="" CADDY=0 FORCE_CADDY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1 ;;
    --recovery-recipient) RECOVERY=${2:?}; shift ;;
    --admin-ip) ADMIN_IP=${2:?}; shift ;;
    --with-caddy) CADDY=1 ;;
    --force-caddy) FORCE_CADDY=1 ;;
    *) sed -n '4,6p' "$0" >&2; exit 2 ;;
  esac
  shift
done
[ "$(id -u)" -eq 0 ] || { echo "prod-root-setup: run as root" >&2; exit 2; }
[[ -z $RECOVERY || $RECOVERY =~ ^age1[a-z0-9]{58}$ ]] || { echo "prod-root-setup: --recovery-recipient must be an age1... public key" >&2; exit 2; }
[[ -z $ADMIN_IP || $ADMIN_IP =~ ^[0-9a-fA-F:.]+(/[0-9]{1,3})?$ ]] || { echo "prod-root-setup: --admin-ip must be an IP or CIDR" >&2; exit 2; }
for f in deploy/prod-local/compose.yml ops/prod-backup.sh ops/prod-restore-drill.sh infra/caddy/prod.caddy \
         infra/systemd/mento-ota-prod.service infra/systemd/mento-prod-backup.service; do
  [ -f "$SRC/$f" ] || { echo "prod-root-setup: missing $SRC/$f" >&2; exit 2; }
done

say() { echo "prod-root-setup: $*"; }
run() { if [ "$DRY" = 1 ]; then echo "  would: $*"; else "$@"; fi; }
rand() { openssl rand -hex "$1"; }

say "== tools"
missing=()
for t in docker age age-keygen caddy openssl curl; do command -v "$t" >/dev/null || missing+=("$t"); done
[ ${#missing[@]} -eq 0 ] || { say "install first: ${missing[*]}"; [ "$DRY" = 1 ] || exit 2; }

say "== directories"
run install -d -m 755 -o root -g root "$P" "$P/web-releases" "$P/ota-data" "$P/state"
run install -d -m 700 -o root -g root "$P/secrets" "$P/secrets/files" /opt/mento-backups/prod-encrypted \
  /opt/mento-backups/prod-predeploy /etc/mento/age /etc/mento/ota
run install -d -m 755 -o root -g root /opt/mento-backups

say "== compose file"
run install -m 644 -o root -g root "$SRC/deploy/prod-local/compose.yml" "$P/compose.yml"

say "== secrets (generated once, never printed, never overwritten)"
if [ -f "$P/secrets/db.env" ]; then
  say "db.env exists; kept"
elif [ "$DRY" = 1 ]; then
  echo "  would: write $P/secrets/db.env and api.env with a random DB password and three distinct JWT secrets"
else
  pw=$(rand 32)
  ( umask 077
    printf 'POSTGRES_USER=mento\nPOSTGRES_DB=mento\nPOSTGRES_PASSWORD=%s\n' "$pw" > "$P/secrets/db.env"
    cat > "$P/secrets/api.env" <<EOF
# PRODUCTION API settings. Root-only. Never print, paste or commit this file.
# Non-secret settings (ENV, REDIS_URL, workers, pool, proxy hops, base URLs, FCM path) live in
# /opt/mento-prod/compose.yml so they cannot drift. Names below are required unless marked optional.
DATABASE_URL=postgresql+psycopg://mento:${pw}@postgres:5432/mento
JWT_SECRET=$(rand 48)
ADMIN_JWT_SECRET=$(rand 48)
LISTENER_JWT_SECRET=$(rand 48)
CORS_ORIGINS=https://app.mento.chat,https://admin.mento.chat
# --- founder fills these (docs/PRODUCTION.md, checklist) -----------------------------
# Chat encryption key: cd services/api && .venv/bin/python -m app.services.message_crypto k1
# Without it own chat refuses to store messages. Keep a copy in the password manager.
MESSAGE_KEY=
# Stream (the API refuses to boot without them: the crisis-scan webhook depends on them).
STREAM_API_KEY=
STREAM_API_SECRET=
# Optional:
SENTRY_DSN=
PUSH_ENABLED=true
# ALLOWANCE_IN_A_ROW=10
# ALLOWANCE_ENFORCED=true
# OWN_CHAT_NEW_CONVERSATIONS=false
EOF
  )
  unset pw
  chmod 600 "$P/secrets/db.env" "$P/secrets/api.env"
  say "wrote db.env and api.env (generated values not shown)"
fi

say "== backup encryption key (this box) + recipients"
if [ -f /etc/mento/age/prod-backup.key ]; then
  say "prod-backup.key exists; kept"
else
  run sh -c 'umask 077; age-keygen -o /etc/mento/age/prod-backup.key 2>/dev/null'
fi
if [ "$DRY" = 0 ]; then
  { age-keygen -y /etc/mento/age/prod-backup.key; [ -z "$RECOVERY" ] || echo "$RECOVERY"; } > /etc/mento/age/prod.recipients.tmp
  # Keep a recovery recipient added on an earlier run.
  [ ! -f /etc/mento/age/prod.recipients ] || grep -h '^age1' /etc/mento/age/prod.recipients >> /etc/mento/age/prod.recipients.tmp
  sort -u /etc/mento/age/prod.recipients.tmp > /etc/mento/age/prod.recipients; rm -f /etc/mento/age/prod.recipients.tmp
  chmod 644 /etc/mento/age/prod.recipients
  n=$(grep -c '^age1' /etc/mento/age/prod.recipients)
  say "recipients: $n (public keys only)"
  [ "$n" -ge 2 ] || say "WARNING: no offline recovery recipient yet; re-run with --recovery-recipient age1... (a lost box would lose the backups)"
fi

say "== backup and restore-drill timers"
run install -m 755 -o root -g root "$SRC/ops/prod-backup.sh" /usr/local/sbin/prod-backup
run install -m 755 -o root -g root "$SRC/ops/prod-restore-drill.sh" /usr/local/sbin/prod-restore-drill
for u in mento-prod-backup.service mento-prod-backup.timer mento-prod-restore-drill.service mento-prod-restore-drill.timer; do
  run install -m 644 "$SRC/infra/systemd/$u" "/etc/systemd/system/$u"
done
[ -f /etc/mento/prod-backup.env ] || run sh -c 'umask 077; printf "# PROD_BACKUP_REMOTE=offbox:mento-prod/   (an rclone destination; unset = local only)\n" > /etc/mento/prod-backup.env'
run systemctl daemon-reload
run systemctl enable --now mento-prod-backup.timer mento-prod-restore-drill.timer

say "== production OTA server (needs /opt/mento-ota from infra/qa-root-ota.sh)"
run install -m 644 "$SRC/infra/systemd/mento-ota-prod.service" /etc/systemd/system/mento-ota-prod.service
run systemctl daemon-reload
if [ -f /etc/mento/ota/prod-private-key.pem ] && [ -x /opt/mento-ota/venv/bin/python ]; then
  run systemctl enable --now mento-ota-prod.service
  run systemctl restart mento-ota-prod.service
else
  say "OTA not started: needs /etc/mento/ota/prod-private-key.pem (checklist) and /opt/mento-ota (qa-root-ota.sh)"
fi

if [ "$CADDY" = 1 ]; then
  say "== Caddy"
  me=$(hostname -I 2>/dev/null || true)
  bad=()
  for h in app.mento.chat api.mento.chat admin.mento.chat; do
    ip=$(getent ahostsv4 "$h" | awk 'NR==1{print $1}')
    { [ -n "$ip" ] && grep -qwF -- "$ip" <<<"$me"; } || bad+=("$h->${ip:-none}")
  done
  if [ ${#bad[@]} -gt 0 ] && [ "$FORCE_CADDY" = 0 ]; then
    say "NOT installing Caddy sites: DNS does not point here yet (this box: ${me:-unknown}; ${bad[*]})."
    say "Point the A records first, or pass --force-caddy (Caddy would keep failing ACME meanwhile)."
  else
    CF=/etc/caddy/Caddyfile
    if [ -n "$ADMIN_IP" ]; then
      rendered=$(sed "s#PROD_ADMIN_EXTRA_IP#$ADMIN_IP#" "$SRC/infra/caddy/prod.caddy")
    else
      rendered=$(sed 's# PROD_ADMIN_EXTRA_IP##' "$SRC/infra/caddy/prod.caddy")
    fi
    if [ "$DRY" = 1 ]; then
      echo "  would: install /etc/caddy/mento-prod.caddy, add 'import /etc/caddy/mento-prod.caddy' to $CF, validate, reload"
    else
      stamp=$(date +%Y%m%d%H%M%S)
      cp -p "$CF" "$CF.bak-prod-$stamp"
      [ ! -f /etc/caddy/mento-prod.caddy ] || cp -p /etc/caddy/mento-prod.caddy "/etc/caddy/mento-prod.caddy.bak-$stamp"
      printf '%s\n' "$rendered" > /etc/caddy/mento-prod.caddy
      grep -qx 'import /etc/caddy/mento-prod.caddy' "$CF" || printf '\n# Production sites (infra/caddy/prod.caddy)\nimport /etc/caddy/mento-prod.caddy\n' >> "$CF"
      if caddy validate --config "$CF" --adapter caddyfile >/dev/null 2>&1; then
        systemctl reload caddy
        say "Caddy reloaded with the production sites (backup $CF.bak-prod-$stamp)"
      else
        cp -p "$CF.bak-prod-$stamp" "$CF"
        if [ -f "/etc/caddy/mento-prod.caddy.bak-$stamp" ]; then
          cp -p "/etc/caddy/mento-prod.caddy.bak-$stamp" /etc/caddy/mento-prod.caddy
        else
          rm -f /etc/caddy/mento-prod.caddy
        fi
        say "caddy validate FAILED: everything restored, nothing reloaded"; exit 1
      fi
    fi
  fi
fi

say "== founder checklist (names only; nothing secret is shown)"
cat <<'EOF'
  1. MESSAGE_KEY: on a trusted machine, cd services/api && .venv/bin/python -m app.services.message_crypto k1
     -> put the output in /opt/mento-prod/secrets/api.env (MESSAGE_KEY=) and in the password manager.
  2. STREAM_API_KEY / STREAM_API_SECRET for the production Stream app -> api.env.
  3. FCM: Firebase service-account JSON -> /opt/mento-prod/secrets/files/fcm.json (root, 600).
  4. Sentry (optional): SENTRY_DSN (API prod) -> api.env; app prod DSN -> .secrets/prod.env as
     EXPO_PUBLIC_SENTRY_DSN; also EXPO_PUBLIC_STREAM_API_KEY there (web + app builds need it).
  5. Production OTA signing key (once, kept forever):
       ops/ota-keygen.sh prod apps/mobile/certs/ota-prod.pem /etc/mento/ota/prod-private-key.pem
     commit apps/mobile/certs/ota-prod.pem (public), keep the key in the password manager,
     then re-run this script (starts mento-ota-prod).
  6. Offline backup recovery key: age-keygen on YOUR machine, keep the private half offline,
     re-run with --recovery-recipient age1... ; set PROD_BACKUP_REMOTE in /etc/mento/prod-backup.env.
  7. DNS: A records app.mento.chat, api.mento.chat, admin.mento.chat -> 129.121.171.140
     (they point at the old server 129.121.122.28 today), then re-run with --with-caddy [--admin-ip <your ip>].
  8. Merge dev -> main (founder approval), run ops/ci.sh <main sha>, then:
       sudo ops/prod-release.sh <main sha> --dry-run
       sudo ops/prod-release.sh <main sha> --yes-production
  9. Retire the old server 129.121.122.28 once the new one serves (test data only).
EOF
