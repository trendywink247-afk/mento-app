"""Application settings, loaded from environment (.env in dev)."""

from __future__ import annotations

import json
from functools import lru_cache
from urllib.parse import urlsplit

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
    # Number of trusted reverse-proxy hops in front of the API. 0 (default) =
    # no trusted proxy: X-Forwarded-For is ignored for rate-limit identity (it
    # is attacker-writable). Set to the number of proxies YOUR infra appends
    # (e.g. 1 behind a single load balancer) to use the right-most untrusted hop.
    trusted_proxy_hops: int = 0

    # Push (spec 2026-09-05): best-effort sends via Expo's push API.
    push_enabled: bool = True
    push_burst_seconds: int = 60
    push_watch_cache_seconds: int = 5

    # Dedicated thread budget for the crisis-scan webhooks — isolated from the
    # shared anyio threadpool so slow sync handlers can't starve the safety scan.
    crisis_scan_threads: int = 8

    # PII redaction on the outbound message path (app/services/moderation.py).
    # On by default — anonymity is the product promise (T&S #7). Regex layer needs
    # no extra deps; the optional Presidio/spaCy NER (pii_use_presidio) auto-detects
    # its install and silently degrades to regex-only when absent (requirements-ml.txt).
    pii_redaction_enabled: bool = True
    pii_use_presidio: bool = True

    # Outbound Stream API budget; a slow Stream call must not pin threads for the
    # SDK's ~6s default.
    stream_timeout_seconds: float = 3.0

    # Member message allowance (DECISIONS §L.2): at most N member messages in a row
    # before the mentor replies, and N per IST day per member. Counted and held in
    # the Stream before-send hook, AFTER the crisis scan — a crisis-flagged message
    # (or any message in a conversation flagged within the exempt window) is never
    # held and never counted. `allowance_enforced` is the rollout switch: counting is
    # always on (the composer meter and the admin numbers work), holding starts when
    # this is true — flip it once the app renders the A22 note. Fail-open: a slow or
    # unreachable database delivers the message (budget below).
    allowance_enabled: bool = True
    allowance_enforced: bool = False
    allowance_in_a_row: int = 3
    allowance_per_day: int = 10
    allowance_crisis_exempt_hours: int = 24
    allowance_budget_ms: int = 800

    # Rotating mentor names + consented "stay in touch" (DECISIONS §L.6–7,
    # services/mentor_names.py, services/in_touch.py). Names change at 04:00 IST.
    mentor_name_rotation_enabled: bool = True
    in_touch_limit: int = 2
    # After a quiet "not now", how long before the same member may ask that mentor
    # again ("the ask is one tap and never nags").
    in_touch_reask_days: int = 7

    # Conversations active longer than this are considered abandoned; the admin
    # reconcile action ends them and frees the listener's slot.
    conversation_max_age_hours: int = 24

    # Snooze (DECISIONS §L, founder 2026-09-19): how long a mentor's "Snooze 24 h"
    # quiets one waiting conversation.
    snooze_hours: int = 24

    # Public web origins (spec 2026-09-19 unified-domains §3.3). app = the one web
    # app (member + mentor sides, /apply, sign-in links); admin = the staff
    # dashboard's own origin. Links the API mints are built from these — see
    # app/services/links.py. Empty = fall back to console_base_url.
    app_base_url: str = ""
    admin_base_url: str = ""

    # DEPRECATED single-origin setting, kept as the fallback for both URLs above so
    # a deploy that lands before the env is edited cannot break link minting.
    console_base_url: str = "http://localhost:8081"

    # Comma-separated browser origins allowed by CORS outside dev (the web build
    # calls this API cross-origin). Empty = derive from the two base URLs above.
    cors_origins: str = ""

    stream_api_key: str = ""
    stream_api_secret: str = ""

    razorpay_key_id: str = ""
    razorpay_key_secret: str = ""

    posthog_api_key: str = ""
    posthog_host: str = "https://app.posthog.com"

    # Sentry error reporting. Empty = Sentry off (dev default); errors-only when
    # set — never performance traces, never request bodies (see app/main.py).
    sentry_dsn: str = ""

    # Journal note-sorting (opt-in AI, app/services/notes_ai.py). Empty key = feature
    # DARK: the endpoint returns 503 and the app shows "coming soon". Only the user's
    # OWN entries (mood/finance/gratitude) are ever sent — never chat/mentor-notes,
    # never crisis content. Cloud LLM (the one sanctioned content egress, opt-in).
    gemini_api_key: str = ""
    gemini_model: str = "gemini-1.5-flash"

    # Raw JSON string from env; parsed via `helplines`.
    crisis_helplines_json: str = (
        '[{"name":"Tele-MANAS","number":"14416","hours":"24x7"},'
        '{"name":"KIRAN","number":"1800-599-0019","hours":"24x7"}]'
    )

    @property
    def is_dev(self) -> bool:
        return self.env == "dev"

    @property
    def resolved_app_base_url(self) -> str:
        return (self.app_base_url or self.console_base_url).rstrip("/")

    @property
    def resolved_admin_base_url(self) -> str:
        return (self.admin_base_url or self.console_base_url).rstrip("/")

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def resolved_cors_origins(self) -> list[str]:
        """Origins the CORS middleware should allow.

        Dev: wildcard (auth is bearer-token, credentials off, so "*" is valid).
        Otherwise: the configured CORS_ORIGINS list; if empty, the origins of the
        app and admin base URLs (deduped, app first) so the web build works
        without extra config.
        """
        if self.is_dev:
            return ["*"]
        configured = self.cors_origin_list
        if configured:
            return configured
        derived: list[str] = []
        for url in (self.resolved_app_base_url, self.resolved_admin_base_url):
            origin = origin_of(url)
            if origin and origin not in derived:
                derived.append(origin)
        return derived

    @property
    def helplines(self) -> list[dict]:
        try:
            return json.loads(self.crisis_helplines_json)
        except (json.JSONDecodeError, TypeError):
            return []


@lru_cache
def get_settings() -> Settings:
    return Settings()
