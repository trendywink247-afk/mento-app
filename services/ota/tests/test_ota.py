"""Protocol tests for the OTA server, against a throwaway data dir and key pair."""

from __future__ import annotations

import base64
import email.parser
import email.policy
import hashlib
import json
import re
import subprocess
from pathlib import Path

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from fastapi.testclient import TestClient

from app import main

REPO = Path(__file__).resolve().parents[3]
KEYGEN = REPO / "ops" / "ota-keygen.sh"
EMBEDDED = "00000000-0000-0000-0000-000000000001"


@pytest.fixture(scope="session")
def keys(tmp_path_factory) -> tuple[Path, Path]:
    d = tmp_path_factory.mktemp("keys")
    cert, key = d / "cert.pem", d / "key.pem"
    subprocess.run(  # noqa: S603 - fixed argv, our own script
        ["/bin/bash", str(KEYGEN), "test", str(cert), str(key)], check=True
    )
    return cert, key


def _publish(root: Path, channel: str, runtime: str, name: str, js: bytes, rolled=False) -> Path:
    d = root / channel / runtime / name
    (d / "_expo/static/js/android").mkdir(parents=True)
    (d / "_expo/static/js/ios").mkdir(parents=True)
    (d / "assets").mkdir()
    (d / "_expo/static/js/android/entry-a.hbc").write_bytes(js)
    (d / "_expo/static/js/ios/entry-i.hbc").write_bytes(js + b"ios")
    (d / "assets/abc123").write_bytes(b"\x89PNG fake")
    meta = {
        "version": 0,
        "bundler": "metro",
        "fileMetadata": {
            "android": {
                "bundle": "_expo/static/js/android/entry-a.hbc",
                "assets": [{"path": "assets/abc123", "ext": "png"}],
            },
            "ios": {"bundle": "_expo/static/js/ios/entry-i.hbc", "assets": []},
        },
    }
    # The tag keeps update ids distinct across these synthetic dirs.
    (d / "metadata.json").write_text(json.dumps({**meta, "tag": name}))
    (d / "expoConfig.json").write_text(json.dumps({"name": "Mento QA", "slug": "mento"}))
    (d / "published.json").write_text(json.dumps({"createdAt": "2026-11-11T10:00:00Z"}))
    if rolled:
        (d / main.ROLLED_BACK).write_text("")
    return d


@pytest.fixture
def client(tmp_path, keys, monkeypatch):
    _, key = keys
    monkeypatch.setenv("OTA_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("OTA_PUBLIC_URL", "https://qa-api.mento.chat/ota")
    monkeypatch.setenv("OTA_PRIVATE_KEY", str(key))
    main.get_settings.cache_clear()
    yield TestClient(main.app), tmp_path
    main.get_settings.cache_clear()


def _headers(platform="android", runtime="1.0.0", channel="preview", **extra) -> dict:
    h = {
        "expo-platform": platform,
        "expo-runtime-version": runtime,
        "expo-channel-name": channel,
        "expo-protocol-version": "1",
        "expo-expect-signature": 'sig, keyid="main", alg="rsa-v1_5-sha256"',
        "expo-embedded-update-id": EMBEDDED,
    }
    h.update(extra)
    return h


def _parts(resp) -> dict[str, tuple[dict, str]]:
    raw = f"Content-Type: {resp.headers['content-type']}\r\n\r\n".encode() + resp.content
    msg = email.parser.BytesParser(policy=email.policy.HTTP).parsebytes(raw)
    out = {}
    for part in msg.iter_parts():
        name = re.search(r'name="([^"]+)"', part["content-disposition"]).group(1)
        out[name] = (dict(part.items()), part.get_payload(decode=True).decode())
    return out


def _verify(cert_path: Path, body: str, header: str) -> None:
    sig = re.search(r'sig="([^"]+)"', header).group(1)
    assert 'keyid="main"' in header
    cert = x509.load_pem_x509_certificate(cert_path.read_bytes())
    cert.public_key().verify(
        base64.b64decode(sig), body.encode(), padding.PKCS1v15(), hashes.SHA256()
    )


def test_manifest_shape_and_signature(client, keys):
    c, root = client
    d = _publish(root, "preview", "1.0.0", "20261111T100000Z-aaaaaaa", b"js-one")
    r = c.get("/api/manifest", headers=_headers())
    assert r.status_code == 200
    assert r.headers["expo-protocol-version"] == "1"
    assert r.headers["expo-sfv-version"] == "0"
    assert r.headers["cache-control"] == "private, max-age=0"
    parts = _parts(r)
    headers, body = parts["manifest"]
    _verify(keys[0], body, headers["expo-signature"])
    m = json.loads(body)
    assert m["runtimeVersion"] == "1.0.0"
    assert re.fullmatch(r"[0-9a-f-]{36}", m["id"])
    assert m["createdAt"] == "2026-11-11T10:00:00Z"
    launch = m["launchAsset"]
    assert launch["contentType"] == "application/javascript"
    js = (d / "_expo/static/js/android/entry-a.hbc").read_bytes()
    assert (
        launch["hash"]
        == base64.urlsafe_b64encode(hashlib.sha256(js).digest()).rstrip(b"=").decode()
    )
    assert launch["key"] == hashlib.md5(js, usedforsecurity=False).hexdigest()
    assert launch["url"].startswith("https://qa-api.mento.chat/ota/assets/preview/1.0.0/")
    assert m["assets"][0]["fileExtension"] == ".png"
    assert m["assets"][0]["contentType"] == "image/png"
    assert m["extra"]["expoClient"]["name"] == "Mento QA"
    assert json.loads(parts["extensions"][1]) == {"assetRequestHeaders": {}}
    # The asset URL the manifest names is servable.
    path = launch["url"].removeprefix("https://qa-api.mento.chat/ota")
    a = c.get(path)
    assert a.status_code == 200 and a.content == js
    assert a.headers["content-type"].startswith("application/javascript")
    assert "immutable" in a.headers["cache-control"]


def test_unsigned_when_not_requested(client):
    c, root = client
    _publish(root, "preview", "1.0.0", "20261111T100000Z-aaaaaaa", b"js")
    h = _headers()
    del h["expo-expect-signature"]
    headers, _ = _parts(c.get("/api/manifest", headers=h))["manifest"]
    assert "expo-signature" not in {k.lower() for k in headers}


def test_selects_platform_runtime_channel_and_newest(client):
    c, root = client
    _publish(root, "preview", "1.0.0", "20261110T100000Z-old0000", b"old")
    _publish(root, "preview", "1.0.0", "20261111T100000Z-new0000", b"new")
    _publish(root, "production", "1.0.0", "20261112T100000Z-prod000", b"prod")
    _publish(root, "preview", "2.0.0", "20261112T100000Z-two0000", b"two")
    m = json.loads(_parts(c.get("/api/manifest", headers=_headers()))["manifest"][1])
    assert "/preview/1.0.0/20261111T100000Z-new0000/" in m["launchAsset"]["url"]
    assert m["launchAsset"]["url"].endswith("/android/entry-a.hbc")
    ios = json.loads(_parts(c.get("/api/manifest", headers=_headers("ios")))["manifest"][1])
    assert ios["launchAsset"]["url"].endswith("/ios/entry-i.hbc")
    prod = json.loads(
        _parts(c.get("/api/manifest", headers=_headers(channel="production")))["manifest"][1]
    )
    assert "/production/1.0.0/" in prod["launchAsset"]["url"]
    two = json.loads(
        _parts(c.get("/api/manifest", headers=_headers(runtime="2.0.0")))["manifest"][1]
    )
    assert two["runtimeVersion"] == "2.0.0"


def test_rolled_back_update_is_skipped(client):
    c, root = client
    _publish(root, "preview", "1.0.0", "20261110T100000Z-good000", b"good")
    _publish(root, "preview", "1.0.0", "20261111T100000Z-bad0000", b"bad", rolled=True)
    m = json.loads(_parts(c.get("/api/manifest", headers=_headers()))["manifest"][1])
    assert "20261110T100000Z-good000" in m["launchAsset"]["url"]


def test_all_rolled_back_sends_phone_to_embedded(client, keys):
    c, root = client
    _publish(root, "preview", "1.0.0", "20261111T100000Z-bad0000", b"bad", rolled=True)
    r = c.get("/api/manifest", headers=_headers(**{"expo-current-update-id": "abc"}))
    headers, body = _parts(r)["directive"]
    _verify(keys[0], body, headers["expo-signature"])
    assert json.loads(body)["type"] == "rollBackToEmbedded"
    # Already on the embedded bundle: nothing to do.
    r = c.get("/api/manifest", headers=_headers(**{"expo-current-update-id": EMBEDDED}))
    assert json.loads(_parts(r)["directive"][1])["type"] == "noUpdateAvailable"


def test_no_update_cases(client, keys):
    c, root = client
    r = c.get("/api/manifest", headers=_headers())  # nothing published at all
    headers, body = _parts(r)["directive"]
    assert json.loads(body) == {"type": "noUpdateAvailable"}
    _verify(keys[0], body, headers["expo-signature"])
    _publish(root, "preview", "1.0.0", "20261111T100000Z-aaaaaaa", b"js")
    m = json.loads(_parts(c.get("/api/manifest", headers=_headers()))["manifest"][1])
    r = c.get("/api/manifest", headers=_headers(**{"expo-current-update-id": m["id"]}))
    assert json.loads(_parts(r)["directive"][1]) == {"type": "noUpdateAvailable"}
    # Protocol 0 has no directives: a plain 404.
    r = c.get("/api/manifest", headers=_headers(runtime="9.9.9", **{"expo-protocol-version": "0"}))
    assert r.status_code == 404


@pytest.mark.parametrize("drop", ["expo-platform", "expo-runtime-version", "expo-channel-name"])
def test_missing_headers_are_400(client, drop):
    c, _ = client
    h = _headers()
    del h[drop]
    assert c.get("/api/manifest", headers=h).status_code == 400


@pytest.mark.parametrize(
    "bad",
    [
        {"expo-platform": "windows"},
        {"expo-runtime-version": "../../etc"},
        {"expo-channel-name": ".."},
        {"expo-channel-name": "a/b"},
        {"expo-protocol-version": "7"},
    ],
)
def test_invalid_headers_are_400(client, bad):
    c, _ = client
    assert c.get("/api/manifest", headers=_headers(**bad)).status_code == 400


@pytest.mark.parametrize(
    "path",
    [
        "/assets/../../etc/passwd",
        "/assets/preview/1.0.0/x/../../../../etc/passwd",
        "/assets/preview/1.0.0/%2e%2e/%2e%2e/secret",
        "/assets/%2fetc%2fpasswd",
        "/assets/preview/1.0.0/20261111T100000Z-aaaaaaa/expoConfig.json",
        "/assets/preview/1.0.0/20261111T100000Z-aaaaaaa/nope",
    ],
)
def test_asset_traversal_and_private_files_rejected(client, path, tmp_path_factory):
    c, root = client
    _publish(root, "preview", "1.0.0", "20261111T100000Z-aaaaaaa", b"js")
    (root.parent / "secret").write_text("no")
    assert c.get(path).status_code == 404


def test_signing_requested_without_key_is_500(client, monkeypatch):
    c, root = client
    _publish(root, "preview", "1.0.0", "20261111T100000Z-aaaaaaa", b"js")
    monkeypatch.setenv("OTA_PRIVATE_KEY", "")
    main.get_settings.cache_clear()
    assert c.get("/api/manifest", headers=_headers()).status_code == 500


def test_certificate_is_a_code_signing_cert(keys):
    cert = x509.load_pem_x509_certificate(keys[0].read_bytes())
    ku = cert.extensions.get_extension_for_class(x509.KeyUsage)
    assert ku.critical and ku.value.digital_signature and not ku.value.key_cert_sign
    eku = cert.extensions.get_extension_for_class(x509.ExtendedKeyUsage)
    assert x509.oid.ExtendedKeyUsageOID.CODE_SIGNING in eku.value
    assert cert.issuer == cert.subject
    key = serialization.load_pem_private_key(keys[1].read_bytes(), password=None)
    assert key.key_size == 2048
    assert oct(keys[1].stat().st_mode & 0o777) == "0o600"
