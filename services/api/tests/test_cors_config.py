"""CORS configuration proofs: CORS_ORIGINS parsing, the dev wildcard, and the
console_base_url-derived fallback that keeps the web-only consoles working
outside dev without extra config. Pure Settings tests — no app boot needed.
"""

from __future__ import annotations

from app.config import Settings, origin_of


def _settings(**kwargs) -> Settings:
    # _env_file=None keeps the developer's local .env out of these proofs.
    return Settings(_env_file=None, **kwargs)


# --- cors_origin_list parsing ---


def test_cors_origin_list_splits_commas():
    s = _settings(cors_origins="https://a.example,https://b.example")
    assert s.cors_origin_list == ["https://a.example", "https://b.example"]


def test_cors_origin_list_strips_whitespace_and_empty_entries():
    s = _settings(cors_origins="  https://a.example , ,https://b.example,  ")
    assert s.cors_origin_list == ["https://a.example", "https://b.example"]


def test_cors_origin_list_empty_string_is_empty_list():
    assert _settings(cors_origins="").cors_origin_list == []


# --- origin_of derivation helper ---


def test_origin_of_keeps_scheme_host_and_port():
    assert origin_of("http://localhost:8081/some/path?q=1") == "http://localhost:8081"


def test_origin_of_without_port():
    assert origin_of("https://console.mento.app/deep/link") == "https://console.mento.app"


def test_origin_of_invalid_url_is_empty():
    assert origin_of("not-a-url") == ""
    assert origin_of("") == ""


# --- resolved_cors_origins ---


def test_dev_resolves_to_wildcard_even_with_explicit_origins():
    s = _settings(env="dev", cors_origins="https://a.example")
    assert s.resolved_cors_origins == ["*"]


def test_prod_uses_configured_origins():
    s = _settings(env="prod", cors_origins="https://a.example, https://b.example")
    assert s.resolved_cors_origins == ["https://a.example", "https://b.example"]


def test_prod_falls_back_to_console_base_url_origin():
    s = _settings(env="prod", cors_origins="", console_base_url="https://console.mento.app/x")
    assert s.resolved_cors_origins == ["https://console.mento.app"]


def test_prod_with_unusable_console_base_url_resolves_empty():
    # The main.py boot invariant refuses to start in this state.
    s = _settings(env="prod", cors_origins="", console_base_url="garbage")
    assert s.resolved_cors_origins == []
