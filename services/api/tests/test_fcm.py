"""Direct FCM sender (app/services/fcm.py) and the Expo/FCM routing in push._post_or_raise."""

from __future__ import annotations

import json
from types import SimpleNamespace

import httpx
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from app.services import fcm, push

EXPO = "ExponentPushToken[abc]"
RAW = "d" * 150 + ":APA91b" + "x" * 40


@pytest.fixture
def account(tmp_path, monkeypatch):
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()
    path = tmp_path / "sa.json"
    path.write_text(
        json.dumps(
            {
                "client_email": "svc@proj.iam.gserviceaccount.com",
                "private_key": pem,
                "project_id": "proj",
            }
        )
    )
    monkeypatch.setattr(
        fcm, "get_settings", lambda: SimpleNamespace(fcm_service_account_file=str(path))
    )
    fcm._cache.update({"token": None, "expires": 0.0})
    return path


def _resp(status: int, body: dict | None = None) -> httpx.Response:
    return httpx.Response(status, json=body or {}, request=httpx.Request("POST", "https://x"))


@pytest.fixture
def wire(monkeypatch):
    """Records every POST; oauth answers with a token, FCM answers per `answers`."""
    calls: list[dict] = []
    answers: list[httpx.Response] = []

    def post(url, **kw):
        calls.append({"url": url, **kw})
        if url == fcm._TOKEN_URL:
            return _resp(200, {"access_token": "tok-1", "expires_in": 3600})
        return answers.pop(0) if answers else _resp(200, {"name": "m"})

    monkeypatch.setattr(fcm.httpx, "post", post)
    return SimpleNamespace(calls=calls, answers=answers)


def test_is_expo_token():
    assert fcm.is_expo_token(EXPO)
    assert fcm.is_expo_token("ExpoPushToken[abc]")
    assert not fcm.is_expo_token(RAW)


def test_send_posts_one_v1_message_per_token_with_persona_only_payload(account, wire):
    tickets = fcm.send(
        [RAW, RAW + "2"], "Mento", "Quiet Cove replied", {"conversation_id": "c1", "n": 3}
    )
    assert tickets == [{"status": "ok"}, {"status": "ok"}]
    sends = [c for c in wire.calls if c["url"] != fcm._TOKEN_URL]
    assert [c["url"] for c in sends] == [
        "https://fcm.googleapis.com/v1/projects/proj/messages:send"
    ] * 2
    msg = sends[0]["json"]["message"]
    assert msg["token"] == RAW
    assert msg["notification"] == {"title": "Mento", "body": "Quiet Cove replied"}
    assert msg["data"] == {"conversation_id": "c1", "n": "3"}
    assert msg["android"]["notification"]["channel_id"] == "default"
    assert sends[0]["headers"]["Authorization"] == "Bearer tok-1"


def test_access_token_is_fetched_once_and_cached(account, wire):
    fcm.send([RAW], "Mento", "a", {})
    fcm.send([RAW], "Mento", "b", {})
    assert sum(c["url"] == fcm._TOKEN_URL for c in wire.calls) == 1


def test_unregistered_token_is_reported_dead(account, wire):
    wire.answers.append(_resp(404, {"error": {"status": "UNREGISTERED"}}))
    wire.answers.append(_resp(400, {"error": {"status": "INVALID_ARGUMENT"}}))
    tickets = fcm.send([RAW, RAW + "2"], "Mento", "a", {})
    dead = {"status": "error", "details": {"error": "DeviceNotRegistered"}}
    assert tickets == [dead, dead]


def test_transient_failure_raises_so_the_send_is_retried(account, wire):
    wire.answers.append(_resp(503, {"error": {"status": "UNAVAILABLE"}}))
    with pytest.raises(httpx.HTTPStatusError):
        fcm.send([RAW], "Mento", "a", {})


def test_rejected_access_token_is_dropped_for_the_retry(account, wire):
    wire.answers.append(_resp(401, {"error": {"status": "UNAUTHENTICATED"}}))
    with pytest.raises(httpx.HTTPStatusError):
        fcm.send([RAW], "Mento", "a", {})
    assert fcm._cache["token"] is None


def test_missing_or_incomplete_account_is_a_config_error(tmp_path, monkeypatch):
    monkeypatch.setattr(fcm, "get_settings", lambda: SimpleNamespace(fcm_service_account_file=""))
    with pytest.raises(fcm.FcmConfigError):
        fcm.send([RAW], "Mento", "a", {})
    bad = tmp_path / "bad.json"
    bad.write_text("{}")
    monkeypatch.setattr(
        fcm, "get_settings", lambda: SimpleNamespace(fcm_service_account_file=str(bad))
    )
    with pytest.raises(fcm.FcmConfigError):
        fcm.send([RAW], "Mento", "a", {})


def test_push_routes_expo_and_raw_tokens_and_keeps_ticket_order(monkeypatch):
    seen = {}
    monkeypatch.setattr(
        push.fcm, "send", lambda toks, *a, **k: seen.setdefault("fcm", toks) and [{"status": "ok"}]
    )
    monkeypatch.setattr(
        push, "_post_expo", lambda msgs: seen.setdefault("expo", msgs) and [{"status": "error"}]
    )
    tickets = push._post_or_raise([EXPO, RAW], "Quiet Cove replied", {"k": "v"})
    assert tickets == [{"status": "error"}, {"status": "ok"}]
    assert seen["fcm"] == [RAW]
    assert [m["to"] for m in seen["expo"]] == [EXPO]


def test_push_maps_fcm_config_and_http_errors_to_a_retryable_transport_error(monkeypatch):
    def boom(*a, **k):
        raise fcm.FcmConfigError("x")

    monkeypatch.setattr(push.fcm, "send", boom)
    with pytest.raises(push.PushTransportError):
        push._post_or_raise([RAW], "b", {})
