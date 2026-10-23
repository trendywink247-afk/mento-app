"""The offline boot checker (app/boot_check.py): same checks as startup, names only.

Pure tests: no database, no app boot. The subprocess tests run `python -m app.boot_check`
exactly as the operator does and assert that no setting VALUE is ever printed.
"""

from __future__ import annotations

import base64
import os
import subprocess
import sys
from pathlib import Path

from app import boot_check
from app.config import Settings

API_DIR = Path(__file__).resolve().parents[1]
GOOD_KEY = "k1:" + base64.b64encode(b"k" * 32).decode()

GOOD = dict(
    env="prod",
    jwt_secret="a-real-long-random-secret",
    admin_jwt_secret="a-distinct-admin-secret",
    listener_jwt_secret="a-distinct-listener-secret",
    stream_api_key="k",
    stream_api_secret="s",
    cors_origins="https://app.example",
    message_key=GOOD_KEY,
    database_url="postgresql+psycopg://mento:not-the-default@db:5432/mento",
    trusted_proxy_hops=1,
)


def names(**overrides) -> list[str]:
    return boot_check.failing_names(Settings(_env_file=None, **{**GOOD, **overrides}))


def test_good_configuration_has_no_failures():
    assert names() == []


def test_each_failure_is_reported_by_setting_name():
    assert names(jwt_secret="change-me-long-random") == ["JWT_SECRET"]
    assert names(message_key="") == ["MESSAGE_KEY"]
    assert names(message_key="not-a-key") == ["MESSAGE_KEY"]
    assert names(listener_jwt_secret="") == ["LISTENER_JWT_SECRET"]
    assert names(admin_jwt_secret="") == ["ADMIN_JWT_SECRET"]
    assert names(database_url=Settings.model_fields["database_url"].default) == ["DATABASE_URL"]
    assert names(stream_api_secret="") == ["STREAM_API_SECRET"]
    assert names(stream_api_key="", stream_api_secret="") == ["STREAM_API_KEY", "STREAM_API_SECRET"]


def test_previous_key_failures_name_the_previous_setting():
    assert names(message_key_previous="k0:%%%") == ["MESSAGE_KEY_PREVIOUS"]
    dev = "dev:" + base64.b64encode(b"mento-dev-only-message-key-32byt").decode()
    assert names(message_key_previous=dev) == ["MESSAGE_KEY_PREVIOUS"]


def test_unset_trusted_proxy_hops_is_reported():
    good = {k: v for k, v in GOOD.items() if k != "trusted_proxy_hops"}
    assert boot_check.failing_names(Settings(_env_file=None, **good)) == ["TRUSTED_PROXY_HOPS"]


def test_every_failing_name_is_listed_once():
    assert names(message_key="", listener_jwt_secret="", admin_jwt_secret="") == [
        "ADMIN_JWT_SECRET",
        "LISTENER_JWT_SECRET",
        "MESSAGE_KEY",
    ]


def test_dev_environment_is_itself_reported():
    assert names(env="dev") == ["ENV"]


def test_messages_never_repeat_key_material():
    # A malformed key whose id and body are recognisable must not appear in any message.
    secret_id, secret_body = "idLEAK", "BODYLEAK"
    found = boot_check.problems(
        Settings(_env_file=None, **{**GOOD, "message_key": f"{secret_id}:{secret_body}"})
    )
    text = " ".join(p.message for p in found)
    assert secret_id not in text and secret_body not in text and "MESSAGE_KEY" in text


def run_checker(env: dict[str, str]) -> subprocess.CompletedProcess:
    """`python -m app.boot_check` in a clean environment, from the API directory."""
    clean = {"PATH": os.environ.get("PATH", ""), "PYTHONPATH": str(API_DIR), **env}
    return subprocess.run(
        [sys.executable, "-m", "app.boot_check"],
        cwd=API_DIR,
        env=clean,
        capture_output=True,
        text=True,
    )


GOOD_ENV = {
    "ENV": "staging",
    "JWT_SECRET": "SENTINEL-jwt-secret-value-0001",
    "ADMIN_JWT_SECRET": "SENTINEL-admin-secret-value-0002",
    "LISTENER_JWT_SECRET": "SENTINEL-listener-secret-value-0003",
    "STREAM_API_KEY": "SENTINEL-stream-key",
    "STREAM_API_SECRET": "SENTINEL-stream-secret",
    "CORS_ORIGINS": "https://app.example",
    "MESSAGE_KEY": GOOD_KEY,
    "DATABASE_URL": "postgresql+psycopg://mento:SENTINEL-db-password@db:5432/mento",
    "TRUSTED_PROXY_HOPS": "1",
}


def test_cli_passes_silently_on_a_good_environment():
    result = run_checker(GOOD_ENV)
    assert (result.returncode, result.stdout, result.stderr) == (0, "", "")


def test_cli_prints_only_names_and_never_a_value():
    bad = {**GOOD_ENV, "MESSAGE_KEY": "SENTINEL-bad-key:SENTINEL-bad-body"}
    del bad["LISTENER_JWT_SECRET"]
    result = run_checker(bad)
    assert result.returncode == 1
    assert result.stdout.split() == ["LISTENER_JWT_SECRET", "MESSAGE_KEY"]
    assert "SENTINEL" not in result.stdout + result.stderr


def test_cli_names_an_unparseable_setting_without_echoing_it():
    result = run_checker({**GOOD_ENV, "DB_POOL_SIZE": "SENTINEL-not-an-int"})
    assert result.returncode == 1
    assert result.stdout.split() == ["DB_POOL_SIZE"]
    assert "SENTINEL" not in result.stdout + result.stderr


def test_cli_flags_dev_environment():
    result = run_checker({**GOOD_ENV, "ENV": "dev"})
    assert (result.returncode, result.stdout.split()) == (1, ["ENV"])


def test_cli_ignores_a_stray_dotenv_in_the_working_directory(tmp_path):
    (tmp_path / ".env").write_text("MESSAGE_KEY=SENTINEL-from-dotenv\n")
    clean = {"PATH": os.environ.get("PATH", ""), "PYTHONPATH": str(API_DIR), **GOOD_ENV}
    result = subprocess.run(
        [sys.executable, "-m", "app.boot_check"],
        cwd=tmp_path,
        env=clean,
        capture_output=True,
        text=True,
    )
    assert (result.returncode, result.stdout) == (0, "")
