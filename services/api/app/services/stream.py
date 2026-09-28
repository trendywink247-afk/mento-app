"""Stream Chat integration. Messages are stored server-side by Stream.

"Panda Wipe" performs a REAL server-side delete (DECISIONS §H.2) — never claim
on-device-only storage. In dev with no Stream creds, methods degrade to a safe
local stub so the onboarding/match slice runs without external credentials.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from functools import lru_cache

from app import ratelimit
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


def ensure_user(user_id: str, persona_name: str, avatar: str) -> bool:
    """`upsert_user` for paths where the Stream user is a follow-up, not the point of
    the request (an admin approval, a mentor's console sign-in): the database write
    has already happened, so a slow or unreachable Stream must not turn it into a 500.
    Idempotent. False (logged, never raised) when Stream did not take it — the next
    sign-in tries again."""
    try:
        upsert_user(user_id, persona_name, avatar)
        return True
    except Exception as exc:  # noqa: BLE001 — any client/transport failure is the same outcome
        logger.warning(
            "Stream upsert for %s did not land (%s); will retry on sign-in",
            user_id,
            type(exc).__name__,
        )
        return False


def rename_user(user_id: str, persona_name: str) -> bool:
    """Rotating mentor names (DECISIONS §L.6): the Stream user's display name follows
    the rename, so the chat header and every bubble in the thread agree. A partial
    update — image and role are left alone. Best-effort: False (logged, never raised)
    when Stream is unreachable, and the next rotation pass retries. Stub mode has no
    Stream user to rename, which counts as done."""
    client = _client()
    if client is None:
        return True
    try:
        client.update_user_partial({"id": user_id, "set": {"name": persona_name}})
    except Exception as exc:  # noqa: BLE001 — best-effort by design
        logger.warning("rename_user failed (%s)", type(exc).__name__)
        return False
    return True


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


def post_message(channel_id: str, user_id: str, text: str) -> str | None:
    """Send `text` into a channel AS `user_id`, server-side. Returns the message id.

    Used for the question a member asked before the mentor accepted: it is written in the
    ask flow, held on the request, and belongs in the thread as the member's own first
    message once there IS a thread.

    The crisis scan still applies — Stream calls the before-message-send webhook for every
    message including a server-side one (T&S #1, proven in tests/test_stream_hooks), so
    posting a held question here can never route around it.
    """
    client = _client()
    if client is None:
        logger.warning("Stream not configured — skipping post_message(%s)", channel_id)
        return None
    channel = client.channel("messaging", channel_id)
    resp = channel.send_message({"text": text}, user_id)
    return (resp or {}).get("message", {}).get("id")


def wipe_channel(channel_id: str) -> None:
    """Panda Wipe: hard-delete the channel and its messages on Stream's servers."""
    client = _client()
    if client is None:
        logger.warning("Stream not configured — skipping wipe_channel(%s)", channel_id)
        return
    client.delete_channels([f"messaging:{channel_id}"], hard_delete=True)


def _is_not_found(exc: Exception) -> bool:
    """Stream answers 404 for a channel or user that is already gone."""
    return getattr(exc, "status_code", None) == 404


def erase_channel(channel_id: str) -> None:
    """The tolerant hard delete: used by both member erasure (DELETE /me) and Clean
    Wipe. A channel that is already gone on Stream — or, for an own-chat conversation,
    was never created there at all (session 48) — counts as done; erasure must converge
    on a retry, not fail forever. Any other failure RAISES: the caller must not claim a
    deletion that did not happen."""
    try:
        wipe_channel(channel_id)
    except Exception as exc:  # noqa: BLE001 — classified here, re-raised unless "gone"
        if not _is_not_found(exc):
            raise


def delete_user(user_id: str) -> None:
    """Member erasure: hard-delete the member's Stream user and anything it still owns
    there. Already gone = done. Stub mode has no Stream user to delete. Any other failure
    RAISES — see erase_channel."""
    client = _client()
    if client is None:
        logger.warning("Stream not configured — skipping delete_user")
        return
    try:
        client.delete_user(user_id, hard_delete=True, mark_messages_deleted=True)
    except Exception as exc:  # noqa: BLE001 — classified here, re-raised unless "gone"
        if not _is_not_found(exc):
            raise


def freeze_channel(channel_id: str) -> bool:
    """Freeze a channel so no member can write into it again — the Stream half of
    Report / Block / Suspend (a blocked or suspended mentor's open client, or a saved
    Stream token, must not keep reaching the member). `frozen` can only be changed
    server-side. Best-effort: returns False (logged, never raised) when Stream is
    stubbed or unreachable — the safety action itself must still succeed."""
    client = _client()
    if client is None:
        logger.warning("Stream not configured — skipping freeze_channel")
        return False
    try:
        client.channel("messaging", channel_id).update_partial(to_set={"frozen": True})
    except Exception as exc:  # noqa: BLE001 — best-effort by design
        logger.warning("freeze_channel failed (%s)", type(exc).__name__)
        return False
    return True


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


def _parse_iso(raw: str) -> datetime | None:
    try:
        dt = datetime.fromisoformat(raw)
    except (ValueError, TypeError):
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt


_LMA_ERROR_SENTINEL = "ERR"  # negative-cache marker — never a valid ISO timestamp


def channel_last_message_at(channel_id: str) -> datetime | None:
    """Read-only lookup for the mentor console's brief (spec 2026-09-06 §4.3):
    when did this channel last see a message. `messages={"limit": 0}` asks
    Stream for channel state only — no message body ever travels over the wire
    for this lookup (defence in depth, T&S #7).

    Cached in Redis (`brief:lma:{channel_id}`, 30s) so re-opening the brief
    doesn't re-query Stream every tap; a channel with no messages yet caches the
    empty string so it isn't re-queried either. On a Stream failure a short
    negative-cache sentinel (5s) stands in, so an outage doesn't turn every brief
    tap into a live call; any Stream or Redis failure -> None, logged once — the
    brief still renders, just without this row (fail-soft, same philosophy as
    push._is_watching)."""
    key = f"brief:lma:{channel_id}"
    try:
        cached = ratelimit._redis().get(key)
    except Exception:
        cached = None
    if cached is not None:
        if cached == _LMA_ERROR_SENTINEL:
            return None
        return _parse_iso(cached) if cached else None

    client = _client()
    if client is None:
        return None
    try:
        resp = client.channel("messaging", channel_id).query(messages={"limit": 0}, state=True)
        raw = (resp.get("channel") or {}).get("last_message_at") or ""
    except Exception as exc:  # noqa: BLE001 — best-effort by design
        logger.warning(
            "channel_last_message_at query failed (%s) — returning None", type(exc).__name__
        )
        try:
            ratelimit._redis().set(key, _LMA_ERROR_SENTINEL, ex=5)
        except Exception:
            pass
        return None
    try:
        ratelimit._redis().set(key, raw, ex=30)
    except Exception:
        pass
    return _parse_iso(raw) if raw else None


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
