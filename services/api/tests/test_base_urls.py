"""Public web origins (spec 2026-09-19 unified-domains §3.3): APP_BASE_URL and
ADMIN_BASE_URL, the deprecated CONSOLE_BASE_URL fallback that keeps a
deploy-before-env-edit safe, and the CORS list derived from them. Pure Settings
tests — no app boot, no database.
"""

from __future__ import annotations

from app.config import Settings


def _settings(**kwargs) -> Settings:
    # _env_file=None keeps the developer's local .env out of these proofs.
    return Settings(_env_file=None, **kwargs)


def test_new_urls_fall_back_to_console_base_url():
    s = _settings(console_base_url="https://console.example")
    assert s.resolved_app_base_url == "https://console.example"
    assert s.resolved_admin_base_url == "https://console.example"


def test_new_urls_win_over_console_base_url():
    s = _settings(
        console_base_url="https://console.example",
        app_base_url="https://app.example",
        admin_base_url="https://admin.example",
    )
    assert s.resolved_app_base_url == "https://app.example"
    assert s.resolved_admin_base_url == "https://admin.example"


def test_each_url_falls_back_independently():
    s = _settings(console_base_url="https://console.example", app_base_url="https://app.example")
    assert s.resolved_app_base_url == "https://app.example"
    assert s.resolved_admin_base_url == "https://console.example"


def test_trailing_slash_is_dropped():
    s = _settings(app_base_url="https://app.example/", admin_base_url="https://admin.example//")
    assert s.resolved_app_base_url == "https://app.example"
    assert s.resolved_admin_base_url == "https://admin.example"


def test_prod_cors_derives_both_origins_in_order():
    s = _settings(
        env="prod",
        cors_origins="",
        app_base_url="https://app.example/x",
        admin_base_url="https://admin.example",
    )
    assert s.resolved_cors_origins == ["https://app.example", "https://admin.example"]


def test_prod_cors_dedupes_when_both_fall_back_to_console():
    s = _settings(env="prod", cors_origins="", console_base_url="https://console.example/x")
    assert s.resolved_cors_origins == ["https://console.example"]


def test_explicit_cors_origins_still_win():
    s = _settings(
        env="prod", cors_origins="https://only.example", app_base_url="https://app.example"
    )
    assert s.resolved_cors_origins == ["https://only.example"]
