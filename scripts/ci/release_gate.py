"""Fail closed on exact-commit CI evidence; never treat a skipped job as passed."""
import json
import os
import re
import subprocess
import sys

REQUIRED = {
    "api-ci.yml": {"lint", "test"},
    "test-ci.yml": {"mobile-web", "release-tooling", "test-gate"},
    "maestro.yml": {"check-secrets", "maestro"},
}


def api(path):
    return json.loads(subprocess.check_output(["gh", "api", path], text=True))


def valid_run(run, sha):
    return (
        run["head_sha"] == sha
        and run["head_branch"] == "master"
        and run["event"] == "push"
        and run["status"] == "completed"
        and run["conclusion"] == "success"
    )


def require_jobs(jobs, expected):
    actual = {job["name"]: job["conclusion"] for job in jobs}
    if any(actual.get(name) != "success" for name in expected):
        raise RuntimeError("Required jobs missing, skipped or unsuccessful")


def checks(repo, sha):
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise ValueError("Expected a complete commit SHA")
    evidence = {}
    for workflow, expected in REQUIRED.items():
        runs = api(f"repos/{repo}/actions/workflows/{workflow}/runs?head_sha={sha}&event=push&per_page=100")["workflow_runs"]
        # The newest attempt must pass: an earlier green run cannot hide a rerun.
        if not runs or not valid_run(runs[0], sha):
            raise RuntimeError(f"{workflow}: latest master push run is not green for {sha}")
        run = runs[0]
        jobs = api(f"repos/{repo}/actions/runs/{run['id']}/jobs?filter=latest&per_page=100")["jobs"]
        require_jobs(jobs, expected)
        evidence[workflow] = {"run_id": run["id"], "attempt": run["run_attempt"]}
    return evidence


def staging(repo, run_id, sha, accepted=True):
    if not run_id.isdigit():
        raise ValueError("Expected a numeric staging run ID")
    run = api(f"repos/{repo}/actions/runs/{run_id}")
    if not (
        run["path"] == ".github/workflows/staging-release.yml"
        and run["head_branch"] == "master"
        and run["event"] == "workflow_dispatch"
        and run["status"] == "completed"
        and (not accepted or run["conclusion"] == "success")
    ):
        raise RuntimeError("Not a successful staging release from master")
    if accepted:
        require_jobs(api(f"repos/{repo}/actions/runs/{run_id}/jobs?filter=latest&per_page=100")["jobs"], {"stage"})
    # Artifact provenance is tied to this exact successful run; download only it.
    subprocess.run(["gh", "run", "download", run_id, "--repo", repo,
                    "--name", "release-candidate" if accepted else "built-candidate", "--dir", "candidate"], check=True)
    with open("candidate/release.json", encoding="utf-8") as source:
        manifest = json.load(source)
    if manifest["sha"] != sha:
        raise RuntimeError("Staging artifact does not match the requested SHA")
    return manifest


if __name__ == "__main__":
    repo = os.environ["GITHUB_REPOSITORY"]
    if sys.argv[1] == "checks":
        result = checks(repo, sys.argv[2])
    elif sys.argv[1] == "staging":
        result = staging(repo, sys.argv[2], sys.argv[3])
    elif sys.argv[1] == "built":
        result = staging(repo, sys.argv[2], sys.argv[3], accepted=False)
    else:
        raise SystemExit("Unknown release gate")
    print(json.dumps(result, indent=2))
