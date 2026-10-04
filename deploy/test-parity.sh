#!/usr/bin/env bash
# Local/prod parity for the Balanced stack (WS1 T1.1). Renders
#   compose.base.yml + compose.local.yml   and   compose.base.yml + compose.prod.yml
# with `docker compose config`, blanks out the ONLY differences allowed between
# them — env values, published ports, memory and log limits, hostnames (which are
# env values here) and the host-side path of a bind mount — and fails if anything
# else differs: images, commands, healthchecks, volumes' container paths, profiles,
# dependencies, restart policy, networks.
# Needs Docker (compose v2) only for `config`; nothing is started.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# prod needs its env file and password to render; fake, non-secret values.
printf 'ENV=prod\nJWT_SECRET=parity-check\n' > "$TMP/api.env"

render() {  # render <override> <out.json>
    docker compose -f "$HERE/compose.base.yml" -f "$HERE/$1" --profile green --profile tools \
        config --format json > "$2"
}
render compose.local.yml "$TMP/local.json"
MENTO_ENV_FILE="$TMP/api.env" POSTGRES_PASSWORD=parity-check GLITCHTIP_SECRET_KEY=parity-check \
    render compose.prod.yml "$TMP/prod.json"

python3 - "$TMP/local.json" "$TMP/prod.json" <<'EOF'
import json, sys

# command/ulimits (T1.2): Postgres/Valkey/API tuning flags sized to the 4 GB prod
# box (deploy/compose.prod.yml) have no local equivalent — same image and
# behaviour either side, only sized differently. Deliberately allowed, not an
# oversight: everything else about the service (image, healthcheck, depends_on,
# volumes' container paths, profiles, restart policy) must still match exactly.
ALLOWED = {"environment", "env_file", "ports", "mem_limit", "mem_reservation",
           "memswap_limit", "logging", "command", "ulimits"}
# GlitchTip (T1.7): a prod-only ops tool, not part of the app under test, no
# local equivalent by design — excluded from the comparison entirely, same
# reasoning as the allowed set above, just at the service/volume level instead
# of the key level.
PROD_ONLY_SERVICES = {"glitchtip", "glitchtip-init-db"}
PROD_ONLY_VOLUMES = {"glitchtip_uploads"}

def normalise(path):
    cfg = json.load(open(path))
    # x-* blocks are YAML anchors for reuse, not configuration.
    cfg = {k: v for k, v in cfg.items() if not k.startswith("x-")}
    for name in PROD_ONLY_SERVICES:
        cfg.get("services", {}).pop(name, None)
    for name in PROD_ONLY_VOLUMES:
        cfg.get("volumes", {}).pop(name, None)
    for svc in cfg.get("services", {}).values():
        for key in ALLOWED:
            svc.pop(key, None)
        for vol in svc.get("volumes", []):
            if vol.get("type") == "bind":
                vol["source"] = "<host path>"
                vol.pop("bind", None)  # create_host_path etc. follow the source
    return cfg

# Inspect actual rendered inheritance before normalisation removes environment.
rendered = json.load(open(sys.argv[2]))["services"]
application_pools = 0
for name in ("api_blue", "api_green", "worker"):
    env = rendered[name]["environment"]
    size, overflow = int(env["DB_POOL_SIZE"]), int(env["DB_MAX_OVERFLOW"])
    assert size > 0 and overflow >= 0, f"{name}: unbounded connection pool"
    application_pools += size + overflow
# One process per color and one worker: reserve queue/migration/ops slots.
# Optional GlitchTip still requires a separately measured budget before rollout.
limit = next(int(arg.split("=", 1)[1]) for arg in rendered["postgres"]["command"]
             if arg.startswith("max_connections="))
assert application_pools + 4 + 1 + 3 + 5 <= limit, "Balanced core overlap exceeds DB budget"
print("PASS: rendered core pool overlap fits; optional clients still require acceptance")
local, prod = (normalise(p) for p in sys.argv[1:3])
diffs = []

def walk(a, b, where):
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(set(a) | set(b)):
            if k not in a or k not in b:
                diffs.append(f"{where}.{k}: only in {'prod' if k not in a else 'local'}")
            else:
                walk(a[k], b[k], f"{where}.{k}")
    elif a != b:
        diffs.append(f"{where}: local={json.dumps(a)} prod={json.dumps(b)}")

walk(local, prod, "compose")
if diffs:
    print("parity: local and prod differ beyond the allowed set:")
    for d in diffs:
        print("  " + d)
    sys.exit(1)
print(f"parity: {len(local['services'])} services identical beyond env, ports, limits, hostnames and host paths")
EOF
