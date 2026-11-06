"""Direct Firebase Cloud Messaging (HTTP v1) sender — no push relay.

Used for device tokens that are not Expo tokens. Authenticates with a Google service
account (RS256 JWT -> OAuth access token, cached until shortly before expiry), using
PyJWT and cryptography which the API already depends on. The service-account file is
read from `FCM_SERVICE_ACCOUNT_FILE` and never logged. Results come back in Expo's
ticket shape so `push._forget_dead_tokens` handles both senders alike.
"""

from __future__ import annotations

import json
import logging
import threading
import time
from pathlib import Path

import httpx
import jwt

from app.config import get_settings

logger = logging.getLogger("mento.push.fcm")

_SCOPE = "https://www.googleapis.com/auth/firebase.messaging"
_TOKEN_URL = "https://oauth2.googleapis.com/token"
_SEND_URL = "https://fcm.googleapis.com/v1/projects/{project}/messages:send"
_TIMEOUT = 10.0
# Refresh a minute early so a token never expires mid-batch.
_SKEW = 60

_lock = threading.Lock()
_cache: dict[str, object] = {"token": None, "expires": 0.0}


class FcmConfigError(Exception):
    """The service account is missing or unreadable — nothing can be sent."""


def is_expo_token(token: str) -> bool:
    return token.startswith(("ExponentPushToken[", "ExpoPushToken["))


def _account() -> dict:
    path = get_settings().fcm_service_account_file
    if not path:
        raise FcmConfigError("FCM_SERVICE_ACCOUNT_FILE is not set")
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise FcmConfigError(type(exc).__name__) from exc
    if not all(data.get(k) for k in ("client_email", "private_key", "project_id")):
        raise FcmConfigError("service account file is incomplete")
    return data


def _access_token(account: dict) -> str:
    with _lock:
        if _cache["token"] and float(_cache["expires"]) > time.time() + _SKEW:
            return str(_cache["token"])
        now = int(time.time())
        assertion = jwt.encode(
            {
                "iss": account["client_email"],
                "scope": _SCOPE,
                "aud": _TOKEN_URL,
                "iat": now,
                "exp": now + 3600,
            },
            account["private_key"],
            algorithm="RS256",
        )
        resp = httpx.post(
            _TOKEN_URL,
            data={
                "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
                "assertion": assertion,
            },
            timeout=_TIMEOUT,
        )
        resp.raise_for_status()
        body = resp.json()
        _cache["token"] = body["access_token"]
        _cache["expires"] = now + int(body.get("expires_in", 3600))
        return str(_cache["token"])


def _ticket(resp: httpx.Response) -> dict:
    """Map one FCM answer to an Expo-style ticket. A token FCM says is gone is dead;
    anything transient raises so the whole send is retried by the caller."""
    if resp.status_code == 200:
        return {"status": "ok"}
    status = ""
    try:
        status = str((resp.json().get("error") or {}).get("status") or "")
    except ValueError:
        pass
    if resp.status_code == 404 or status == "UNREGISTERED":
        return {"status": "error", "details": {"error": "DeviceNotRegistered"}}
    if resp.status_code == 400 and status == "INVALID_ARGUMENT":
        # A malformed or foreign token will never work; treat it as dead.
        return {"status": "error", "details": {"error": "DeviceNotRegistered"}}
    resp.raise_for_status()
    return {"status": "error", "details": {"error": status or "Unknown"}}


def send(
    tokens: list[str], title: str, body: str, data: dict, channel_id: str = "default"
) -> list[dict]:
    """One FCM message per token; returns tickets in the same order. Raises
    httpx.HTTPError / FcmConfigError on anything worth retrying or fixing."""
    account = _account()
    bearer = _access_token(account)
    url = _SEND_URL.format(project=account["project_id"])
    string_data = {str(k): v if isinstance(v, str) else json.dumps(v) for k, v in data.items()}
    tickets: list[dict] = []
    for token in tokens:
        message = {
            "message": {
                "token": token,
                "notification": {"title": title, "body": body},
                "data": string_data,
                "android": {"priority": "HIGH", "notification": {"channel_id": channel_id}},
            }
        }
        resp = httpx.post(
            url, json=message, headers={"Authorization": f"Bearer {bearer}"}, timeout=_TIMEOUT
        )
        if resp.status_code == 401:
            with _lock:
                _cache["token"] = None  # revoked or stale: fetch a new one on the retry
        tickets.append(_ticket(resp))
    return tickets
