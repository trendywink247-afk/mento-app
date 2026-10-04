import json
from types import SimpleNamespace

import httpx
import pytest

from app.services import recovery_receipts as receipts


@pytest.mark.parametrize(
    "outcome",
    [
        "success",
        "success_port",
        "success_ipv6",
        "mismatch",
        "redirect",
        "invalid",
        "timeout",
        "invalid_url",
        "array",
        "boolean_version",
        "float_version",
        "numeric_durable",
        "string_durable",
        "missing_digest",
    ],
)
def test_acknowledgement_contract(monkeypatch, outcome):
    digest = "a" * 64
    endpoint = {
        "success_port": "https://recovery.invalid:8443/receipts",
        "success_ipv6": "https://[::1]:8443/receipts",
    }.get(outcome, "https://recovery.invalid/receipts")
    monkeypatch.setattr(
        receipts,
        "get_settings",
        lambda: SimpleNamespace(
            recovery_receipt_required=True,
            recovery_receipt_url=endpoint,
            recovery_receipt_token="x" * 32,
        ),
    )
    real_client = httpx.Client

    def respond(request):
        assert request.headers["authorization"] == "Bearer " + "x" * 32
        assert json.loads(request.content) == {"version": 1, "member_digest": digest}
        if outcome == "timeout":
            raise httpx.ReadTimeout("synthetic", request=request)
        if outcome == "invalid_url":
            raise httpx.InvalidURL("synthetic configuration detail")
        if outcome == "redirect":
            return httpx.Response(302, headers={"location": "https://other.invalid"})
        if outcome == "invalid":
            return httpx.Response(200, text="not json")
        result = {"version": 1, "durable": True, "member_digest": digest}
        if outcome == "mismatch":
            result["member_digest"] = "b" * 64
        elif outcome == "array":
            return httpx.Response(200, json=[result])
        elif outcome == "boolean_version":
            result["version"] = True
        elif outcome == "float_version":
            result["version"] = 1.0
        elif outcome == "numeric_durable":
            result["durable"] = 1
        elif outcome == "string_durable":
            result["durable"] = "true"
        elif outcome == "missing_digest":
            del result["member_digest"]
        return httpx.Response(200, json=result)

    def client_factory(**kwargs):
        assert kwargs == {"timeout": 5.0, "follow_redirects": False, "trust_env": False}
        return real_client(**kwargs, transport=httpx.MockTransport(respond))

    monkeypatch.setattr(
        receipts.httpx,
        "Client",
        client_factory,
    )
    if outcome.startswith("success"):
        receipts.acknowledge(digest)
    else:
        with pytest.raises(receipts.ReceiptUnavailable) as failure:
            receipts.acknowledge(digest)
        assert failure.value.__cause__ is None


@pytest.mark.parametrize(
    ("endpoint", "token"),
    [
        ("http://recovery.invalid/receipts", "x" * 32),
        ("https://recovery.invalid/receipts", "x" * 31),
        ("https://recovery.invalid/receipts", "x" * 32 + "\r\n"),
        ("https://recovery.invalid/receipts", "x" * 32 + "é"),
        ("https://[bad/receipts", "x" * 32),
        ("https://recovery.invalid:bad/receipts", "x" * 32),
        ("https://recovery.invalid:65536/receipts", "x" * 32),
        ("https://recovery.invalid:0/receipts", "x" * 32),
        ("https://recovery.invalid:/receipts", "x" * 32),
        ("https:///receipts", "x" * 32),
        ("https://@recovery.invalid/receipts", "x" * 32),
        ("https://user:password@recovery.invalid/receipts", "x" * 32),
        ("https://recovery.invalid/receipts?", "x" * 32),
        ("https://recovery.invalid/receipts#", "x" * 32),
        ("https://recovery.invalid/receipts?token=synthetic", "x" * 32),
        ("https://recovery.invalid/receipts#fragment", "x" * 32),
        (" https://recovery.invalid/receipts", "x" * 32),
        ("https://recovery.invalid/receipts\n", "x" * 32),
        ("https://recovery.invalid/re ceipts", "x" * 32),
    ],
)
def test_incomplete_configuration_fails_before_network(monkeypatch, endpoint, token):
    monkeypatch.setattr(
        receipts,
        "get_settings",
        lambda: SimpleNamespace(
            recovery_receipt_required=True,
            recovery_receipt_url=endpoint,
            recovery_receipt_token=token,
        ),
    )

    def forbidden(**kwargs):
        raise AssertionError("Invalid configuration must fail before creating an HTTP client")

    monkeypatch.setattr(receipts.httpx, "Client", forbidden)
    with pytest.raises(receipts.ReceiptUnavailable) as failure:
        receipts.acknowledge("a" * 64)
    assert failure.value.__cause__ is None
    assert str(failure.value) == "Recovery receipt configuration is incomplete"


def test_disabled_gate_does_not_parse_configuration_or_open_client(monkeypatch):
    monkeypatch.setattr(
        receipts, "get_settings", lambda: SimpleNamespace(recovery_receipt_required=False)
    )

    def forbidden(**kwargs):
        raise AssertionError("Disabled gate must not create an HTTP client")

    monkeypatch.setattr(receipts.httpx, "Client", forbidden)
    receipts.acknowledge("a" * 64)
