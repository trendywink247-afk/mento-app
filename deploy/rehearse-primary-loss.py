"""Local synthetic primary-loss rehearsal. Never accepts live resources or keys."""

import argparse
import gzip
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import tempfile
import time
import uuid

if not __debug__:
    raise RuntimeError("Rehearsal proof requires Python assertions enabled")

ROOT = Path(__file__).resolve().parents[1]
LABEL = "org.mento.synthetic.primary-loss"
RESOURCE_LABEL = LABEL + ".resource"


def command(args, *, data=None, timeout=120, env=None):
    result = subprocess.run(args, input=data, capture_output=True, timeout=timeout, env=env)
    if result.returncode:
        raise RuntimeError("Synthetic command failed; captured output suppressed")
    return result.stdout


def require_local_docker_host(host):
    if (
        not isinstance(host, str)
        or re.fullmatch(r"(?:unix:///[^\r\n?]+|npipe:////\./pipe/[A-Za-z0-9_.-]+)", host) is None
    ):
        raise ValueError("Only a local Docker socket is permitted")


def source_evidence():
    def git(*args):
        return command(["git", "-C", str(ROOT), *args]).decode().strip()

    if git("status", "--porcelain", "--", "services/api/app", "services/api/migrations"):
        raise ValueError("Tracked app and migrations must be clean")
    files = [
        "deploy/rehearse-primary-loss.py",
        "deploy/primary-loss-fixture.py",
        "deploy/export-recovery-snapshot.sh",
    ]
    return {
        "revision": git("rev-parse", "HEAD"),
        "tracked_dirty": bool(git("status", "--porcelain", "--untracked-files=no")),
        "app_migrations_clean": True,
        "file_sha256": {
            name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in files
        },
    }


class Resources:
    """Deletion requires this run's label AND the originally observed identity."""

    def __init__(self, run, execute):
        if not re.fullmatch(r"mento-primary-loss-[0-9a-f]{32}", run):
            raise ValueError("Invalid synthetic run identity")
        self.run, self.execute, self.owned = run, execute, []

    def inspect(self, kind, name):
        return json.loads(self.execute(kind, "inspect", name))[0]

    def identity(self, kind, name, nonce):
        info = self.inspect(kind, name)
        labels = info["Config"].get("Labels", {}) if kind == "container" else info.get("Labels", {})
        if labels.get(LABEL) != self.run or labels.get(RESOURCE_LABEL) != nonce:
            raise ValueError("Resource ownership differs")
        return info["Id"] if kind != "volume" else (info["Name"], info["CreatedAt"], nonce)

    def create(self, kind, name, arguments):
        if not name.startswith(self.run + "-"):
            raise ValueError("Resource name outside synthetic run")
        nonce = uuid.uuid4().hex
        # Labels are inserted by this wrapper, never supplied by the caller.
        arguments = [
            *arguments,
            "--label",
            LABEL + "=" + self.run,
            "--label",
            RESOURCE_LABEL + "=" + nonce,
            name,
        ]
        try:
            self.execute(*arguments)
        finally:
            identity = self.identity(kind, name, nonce)
            self.owned.append((kind, name, nonce, identity))
        return identity

    def register_container(self, name, arguments):
        if not name.startswith(self.run + "-"):
            raise ValueError("Resource name outside synthetic run")
        nonce = uuid.uuid4().hex
        try:
            self.execute(
                "run",
                "-d",
                "--name",
                name,
                "--label",
                LABEL + "=" + self.run,
                "--label",
                RESOURCE_LABEL + "=" + nonce,
                *arguments,
            )
        finally:
            identity = self.identity("container", name, nonce)
            self.owned.append(("container", name, nonce, identity))
        info = self.inspect("container", name)
        if info["HostConfig"].get("PortBindings"):
            raise ValueError("Synthetic container exposed host ports")
        return identity

    def checked_identity(self, kind, name):
        record = next(record for record in self.owned if record[:2] == (kind, name))
        _, _, nonce, original = record
        if self.identity(kind, name, nonce) != original:
            raise ValueError("Resource identity changed")
        return original

    def remove(self, kind, name):
        record = next(record for record in self.owned if record[:2] == (kind, name))
        _, _, nonce, original = record
        if self.identity(kind, name, nonce) != original:
            raise ValueError("Resource identity changed")
        self.execute(
            kind,
            "rm",
            *(["-f"] if kind == "container" else []),
            name if kind == "volume" else original,
        )
        self.owned.remove(record)

    def cleanup(self):
        failures = []
        for kind, name, _nonce, _identity in list(reversed(self.owned)):
            try:
                self.remove(kind, name)
            except Exception:
                failures.append(kind)
        # A successful daemon listing is required; a daemon error is not absence.
        for arguments in [("container", "ls", "-a"), ("volume", "ls"), ("network", "ls")]:
            if self.execute(
                *arguments,
                "--filter",
                "label=" + LABEL + "=" + self.run,
                "--format",
                "{{.Name}}" if arguments[0] != "container" else "{{.Names}}",
            ):
                failures.append(arguments[0])
        if failures:
            raise RuntimeError("Synthetic cleanup incomplete; no unowned resource was removed")


def require_source_loss(resources, container, volume):
    resources.remove("container", container)
    resources.remove("volume", volume)
    containers = resources.execute("container", "ls", "-a", "--format", "{{.Names}}").splitlines()
    volumes = resources.execute("volume", "ls", "--format", "{{.Name}}").splitlines()
    if container in containers or volume in volumes:
        raise RuntimeError("Source destruction not confirmed")


def cleanup_private_work(directory):
    boundary = (ROOT / ".local/tmp").resolve()
    resolved = directory.resolve()
    if (
        directory.is_symlink()
        or resolved.parent != boundary
        or not resolved.name.startswith("primary-loss-")
    ):
        raise ValueError("Private fixture cleanup outside temporary boundary")
    shutil.rmtree(directory)


class Rehearsal:
    def __init__(self, app_image, receiver_image, bash, age, keygen, context=None):
        self.run = "mento-primary-loss-" + uuid.uuid4().hex
        if os.environ.get("DOCKER_HOST"):
            require_local_docker_host(os.environ["DOCKER_HOST"])
        self.context = (
            context
            or os.environ.get("DOCKER_CONTEXT")
            or command(["docker", "context", "show"]).decode().strip()
        )
        endpoint = json.loads(command(["docker", "context", "inspect", self.context]))[0][
            "Endpoints"
        ]["docker"]["Host"]
        require_local_docker_host(endpoint)
        source = source_evidence()
        self.resources = Resources(self.run, self.docker)
        self.app_image = self.pin(app_image)
        self.receiver_image = self.pin(receiver_image)
        self.pg_image = self.pin("postgres:16-alpine")
        self.bash, self.age, self.keygen = bash, age, keygen
        temporary = ROOT / ".local/tmp"
        temporary.mkdir(parents=True, exist_ok=True)
        self.work = Path(tempfile.mkdtemp(prefix="primary-loss-", dir=temporary))
        self.fixture_work = self.work / "app-fixtures"
        self.fixture_work.mkdir()
        self.network = self.run + "-net"
        self.password = secrets.token_hex(24)
        self.token = secrets.token_hex(32)
        self.evidence = {
            "run": self.run,
            "source": source,
            "docker_endpoint": endpoint,
            "checks": [],
            "coverage": "synthetic-local-only",
            "images": {
                "app": self.app_image,
                "receiver": self.receiver_image,
                "postgres": self.pg_image,
            },
            "limitations": [
                "Not historical/live receipt coverage or operational host-loss acceptance.",
                "Independent container/volume remains on this local Docker host, not another fault domain.",
                "Synthetic keys and CA only; no real-key custody, off-host transfer or production activation.",
            ],
        }

    def docker(self, *args, data=None, timeout=120):
        prefix = ["docker", "--context", self.context] if self.context else ["docker"]
        return command([*prefix, *args], data=data, timeout=timeout).decode().strip()

    def pin(self, image):
        return json.loads(self.docker("image", "inspect", image))[0]["Id"]

    def passed(self, name):
        self.evidence["checks"].append(name)
        print("PASS " + name, flush=True)

    def volume(self, name):
        return self.resources.create("volume", name, ["volume", "create"])

    def container(
        self,
        name,
        image,
        *,
        args=(),
        env=None,
        mounts=(),
        entrypoint=None,
        network=None,
        readonly=False,
    ):
        arguments = [
            "--pull",
            "never",
            "--network",
            network or self.network,
            "--memory",
            "512m",
            "--cpus",
            "1",
            "--pids-limit",
            "128",
            "--cap-drop",
            "ALL",
            "--security-opt",
            "no-new-privileges",
        ]
        # PostgreSQL's own entrypoint needs to prepare its newly allocated data dir.
        if image == self.pg_image:
            arguments[arguments.index("--cap-drop") + 1] = "NET_RAW"
        if readonly:
            arguments += ["--read-only", "--tmpfs", "/tmp:size=16m,mode=1777"]
        for mount in mounts:
            arguments += ["--mount", mount]
        for key, value in (env or {}).items():
            arguments += ["-e", key + "=" + value]
        if entrypoint:
            arguments += ["--entrypoint", entrypoint]
        return self.resources.register_container(name, [*arguments, image, *args])

    def finished(self, name):
        deadline = time.monotonic() + 180
        while time.monotonic() < deadline:
            state = self.resources.inspect("container", name)["State"]
            if not state["Running"]:
                if state["ExitCode"]:
                    raise RuntimeError("Synthetic fixture stage failed: " + name.rsplit("-", 1)[-1])
                return
            time.sleep(0.25)
        raise RuntimeError("Synthetic fixture stage timed out")

    def app(self, stage, database=None, extra=None):
        env = {
            "ENV": "dev",
            "MENTO_SYNTHETIC_REHEARSAL": self.run,
            "JWT_SECRET": "synthetic-rehearsal-member",
            "ADMIN_JWT_SECRET": "synthetic-rehearsal-admin",
            "LISTENER_JWT_SECRET": "synthetic-rehearsal-listener",
            "PUSH_ENABLED": "false",
            "STREAM_API_KEY": "",
            "STREAM_API_SECRET": "",
            "SENTRY_DSN": "",
            "REDIS_URL": "redis://127.0.0.1:6379/0",
            "RECOVERY_RECEIPT_REQUIRED": "false",
            "PYTHONDONTWRITEBYTECODE": "1",
            "PYTHONOPTIMIZE": "",
            "PYTHONPATH": "/rehearsal/services/api",
        }
        if database:
            env["DATABASE_URL"] = (
                "postgresql+psycopg://mento:" + self.password + "@" + database + "/mento"
            )
        env.update(extra or {})
        mounts = [
            "type=bind,source="
            + str(ROOT / "services/api")
            + ",target=/rehearsal/services/api,readonly",
            "type=bind,source=" + str(ROOT / "scripts") + ",target=/rehearsal/scripts,readonly",
            "type=bind,source="
            + str(ROOT / "deploy/primary-loss-fixture.py")
            + ",target=/rehearsal/deploy/primary-loss-fixture.py,readonly",
            "type=bind,source=" + str(ROOT / "services/api/app") + ",target=/app/app,readonly",
            "type=bind,source="
            + str(ROOT / "services/api/migrations")
            + ",target=/app/migrations,readonly",
            "type=bind,source=" + str(self.fixture_work) + ",target=/evidence",
        ]
        name = self.run + "-" + stage
        args = (
            ("-m", "alembic", "upgrade", "head")
            if stage == "migrate"
            else ("/rehearsal/deploy/primary-loss-fixture.py", stage)
        )
        self.container(
            name,
            self.app_image,
            args=args,
            env=env,
            mounts=mounts,
            entrypoint="python",
            network="none" if stage == "tls" else self.network,
        )
        self.finished(name)

    def postgres(self, name, volume):
        self.container(
            name,
            self.pg_image,
            env={
                "POSTGRES_USER": "mento",
                "POSTGRES_DB": "mento",
                "POSTGRES_PASSWORD": self.password,
                "PGPASSWORD": self.password,
            },
            mounts=["type=volume,source=" + volume + ",target=/var/lib/postgresql/data"],
        )
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            try:
                self.docker(
                    "exec", name, "pg_isready", "-h", "127.0.0.1", "-U", "mento", "-d", "mento"
                )
                if (
                    self.docker(
                        "exec",
                        name,
                        "psql",
                        "-X",
                        "-h",
                        "127.0.0.1",
                        "-U",
                        "mento",
                        "-d",
                        "mento",
                        "-Atc",
                        "SELECT 1",
                    )
                    == "1"
                ):
                    return
            except RuntimeError:
                pass
            time.sleep(0.5)
        raise RuntimeError("Synthetic PostgreSQL readiness timed out")

    def receiver_export(self):
        # Authenticated local Docker administration, not a public HTTP read endpoint.
        return self.docker(
            "exec",
            self.resources.checked_identity("container", self.run + "-receiver"),
            "python",
            "-c",
            "from pathlib import Path; from recovery_receiver.store import Store,canonical; "
            "print(canonical(Store(Path('/data/receipts.sqlite3')).export()).decode())",
        ).encode()

    def execute(self):
        resources = self.resources
        resources.create("network", self.network, ["network", "create", "--internal"])
        assert resources.inspect("network", self.network)["Internal"] is True
        source, source_volume = self.run + "-source", self.run + "-source-data"
        receiver_volume = self.run + "-receiver-data"
        self.volume(source_volume)
        self.volume(receiver_volume)
        self.app("tls")
        self.postgres(source, source_volume)
        self.app("migrate", source)
        self.app("seed", source)
        self.evidence["source_container_id"] = resources.checked_identity("container", source)
        self.evidence["source_volume"] = list(resources.checked_identity("volume", source_volume))[
            :2
        ]
        self.passed(
            "full migrated synthetic database contains two accounts, saved notes, credentials and chat"
        )
        key, recipient, archive = (
            self.work / "synthetic.agekey",
            self.work / "recipients.txt",
            self.work / "snapshot.age",
        )
        command([self.keygen, "-o", str(key)])
        recipient.write_bytes(command([self.keygen, "-y", str(key)]))
        environment = {
            **os.environ,
            "PATH": str(Path(self.age).parent) + os.pathsep + os.environ["PATH"],
            "MSYS_NO_PATHCONV": "1",
            "DOCKER_CONTEXT": self.context,
        }
        snapshot = self.work / "snapshot.sql.gz"
        command(
            [
                self.bash,
                str(ROOT / "deploy/export-recovery-snapshot.sh").replace("\\", "/"),
                resources.checked_identity("container", source),
                "mento",
                "mento",
                snapshot.as_posix(),
            ],
            env=environment,
            timeout=180,
        )
        gzip.decompress(snapshot.read_bytes())  # reject malformed plaintext before encryption
        partial = self.work / "encrypted.partial"
        command(
            [
                self.age,
                "--encrypt",
                "--recipients-file",
                str(recipient),
                "--output",
                str(partial),
                str(snapshot),
            ]
        )
        with partial.open("r+b") as handle:
            os.fsync(handle.fileno())
        os.link(partial, archive)  # exclusive publication, even if another writer races
        partial.unlink()
        snapshot.unlink()  # no plaintext snapshot survives to the primary-loss phase
        assert archive.read_bytes().startswith(b"age-encryption.org/v1")
        archive_hash = hashlib.sha256(archive.read_bytes()).hexdigest()
        self.evidence["archive_sha256"] = archive_hash
        self.passed(
            "real locked PostgreSQL snapshot encrypted with synthetic age recipient outside source volume"
        )
        mount = "type=volume,source=" + receiver_volume + ",target=/data"
        init = self.run + "-receiver-init"
        self.container(
            init,
            self.receiver_image,
            args=("init", "--database", "/data/receipts.sqlite3"),
            mounts=[mount],
            network="none",
        )
        self.finished(init)
        receiver = self.run + "-receiver"
        serve = "from pathlib import Path;import os,uvicorn;from recovery_receiver.receiver import create_app;uvicorn.run(create_app(Path('/data/receipts.sqlite3'),os.environ['RECEIVER_TOKEN']),host='0.0.0.0',port=18090,access_log=False,ssl_keyfile='/tls/key.pem',ssl_certfile='/tls/cert.pem')"
        self.container(
            receiver,
            self.receiver_image,
            args=("-c", serve),
            env={"RECEIVER_TOKEN": self.token},
            entrypoint="python",
            readonly=True,
            mounts=[
                mount,
                "type=bind,source=" + str(self.fixture_work / "tls") + ",target=/tls,readonly",
            ],
        )
        # Ready means HTTPS is accepting connections; never publish a host port.
        probe = "import socket;socket.create_connection(('127.0.0.1',18090),timeout=1).close()"
        deadline = time.monotonic() + 30
        while True:
            try:
                self.docker("exec", receiver, "python", "-c", probe)
                break
            except RuntimeError:
                if time.monotonic() >= deadline:
                    raise RuntimeError("Synthetic receiver readiness timed out")
                time.sleep(0.5)
        self.app(
            "erase",
            source,
            {
                "RECOVERY_RECEIPT_REQUIRED": "true",
                "RECOVERY_RECEIPT_URL": "https://" + receiver + ":18090/receipts",
                "RECOVERY_RECEIPT_TOKEN": self.token,
            },
        )
        raw = self.receiver_export()
        (self.fixture_work / "receipts.json").write_bytes(raw)
        spec = importlib.util.spec_from_file_location(
            "primary_loss_evidence", ROOT / "scripts/recovery_receipt_evidence.py"
        )
        evidence_module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(evidence_module)
        witness_hash = evidence_module.checkpoint(
            self.fixture_work / "receipts.json", self.fixture_work / "checkpoint.json"
        )
        self.evidence["checkpoint_sha256"] = witness_hash
        assert (
            len(
                evidence_module.verify(
                    self.fixture_work / "receipts.json",
                    self.fixture_work / "checkpoint.json",
                    witness_hash,
                )
            )
            == 1
        )
        self.passed(
            "post-snapshot erasure durably acknowledged over synthetic HTTPS; full witness pinned before loss"
        )
        require_source_loss(resources, source, source_volume)
        self.passed(
            "source PostgreSQL container AND data volume destroyed and absent before restoration"
        )
        self.docker("restart", resources.checked_identity("container", receiver))
        after_restart = json.loads(self.receiver_export())
        before = json.loads(raw)
        assert all(
            after_restart[field] == before[field]
            for field in ["store_id", "receipts", "high_water", "receipt_count"]
        )
        self.passed("independent receiver receipt survives source destruction and receiver restart")
        assert hashlib.sha256(archive.read_bytes()).hexdigest() == archive_hash
        restored_dump = self.work / "restored.sql.gz"
        command([self.age, "--decrypt", "-i", str(key), "-o", str(restored_dump), str(archive)])
        dump = gzip.decompress(restored_dump.read_bytes())
        assert b"SYNTHETIC_RETAINED_NOTE" in dump and b"EXCLUDED_SYNTHETIC_CHAT" not in dump
        restored, restored_volume = self.run + "-restored", self.run + "-restored-data"
        self.volume(restored_volume)
        self.postgres(restored, restored_volume)
        self.evidence["restored_container_id"] = resources.checked_identity("container", restored)
        assert self.evidence["restored_container_id"] != self.evidence["source_container_id"]
        self.evidence["restored_volume"] = list(
            resources.checked_identity("volume", restored_volume)
        )[:2]
        self.docker(
            "exec",
            "-i",
            restored,
            "psql",
            "-X",
            "-v",
            "ON_ERROR_STOP=1",
            "-U",
            "mento",
            "-d",
            "mento",
            data=dump,
        )
        self.passed(
            "pinned encrypted archive decrypted and restored into a newly created isolated database"
        )
        self.app("replay", restored, {"TRUSTED_CHECKPOINT_SHA256": witness_hash})
        if source_evidence() != self.evidence["source"]:
            raise ValueError("Rehearsal source changed during execution")
        self.passed(
            "full trusted witness removes resurrected account, notes, refresh/recovery credentials and room"
        )
        self.passed(
            "retained account, note, room and credentials preserved; replay idempotent; chat rows absent"
        )


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app-image", required=True)
    parser.add_argument("--receiver-image", required=True)
    parser.add_argument("--bash", default=shutil.which("bash"))
    parser.add_argument("--age", default=shutil.which("age"))
    parser.add_argument("--age-keygen", default=shutil.which("age-keygen"))
    parser.add_argument("--docker-context")
    args = parser.parse_args(argv)
    if not all([args.bash, args.age, args.age_keygen]):
        parser.error("explicit Bash, age and age-keygen tools are required")
    rehearsal = Rehearsal(
        args.app_image,
        args.receiver_image,
        args.bash,
        args.age,
        args.age_keygen,
        args.docker_context,
    )
    success = cleaned = private_cleaned = False
    try:
        rehearsal.execute()
        success = True
    finally:
        try:
            rehearsal.resources.cleanup()
            cleaned = True
            rehearsal.passed(
                "all uniquely labeled synthetic containers, volumes and network removed"
            )
        finally:
            try:
                cleanup_private_work(rehearsal.work)
                private_cleaned = True
            finally:
                rehearsal.evidence["passed"] = success and cleaned and private_cleaned
                rehearsal.evidence["cleanup_complete"] = cleaned
                rehearsal.evidence["private_fixture_cleanup_complete"] = private_cleaned
                directory = ROOT / ".local/primary-loss"
                directory.mkdir(parents=True, exist_ok=True)
                (directory / (rehearsal.run + ".json")).write_text(
                    json.dumps(rehearsal.evidence, indent=2) + "\n", encoding="utf-8"
                )
    print(
        "PASS synthetic local primary-loss rehearsal; historical/live coverage remains unverified",
        flush=True,
    )


if __name__ == "__main__":
    main()
