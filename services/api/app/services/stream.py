"""Stream Chat integration. Messages are stored server-side by Stream.

"Panda Wipe" performs a REAL server-side delete (DECISIONS §H.2) — never claim
on-device-only storage. In dev with no Stream creds, methods degrade to a safe
local stub so the onboarding/match slice runs without external credentials.
"""
from __future__ import annotations

import logging
from functools import lru_cache

from app.config import get_settings

logger = logging.getLogger("mento.stream")
_settings = get_settings()

try:  # SDK is optional in dev
    from stream_chat import StreamChat  # type: ignore
except Exception:  # pragma: no cover
    StreamChat = None  # type: ignore


@lru_cache
def _client():
    """One shared client (one requests.Session → connection reuse instead of a new
    TLS handshake per call). Explicit timeout: a slow Stream call must not pin a
    worker thread — or, via the matcher, listener row locks — for the SDK default."""
    if not (_settings.stream_api_key and _settings.stream_api_secret) or StreamChat is None:
        return None
    return StreamChat(
        api_key=_settings.stream_api_key,
        api_secret=_settings.stream_api_secret,
        timeout=_settings.stream_timeout_seconds,
    )


def upsert_user(user_id: str, persona_name: str, avatar: str) -> None:
    client = _client()
    if client is None:
        logger.warning("Stream not configured — skipping upsert_user(%s)", user_id)
        return
    client.upsert_user({"id": user_id, "name": persona_name, "image": avatar, "role": "user"})


def user_token(user_id: str) -> str:
    """Client token for the mobile Stream SDK."""
    client = _client()
    if client is None:
        logger.warning("Stream not configured — returning dev placeholder token")
        return f"dev-stream-token::{user_id}"
    return client.create_token(user_id)


def create_dm_channel(channel_id: str, user_id: str, listener_id: str) -> str:
    """Create a 1:1 messaging channel and return its id."""
    client = _client()
    if client is None:
        logger.warning("Stream not configured — returning dev channel id")
        return f"dev:{channel_id}"
    channel = client.channel("messaging", channel_id, {"members": [user_id, listener_id]})
    channel.create(user_id)
    return channel_id


def wipe_channel(channel_id: str) -> None:
    """Panda Wipe: hard-delete the channel and its messages on Stream's servers."""
    client = _client()
    if client is None:
        logger.warning("Stream not configured — skipping wipe_channel(%s)", channel_id)
        return
    client.delete_channels([f"messaging:{channel_id}"], hard_delete=True)


def fetch_channel_messages(channel_id: str) -> list[dict]:
    """Read-only crisis-review fetch — messages live in Stream, never stored here.
    Returns persona-tagged rows; empty in stub mode."""
    client = _client()
    if client is None or not channel_id:
        return []
    channel = client.channel("messaging", channel_id)
    state = channel.query(messages={"limit": 100})
    out = []
    for m in state.get("messages", []):
        out.append(
            {
                "id": m.get("id") or "",
                "text": m.get("text") or "",
                "user_persona": (m.get("user") or {}).get("name") or "Member",
                "at": str(m.get("created_at") or ""),
            }
        )
    return out


def is_configured() -> bool:
    """True when real Stream credentials are present (not stub mode)."""
    return _client() is not None


def verify_webhook(body: bytes, signature: str | None) -> bool:
    """Verify a Stream webhook's X-Signature (HMAC-SHA256 over the raw body).

    Returns False in stub mode or without a signature — callers must reject, so an
    unverified request never drives the safety scan.
    """
    client = _client()
    if client is None or not signature:
        return False
    return client.verify_webhook(body, signature)


def configure_webhooks(before_message_send_url: str, push_webhook_url: str) -> None:
    """Point Stream at our webhook endpoints (idempotent; run once per tunnel URL).

    - before_message_send_hook_url: synchronous enforcement (scan before delivery).
      Stays a dedicated setting (not part of the v2 event_hooks array).
    - event_hooks[webhook → message.new]: async push events — the retried safety net.
    """
    client = _client()
    if client is None:
        raise RuntimeError("Stream not configured — set STREAM_API_KEY/SECRET")
    client.update_app_settings(
        before_message_send_hook_url=before_message_send_url,
        # Max per-attempt budget (covers dev-tunnel latency; prod is much faster).
        before_message_send_hook_attempt_timeout_ms=5000,
        event_hooks=[
            {
                "enabled": True,
                "hook_type": "webhook",
                "webhook_url": push_webhook_url,
                "event_types": ["message.new"],
            }
        ],
    )
