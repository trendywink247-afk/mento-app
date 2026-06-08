"""Anonymous session tokens (JWT). No passwords, no PII in the token."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

from app.config import get_settings

_settings = get_settings()
_ALGO = "HS256"
_bearer = HTTPBearer(auto_error=True)


def issue_session_token(user_id: str) -> str:
    """Mint an anonymous session JWT carrying only the opaque user id."""
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(days=_settings.jwt_ttl_days)).timestamp()),
    }
    return jwt.encode(payload, _settings.jwt_secret, algorithm=_ALGO)


def current_user_id(
    creds: HTTPAuthorizationCredentials = Depends(_bearer),
) -> str:
    """FastAPI dependency: resolve the anonymous user id from the bearer token."""
    try:
        payload = jwt.decode(creds.credentials, _settings.jwt_secret, algorithms=[_ALGO])
    except JWTError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid or expired session") from exc
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "malformed session")
    return user_id
