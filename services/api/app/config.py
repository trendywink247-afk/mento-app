"""Application settings, loaded from environment (.env in dev)."""
from __future__ import annotations

import json
from functools import lru_cache
from urllib.parse import urlsplit

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


def origin_of(url: str) -> str:
    """The origin (scheme://host[:port]) of a URL, or "" if it has none."""
    parts = urlsplit(url)
    if not (parts.scheme and parts.netloc):
        return ""
    return f"{parts.scheme}://{parts.netloc}"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    env: str = "dev"
    jwt_secret: str = "change-me-long-random"
    jwt_ttl_days: int = 90
    # Listener-console token links are shareable strings — keep their life shorter
    # than user sessions; regeneration is one script run (scripts/issue_listener_token).
    listener_jwt_ttl_days: int = 30
    # Admin-console tokens are the highest-privilege credential — shortest life.
    admin_jwt_ttl_days: int = 14
    # Optional dedicated signing secret for admin tokens. When set, admin JWTs
    # sign/verify with it (a leaked user/listener secret can't forge admin access).
    # Empty = fall back to jwt_secret (backward compatible).
    admin_jwt_secret: str = ""
    min_age: int = 18

    # Guards the static-header admin endpoints in routers/listeners.py (listener
    # CRUD bootstrap). Empty = those endpoints disabled.
    admin_token: str = ""

    database_url: str = "postgresql+psycopg://mento:mento@localhost:5432/mento"
    # Sized for a single process: workers × (pool_size + max_overflow) must stay
    # under Postgres max_connections (default 100). pool_timeout fails fast — a
    # 5s 500 beats a 30s hang on a support app.
    db_pool_size: int = 20
    db_max_overflow: int = 20
    db_pool_timeout: int = 5
    db_pool_recycle: int = 1800

    redis_url: str = "redis://localhost:6379/0"
    # Redis-backed rate limiting (see app/ratelimit.py). Fail-open when Redis is
    # unreachable — never hard-block a support conversation on infra hiccups.
    rate_limit_enabled: bool = True

    # Outbound Stream API budget; a slow Stream call must not pin threads for the
    # SDK's ~6s default.
    stream_timeout_seconds: float = 3.0

    # Conversations active longer than this are considered abandoned; the admin
    # reconcile action ends them and frees the listener's slot.
    conversation_max_age_hours: int = 24

    # Base URL the admin dashboard prints into copyable console links.
    console_base_url: str = "http://localhost:8081"

    # Comma-separated browser origins allowed by CORS outside dev (the listener
    # console and admin dashboard are web-only and call this API cross-origin).
    # Empty = fall back to console_base_url's origin so consoles work out of the box.
    cors_origins: str = ""

    stream_api_key: str = ""
    stream_api_secret: str = ""

    razorpay_key_id: str = ""
    razorpay_key_secret: str = ""

    posthog_api_key: str = ""
    posthog_host: str = "https://app.posthog.com"

    # Raw JSON string from env; parsed via `helplines`.
    crisis_helplines_json: str = (
        '[{"name":"Tele-MANAS","number":"14416","hours":"24x7"},'
        '{"name":"KIRAN","number":"1800-599-0019","hours":"24x7"}]'
    )

    @property
    def is_dev(self) -> bool:
        return self.env == "dev"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def resolved_cors_origins(self) -> list[str]:
        """Origins the CORS middleware should allow.

        Dev: wildcard (auth is bearer-token, credentials off, so "*" is valid).
        Otherwise: the configured CORS_ORIGINS list; if empty, derive the origin
        of console_base_url so the web consoles work without extra config.
        """
        if self.is_dev:
            return ["*"]
        configured = self.cors_origin_list
        if configured:
            return configured
        fallback = origin_of(self.console_base_url)
        return [fallback] if fallback else []

    @property
    def helplines(self) -> list[dict]:
        try:
            return json.loads(self.crisis_helplines_json)
        except (json.JSONDecodeError, TypeError):
            return []


@lru_cache
def get_settings() -> Settings:
    return Settings()
