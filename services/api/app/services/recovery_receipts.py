"""Fail-closed acknowledgement contract for an independently durable receipt sink.

Disabled until the dedicated sink, credentials and recovery coverage are accepted.
A successful response is a contract, not proof of the sink's storage durability.
"""

from urllib.parse import urlsplit

import httpx

from app.config import get_settings


class ReceiptUnavailable(Exception):
    pass


def acknowledge(member_digest: str) -> None:
    settings = get_settings()
    if not settings.recovery_receipt_required:
        return
    endpoint = settings.recovery_receipt_url
    token = settings.recovery_receipt_token
    try:
        parsed = urlsplit(endpoint)
        # Accessing .port validates malformed and out-of-range explicit ports.
        port = parsed.port
    except ValueError:
        # Parser exceptions can contain the configured URL; do not chain them.
        raise ReceiptUnavailable("Recovery receipt configuration is incomplete") from None
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or port == 0
        or parsed.netloc.endswith(":")
        or "?" in endpoint
        or "#" in endpoint
        or any(
            character.isspace() or ord(character) < 32 or ord(character) == 127
            for character in endpoint
        )
        or len(token) < 32
        or any(not 33 <= ord(character) <= 126 for character in token)
    ):
        raise ReceiptUnavailable("Recovery receipt configuration is incomplete")
    try:
        # No redirects or environment proxies: never forward this credential to
        # a redirect destination; timeout bounds the user's erasure request.
        with httpx.Client(timeout=5.0, follow_redirects=False, trust_env=False) as client:
            response = client.post(
                endpoint,
                headers={"Authorization": f"Bearer {token}"},
                json={"version": 1, "member_digest": member_digest},
            )
        if response.status_code != 200:
            raise ReceiptUnavailable("Recovery receipt not acknowledged")
        result = response.json()
        if (
            not isinstance(result, dict)
            or type(result.get("version")) is not int
            or result.get("version") != 1
            or result.get("member_digest") != member_digest
            or result.get("durable") is not True
        ):
            raise ReceiptUnavailable("Recovery receipt acknowledgement mismatch")
    except (httpx.HTTPError, httpx.InvalidURL, ValueError):
        # Do not log URLs, tokens, digests or response bodies.
        raise ReceiptUnavailable("Recovery receipt service unavailable") from None
