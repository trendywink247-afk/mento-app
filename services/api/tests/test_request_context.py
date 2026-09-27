"""Operability (audit F10): every response carries a request id, the access line
names the ROUTE (never the raw path or a query string), an unhandled error is JSON
the app can parse, and readiness tells the truth about Postgres."""

from __future__ import annotations

import logging
import uuid

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.db import engine_kwargs, get_db
from app.main import app
from app.routers import health
from app.security import issue_session_token


@pytest.fixture
def client():
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture(autouse=True)
def _loggers_enabled():
    """conftest runs the Alembic upgrade in-process; its logging fileConfig disables
    every logger that already exists (test-only — prod migrates in its own process)."""
    for name in ("mento.access", "mento.errors"):
        logging.getLogger(name).disabled = False


def test_every_response_carries_a_request_id(client):
    r = client.get("/api/v1/health")
    assert len(r.headers["x-request-id"]) >= 8


def test_a_well_formed_inbound_id_is_kept_and_a_hostile_one_is_replaced(client):
    kept = client.get("/api/v1/health", headers={"X-Request-ID": "mobile-1234-abcd"})
    assert kept.headers["x-request-id"] == "mobile-1234-abcd"
    hostile = client.get("/api/v1/health", headers={"X-Request-ID": "forged line; rid=admin"})
    assert hostile.headers["x-request-id"] != "forged line; rid=admin"


def test_access_line_names_the_route_never_the_id_or_the_query(client, caplog):
    convo_id = str(uuid.uuid4())
    with caplog.at_level(logging.INFO, logger="mento.access"):
        client.get(f"/api/v1/conversations/{convo_id}/mentor?secret=abc")
    lines = [r.getMessage() for r in caplog.records if r.name == "mento.access"]
    assert lines and "/api/v1/conversations/{convo_id}/mentor" in lines[-1]
    assert convo_id not in lines[-1] and "secret" not in lines[-1]


def test_the_healthcheck_stays_out_of_the_access_log(client, caplog):
    """The container probe hits /health every 30 s; its line is noise, and the quiet
    list is keyed on the FULL route template (prefix included)."""
    with caplog.at_level(logging.INFO, logger="mento.access"):
        client.get("/api/v1/health")
    assert not [r for r in caplog.records if r.name == "mento.access"]


def test_unhandled_error_is_json_with_the_request_id_and_no_internals(client, caplog):
    def _boom():
        raise RuntimeError("the member wrote: my name is Rahul")
        yield  # pragma: no cover

    app.dependency_overrides[get_db] = _boom
    try:
        with caplog.at_level(logging.ERROR, logger="mento.errors"):
            r = client.get(
                "/api/v1/paths/me",
                headers={
                    "Authorization": f"Bearer {issue_session_token('u-1')}",
                    "Origin": "http://localhost:8081",
                },
            )
    finally:
        app.dependency_overrides.pop(get_db, None)
    assert r.status_code == 500
    body = r.json()
    assert body["request_id"] == r.headers["x-request-id"]
    assert "Rahul" not in r.text and "RuntimeError" not in r.text
    # Inside the CORS middleware: a browser gets the JSON, not an opaque CORS failure.
    assert "access-control-allow-origin" in r.headers
    logged = " ".join(rec.getMessage() for rec in caplog.records)
    assert "RuntimeError" in logged and "Rahul" not in logged


def test_readiness_is_ok_with_the_database_up(client):
    r = client.get("/api/v1/health/ready")
    assert r.status_code == 200 and r.json()["db"] is True


def test_readiness_is_503_when_postgres_is_unreachable(client, monkeypatch):
    def _down():
        raise ConnectionError("refused")

    monkeypatch.setattr(health, "SessionLocal", _down)
    r = client.get("/api/v1/health/ready")
    assert r.status_code == 503 and r.json()["db"] is False
    # Liveness is unaffected — the process itself is fine.
    assert client.get("/api/v1/health").status_code == 200


def test_db_errors_hide_their_parameters_outside_dev():
    assert engine_kwargs(Settings(env="prod", _env_file=None))["hide_parameters"] is True
    assert engine_kwargs(Settings(env="dev", _env_file=None))["hide_parameters"] is False
