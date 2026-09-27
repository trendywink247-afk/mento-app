"""Anonymous session tokens (JWT). No passwords, no PII in the token.

Every token this API mints carries `iss` (ISSUER), a per-role `aud` (AUDIENCES) and
a unique `jti` (T3.1). Each role verifies with its own secret: members with
JWT_SECRET, mentors (listener console) with LISTENER_JWT_SECRET, staff with
ADMIN_JWT_SECRET.

Legacy acceptance, both closing on dates — never earlier:
- Tokens minted before T3.1 carry no iss/aud/jti, and pre-split listener tokens are
  signed with JWT_SECRET. Accepted until `legacy_claims_accepted_until` (config).
- Member tokens minted before 2026-07-19 carry no role claim. Deployed clients hold
  90-day tokens, so role-less tokens stay valid until ROLELESS_ACCEPTED_UNTIL
  (2026-10-17). T3.3 closes this window automatically on that date.
"""

from __future__ import annotations

import hashlib
import hmac
import uuid
from datetime import UTC, date, datetime, timedelta

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWTError as JWTError
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app.config import get_settings
from app.db import get_db
from app.errors import ApiProblem
from app.models.enums import MemberStatus
from app.models.user import User

_ALGO = "HS256"
_bearer = HTTPBearer(auto_error=True)

ISSUER = "mento-api"
AUDIENCES = {"user": "mento:member", "listener": "mento:listener", "admin": "mento:admin"}

# Role-less member tokens (pre 2026-07-19) are refused from this day on (T3.3).
ROLELESS_ACCEPTED_UNTIL = date(2026, 10, 17)


def _now() -> datetime:
    """The clock the legacy windows are judged by (tests move it)."""
    return datetime.now(UTC)


def _before(day: date) -> bool:
    return _now() < datetime.combine(day, datetime.min.time(), UTC)


def _signing_secret(role: str) -> str:
    """The secret NEW tokens of a role are signed with. Admin and listener use their
    dedicated secrets when configured (smaller blast radius if the member secret
    leaks); when unset (dev only — boot refuses it elsewhere) they use jwt_secret."""
    settings = get_settings()
    if role == "admin" and settings.admin_jwt_secret:
        return settings.admin_jwt_secret
    if role == "listener" and settings.listener_jwt_secret:
        return settings.listener_jwt_secret
    return settings.jwt_secret


def hash_pin(pin: str, salt: str) -> str:
    """Hash a conversation lock PIN. Simplified v1 lock (a 4-digit PIN is low-entropy
    by nature) — pbkdf2 with the conversation id as salt; never store the PIN itself."""
    return hashlib.pbkdf2_hmac("sha256", pin.encode(), salt.encode(), 100_000).hex()


def verify_pin(pin: str, salt: str, pin_hash: str | None) -> bool:
    if not pin_hash:
        return False
    return hmac.compare_digest(hash_pin(pin, salt), pin_hash)


def _mint(subject: str, role: str, ttl: timedelta, **extra: str) -> str:
    now = _now()
    payload = {
        "sub": subject,
        "role": role,
        "iss": ISSUER,
        "aud": AUDIENCES[role],
        "jti": uuid.uuid4().hex,
        "iat": int(now.timestamp()),
        "exp": int((now + ttl).timestamp()),
        **extra,
    }
    return jwt.encode(payload, _signing_secret(role), algorithm=_ALGO)


def issue_session_token(user_id: str) -> str:
    """Mint a long-lived (jwt_ttl_days) member session JWT — the pre-refresh shape
    that clients without refresh support still receive and hold. Refresh-capable
    clients exchange it (POST /auth/upgrade) for a short access token + refresh
    token pair (services/sessions.py)."""
    return _mint(user_id, "user", timedelta(days=get_settings().jwt_ttl_days))


def issue_access_token(user_id: str, session_family_id: str) -> str:
    """Mint a short (access_token_minutes) member access token bound to a refresh
    family via `sid`. Renewed with POST /auth/refresh (services/sessions.py)."""
    ttl = timedelta(minutes=get_settings().access_token_minutes)
    return _mint(user_id, "user", ttl, sid=session_family_id)


def user_token_claims(creds: HTTPAuthorizationCredentials = Depends(_bearer)) -> dict:
    """The verified member token's claims — for the few endpoints that care which
    KIND of member token it is (POST /auth/upgrade)."""
    payload = _decode(creds, "user")
    if not _member_role_ok(payload.get("role")) or not payload.get("sub"):
        raise _unauthorized("not a user session")
    return payload


def issue_listener_token(listener_id: str) -> str:
    """Mint a listener-console JWT (role claim distinguishes it from user sessions;
    revocation is the per-request vetting_status check, not the token itself)."""
    return _mint(listener_id, "listener", timedelta(days=get_settings().listener_jwt_ttl_days))


def issue_admin_token(admin_id: str) -> str:
    """Mint an admin-console JWT (role claim; revocation = per-request status check)."""
    return _mint(admin_id, "admin", timedelta(days=get_settings().admin_jwt_ttl_days))


def _unauthorized(detail: str = "invalid or expired session") -> HTTPException:
    return HTTPException(status.HTTP_401_UNAUTHORIZED, detail)


def _decode(creds: HTTPAuthorizationCredentials, role: str) -> dict:
    """Verify a bearer token for `role`: signature with the role's secret, expiry,
    then iss/aud. A claim-less (pre-T3.1) token is accepted only before the legacy
    cutoff — and for a listener, only then may it be signed with the member secret."""
    settings = get_settings()
    current = _signing_secret(role)
    # (secret, is_legacy): pre-split mentor tokens verify with the member secret.
    secrets = [(current, False)]
    if role == "listener" and settings.jwt_secret != current:
        secrets.append((settings.jwt_secret, True))
    for secret, is_legacy in secrets:
        try:
            payload = jwt.decode(
                creds.credentials,
                secret,
                algorithms=[_ALGO],
                # Every token this API has ever minted carries all three; one without
                # an expiry would never lapse. iss/aud are checked below, by hand,
                # because pre-T3.1 tokens legitimately lack them.
                options={"require": ["exp", "iat", "sub"], "verify_aud": False},
            )
        except jwt.InvalidSignatureError:
            continue
        except JWTError as exc:
            raise _unauthorized() from exc
        claimed = "iss" in payload or "aud" in payload
        if claimed:
            if is_legacy:
                raise _unauthorized()  # a new-format mentor token on the member secret
            if payload.get("iss") != ISSUER or payload.get("aud") != AUDIENCES[role]:
                raise _unauthorized()
        elif not _before(settings.legacy_claims_accepted_until):
            raise _unauthorized()
        return payload
    raise _unauthorized()


def _peek_role(creds: HTTPAuthorizationCredentials) -> str | None:
    """The UNVERIFIED role claim — only to pick which secret to verify with."""
    try:
        return jwt.decode(creds.credentials, options={"verify_signature": False}).get("role")
    except JWTError:
        return None


def _member_role_ok(role: str | None) -> bool:
    return role == "user" or (role is None and _before(ROLELESS_ACCEPTED_UNTIL))


def user_id_from_token(creds: HTTPAuthorizationCredentials) -> str:
    """The member id a bearer token proves — the token alone, no standing check.
    Rejects listener/admin tokens — roles must never cross endpoints."""
    payload = _decode(creds, "user")
    if not _member_role_ok(payload.get("role")):
        raise _unauthorized("not a user session")
    user_id = payload.get("sub")
    if not user_id:
        raise _unauthorized("malformed session")
    return user_id


def current_user_id_any_standing(
    creds: HTTPAuthorizationCredentials = Depends(_bearer),
) -> str:
    """For the one place a suspended or banned member may still read: their own
    account (GET /me), so the app can say why and until when."""
    return user_id_from_token(creds)


def current_user_id(
    creds: HTTPAuthorizationCredentials = Depends(_bearer),
    db: DbSession = Depends(get_db),
) -> str:
    """FastAPI dependency for every member route: the member id, refused with 403
    `member_suspended` / `member_banned` while a suspension or ban is in force (T3.7).
    A token for a member row that no longer exists passes — routes answer that
    themselves (401 unknown session). Shares the request's DB session."""
    from app.services.member_status import standing  # reason: services import security

    user_id = user_id_from_token(creds)
    row = db.execute(select(User.status, User.banned_until).where(User.id == user_id)).first()
    if row is not None:
        now = standing(row[0], row[1])
        if now.status != MemberStatus.active:
            raise ApiProblem(
                status.HTTP_403_FORBIDDEN,
                f"member_{now.status.value}",
                (
                    "Your account is paused by the Mento team."
                    if now.status == MemberStatus.suspended
                    else "Your account has been closed by the Mento team."
                ),
                until=now.until.isoformat() if now.until else None,
            )
    return user_id


def current_listener_id(
    creds: HTTPAuthorizationCredentials = Depends(_bearer),
) -> str:
    """FastAPI dependency: resolve the listener id from a role-claimed bearer token."""
    payload = _decode(creds, "listener")
    if payload.get("role") != "listener":
        raise _unauthorized("not a listener session")
    listener_id = payload.get("sub")
    if not listener_id:
        raise _unauthorized("malformed session")
    return listener_id


def current_member_or_listener(
    creds: HTTPAuthorizationCredentials = Depends(_bearer),
) -> tuple[str, str]:
    """For the few endpoints BOTH sides of the app may call (product feedback):
    ("member" | "mentor", id). Admin tokens are refused — they sign with their own
    secret and carry their own role."""
    if _peek_role(creds) == "listener":
        return "mentor", current_listener_id(creds)
    payload = _decode(creds, "user")
    subject = payload.get("sub")
    if not subject:
        raise _unauthorized("malformed session")
    if _member_role_ok(payload.get("role")):
        return "member", subject
    raise _unauthorized("not a member or mentor session")


def current_admin_id(
    creds: HTTPAuthorizationCredentials = Depends(_bearer),
) -> str:
    """Resolve the admin id from a role-claimed bearer token."""
    payload = _decode(creds, "admin")
    if payload.get("role") != "admin":
        raise _unauthorized("not an admin session")
    admin_id = payload.get("sub")
    if not admin_id:
        raise _unauthorized("malformed session")
    return admin_id
