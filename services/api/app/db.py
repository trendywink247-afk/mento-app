"""Database engine, session factory, and Base."""

from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import Settings, get_settings

_settings = get_settings()


def engine_kwargs(settings: Settings) -> dict:
    connect_args: dict = {}
    if settings.database_url.startswith("postgresql"):
        # Server-side cap on every statement from this pool (T5.3).
        connect_args["options"] = f"-c statement_timeout={settings.db_statement_timeout_ms}"
    return {
        "connect_args": connect_args,
        "pool_pre_ping": True,
        "pool_size": settings.db_pool_size,
        "max_overflow": settings.db_max_overflow,
        "pool_timeout": settings.db_pool_timeout,
        "pool_recycle": settings.db_pool_recycle,
        "future": True,
        # A DB error message echoes the statement's bound parameters — journal bodies,
        # intro messages, emails — straight into logs and error reports. Dev keeps
        # them (they are what you debug with); everywhere else they are hidden.
        "hide_parameters": not settings.is_dev,
    }


engine = create_engine(_settings.database_url, **engine_kwargs(_settings))
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


class Base(DeclarativeBase):
    pass


def get_db() -> Iterator[Session]:
    """FastAPI dependency yielding a scoped DB session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    """Dev convenience: create tables from models. Use Alembic in staging/prod."""
    from app import models  # noqa: F401  (register mappers)

    Base.metadata.create_all(bind=engine)
