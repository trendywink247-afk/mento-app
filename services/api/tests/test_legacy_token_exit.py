"""T3.3 — legacy token exit, on the dates already written in security.py.

Nothing is removed early: each leniency closes by itself on its date, and these
tests pin the clock either side of it so they mean the same thing on any day.
- role-less member tokens: last day 2026-10-16, refused from 2026-10-17.
- claim-less tokens (no iss/aud/jti) of every role, and pre-split mentor tokens on
  the member secret: refused from `legacy_claims_accepted_until`.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import jwt
import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from app import security
from app.config import get_settings


def _creds(token: str) -> HTTPAuthorizationCredentials:
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)


def _at(monkeypatch, when: datetime) -> None:
    monkeypatch.setattr(security, "_now", lambda: when)


def _midnight(day: date) -> datetime:
    return datetime.combine(day, datetime.min.time(), UTC)


def _raw(payload: dict, secret: str | None = None) -> str:
    # Far-future exp: these tests are about the legacy windows, not expiry.
    base = {"iat": 1, "exp": 4102444800}
    return jwt.encode({**base, **payload}, secret or get_settings().jwt_secret, algorithm="HS256")


def test_roleless_window_is_the_documented_date():
    assert security.ROLELESS_ACCEPTED_UNTIL == date(2026, 10, 17)


def test_roleless_member_token_accepted_until_the_last_second(monkeypatch):
    _at(monkeypatch, _midnight(date(2026, 10, 17)) - timedelta(seconds=1))
    assert security.user_id_from_token(_creds(_raw({"sub": "u-old"}))) == "u-old"
    assert security.current_member_or_listener(_creds(_raw({"sub": "u-old"}))) == (
        "member",
        "u-old",
    )


@pytest.mark.parametrize("day", [date(2026, 10, 17), date(2026, 12, 1)])
def test_roleless_member_token_refused_from_the_date(monkeypatch, day):
    _at(monkeypatch, _midnight(day))
    for dep in (security.user_id_from_token, security.current_member_or_listener):
        with pytest.raises(HTTPException) as exc:
            dep(_creds(_raw({"sub": "u-old"})))
        assert exc.value.status_code == 401


def test_role_claimed_legacy_token_outlives_the_roleless_date(monkeypatch):
    # role:"user" but no iss/aud/jti (minted 2026-07-19 … T3.1): the claims window
    # governs it, not the role-less one.
    _at(monkeypatch, _midnight(date(2026, 11, 1)))
    assert security.user_id_from_token(_creds(_raw({"sub": "u", "role": "user"}))) == "u"


@pytest.mark.parametrize("role", ["user", "listener", "admin"])
def test_claimless_tokens_refused_from_the_claims_cutoff(monkeypatch, role):
    cutoff = _midnight(get_settings().legacy_claims_accepted_until)
    dep = {
        "user": security.user_id_from_token,
        "listener": security.current_listener_id,
        "admin": security.current_admin_id,
    }[role]
    token = _raw({"sub": "s", "role": role}, security._signing_secret(role))
    _at(monkeypatch, cutoff - timedelta(seconds=1))
    assert dep(_creds(token)) == "s"
    _at(monkeypatch, cutoff)
    with pytest.raises(HTTPException):
        dep(_creds(token))


def test_new_tokens_are_untouched_by_either_cutoff(monkeypatch):
    token = security.issue_session_token("u-new")
    _at(monkeypatch, _midnight(date(2027, 6, 1)))
    assert security.user_id_from_token(_creds(token)) == "u-new"
