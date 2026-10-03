#!/usr/bin/env python3
"""Install root-owned, outside the checkout; expose only via a forced SSH command.

sudo /usr/local/lib/mento-release/ci-receiver.py staging|production
Never accept a client-supplied environment or execute scripts from an upload.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import tarfile
import tempfile
import time


def run(*args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def extract(archive, target, allowed=None):
    with tarfile.open(archive, "r:gz") as source:
        members = []
        for member in source:
            members.append(member)
            if len(members) > (16 if allowed is not None else 100000):
                raise ValueError("Archive has too many entries")
        if sum(member.size for member in members) > 2 * 1024**3:
            raise ValueError("Expanded archive exceeds 2 GiB")
        for member in members:
            path = Path(member.name)
            if path.is_absolute() or ".." in path.parts or not (member.isfile() or member.isdir()):
                raise ValueError("Unsafe archive entry")
            if member.isfile() and allowed is not None and str(path) not in allowed:
                raise ValueError("Unexpected candidate file")
            if member.isdir() and allowed is not None and str(path) != ".":
                raise ValueError("Unexpected candidate directory")
        for member in members:
            destination = target / member.name
            if member.isdir():
                destination.mkdir(parents=True, exist_ok=True)
            else:
                destination.parent.mkdir(parents=True, exist_ok=True)
                with source.extractfile(member) as src, destination.open("wb") as dst:
                    shutil.copyfileobj(src, dst)
                destination.chmod(0o644)


def verify_candidate(candidate, sha):
    manifest = json.loads((candidate / "release.json").read_text())
    if manifest["sha"] != sha or not re.fullmatch(r"sha256:[0-9a-f]{64}", manifest["image"]):
        raise ValueError("Invalid candidate identity")
    expected = {"api-image.tar.gz", "web-staging.tar.gz", "web-production.tar.gz",
                "release.json", "checks.json", "image-id.txt"}
    hashes = {}
    for line in (candidate / "SHA256SUMS").read_text().splitlines():
        digest, name = line.split("  ", 1)
        if name not in expected or name in hashes or not re.fullmatch(r"[0-9a-f]{64}", digest):
            raise ValueError("Invalid checksum manifest")
        hashes[name] = digest
    if set(hashes) != expected:
        raise ValueError("Incomplete checksum manifest")
    for name, digest in hashes.items():
        with (candidate / name).open("rb") as source:
            actual = hashlib.file_digest(source, "sha256").hexdigest()
        if actual != digest:
            raise ValueError(f"Checksum mismatch: {name}")
    return manifest


def verify_image_archive(archive, sha):
    # Docker's classic and containerd stores expose different native image IDs.
    # The checksummed archive is portable; require it to import exactly our tag.
    with tarfile.open(archive, "r:gz") as source:
        manifest = json.load(source.extractfile("manifest.json"))
        if len(manifest) != 1 or manifest[0].get("RepoTags") != [f"mento-api:{sha[:12]}"]:
            raise ValueError("Image archive must contain exactly the candidate tag")
        config = json.load(source.extractfile(manifest[0]["Config"]))
        if config.get("config", {}).get("Labels", {}).get("org.opencontainers.image.revision") != sha:
            raise ValueError("Archived image source revision differs from candidate")


def verify_production_runtime(expected_image):
    """Reject API-only releases; the current production topology has one worker."""
    for name in ("mento-api-prod", "mento-worker-prod"):
        state = json.loads(subprocess.check_output(
            ["docker", "inspect", name], text=True))[0]
        if state["Image"] != expected_image or not state["State"]["Running"]:
            raise ValueError(f"{name} is not running the accepted image")
    # Queue heartbeat proves database participation, not successful delivery of
    # every job. Per-worker identity is required before introducing replicas.
    probe = (
        "from app.db import SessionLocal; from app.jobs.health import queue_health; "
        "db=SessionLocal(); result=queue_health(db); db.close(); "
        "raise SystemExit(0 if result.get('worker_alive') else 1)"
    )
    run("docker", "exec", "mento-worker-prod", "python", "-c", probe)


def require_production_enabled(path):
    """An operator-owned server gate complements the GitHub readiness switch."""
    if path.is_symlink() or not path.is_file():
        raise ValueError("Production promotion remains locked on this server")
    state = path.stat()
    if state.st_uid != 0 or state.st_mode & 0o022 or path.read_text().strip() != "enabled":
        raise ValueError("Production gate must be root-owned, non-writable by others and explicitly enabled")


def main():
    import fcntl  # Linux server only; archive validation is testable on Windows.

    os.umask(0o077)
    def interrupted(_signal, _frame):
        raise RuntimeError("Release interrupted; restoring previous runtime")
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGHUP, interrupted)
    environment = sys.argv[1]
    if environment not in {"staging", "production"}:
        raise ValueError("Invalid installed environment")
    words = os.environ.get("SSH_ORIGINAL_COMMAND", "").split()
    if len(words) != 2 or words[0] not in {"receive", "deploy", "accept", "verify", "fixture", "cleanup"} or not re.fullmatch(r"[0-9a-f]{40}", words[1]):
        raise ValueError("Expected receive|deploy|accept|verify followed by a full SHA")
    operation, sha = words
    if environment == "production" and operation == "deploy":
        require_production_enabled(Path("/etc/mento-release/production-enabled"))
    base = Path("/opt/mento-staging" if environment == "staging" else "/opt/mento-release")
    base.mkdir(exist_ok=True)
    with (base / "ci.lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        candidate = base / "candidates" / sha
        candidate.parent.mkdir(exist_ok=True)
        if operation == "receive":
            if shutil.disk_usage(base).free < 8 * 1024**3:
                raise ValueError("Less than 8 GiB free; review retained release artifacts before retrying")
            with tempfile.TemporaryDirectory(dir=base) as temp:
                temp = Path(temp)
                archive = temp / "candidate.tgz"
                total = 0
                with archive.open("wb") as target:
                    while chunk := sys.stdin.buffer.read(1024 * 1024):
                        total += len(chunk)
                        if total > 2 * 1024**3:
                            raise ValueError("Upload exceeds 2 GiB")
                        target.write(chunk)
                files = temp / "files"
                files.mkdir()
                extract(archive, files, {"api-image.tar.gz", "web-staging.tar.gz", "web-production.tar.gz",
                                         "release.json", "checks.json", "image-id.txt", "SHA256SUMS"})
                verify_candidate(files, sha)
                if candidate.exists():
                    verify_candidate(candidate, sha)
                    if (files / "SHA256SUMS").read_bytes() != (candidate / "SHA256SUMS").read_bytes():
                        raise ValueError("Existing candidate is immutable and differs from upload")
                else:
                    files.rename(candidate)
            print("Candidate received and verified")
            return

        manifest = verify_candidate(candidate, sha)
        image = f"mento-api:{sha[:12]}"
        runtime_ids = base / "runtime-image-ids"
        runtime_ids.mkdir(exist_ok=True)
        runtime_id = runtime_ids / sha
        os.chdir(base)
        dc = ["docker", "compose", "-f", str(base / "compose.yml"), "-f", str(base / "ci.override.yml")]
        if operation in {"fixture", "cleanup"}:
            if environment != "staging":
                raise ValueError("Fixtures are staging-only")
            snapshot = base / "fixture-state.json"
            if operation == "fixture":
                if snapshot.exists():
                    raise ValueError("Previous fixture needs cleanup before another run")
                if (base / "current-sha").read_text().strip() != sha:
                    raise ValueError("Candidate is not deployed")
            elif not snapshot.exists():
                return
            script = Path("/usr/local/lib/mento-release/ci-fixture.py").read_text()
            command = [*dc, "exec", "-T", "api", "python", "-c", script]
            if operation == "fixture":
                state = json.loads(subprocess.check_output(command, input=json.dumps({"operation": "plan"}), text=True))
                state["sha"] = sha
                # Persist recovery state BEFORE changing mentor availability.
                snapshot.write_text(json.dumps(state))
                with snapshot.open("rb") as saved:
                    os.fsync(saved.fileno())
                fixture = json.loads(subprocess.check_output(command, input=json.dumps({"operation": "create", "state": state}), text=True))
                print(json.dumps({"id": fixture["id"], "url": fixture["url"]}))
            else:
                state = json.loads(snapshot.read_text())
                if state["sha"] != sha:
                    raise ValueError("Cleanup belongs to a different release")
                subprocess.check_output(command, input=json.dumps({"operation": "cleanup", "state": state}), text=True)
                snapshot.unlink()
                print("Staging mentor availability restored; synthetic token revoked")
            return
        if operation in {"accept", "verify"}:
            if environment != "staging":
                raise ValueError("Acceptance is staging-only")
            if (base / "current-sha").read_text().strip() != sha:
                raise ValueError("Staging has changed since this candidate was deployed")
            for service in ("api", "worker"):
                cid = subprocess.check_output([*dc, "ps", "-q", service], text=True).strip()
                actual = subprocess.check_output(["docker", "inspect", "--format", "{{.Image}}", cid], text=True).strip()
                if actual != runtime_id.read_text().strip():
                    raise ValueError("Running image differs from candidate")
            if operation == "accept":
                run(*dc, "exec", "-T", "api", "alembic", "check")
                # Installed, reviewed safety script; never execute uploaded code.
                with Path("/usr/local/lib/mento-release/verify-safety.py").open("rb") as source:
                    run(*dc, "exec", "-T", "api", "python", stdin=source)
                run("bash", "/usr/local/lib/mento-release/restore-drill.sh", env={**os.environ, "RESTORE_IMAGE": image})
            print("Staging candidate verified")
            return

        if (base / "fixture-state.json").exists():
            raise ValueError("Restore outstanding staging fixture before another deployment")
        verify_image_archive(candidate / "api-image.tar.gz", sha)
        run("docker", "load", "--input", str(candidate / "api-image.tar.gz"))
        actual = subprocess.check_output(["docker", "image", "inspect", image, "--format", "{{.Id}}"], text=True).strip()
        if not re.fullmatch(r"sha256:[0-9a-f]{64}", actual):
            raise ValueError("Loaded image has no content identity")
        revision = subprocess.check_output(["docker", "image", "inspect", image, "--format",
                                            '{{index .Config.Labels "org.opencontainers.image.revision"}}'], text=True).strip()
        if revision != sha:
            raise ValueError("Image source revision differs from candidate")
        runtime_id.write_text(actual + "\n")
        webbase = base if environment == "staging" else Path("/opt/mento-console")
        release = webbase / "web-releases" / sha
        if not release.exists():
            release.mkdir(parents=True)
            try:
                extract(candidate / f"web-{environment}.tar.gz", release)
                if not (release / "index.html").is_file():
                    raise ValueError("Web export has no index")
                # Only public web assets are readable by Nginx; API archives and
                # backups inherit the private process umask.
                release.chmod(0o755)
                release.parent.chmod(0o755)
                for directory in release.rglob("*"):
                    if directory.is_dir():
                        directory.chmod(0o755)
            except Exception:
                shutil.rmtree(release)
                raise
        current = webbase / ("web" if environment == "staging" else "current")
        if current.exists() and not current.is_symlink():
            raise ValueError("Convert legacy web directory to a release symlink before enabling CI")
        old_web = current.resolve() if current.exists() else None
        override = base / "ci.override.yml"
        old_override = override.read_text() if override.exists() else None
        production_api_changed = False
        try:
            if environment == "staging":
                # Back up before a migration; do not print database contents.
                backups = base / "predeploy-backups"
                backups.mkdir(mode=0o700, exist_ok=True)
                with (backups / f"{sha}-{time.time_ns()}.sql").open("xb") as backup:
                    run("docker", "compose", "-f", str(base / "compose.yml"), "exec", "-T", "postgres",
                        "pg_dump", "-U", "mento_staging", "-d", "mento_staging", stdin=subprocess.DEVNULL, stdout=backup)
                override.write_text("services:\n" + "".join(f"  {service}:\n    image: {image}\n" for service in ("api", "worker", "migrate")))
                override.chmod(0o644)  # image tags only; operator Compose reads remain usable
                run(*dc, "run", "--rm", "--no-deps", "migrate")
                run(*dc, "up", "-d", "--wait", "--wait-timeout", "120", "api", "worker")
            else:
                # The existing operator script checks master ancestry, backs up,
                # migrates once and reuses the preloaded SHA-tagged image.
                run("sudo", "-Hu", "mento-ops", "env", f"SSH_ORIGINAL_COMMAND=deploy {sha}",
                    "bash", "/opt/mento/deploy/deploy.sh", "--from-ssh")
                production_api_changed = True
                for attempt in range(12):
                    try:
                        verify_production_runtime(actual)
                        break
                    except (ValueError, subprocess.CalledProcessError):
                        if attempt == 11:
                            raise
                        time.sleep(5)
            next_link = webbase / "ci-next"
            next_link.unlink(missing_ok=True)
            next_link.symlink_to(release, target_is_directory=True)
            next_link.replace(current)
            health = "http://127.0.0.1:18010/api/v1/health/ready" if environment == "staging" else "https://api.mento.chat/api/v1/health/ready"
            run("curl", "--fail", "--silent", "--retry", "5", "--retry-delay", "2", "--output", "/dev/null", health)
            (base / "current-sha").write_text(sha + "\n")
            if old_web:
                (base / "previous-web").write_text(str(old_web) + "\n")
        except Exception:
            # Complete recovery even if the SSH caller sends another interruption.
            signal.signal(signal.SIGTERM, signal.SIG_IGN)
            signal.signal(signal.SIGHUP, signal.SIG_IGN)
            if old_web:
                rollback = webbase / "ci-rollback"
                rollback.unlink(missing_ok=True)
                rollback.symlink_to(old_web, target_is_directory=True)
                rollback.replace(current)
            if environment == "staging":
                if old_override is None:
                    override.unlink(missing_ok=True)
                    run("docker", "compose", "-f", str(base / "compose.yml"), "up", "-d", "--wait", "--wait-timeout", "120", "api", "worker")
                else:
                    override.write_text(old_override)
                    run(*dc, "up", "-d", "--wait", "--wait-timeout", "120", "api", "worker")
            elif production_api_changed:
                run("sudo", "-Hu", "mento-ops", "bash", "/opt/mento/deploy/deploy.sh", "--rollback")
            # Schema rollback is never automatic: migrations must be expand/contract.
            raise
        print(f"Deployed {environment} candidate {sha}")


if __name__ == "__main__":
    main()
