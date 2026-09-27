"""Alembic environment. Pulls the DB URL from app settings and the target
metadata from the SQLAlchemy models, so autogenerate stays in sync with the app.
"""

from __future__ import annotations

from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool, text

# Importing the model registry registers every mapper on Base.metadata.
import app.models  # noqa: F401
from app.config import get_settings
from app.db import Base

config = context.config

if config.config_file_name is not None:
    # Keep loggers that already exist: the test suite migrates in-process, and the
    # default would silently disable every app logger imported before it (e.g.
    # mento.chat's fail-open ERROR lines).
    fileConfig(config.config_file_name, disable_existing_loggers=False)

# Source the URL from app settings rather than alembic.ini.
config.set_main_option("sqlalchemy.url", get_settings().database_url)

target_metadata = Base.metadata


def include_name(name, type_, parent_names) -> bool:
    """The job queue's tables are Procrastinate's, installed from vendored SQL
    (revision e4a1jobs0001) — not our models, so autogenerate must not see them."""
    if type_ == "table" and name and name.startswith("procrastinate_"):
        return False
    return True


def run_migrations_offline() -> None:
    """Emit SQL to script output without a live DB connection."""
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations against a live connection."""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        if connection.dialect.name == "postgresql":
            # A migration that waits on a lock held by live traffic gives up after 3 s
            # instead of queueing every request behind it; the deploy then fails and
            # the old containers keep serving (deploy/deploy.sh). Session-level, so it
            # outlives this commit and covers every migration in the run.
            connection.execute(text("SET lock_timeout = '3s'"))
            connection.commit()
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            include_name=include_name,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
