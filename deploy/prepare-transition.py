"""Locked, read-only transition preparation; never activate a serving service."""

import argparse
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import sys
from contextlib import contextmanager

spec = importlib.util.spec_from_file_location(
    "transition_preflight", Path(__file__).with_name("transition-preflight.py")
)
preflight = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preflight)


@contextmanager
def deploy_lock(directory):
    import fcntl

    directory = Path(directory)
    info = directory.stat()
    if (
        directory.is_symlink()
        or not directory.is_dir()
        or info.st_uid != os.geteuid()
        or stat.S_IMODE(info.st_mode) & 0o022
    ):
        raise ValueError("Operator-owned state directory required")
    descriptor = os.open(
        directory / "deploy.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600
    )
    with os.fdopen(descriptor, "r+") as lock:
        info = os.fstat(lock.fileno())
        if info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) & 0o022:
            raise ValueError("Unsafe deployment lock")
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield


def release_identity(release):
    if not re.fullmatch(r"[0-9a-f]{40}", release["sha"]) or not re.fullmatch(
        r"sha256:[0-9a-f]{64}", release["runtime_image_id"]
    ):
        raise ValueError("Exact accepted runtime image and SHA required")
    image = json.loads(
        preflight.run(
            ["docker", "image", "inspect", "mento-api:" + release["sha"][:12]]
        )
    )
    if (
        len(image) != 1
        or image[0]["Id"] != release["runtime_image_id"]
        or image[0]["Config"].get("Labels", {}).get("org.opencontainers.image.revision")
        != release["sha"]
    ):
        raise ValueError("Loaded image provenance differs")
    return "mento-api:" + release["sha"][:12]


def prepare(expected, config, release, state_dir, *, headroom, other_connections):
    # Use precisely the existing deployment lock inode/name. An independent lock
    # would allow preparation to race the old deployment path.
    with deploy_lock(state_dir):
        image = release_identity(release)
        for name in ("api_blue", "api_green", "worker", "migrate"):
            if config["services"][name].get("image") != image:
                raise ValueError("Candidate services do not use the accepted image")
        budget = preflight.validate_candidate(
            config,
            expected,
            preflight.collect(expected),
            headroom=headroom,
            other_connections=other_connections,
        )
        return dict(
            version=1,
            status="prepared_only",
            sha=release["sha"],
            runtime_image_id=release["runtime_image_id"],
            budget=budget,
            stages=[
                "Accept backup/recovery, old-client migration compatibility, resource/load and edge rollback evidence",
                "Acquire the same deployment lock and rerun identity, inventory, image and live budget preflight",
                "Run one-off migration against the retained database; preserve old API and retained data services",
                "Start one accepted API candidate with no dependencies; verify identity, readiness and database connectivity",
                "Fence the previous periodic scheduler, then start and verify the accepted single worker",
                "Transfer edge ownership through the accepted Nginx/Caddy maintenance procedure",
                "Verify committed writes, erasures, authenticated WebSockets, safety hooks and delivered alerts",
                "Retire the old API only after acceptance; rollback edge/application against the same database if required",
            ],
            activation_authorized=False,
        )


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("expected", "candidate-config", "release", "state-dir"):
        parser.add_argument("--" + name, required=True)
    parser.add_argument("--headroom", type=int, required=True)
    parser.add_argument("--other-connections", type=int, required=True)
    args = parser.parse_args(argv)
    try:
        result = prepare(
            json.loads(Path(args.expected).read_text()),
            json.loads(Path(args.candidate_config).read_text()),
            json.loads(Path(args.release).read_text()),
            args.state_dir,
            headroom=args.headroom,
            other_connections=args.other_connections,
        )
    except (
        OSError,
        ValueError,
        KeyError,
        TypeError,
        AttributeError,
        preflight.subprocess.SubprocessError,
    ):
        print(
            "FAIL locked transition preparation; no activation performed",
            file=sys.stderr,
        )
        return 1
    print(
        json.dumps(result, sort_keys=True)
    )  # allowlisted plan only; no env/URLs/paths
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
