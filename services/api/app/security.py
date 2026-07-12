"""Anonymous session tokens (JWT). No passwords, no PII in the token."""
from __future__ import annotations

import hashlib
import hmac
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

from app.config import get_settings

_settings = get_settings()
_ALGO = "HS256"
_bearer = HTTPBearer(auto_error=True)


def hash_pin(pin: str, salt: str) -> str:
    """Hash a conversation lock PIN. Simplified v1 lock (a 4-digit PIN is low-entropy
    by nature) — pbkdf2 with the conversation id as salt; never store the PIN itself."""
    return hashlib.pbkdf2_hmac("sha256", pin.encode(), salt.encode(), 100_000).hex()


def verify_pin(pin: str, salt: str, pin_hash: str | None) -> bool:
    if not pin_hash:
        return False
    return hmac.compare_digest(hash_pin(pin, salt), pin_hash)


def issue_session_token(user_id: str) -> str:
    """Mint an anonymous session JWT carrying only the opaque user id."""
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(days=_settings.jwt_ttl_days)).timestamp()),
    }
    return jwt.encode(payload, _settings.jwt_secret, algorithm=_ALGO)


def issue_listener_token(listener_id: str) -> str:
    """Mint a listener-console JWT (role claim distinguishes it from user sessions;
    revocation is the per-request vetting_status check, not the token itself)."""
    now = datetime.now(timezone.utc)
    payload = {
        "sub": listener_id,
        "role": "listener",
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(days=_settings.listener_jwt_ttl_days)).timestamp()),
    }
    return jwt.encode(payload, _settings.jwt_secret, algorithm=_ALGO)


def issue_admin_token(admin_id: str) -> str:
    """Mint an admin-console JWT (role claim; revocation = per-request status check)."""
    now = datetime.now(timezone.utc)
    payload = {
        "sub": admin_id,
        "role": "admin",
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(days=_settings.listener_jwt_ttl_days)).timestamp()),
    }
    return jwt.encode(payload, _settings.jwt_secret, algorithm=_ALGO)


def _decode(creds: HTTPAuthorizationCredentials) -> dict:
    try:
        return jwt.decode(creds.credentials, _settings.jwt_secret, algorithms=[_ALGO])
    except JWTError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid or expired session") from exc


def current_user_id(
    creds: HTTPAuthorizationCredentials = Depends(_bearer),
) -> str:
    """FastAPI dependency: resolve the anonymous user id from the bearer token.
    Rejects listener tokens — the two roles must never cross endpoints. Legacy
    role-less tokens remain valid user sessions."""
    payload = _decode(creds)
    if payload.get("role") in ("listener", "admin"):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "not a user session")
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "malformed session")
    return user_id


def current_listener_id(
    creds: HTTPAuthorizationCredentials = Depends(_bearer),
) -> str:
    """FastAPI dependency: resolve the listener id from a role-claimed bearer token."""
    payload = _decode(creds)
    if payload.get("role") != "listener":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "not a listener session")
    listener_id = payload.get("sub")
    if not listener_id:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "malformed session")
    return listener_id


def current_admin_id(
    creds: HTTPAuthorizationCredentials = Depends(_bearer),
) -> str:
    """Resolve the admin id from a role-claimed bearer token."""
    payload = _decode(creds)
    if payload.get("role") != "admin":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "not an admin session")
    admin_id = payload.get("sub")
    if not admin_id:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "malformed session")
    return admin_id
