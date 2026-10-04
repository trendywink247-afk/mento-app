"""The own-chat fixture must fail before opening any unsafe database/provider."""

import importlib.util
from pathlib import Path
from types import SimpleNamespace

import pytest


@pytest.mark.parametrize(
    "overrides",
    [
        {"env": "staging"},
        {"database_url": "postgresql+psycopg://mento:local@remote.test:15432/mento_dev"},
        {"database_url": "postgresql+psycopg://mento:local@127.0.0.1:5432/mento_dev"},
        {"database_url": "postgresql+psycopg://mento:local@127.0.0.1:15432/mento_test"},
        {"stream_api_key": "configured-key"},
        {"stream_api_secret": "configured-secret"},
    ],
)
def test_local_fixture_refuses_unsafe_configuration_before_database_access(monkeypatch, overrides):
    script = Path(__file__).resolve().parents[3] / "scripts/local/own_chat_fixture.py"
    spec = importlib.util.spec_from_file_location("local_own_fixture", script)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    settings = {
        "env": "dev",
        "database_url": "postgresql+psycopg://mento:local@127.0.0.1:15432/mento_dev",
        "stream_api_key": "",
        "stream_api_secret": "",
        **overrides,
    }
    monkeypatch.setattr(module, "get_settings", lambda: SimpleNamespace(**settings))

    def forbidden_database():
        pytest.fail("Unsafe fixture configuration reached the database")

    monkeypatch.setattr(module, "SessionLocal", forbidden_database)
    with pytest.raises(SystemExit, match="isolated offline localhost"):
        module.main()
