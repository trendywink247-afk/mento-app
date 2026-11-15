#!/usr/bin/env bash
# One-time (idempotent) root install of the self-hosted OTA server on the QA box.
#   sudo bash infra/qa-root-ota.sh            # from a checkout that has services/ota
# Installs services/ota to /opt/mento-ota (root-owned), its venv, the systemd unit, and the
# /ota/* route in the qa-api site of /etc/caddy/Caddyfile (backed up; restored if validation fails).
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "run as root" >&2; exit 1; }
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[ -f "$SRC/services/ota/requirements.txt" ] || { echo "no services/ota in $SRC" >&2; exit 1; }

echo "== code + venv"
install -d -m 755 /opt/mento-ota
rm -rf /opt/mento-ota/src.new && cp -r "$SRC/services/ota" /opt/mento-ota/src.new
rm -rf /opt/mento-ota/src.new/tests /opt/mento-ota/src.new/.venv
chown -R root:root /opt/mento-ota/src.new && rm -rf /opt/mento-ota/src && mv /opt/mento-ota/src.new /opt/mento-ota/src
# Root's own Python (3.12 if present, else the system python3). The service never uses a
# Python under /home (ProtectHome=yes). Tests pass on 3.12 and 3.14.
PY="$(command -v python3.12 || command -v python3)"
if [ ! -x /opt/mento-ota/venv/bin/python ] || [ ! -x /opt/mento-ota/venv/bin/pip ]; then
  rm -rf /opt/mento-ota/venv
  if ! "$PY" -m venv /opt/mento-ota/venv 2>/dev/null; then
    rm -rf /opt/mento-ota/venv
    v="$("$PY" -c 'import sys; print(f"{sys.version_info[0]}.{sys.version_info[1]}")')"
    echo "installing python$v-venv (needed to create the venv)"
    apt-get install -y -q "python$v-venv" >/dev/null || apt-get install -y -q python3-venv >/dev/null
    "$PY" -m venv /opt/mento-ota/venv
  fi
fi
/opt/mento-ota/venv/bin/pip install -q -r /opt/mento-ota/src/requirements.txt

echo "== systemd"
install -m 644 "$SRC/infra/systemd/mento-ota.service" /etc/systemd/system/mento-ota.service
systemctl daemon-reload
systemctl enable --now mento-ota.service
systemctl restart mento-ota.service
for _ in $(seq 1 20); do curl -fsS -o /dev/null http://127.0.0.1:18020/health && break; sleep 0.5; done
curl -s -o /dev/null -w 'ota local: %{http_code}\n' http://127.0.0.1:18020/health

echo "== caddy"
CF=/etc/caddy/Caddyfile
if grep -q 'handle_path /ota/\*' "$CF"; then
  echo "route already present"
else
  BAK="$CF.bak-ota-$(date +%Y%m%d%H%M%S)"; cp -p "$CF" "$BAK"
  python3 - "$CF" <<'PY'
import re, sys
p = sys.argv[1]; s = open(p).read()
m = re.search(r'^qa-api\.mento\.chat[^\n{]*\{\n', s, re.M)
if not m: sys.exit("qa-api site block not found")
block = "\thandle_path /ota/* {\n\t\treverse_proxy 127.0.0.1:18020\n\t}\n"
open(p, "w").write(s[:m.end()] + block + s[m.end():])
PY
  if caddy validate --config "$CF" --adapter caddyfile >/dev/null 2>&1; then
    systemctl reload caddy; echo "route added (backup $BAK)"
  else
    cp -p "$BAK" "$CF"; echo "caddy validate failed: Caddyfile restored, route NOT added" >&2; exit 1
  fi
fi
sleep 1
curl -s -o /dev/null -w 'ota public: %{http_code}\n' https://qa-api.mento.chat/ota/health
