"""Security-hardening proofs: the server-side age gate, Panda-Wipe ownership +
hard-delete call, /safety/scan conversation ownership, the PIN attempt cap, and
JWT role/secret hygiene.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta

import jwt
import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from fastapi.testclient import TestClient
from jwt import PyJWTError as JWTError
from sqlalchemy import select

from app import ratelimit, security
from app.config import get_settings
from app.main import app
from app.models.conversation import Conversation
from app.models.enums import ConversationStatus, ListenerStatus, VettingStatus
from app.models.listener import ListenerProfile
from app.models.safety import SafetyFlag
from app.models.user import User
from app.security import issue_admin_token, issue_listener_token, issue_session_token
from app.services import stream

from .conftest import TestSession, requires_postgres


@pytest.fixture(autouse=True)
def _stub_stream(monkeypatch):
    monkeypatch.setattr(
        stream, "create_dm_channel", lambda channel_id, user_id, listener_id: channel_id
    )
    monkeypatch.setattr(stream, "upsert_user", lambda *a, **k: None)
    monkeypatch.setattr(stream, "user_token", lambda user_id: f"stub::{user_id}")


@pytest.fixture
def client():
    return TestClient(app)


def _seed_user(s) -> str:
    u = User(persona_name="Quiet Cove", persona_avatar="x", dob=date(1996, 1, 1), age_at_signup=30)
    s.add(u)
    s.flush()
    return u.id


def _seed_listener(s) -> str:
    li = ListenerProfile(
        persona_name="Open River",
        persona_avatar="river",
        categories=[],
        status=ListenerStatus.online,
        vetting_status=VettingStatus.approved,
        rank=10,
        active_conversations=0,
        max_concurrent=3,
    )
    s.add(li)
    s.flush()
    return li.id


def _seed_convo(s, user_id: str, listener_id: str, *, channel: str | None = None) -> str:
    c = Conversation(
        type="anon",
        status=ConversationStatus.active,
        user_id=user_id,
        listener_id=listener_id,
        stream_channel_id=channel,
    )
    s.add(c)
    s.flush()
    return c.id


def _auth(user_id: str) -> dict:
    return {"Authorization": f"Bearer {issue_session_token(user_id)}"}


def _dob_for_age(years: int) -> str:
    today = datetime.now(UTC).date()
    return (today - timedelta(days=years * 365 + 200)).isoformat()


# --- Age gate (Trust & Safety #3) ---


@requires_postgres
def test_age_gate_blocks_under_min_age(client, db_session):
    resp = client.post("/api/v1/onboarding/start", json={"dob": _dob_for_age(16)})
    assert resp.status_code == 403


@requires_postgres
def test_age_gate_rejects_future_dob(client, db_session):
    future = (datetime.now(UTC).date() + timedelta(days=30)).isoformat()
    resp = client.post("/api/v1/onboarding/start", json={"dob": future})
    assert resp.status_code == 422


@requires_postgres
def test_age_gate_admits_adult_with_anonymous_persona(client, db_session):
    resp = client.post("/api/v1/onboarding/start", json={"dob": _dob_for_age(25)})
    assert resp.status_code == 201
    body = resp.json()
    assert body["session_token"]
    assert body["user"]["persona_name"]
    # The response must never echo identity — persona only.
    assert "dob" not in body["user"] and "email" not in body["user"]


# --- Panda Wipe (Trust & Safety #8) ---


@requires_postgres
def test_wipe_hard_deletes_and_requires_ownership(client, db_session, monkeypatch):
    wiped: list[str] = []
    monkeypatch.setattr(stream, "wipe_channel", lambda channel_id: wiped.append(channel_id))

    user_id = _seed_user(db_session)
    intruder_id = _seed_user(db_session)
    listener_id = _seed_listener(db_session)
    convo_id = _seed_convo(db_session, user_id, listener_id, channel="c-wipe-proof")
    db_session.commit()

    # A non-owner gets an opaque 404 and nothing is deleted.
    resp = client.post(f"/api/v1/conversations/{convo_id}/wipe", headers=_auth(intruder_id))
    assert resp.status_code == 404
    assert wiped == []

    # The owner's wipe hard-deletes the Stream channel (the storage promise).
    resp = client.post(f"/api/v1/conversations/{convo_id}/wipe", headers=_auth(user_id))
    assert resp.status_code == 200
    assert wiped == ["c-wipe-proof"]
    assert resp.json()["deleted_from"] == ["device", "servers"]
    with TestSession() as s:
        convo = s.get(Conversation, convo_id)
        assert convo is not None and convo.status == ConversationStatus.wiped


# --- /safety/scan ownership (flag planting) ---


@requires_postgres
def test_scan_rejects_someone_elses_conversation_id(client, db_session):
    owner_id = _seed_user(db_session)
    attacker_id = _seed_user(db_session)
    listener_id = _seed_listener(db_session)
    convo_id = _seed_convo(db_session, owner_id, listener_id)
    db_session.commit()

    resp = client.post(
        "/api/v1/safety/scan",
        json={"text": "I want to end my life", "conversation_id": convo_id},
        headers=_auth(attacker_id),
    )
    assert resp.status_code == 404
    with TestSession() as s:
        flags = s.scalars(select(SafetyFlag).where(SafetyFlag.conversation_id == convo_id)).all()
        assert flags == []


# --- Safety flags store the signal, never message fragments (T&S #6) ---


@requires_postgres
def test_safety_flag_never_stores_message_text(client, db_session):
    user_id = _seed_user(db_session)
    db_session.commit()

    secret_phrase = "I want to end my life because of zzz-unique-marker"
    resp = client.post("/api/v1/safety/scan", json={"text": secret_phrase}, headers=_auth(user_id))
    assert resp.status_code == 200 and resp.json()["triggered"]
    with TestSession() as s:
        flag = s.scalars(select(SafetyFlag).where(SafetyFlag.user_id == user_id)).one()
        assert "zzz-unique-marker" not in (flag.matched_terms or "")
        assert "end my life" not in (flag.matched_terms or "")


# --- PIN attempt cap (brute-force lockout) ---


@requires_postgres
def test_pin_attempts_are_rate_limited(client, db_session):
    user_id = _seed_user(db_session)
    listener_id = _seed_listener(db_session)
    convo_id = _seed_convo(db_session, user_id, listener_id)
    db_session.commit()

    lock = client.post(
        f"/api/v1/conversations/{convo_id}/lock", json={"pin": "4321"}, headers=_auth(user_id)
    )
    assert lock.status_code == 200

    # Enable the limiter around keys unique to this test run (fresh convo UUID).
    ratelimit.ENABLED = True
    try:
        if not ratelimit.allow(f"probe:{uuid.uuid4()}", 1, 5):
            pytest.skip("Redis unavailable — limiter fails open by design")
        statuses = [
            client.post(
                f"/api/v1/conversations/{convo_id}/verify-pin",
                json={"pin": "0000"},
                headers=_auth(user_id),
            ).status_code
            for _ in range(6)
        ]
        assert statuses[:5] == [403] * 5  # wrong PIN, still answering
        assert statuses[5] == 429  # 6th attempt hits the cap

        # The cap also blocks a would-be success until the window passes:
        blocked = client.post(
            f"/api/v1/conversations/{convo_id}/verify-pin",
            json={"pin": "4321"},
            headers=_auth(user_id),
        )
        assert blocked.status_code == 429
    finally:
        ratelimit.ENABLED = False


# --- JWT role + secret hygiene ---


def _creds(token: str) -> HTTPAuthorizationCredentials:
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)


def _raw_token(payload: dict, secret: str) -> str:
    now = datetime.now(UTC)
    base = {"iat": int(now.timestamp()), "exp": int((now + timedelta(days=1)).timestamp())}
    return jwt.encode({**base, **payload}, secret, algorithm="HS256")


def test_user_token_carries_explicit_role_and_resolves():
    token = issue_session_token("u-role")
    assert jwt.decode(token, options={"verify_signature": False})["role"] == "user"
    assert security.current_user_id(_creds(token)) == "u-role"


def _pin_clock(monkeypatch, day) -> None:
    """Judge the legacy windows on `day` (noon UTC), not on whatever today is."""
    at = datetime.combine(day, datetime.min.time(), UTC) + timedelta(hours=12)
    monkeypatch.setattr(security, "_now", lambda: at)


def test_legacy_roleless_token_remains_valid_user_session(monkeypatch):
    # Deployed clients hold 90-day role-less tokens (pre 2026-07-19); they must
    # keep working until one TTL cycle passes (see current_user_id).
    _pin_clock(monkeypatch, date(2026, 10, 16))
    token = _raw_token({"sub": "u-legacy"}, get_settings().jwt_secret)
    assert security.current_user_id(_creds(token)) == "u-legacy"


def test_listener_and_admin_tokens_rejected_as_user_session():
    for token in (issue_listener_token("l-cross"), issue_admin_token("a-cross")):
        with pytest.raises(HTTPException) as exc:
            security.current_user_id(_creds(token))
        assert exc.value.status_code == 401


def test_admin_token_uses_dedicated_secret_when_configured(monkeypatch):
    monkeypatch.setattr(get_settings(), "admin_jwt_secret", "admin-only-secret")
    token = issue_admin_token("a-sec")
    # Signed with the dedicated secret, NOT the shared one.
    aud = security.AUDIENCES["admin"]
    assert (
        jwt.decode(token, "admin-only-secret", algorithms=["HS256"], audience=aud)["sub"] == "a-sec"
    )
    with pytest.raises(JWTError):
        jwt.decode(token, get_settings().jwt_secret, algorithms=["HS256"], audience=aud)
    assert security.current_admin_id(_creds(token)) == "a-sec"
    # A shared-secret forgery must not open admin (blast-radius reduction).
    forged = _raw_token({"sub": "a-forged", "role": "admin"}, get_settings().jwt_secret)
    with pytest.raises(HTTPException) as exc:
        security.current_admin_id(_creds(forged))
    assert exc.value.status_code == 401


def test_admin_token_falls_back_to_shared_secret_when_unset(monkeypatch):
    monkeypatch.setattr(get_settings(), "admin_jwt_secret", "")
    token = issue_admin_token("a-fallback")
    decoded = jwt.decode(
        token, get_settings().jwt_secret, algorithms=["HS256"], audience=security.AUDIENCES["admin"]
    )
    assert decoded["role"] == "admin"
    assert security.current_admin_id(_creds(token)) == "a-fallback"


@requires_postgres
def test_role_isolation_on_user_endpoint(client, db_session):
    user_id = _seed_user(db_session)
    db_session.commit()
    assert client.get("/api/v1/journals/summary", headers=_auth(user_id)).status_code == 200
    for token in (issue_listener_token("l1"), issue_admin_token("a1")):
        resp = client.get("/api/v1/journals/summary", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 401


# --- T3.1: iss / aud / jti claims and the split listener secret ---


def _claims(token: str) -> dict:
    return jwt.decode(token, options={"verify_signature": False})


def test_new_tokens_carry_iss_aud_jti():
    tokens = {
        "user": issue_session_token("u-claims"),
        "listener": issue_listener_token("l-claims"),
        "admin": issue_admin_token("a-claims"),
    }
    for role, token in tokens.items():
        claims = _claims(token)
        assert claims["iss"] == security.ISSUER
        assert claims["aud"] == security.AUDIENCES[role]
        assert claims["jti"]
    # jti is unique per mint, even for the same subject in the same second
    assert _claims(issue_session_token("u-x"))["jti"] != _claims(issue_session_token("u-x"))["jti"]


def test_listener_token_signed_with_its_own_secret(monkeypatch):
    monkeypatch.setattr(get_settings(), "listener_jwt_secret", "listener-only-secret")
    token = issue_listener_token("l-own")
    assert jwt.decode(
        token, "listener-only-secret", algorithms=["HS256"], audience=security.AUDIENCES["listener"]
    )
    with pytest.raises(JWTError):
        jwt.decode(
            token,
            get_settings().jwt_secret,
            algorithms=["HS256"],
            audience=security.AUDIENCES["listener"],
        )
    assert security.current_listener_id(_creds(token)) == "l-own"
    # a member-secret signature on a NEW-format listener token is a forgery
    forged = _raw_token(
        {
            "sub": "l-forged",
            "role": "listener",
            "iss": security.ISSUER,
            "aud": security.AUDIENCES["listener"],
            "jti": "x",
        },
        get_settings().jwt_secret,
    )
    with pytest.raises(HTTPException) as exc:
        security.current_listener_id(_creds(forged))
    assert exc.value.status_code == 401


def test_legacy_listener_token_on_member_secret_lives_until_cutoff(monkeypatch):
    # Console links and native console sessions minted before the split were signed
    # with JWT_SECRET and carry no iss/aud/jti; they keep working until the cutoff.
    monkeypatch.setattr(get_settings(), "listener_jwt_secret", "listener-only-secret")
    _pin_clock(monkeypatch, date(2026, 10, 1))
    legacy = _raw_token({"sub": "l-legacy", "role": "listener"}, get_settings().jwt_secret)
    assert security.current_listener_id(_creds(legacy)) == "l-legacy"
    assert security.current_member_or_listener(_creds(legacy)) == ("mentor", "l-legacy")
    after = datetime.combine(get_settings().legacy_claims_accepted_until, datetime.min.time(), UTC)
    monkeypatch.setattr(security, "_now", lambda: after + timedelta(seconds=1))
    with pytest.raises(HTTPException) as exc:
        security.current_listener_id(_creds(legacy))
    assert exc.value.status_code == 401


def test_legacy_user_token_without_claims_lives_until_cutoff(monkeypatch):
    _pin_clock(monkeypatch, date(2026, 10, 1))
    legacy = _raw_token({"sub": "u-old", "role": "user"}, get_settings().jwt_secret)
    assert security.current_user_id(_creds(legacy)) == "u-old"
    after = datetime.combine(get_settings().legacy_claims_accepted_until, datetime.min.time(), UTC)
    monkeypatch.setattr(security, "_now", lambda: after + timedelta(seconds=1))
    with pytest.raises(HTTPException):
        security.current_user_id(_creds(legacy))
    # a claimed token is unaffected by the cutoff
    monkeypatch.setattr(security, "_now", lambda: datetime.now(UTC))
    fresh = issue_session_token("u-new")
    monkeypatch.setattr(security, "_now", lambda: after + timedelta(seconds=1))
    assert security.current_user_id(_creds(fresh)) == "u-new"


def test_wrong_audience_or_issuer_is_refused(monkeypatch):
    # Same secret (dev fallback) — only aud tells a listener token from a member one.
    monkeypatch.setattr(get_settings(), "listener_jwt_secret", "")
    secret = get_settings().jwt_secret
    base = {"sub": "x", "jti": "j", "iss": security.ISSUER}
    wrong_aud = _raw_token({**base, "role": "listener", "aud": security.AUDIENCES["user"]}, secret)
    with pytest.raises(HTTPException):
        security.current_listener_id(_creds(wrong_aud))
    wrong_iss = _raw_token(
        {**base, "role": "user", "aud": security.AUDIENCES["user"], "iss": "evil"}, secret
    )
    with pytest.raises(HTTPException):
        security.current_user_id(_creds(wrong_iss))
    half = _raw_token({"sub": "x", "role": "user", "iss": security.ISSUER}, secret)  # iss, no aud
    with pytest.raises(HTTPException):
        security.current_user_id(_creds(half))


def test_member_or_listener_resolves_new_listener_tokens(monkeypatch):
    monkeypatch.setattr(get_settings(), "listener_jwt_secret", "listener-only-secret")
    assert security.current_member_or_listener(_creds(issue_listener_token("l-both"))) == (
        "mentor",
        "l-both",
    )
    assert security.current_member_or_listener(_creds(issue_session_token("u-both"))) == (
        "member",
        "u-both",
    )
    with pytest.raises(HTTPException):
        security.current_member_or_listener(_creds(issue_admin_token("a-both")))
