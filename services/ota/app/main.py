"""Mento's self-hosted OTA server: the Expo Updates protocol (v1), nothing else.

`expo-updates` in the app asks GET /api/manifest with its platform, runtime version and
channel; we answer with the newest published update for that triple as a signed
multipart manifest, or a signed directive (`noUpdateAvailable`, `rollBackToEmbedded`).
GET /assets/<channel>/<runtime>/<update>/<file> serves the bundle and assets.

Layout under OTA_DATA_DIR (written by ops/ota-publish.sh):

    <channel>/<runtimeVersion>/<updateDir>/metadata.json      `expo export` output
                                          /_expo/static/js/<platform>/...
                                          /assets/...
                                          /expoConfig.json    `expo config --type public`
                                          /ROLLED_BACK        optional: skip this update

Update dirs are named so that a plain sort is chronological (UTC timestamp first);
the newest one without ROLLED_BACK wins.

Behaviour follows expo/custom-expo-updates-server. Logs carry platform, runtime,
channel and the outcome only: no client IPs, ids or other headers.
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import mimetypes
import os
import re
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, Response

logger = logging.getLogger("mento.ota")

PLATFORMS = ("android", "ios")
# Channel names, runtime versions and update dir names: plain tokens only.
_TOKEN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
ROLLED_BACK = "ROLLED_BACK"
COMMON_HEADERS = {
    "expo-protocol-version": "1",
    "expo-sfv-version": "0",
    "cache-control": "private, max-age=0",
}


class Settings:
    def __init__(self) -> None:
        self.data_dir = Path(os.environ.get("OTA_DATA_DIR", "/srv/mento/ota-data")).resolve()
        self.public_url = os.environ.get("OTA_PUBLIC_URL", "http://127.0.0.1:18020").rstrip("/")
        self.private_key_path = os.environ.get("OTA_PRIVATE_KEY", "")


@lru_cache
def get_settings() -> Settings:
    return Settings()


@lru_cache
def _private_key(path: str) -> rsa.RSAPrivateKey | None:
    if not path:
        return None
    key = serialization.load_pem_private_key(Path(path).read_bytes(), password=None)
    if not isinstance(key, rsa.RSAPrivateKey):
        raise ValueError("OTA_PRIVATE_KEY must be an RSA key")
    return key


class ProtocolError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


@dataclass(frozen=True)
class Update:
    channel: str
    runtime: str
    name: str
    path: Path


def _token(value: str | None, what: str) -> str:
    if not value or not _TOKEN.match(value) or value in (".", ".."):
        raise ProtocolError(400, f"missing or invalid {what}")
    return value


def _published(channel: str, runtime: str) -> list[Update]:
    """Every update dir for this channel/runtime, newest first, rolled-back ones included."""
    base = get_settings().data_dir / channel / runtime
    if not base.is_dir():
        return []
    dirs = [d for d in base.iterdir() if d.is_dir() and _TOKEN.match(d.name)]
    dirs.sort(key=lambda d: d.name, reverse=True)
    return [Update(channel, runtime, d.name, d) for d in dirs]


def latest_update(channel: str, runtime: str) -> tuple[Update | None, bool]:
    """(newest live update or None, whether any update was ever published here)."""
    every = _published(channel, runtime)
    live = [u for u in every if not (u.path / ROLLED_BACK).exists()]
    return (live[0] if live else None), bool(every)


def _sha256_b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b"=").decode()


def _uuid_from_sha256(hex_digest: str) -> str:
    return str(uuid.UUID(hex_digest[:32]))


def _asset_url(update: Update, rel: str) -> str:
    return (
        f"{get_settings().public_url}/assets/{update.channel}/{update.runtime}/{update.name}/{rel}"
    )


def _asset_entry(update: Update, rel: str, ext: str | None, launch: bool) -> dict:
    data = (update.path / rel).read_bytes()
    entry = {
        "hash": _sha256_b64url(data),
        "key": hashlib.md5(data, usedforsecurity=False).hexdigest(),
        "contentType": (
            "application/javascript"
            if launch
            else (mimetypes.guess_type(f"x.{ext}")[0] or "application/octet-stream")
        ),
        "url": _asset_url(update, rel),
    }
    if not launch and ext:
        entry["fileExtension"] = f".{ext}"
    return entry


def build_manifest(update: Update, platform: str) -> dict:
    metadata_raw = (update.path / "metadata.json").read_bytes()
    metadata = json.loads(metadata_raw)
    files = metadata.get("fileMetadata", {}).get(platform)
    if not files:
        raise ProtocolError(404, f"update has no {platform} bundle")
    config_path = update.path / "expoConfig.json"
    expo_config = json.loads(config_path.read_text()) if config_path.exists() else {}
    published = update.path / "published.json"
    created = (
        json.loads(published.read_text()).get("createdAt")
        if published.exists()
        else datetime.fromtimestamp(update.path.stat().st_mtime, UTC).isoformat()
    )
    return {
        "id": _uuid_from_sha256(hashlib.sha256(metadata_raw).hexdigest()),
        "createdAt": created,
        "runtimeVersion": update.runtime,
        "launchAsset": _asset_entry(update, files["bundle"], None, launch=True),
        "assets": [_asset_entry(update, a["path"], a.get("ext"), False) for a in files["assets"]],
        "metadata": {},
        "extra": {"expoClient": expo_config},
    }


def _sign(body: str) -> str:
    key = _private_key(get_settings().private_key_path)
    if key is None:
        raise ProtocolError(500, "code signing requested but OTA_PRIVATE_KEY is not configured")
    sig = key.sign(body.encode(), padding.PKCS1v15(), hashes.SHA256())
    return f'sig="{base64.b64encode(sig).decode()}", keyid="main"'


def _multipart(name: str, payload: dict, signed: bool) -> Response:
    body = json.dumps(payload, separators=(",", ":"))
    boundary = secrets.token_hex(16)
    head = [
        f"--{boundary}",
        f'Content-Disposition: form-data; name="{name}"',
        "Content-Type: application/json; charset=utf-8",
    ]
    if signed:
        head.append(f"expo-signature: {_sign(body)}")
    parts = [*head, "", body]
    if name == "manifest":
        parts += [
            f"--{boundary}",
            'Content-Disposition: form-data; name="extensions"',
            "Content-Type: application/json",
            "",
            json.dumps({"assetRequestHeaders": {}}),
        ]
    parts.append(f"--{boundary}--")
    return Response(
        content="\r\n".join(parts) + "\r\n",
        media_type=f"multipart/mixed; boundary={boundary}",
        headers=COMMON_HEADERS,
    )


app = FastAPI(title="Mento OTA", docs_url=None, redoc_url=None, openapi_url=None)


@app.exception_handler(ProtocolError)
async def _protocol_error(_: Request, exc: ProtocolError) -> JSONResponse:
    return JSONResponse({"error": exc.message}, status_code=exc.status, headers=COMMON_HEADERS)


@app.get("/health")
def health() -> dict:
    return {"ok": get_settings().data_dir.is_dir()}


@app.get("/api/manifest")
def manifest(request: Request) -> Response:
    h, q = request.headers, request.query_params
    platform = h.get("expo-platform") or q.get("platform")
    if platform not in PLATFORMS:
        raise ProtocolError(400, "missing or invalid expo-platform (android or ios)")
    runtime = _token(h.get("expo-runtime-version") or q.get("runtime-version"), "runtime version")
    channel = _token(h.get("expo-channel-name") or q.get("channel"), "expo-channel-name")
    try:
        protocol = int(h.get("expo-protocol-version", "0"))
    except ValueError as exc:
        raise ProtocolError(400, "invalid expo-protocol-version") from exc
    if protocol not in (0, 1):
        raise ProtocolError(400, "unsupported expo-protocol-version")
    signed = h.get("expo-expect-signature") is not None
    current = h.get("expo-current-update-id")
    embedded = h.get("expo-embedded-update-id")

    update, ever = latest_update(channel, runtime)
    outcome = "manifest"
    if update is None:
        if protocol == 0:
            logger.info("ota %s %s %s: none", platform, runtime, channel)
            raise ProtocolError(404, "no update for this runtime version and channel")
        if ever and current and embedded and current != embedded:
            # Every published update is rolled back: send the phone back to its APK's bundle.
            outcome = "rollBackToEmbedded"
            directive = {
                "type": "rollBackToEmbedded",
                "parameters": {"commitTime": datetime.now(UTC).isoformat()},
            }
        else:
            outcome = "noUpdateAvailable"
            directive = {"type": "noUpdateAvailable"}
        logger.info("ota %s %s %s: %s", platform, runtime, channel, outcome)
        return _multipart("directive", directive, signed)

    body = build_manifest(update, platform)
    if protocol == 1 and current == body["id"]:
        logger.info("ota %s %s %s: noUpdateAvailable", platform, runtime, channel)
        return _multipart("directive", {"type": "noUpdateAvailable"}, signed)
    logger.info("ota %s %s %s: %s %s", platform, runtime, channel, outcome, update.name)
    return _multipart("manifest", body, signed)


@app.get("/assets/{rel:path}")
def asset(rel: str) -> Response:
    root = get_settings().data_dir
    parts = rel.split("/")
    if len(parts) < 4 or any(p in ("", ".", "..") for p in parts):
        raise ProtocolError(404, "not found")
    target = (root / rel).resolve()
    if not target.is_relative_to(root) or not target.is_file():
        raise ProtocolError(404, "not found")
    if target.name in (ROLLED_BACK, "expoConfig.json", "published.json"):
        raise ProtocolError(404, "not found")
    media = (
        "application/javascript"
        if target.suffix in (".hbc", ".js", ".bundle")
        else (mimetypes.guess_type(target.name)[0] or "application/octet-stream")
    )
    return FileResponse(
        target,
        media_type=media,
        headers={"cache-control": "public, max-age=31536000, immutable"},
    )


def run() -> None:  # pragma: no cover - entry point for systemd
    import uvicorn

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    uvicorn.run(
        app,
        host=os.environ.get("OTA_HOST", "127.0.0.1"),
        port=int(os.environ.get("OTA_PORT", "18020")),
        access_log=False,
        proxy_headers=False,
        server_header=False,
    )


if __name__ == "__main__":  # pragma: no cover
    run()
