"""Disposable local same-candidate topology rollback rehearsal; no VPS changes."""

import argparse
import copy
import importlib.util
import json
import sys
from pathlib import Path
import secrets
import re
import signal
import subprocess
import time
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]
REVISION = None
IMAGE = None
CONTEXT = None
RUN = "mento-rehearsal-" + uuid.uuid4().hex
NETWORK = RUN + "-net"
VOLUME = RUN + "-pgdata"
DB = RUN + "-db"
CACHE = RUN + "-cache"
LABEL = "org.mento.local.rehearsal=" + RUN
created = []
evidence = {
    "run": RUN,
    "checks": [],
    "limitations": [
        "Same candidate code in classic and Balanced topology: not old-release compatibility.",
        "Direct API endpoints: no reverse proxy, TLS, VPS or traffic-switch acceptance.",
        "Additive synthetic schema probe: not a release migration compatibility test.",
        "Synthetic resource-limited database: not a production load benchmark.",
    ],
}


def ownership(kind, name):
    info = json.loads(docker(kind, "inspect", name))[0]
    labels = (
        info["Config"].get("Labels", {})
        if kind == "container"
        else info.get("Labels", {})
    )
    if labels.get("org.mento.local.rehearsal") != RUN:
        raise ValueError("Resource ownership differs")
    return info["Id"] if kind != "volume" else info["CreatedAt"]


def create(kind, name, command):
    """Record owned identity even when Docker timed out after creating a resource."""
    try:
        docker(*command)
    finally:
        # Never delete by a generated name alone: inspect the run label and identity.
        ident = ownership(kind, name)
        created.append((kind, name, ident))
    return ident


def cleanup():
    result = []
    for kind, name, ident in reversed(created):
        try:
            if ownership(kind, name) != ident:
                raise ValueError("Resource identity changed")
            docker(
                kind,
                "rm",
                *(["-f"] if kind == "container" else []),
                name if kind == "volume" else ident
            )
            result.append({"kind": kind, "name": name, "removed": True})
        except Exception:
            result.append({"kind": kind, "name": name, "removed": False})
    # Successful daemon queries confirm no owned runtime objects remain.
    for args, field in [
        (("ps", "-a"), "Names"),
        (("network", "ls"), "Name"),
        (("volume", "ls"), "Name"),
    ]:
        if docker(
            *args, "--filter", "label=" + LABEL, "--format", "{{." + field + "}}"
        ):
            raise RuntimeError("Owned runtime resource remains")
    return result


def docker(*args, input=None, timeout=90):
    prefix = ["docker", "--context", CONTEXT] if CONTEXT else ["docker"]
    result = subprocess.run(
        [*prefix, *args], input=input, text=True, capture_output=True, timeout=timeout
    )
    if result.returncode:
        raise RuntimeError("Docker command failed: " + args[0])
    return result.stdout.strip()


def inspect(name):
    return json.loads(docker("inspect", name))[0]


def run_preflight(args, **kwargs):
    """Pin imported guard's subprocesses to the same validated local context."""
    if not args or args[0] != "docker":
        raise ValueError("Unexpected preflight command")
    return docker(*args[1:], input=kwargs.get("input"), timeout=30)


def sql(query):
    return docker(
        "exec",
        DB,
        "psql",
        "-X",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        "mento",
        "-d",
        "mento",
        "-At",
        "-c",
        query,
    )


def wait(test, seconds=90):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            if test():
                return
        except Exception:
            pass
        time.sleep(1)
    raise RuntimeError("Readiness deadline exceeded")


def container(name, image, args=(), env=None, port=False, memory="256m"):
    # Inspect/pin local images; docker run must never implicitly pull an image.
    image = json.loads(docker("image", "inspect", image))[0]["Id"]
    command = [
        "run",
        "-d",
        "--name",
        name,
        "--label",
        LABEL,
        "--network",
        NETWORK,
        "--memory",
        memory,
        "--cpus",
        "1",
        "--pids-limit",
        "128",
    ]
    if port:
        command += ["-p", "127.0.0.1::8000"]
    for key, value in (env or {}).items():
        command += ["-e", key + "=" + value]
    if name == DB:
        command += [
            "--mount",
            "type=volume,source=" + VOLUME + ",target=/var/lib/postgresql/data",
        ]
    return create("container", name, [*command, image, *args])


def request(base, path, token=None, body=None, method=None):
    headers = {}
    if token:
        headers["Authorization"] = "Bearer " + token
    if body is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(
        base + "/api/v1" + path,
        data=json.dumps(body).encode() if body is not None else None,
        headers=headers,
        method=method,
    )
    with urllib.request.urlopen(req, timeout=10) as response:
        return json.loads(response.read())


def endpoint(name):
    binding = inspect(name)["NetworkSettings"]["Ports"]["8000/tcp"][0]
    assert binding["HostIp"] == "127.0.0.1"
    return "http://127.0.0.1:" + binding["HostPort"]


def passed(name):
    evidence["checks"].append(name)
    print("PASS " + name, flush=True)


def must_refuse(fn, name):
    try:
        fn()
    except ValueError:
        passed(name)
    else:
        raise AssertionError("Unsafe preflight acceptance: " + name)


def main():
    global IMAGE
    image = json.loads(docker("image", "inspect", IMAGE))[0]
    if (
        image["Config"].get("Labels", {}).get("org.opencontainers.image.revision")
        != REVISION
    ):
        raise ValueError("API image revision differs")
    evidence["image_id"] = image["Id"]
    IMAGE = image["Id"]  # Never let mutable image tags change mid-rehearsal.
    netid = create("network", NETWORK, ["network", "create", "--label", LABEL, NETWORK])
    create("volume", VOLUME, ["volume", "create", "--label", LABEL, VOLUME])
    password = secrets.token_hex(24)
    dbid = container(
        DB,
        "postgres:16-alpine",
        env={
            "POSTGRES_DB": "mento",
            "POSTGRES_USER": "mento",
            "POSTGRES_PASSWORD": password,
        },
    )
    cacheid = container(CACHE, "valkey/valkey:8-alpine")
    wait(lambda: sql("SELECT 1") == "1")
    env = {
        "ENV": "dev",
        "DATABASE_URL": "postgresql+psycopg://mento:" + password + "@" + DB + "/mento",
        "REDIS_URL": "redis://" + CACHE + ":6379/0",
        "JWT_SECRET": secrets.token_hex(32),
        "UVICORN_WORKERS": "2",
        "DB_POOL_SIZE": "5",
        "DB_MAX_OVERFLOW": "5",
        "STREAM_API_KEY": "",
        "STREAM_API_SECRET": "",
        "PUSH_ENABLED": "false",
        "RECOVERY_RECEIPT_REQUIRED": "false",
    }
    migration = RUN + "-migrate"
    container(migration, IMAGE, ("alembic", "upgrade", "head"), env, memory="512m")
    wait(lambda: not inspect(migration)["State"]["Running"])
    assert inspect(migration)["State"]["ExitCode"] == 0
    classic = RUN + "-classic"
    container(classic, IMAGE, env=env, port=True, memory="512m")
    old = endpoint(classic)
    wait(lambda: request(old, "/health/ready")["status"] == "ok")
    user = request(
        old, "/onboarding/start", body={"dob": "1990-01-01", "terms_accepted": True}
    )
    token = user["session_token"]
    before = request(
        old,
        "/journals/entries",
        token,
        {"channel": "mood", "body": "synthetic-before-transition"},
    )
    erased = request(
        old, "/onboarding/start", body={"dob": "1991-01-01", "terms_accepted": True}
    )
    request(
        old,
        "/journals/entries",
        erased["session_token"],
        {"channel": "mood", "body": "synthetic-to-erase"},
    )
    passed("classic API committed pre-transition journal writes")
    cluster, oid = sql(
        "SELECT system_identifier::text FROM pg_control_system(); SELECT oid FROM pg_database WHERE datname=current_database()"
    ).splitlines()
    expected = {
        "database_container": DB,
        "database_name": "mento",
        "database_user": "mento",
        "network": NETWORK,
        "volume": VOLUME,
        "cache_container": CACHE,
        "container_id": dbid,
        "network_id": netid,
        "cache_id": cacheid,
        "system_identifier": cluster,
        "database_oid": int(oid),
        "old_clients": [classic],
        "other_clients": [],
    }
    spec = importlib.util.spec_from_file_location(
        "transition_preflight", ROOT / "deploy/transition-preflight.py"
    )
    preflight = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(preflight)
    preflight.run = run_preflight
    candidate_env = {
        **env,
        "UVICORN_WORKERS": "2",
        "DB_POOL_SIZE": "5",
        "DB_MAX_OVERFLOW": "0",
    }
    services = {
        name: {"image": IMAGE, "environment": dict(candidate_env)}
        for name in ("api_blue", "api_green", "worker", "migrate")
    }
    services["worker"]["command"] = ["python", "-m", "app.jobs.worker"]
    services["migrate"]["command"] = ["alembic", "upgrade", "head"]
    config = {
        "services": services,
        "networks": {"default": {"external": True, "name": NETWORK}},
    }
    live = preflight.collect(expected)
    evidence["budget"] = preflight.validate_candidate(
        config, expected, live, headroom=5, other_connections=0
    )
    passed("live retained identity and old/new pool overlap preflight")
    wrong = dict(expected, system_identifier=str(int(cluster) + 1))
    must_refuse(
        lambda: preflight.collect(wrong),
        "wrong cluster refused before candidate mutation",
    )
    wrong_config = copy.deepcopy(config)
    wrong_config["services"]["api_blue"]["environment"]["DATABASE_URL"] = env[
        "DATABASE_URL"
    ].replace(DB, RUN + "-new-db")
    must_refuse(
        lambda: preflight.validate_candidate(
            wrong_config, expected, live, headroom=5, other_connections=0
        ),
        "new database endpoint refused before candidate mutation",
    )
    low = dict(live, max_connections=50)
    must_refuse(
        lambda: preflight.validate_candidate(
            config, expected, low, headroom=5, other_connections=0
        ),
        "old plus new overlap refused at 50 connections",
    )
    sql(
        "CREATE TABLE local_rehearsal_expand (id integer PRIMARY KEY, note text); INSERT INTO local_rehearsal_expand VALUES (1, 'additive schema survives rollback')"
    )
    blue, green, worker = (RUN + "-blue", RUN + "-green", RUN + "-worker")
    container(blue, IMAGE, env=candidate_env, port=True, memory="512m")
    container(green, IMAGE, env=candidate_env, port=True, memory="512m")
    worker_env = dict(candidate_env)
    container(
        worker, IMAGE, ("python", "-m", "app.jobs.worker"), worker_env, memory="512m"
    )
    new = endpoint(blue)
    wait(lambda: request(new, "/health/ready")["status"] == "ok")
    wait(lambda: request(endpoint(green), "/health/ready")["status"] == "ok")
    assert inspect(worker)["State"]["Running"]
    wait(
        lambda: sql(
            "SELECT count(*) FROM procrastinate_workers WHERE last_heartbeat > now() - interval '60 seconds'"
        )
        == "1"
    )
    job = docker(
        "exec",
        "-i",
        blue,
        "python",
        "-",
        input="""
from app.db import SessionLocal
from app.jobs import enqueue
from app.jobs.tasks import maintenance_capacity
with SessionLocal() as db:
    ident = enqueue(db, maintenance_capacity, timestamp=0)
    db.commit()
print(ident)
""",
    )
    assert job.isdigit()
    wait(lambda: sql("SELECT count(*) FROM procrastinate_jobs WHERE id=" + job) == "0")
    passed("isolated worker consumed explicit committed maintenance job")
    assert before["id"] in {
        row["id"] for row in request(new, "/journals/entries?channel=mood", token)
    }
    after = request(
        new,
        "/journals/entries",
        token,
        {"channel": "mood", "body": "synthetic-after-transition"},
    )
    assert (
        request(new, "/me", erased["session_token"], method="DELETE")["status"]
        == "erased"
    )
    erased_id = str(uuid.UUID(erased["user"]["id"]))
    assert sql("SELECT count(*) FROM users WHERE id='" + erased_id + "'") == "0"
    passed(
        "Balanced APIs and worker share retained DB; new write and erasure committed"
    )
    # Isolate rollback: original classic container is restarted after candidate stop.
    docker("stop", "-t", "10", classic)
    for name in (worker, blue, green):
        docker("stop", "-t", "10", name)
    docker("start", classic)
    old = endpoint(classic)  # Docker may allocate a new ephemeral port on restart.
    wait(lambda: request(old, "/health/ready")["status"] == "ok")
    rows = request(old, "/journals/entries?channel=mood", token)
    assert {before["id"], after["id"]} <= {row["id"] for row in rows}
    assert sql("SELECT count(*) FROM users WHERE id='" + erased_id + "'") == "0"
    assert sql("SELECT count(*) FROM local_rehearsal_expand") == "1"
    assert inspect(DB)["Id"] == dbid
    assert sql("SELECT system_identifier::text FROM pg_control_system()") == cluster
    assert inspect(DB)["Mounts"][0]["Name"] == VOLUME
    passed(
        "classic rollback preserves both writes, deletion, additive schema and DB identity"
    )
    evidence["status"] = "passed"


def cli(argv=None):
    global IMAGE, REVISION, CONTEXT
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--image", required=True, help="Already built local API image; never pulled"
    )
    parser.add_argument(
        "--revision",
        required=True,
        help="Full Git SHA matching image OCI revision label",
    )
    parser.add_argument(
        "--context",
        help="Local Docker context (Unix socket or Windows named pipe only)",
    )
    parser.add_argument(
        "--evidence", type=Path, default=ROOT / ".local" / (RUN + ".json")
    )
    args = parser.parse_args(argv)
    if not re.fullmatch(r"[0-9a-f]{40}", args.revision):
        parser.error("Full lowercase Git SHA required")
    if sys.flags.optimize:
        parser.error(
            "Run without Python optimization so proof assertions remain active"
        )
    context = args.context or docker("context", "show")
    host = json.loads(docker("context", "inspect", context))[0]["Endpoints"]["docker"][
        "Host"
    ]
    if not host.startswith(("unix:///", "npipe:////./pipe/")):
        parser.error("Local Docker socket context required; remote endpoints refused")
    CONTEXT = context
    IMAGE, REVISION = args.image, args.revision
    evidence["revision"] = REVISION
    args.evidence.parent.mkdir(parents=True, exist_ok=True)
    # Check artifact writability before creating infrastructure.
    args.evidence.write_text(json.dumps(evidence) + "\n")

    def interrupted(signum, frame):
        raise KeyboardInterrupt

    previous = signal.signal(signal.SIGTERM, interrupted)
    try:
        main()
    except (Exception, KeyboardInterrupt) as exc:
        evidence["status"] = "failed"
        evidence["error_type"] = type(
            exc
        ).__name__  # no API tokens, URLs or command stderr
    finally:
        signal.signal(signal.SIGTERM, previous)
        try:
            evidence["cleanup"] = cleanup()
            if not all(row["removed"] for row in evidence["cleanup"]):
                evidence["status"] = "failed"
        except Exception as exc:
            evidence["status"] = "failed"
            evidence["cleanup_error_type"] = type(exc).__name__
        args.evidence.write_text(json.dumps(evidence, indent=2) + "\n")
    print("Evidence: " + str(args.evidence))
    return 0 if evidence.get("status") == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(cli())
