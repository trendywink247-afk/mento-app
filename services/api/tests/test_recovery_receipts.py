from types import SimpleNamespace

import httpx
import pytest

from app.services import recovery_receipts as receipts


@pytest.mark.parametrize("outcome", ["success", "mismatch", "redirect", "invalid", "timeout"])
def test_acknowledgement_contract(monkeypatch, outcome):
    digest = "a" * 64
    monkeypatch.setattr(
        receipts,
        "get_settings",
        lambda: SimpleNamespace(
            recovery_receipt_required=True,
            recovery_receipt_url="https://recovery.invalid/receipts",
            recovery_receipt_token="x" * 32,
        ),
    )
    real_client = httpx.Client

    def respond(request):
        assert request.headers["authorization"] == "Bearer " + "x" * 32
        if outcome == "timeout":
            raise httpx.ReadTimeout("synthetic", request=request)
        if outcome == "redirect":
            return httpx.Response(302, headers={"location": "https://other.invalid"})
        if outcome == "invalid":
            return httpx.Response(200, text="not json")
        return httpx.Response(
            200,
            json={
                "version": 1,
                "durable": True,
                "member_digest": digest if outcome == "success" else "b" * 64,
            },
        )

    monkeypatch.setattr(
        receipts.httpx,
        "Client",
        lambda **kwargs: real_client(**kwargs, transport=httpx.MockTransport(respond)),
    )
    if outcome == "success":
        receipts.acknowledge(digest)
    else:
        with pytest.raises(receipts.ReceiptUnavailable):
            receipts.acknowledge(digest)


def test_incomplete_configuration_fails_before_network(monkeypatch):
    monkeypatch.setattr(
        receipts,
        "get_settings",
        lambda: SimpleNamespace(
            recovery_receipt_required=True,
            recovery_receipt_url="http://recovery.invalid",
            recovery_receipt_token="",
        ),
    )
    with pytest.raises(receipts.ReceiptUnavailable):
        receipts.acknowledge("a" * 64)
