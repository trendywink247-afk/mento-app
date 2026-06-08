"""Application settings, loaded from environment (.env in dev)."""
from __future__ import annotations

import json
from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    env: str = "dev"
    jwt_secret: str = "change-me-long-random"
    jwt_ttl_days: int = 90
    min_age: int = 18

    # Guards the moderation review queue. Empty = queue disabled (no console yet).
    admin_token: str = ""

    database_url: str = "postgresql+psycopg://mento:mento@localhost:5432/mento"
    redis_url: str = "redis://localhost:6379/0"

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
    def helplines(self) -> list[dict]:
        try:
            return json.loads(self.crisis_helplines_json)
        except (json.JSONDecodeError, TypeError):
            return []


@lru_cache
def get_settings() -> Settings:
    return Settings()
