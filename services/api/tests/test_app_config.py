"""GET /app-config (DECISIONS R.10, R.11): public, identity-free switches, off by default."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import app


def _get() -> dict:
    with TestClient(app) as client:
        res = client.get("/api/v1/app-config")
    assert res.status_code == 200
    return res.json()


def test_switches_are_off_by_default():
    assert _get() == {
        "signup_verification_required": False,
        "email_required_from_second_visit": False,
    }


def test_signup_verification_follows_its_switch(monkeypatch):
    monkeypatch.setattr(get_settings(), "signup_verification_required", True)
    assert _get()["signup_verification_required"] is True


def test_email_requirement_never_on_without_an_email_service(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "email_required_from_second_visit", True)
    monkeypatch.setattr(s, "email_provider", "log")
    assert _get()["email_required_from_second_visit"] is False
    monkeypatch.setattr(s, "email_provider", "smtp")
    assert _get()["email_required_from_second_visit"] is True
