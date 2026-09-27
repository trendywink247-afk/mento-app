"""Anonymous session tokens (JWT). No passwords, no PII in the token."""

from __future__ import annotations

import hashlib
import hmac
from datetime import UTC, datetime, timedelta

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWTError as JWTError

from app.config import get_settings

_ALGO = "HS256"


class _Bearer(HTTPBearer):
    """HTTPBearer that keeps the pre-0.12x answer for a MISSING header: 403.

    FastAPI now says 401 there. Clients treat 401 as "your session is dead" (the
    member app clears it and re-onboards), so a dependency bump must not change
    which of the two a request gets. A bad or expired token is still 401 from
    `_decode`. This override is the one FastAPI documents for keeping 403.
    """

    def make_not_authenticated_error(self) -> HTTPException:
        return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authenticated")


_bearer = _Bearer(auto_error=True)


def _signing_secret(role: str) -> str:
    """Pick the signing secret for a role. Admin tokens use the dedicated
    admin_jwt_secret when configured (smaller blast radius if the shared secret
    leaks); everything else — and admin when unset — uses jwt_secret."""
    settings = get_settings()
    if role == "admin" and settings.admin_jwt_secret:
        return settings.admin_jwt_secret
    return settings.jwt_secret


def hash_pin(pin: str, salt: str) -> str:
    """Hash a conversation lock PIN. Simplified v1 lock (a 4-digit PIN is low-entropy
    by nature) — pbkdf2 with the conversation id as salt; never store the PIN itself."""
    return hashlib.pbkdf2_hmac("sha256", pin.encode(), salt.encode(), 100_000).hex()


def verify_pin(pin: str, salt: str, pin_hash: str | None) -> bool:
    if not pin_hash:
        return False
    return hmac.compare_digest(hash_pin(pin, salt), pin_hash)


def issue_session_token(user_id: str) -> str:
    """Mint an anonymous session JWT carrying the opaque user id and an explicit
    user role claim."""
    now = datetime.now(UTC)
    payload = {
        "sub": user_id,
        "role": "user",
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(days=get_settings().jwt_ttl_days)).timestamp()),
    }
    return jwt.encode(payload, _signing_secret("user"), algorithm=_ALGO)


def issue_listener_token(listener_id: str) -> str:
    """Mint a listener-console JWT (role claim distinguishes it from user sessions;
    revocation is the per-request vetting_status check, not the token itself)."""
    now = datetime.now(UTC)
    payload = {
        "sub": listener_id,
        "role": "listener",
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(days=get_settings().listener_jwt_ttl_days)).timestamp()),
    }
    return jwt.encode(payload, _signing_secret("listener"), algorithm=_ALGO)


def issue_admin_token(admin_id: str) -> str:
    """Mint an admin-console JWT (role claim; revocation = per-request status check)."""
    now = datetime.now(UTC)
    payload = {
        "sub": admin_id,
        "role": "admin",
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(days=get_settings().admin_jwt_ttl_days)).timestamp()),
    }
    return jwt.encode(payload, _signing_secret("admin"), algorithm=_ALGO)


def _decode(creds: HTTPAuthorizationCredentials, role: str) -> dict:
    try:
        return jwt.decode(
            creds.credentials,
            _signing_secret(role),
            algorithms=[_ALGO],
            # Every token this API has ever minted carries all three; one without an
            # expiry would never lapse.
            options={"require": ["exp", "iat", "sub"]},
        )
    except JWTError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid or expired session") from exc


def current_user_id(
    creds: HTTPAuthorizationCredentials = Depends(_bearer),
) -> str:
    """FastAPI dependency: resolve the anonymous user id from the bearer token.
    Rejects listener/admin tokens — roles must never cross endpoints.

    Legacy acceptance: tokens minted before 2026-07-19 carry no role claim.
    Deployed clients hold 90-day tokens, so role-less tokens stay valid until one
    TTL cycle has passed — the `None` branch can be dropped after 2026-10-17."""
    payload = _decode(creds, "user")
    if payload.get("role") not in ("user", None):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "not a user session")
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "malformed session")
    return user_id


def current_listener_id(
    creds: HTTPAuthorizationCredentials = Depends(_bearer),
) -> str:
    """FastAPI dependency: resolve the listener id from a role-claimed bearer token."""
    payload = _decode(creds, "listener")
    if payload.get("role") != "listener":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "not a listener session")
    listener_id = payload.get("sub")
    if not listener_id:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "malformed session")
    return listener_id


def current_member_or_listener(
    creds: HTTPAuthorizationCredentials = Depends(_bearer),
) -> tuple[str, str]:
    """For the few endpoints BOTH sides of the app may call (product feedback):
    ("member" | "mentor", id). Admin tokens are refused — they sign with their own
    secret and carry their own role."""
    payload = _decode(creds, "user")
    subject = payload.get("sub")
    if not subject:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "malformed session")
    role = payload.get("role")
    if role in ("user", None):
        return "member", subject
    if role == "listener":
        return "mentor", subject
    raise HTTPException(status.HTTP_401_UNAUTHORIZED, "not a member or mentor session")


def current_admin_id(
    creds: HTTPAuthorizationCredentials = Depends(_bearer),
) -> str:
    """Resolve the admin id from a role-claimed bearer token."""
    payload = _decode(creds, "admin")
    if payload.get("role") != "admin":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "not an admin session")
    admin_id = payload.get("sub")
    if not admin_id:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "malformed session")
    return admin_id
