"""Every URL the API hands to a person is built here, from the two public web
origins in Settings — never formatted inline in a router. The token rides in the
#fragment: browsers never send it to a server, and it survives the redirects the
legacy hosts serve (spec 2026-09-19 unified-domains §3.1).

The paths are the current ones; routes-spec step 3 moves the mentor link to
/signin — one line, here.
"""

from __future__ import annotations

from app.config import Settings, get_settings


def mentor_console_link(token: str, settings: Settings | None = None) -> str:
    s = settings or get_settings()
    return f"{s.resolved_app_base_url}/listener#token={token}"


def admin_link(token: str, settings: Settings | None = None) -> str:
    s = settings or get_settings()
    return f"{s.resolved_admin_base_url}/admin#token={token}"
