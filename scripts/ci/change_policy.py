"""Fail-closed CI selection, shared by workflow and exact-candidate release gates.

Pull requests select affected suites. Every non-documentation push and every
manual run uses all suites. Git failures or incomplete event evidence run all
suites too; they must never turn an unknown change into a documentation skip.
"""

import argparse
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess


FLAGS = ("api", "mobile", "tooling", "recovery", "receiver", "native", "full")
SHA = re.compile(r"[0-9a-fA-F]{40}\Z")
EXECUTABLE_SUFFIXES = {
    ".py", ".sh", ".ps1", ".js", ".cjs", ".mjs", ".ts", ".tsx", ".jsx",
    ".bat", ".cmd", ".sql", ".yml", ".yaml", ".json", ".toml", ".ini",
    ".conf", ".dockerfile", ".html", ".css", ".exe", ".dll", ".wasm",
}


def all_flags():
    return dict.fromkeys(FLAGS, True)


def is_documentation(path):
    """Only explicitly inert documentation paths may bypass runtime suites."""
    name = PurePosixPath(path)
    if name.suffix.lower() == ".md":
        return True
    if not path.startswith("docs/"):
        return False
    # Extensionless files and executable/configuration content are unknown.
    return name.suffix.lower() in {
        ".txt", ".rst", ".adoc", ".png", ".jpg", ".jpeg", ".gif", ".webp",
        ".svg", ".pdf", ".pptx", ".docx",
    } and name.suffix.lower() not in EXECUTABLE_SUFFIXES


def classify_paths(paths, event_name="pull_request"):
    if event_name not in {"pull_request", "push"}:
        return all_flags()
    selected = dict.fromkeys(FLAGS, False)
    for path in paths:
        # Git paths use '/' even on Windows. Do not normalize an unexpected
        # path into an allowlisted path: ambiguity must select full coverage.
        if not isinstance(path, str) or not path or "\\" in path or path.startswith("/"):
            return all_flags()
        if any(part in {".", ".."} for part in path.split("/")):
            return all_flags()
        if is_documentation(path):
            continue
        if event_name == "push":
            return all_flags()
        if path.startswith("services/api/"):
            for flag in ("api", "tooling", "native"):
                selected[flag] = True
        elif path.startswith("apps/mobile/"):
            selected["mobile"] = selected["native"] = True
        elif path.startswith("services/recovery_receiver/"):
            selected["recovery"] = True
        else:
            return all_flags()
    return selected


def _valid_sha(value):
    return isinstance(value, str) and bool(SHA.fullmatch(value)) and value != "0" * 40


def changed_paths(event_name, event, repo="."):
    """Return old and new names (including deletions), or fail on bad evidence."""
    if event_name == "pull_request":
        request = event["pull_request"]
        before, after = request["base"]["sha"], request["head"]["sha"]
        separator = "..."
    elif event_name == "push":
        before, after = event["before"], event["after"]
        separator = ".."
    else:
        raise ValueError("Event requires full coverage")
    if not _valid_sha(before) or not _valid_sha(after):
        raise ValueError("Missing or invalid change range")
    # A truncated graph can make a merge base inaccurate. Full checkout is
    # required even if the two endpoint commits happen to be present.
    shallow = subprocess.run(
        ["git", "rev-parse", "--is-shallow-repository"], cwd=repo,
        check=True, capture_output=True,
    )
    if shallow.stdout.strip() != b"false":
        raise ValueError("Incomplete repository history")
    diff = subprocess.run(
        ["git", "diff", "--name-only", "-z", "--no-renames", f"{before}{separator}{after}", "--"],
        cwd=repo, check=True, capture_output=True,
    )
    if diff.stdout and not diff.stdout.endswith(b"\0"):
        raise ValueError("Malformed change list")
    return [path.decode("utf-8", errors="strict") for path in diff.stdout.split(b"\0") if path]


def classify_event(event_name, event, repo="."):
    if event_name not in {"pull_request", "push"}:
        return all_flags()
    try:
        return classify_paths(changed_paths(event_name, event, repo), event_name)
    except (KeyError, TypeError, ValueError, UnicodeError, OSError, subprocess.CalledProcessError):
        return all_flags()


def validate_results(selected, results):
    """Require success for selected jobs and an intentional skip for others.

    Pass job names mapped to bools, and either GitHub ``needs`` objects or
    job-name/result strings. The classifier's own success is checked separately
    by the aggregate workflow job, before trusting these selections.
    """
    for job, required in selected.items():
        if type(required) is not bool:
            raise RuntimeError(f"Invalid selection for {job}")
        actual = results.get(job)
        if isinstance(actual, dict):
            actual = actual.get("result")
        expected = "success" if required else "skipped"
        if actual != expected:
            raise RuntimeError(f"{job}: expected {expected}, got {actual!r}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--event-name", default=os.environ.get("GITHUB_EVENT_NAME", ""))
    parser.add_argument("--event-path", default=os.environ.get("GITHUB_EVENT_PATH", ""))
    parser.add_argument("--repo", default=".")
    args = parser.parse_args()
    try:
        event = json.loads(Path(args.event_path).read_text(encoding="utf-8"))
        selected = classify_event(args.event_name, event, args.repo)
    except (OSError, ValueError, TypeError):
        selected = all_flags()
    output = os.environ.get("GITHUB_OUTPUT")
    if output:
        with open(output, "a", encoding="utf-8") as stream:
            for flag, value in selected.items():
                stream.write(f"{flag}={str(value).lower()}\n")
    print(json.dumps(selected, sort_keys=True))


if __name__ == "__main__":
    main()
