"""Stream Chat integration. Messages are stored server-side by Stream.

"Panda Wipe" performs a REAL server-side delete (DECISIONS §H.2) — never claim
on-device-only storage. In dev with no Stream creds, methods degrade to a safe
local stub so the onboarding/match slice runs without external credentials.
"""
from __future__ import annotations

import logging

from app.config import get_settings

logger = logging.getLogger("mento.stream")
_settings = get_settings()

try:  # SDK is optional in dev
    from stream_chat import StreamChat  # type: ignore
except Exception:  # pragma: no cover
    StreamChat = None  # type: ignore


def _client():
    if not (_settings.stream_api_key and _settings.stream_api_secret) or StreamChat is None:
        return None
    return StreamChat(api_key=_settings.stream_api_key, api_secret=_settings.stream_api_secret)


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
