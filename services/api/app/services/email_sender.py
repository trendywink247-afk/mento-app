"""Outgoing email (DECISIONS R.10). No provider is set up yet: "log" is a placeholder that
sends nothing and logs only that a send would have happened — never the address or the
code. A real provider plugs in behind `send_code`."""

from __future__ import annotations

import logging

from app.config import get_settings

logger = logging.getLogger("mento.email")


class EmailNotConfigured(Exception):
    """No real provider: nothing was sent."""


def send_code(to: str, code: str) -> None:
    provider = get_settings().email_provider
    if provider == "log":
        logger.info("email (log placeholder): a confirmation code would be sent")
        return
    raise EmailNotConfigured(provider)
