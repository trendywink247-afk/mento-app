"""Run this checkout against isolated local data, without loading copied .env files.

Usage: services/api/.venv/Scripts/python.exe scripts/local/api.py init|serve|worker|test|check
The legacy Desktop stack and all external service credentials remain untouched.
"""

from __future__ import annotations

import os
from pathlib import Path
import runpy
import sys

ROOT = Path(__file__).resolve().parents[2]
API = ROOT / "services" / "api"


def main() -> None:
    action = sys.argv[1] if len(sys.argv) > 1 else "serve"
    if action not in {"init", "serve", "worker", "test", "check"}:
        raise SystemExit("Expected init, serve, worker, test, or check")
    os.chdir(API)
    sys.path.insert(0, str(API))
    from app.config import Settings

    # Empty external credentials also protect subprocess tests from the copied .env.
    # Leave other defaults unset: settings tests distinguish unset from explicit 0.
    for field in Settings.model_fields:
        os.environ.pop(field.upper(), None)
    Settings.model_config["env_file"] = None
    for key, value in Settings(_env_file=None).model_dump().items():
        if any(word in key for word in ("secret", "api_key", "dsn", "message_key")):
            os.environ[key.upper()] = str(value or "")
    database = "mento_test" if action == "test" else "mento_dev"
    os.environ.update(
        ENV="dev",
        DATABASE_URL=f"postgresql+psycopg://mento:mento-local-only@127.0.0.1:15432/{database}",
        REDIS_URL=f"redis://127.0.0.1:16379/{1 if action == 'test' else 0}",
        JWT_SECRET="workspace-dev-member-not-for-production",
        ADMIN_JWT_SECRET="workspace-dev-admin-not-for-production",
        LISTENER_JWT_SECRET="workspace-dev-mentor-not-for-production",
        PUSH_ENABLED="false",
    )
    if action != "test":
        os.environ.update(
            APP_BASE_URL="http://localhost:18081",
            ADMIN_BASE_URL="http://localhost:18081",
            TRUSTED_PROXY_HOPS="0",
        )
        # Explicit opt-in file for a verified development-only Stream application.
        # Tests always remain hermetic. Never read the copied application .env here.
        stream_file = ROOT / ".local" / "stream.env"
        if stream_file.exists():
            from dotenv import dotenv_values

            values = dotenv_values(stream_file)
            for key in ("STREAM_API_KEY", "STREAM_API_SECRET"):
                if not values.get(key):
                    raise SystemExit(f"Dedicated local Stream config missing {key}")
                os.environ[key] = values[key]
    if action == "test":
        import pytest

        os.environ["MENTO_PG_CONTAINER"] = "mento-h-dev-postgres-1"
        raise SystemExit(pytest.main(sys.argv[2:] or ["-q"]))
    if action in {"init", "check"}:
        from alembic import command
        from alembic.config import Config

        config = Config(str(API / "alembic.ini"))
        if action == "check":
            command.check(config)
            return
        command.upgrade(config, "head")
        from sqlalchemy import create_engine, text

        engine = create_engine(
            "postgresql+psycopg://mento:mento-local-only@127.0.0.1:15432/postgres",
            isolation_level="AUTOCOMMIT",
        )
        with engine.connect() as connection:
            if not connection.execute(
                text("SELECT 1 FROM pg_database WHERE datname='mento_test'")
            ).scalar():
                connection.execute(text("CREATE DATABASE mento_test"))
        engine.dispose()
        from app.db import SessionLocal
        from app.models.listener import ListenerProfile

        with SessionLocal() as session:
            needs_seed = session.query(ListenerProfile).count() == 0
        if needs_seed:
            runpy.run_module("scripts.seed_listeners", run_name="__main__")
        elif os.environ.get("STREAM_API_KEY"):
            from app.services import stream

            with SessionLocal() as session:
                for listener in session.query(ListenerProfile).all():
                    stream.upsert_user(listener.id, listener.persona_name, listener.persona_avatar)
        return
    if action == "worker":
        runpy.run_module("app.jobs.worker", run_name="__main__")
        return
    import uvicorn

    uvicorn.run("app.main:app", host="127.0.0.1", port=18000, ws_max_size=16384)


if __name__ == "__main__":
    main()
