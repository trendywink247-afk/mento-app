"""Message bodies encrypted at rest (WS5 T5.6): AES-256-GCM with a key id.

A dump of the database — a backup, a stolen disk, a support export — holds only
ciphertext; the key lives in the environment (`MESSAGE_KEY`), never in the database.
Each row stores its `key_id`, so keys rotate without re-encrypting anything:

    MESSAGE_KEY=k2:<base64 of 32 random bytes>          # encrypts every new message
    MESSAGE_KEY_PREVIOUS=k1:<base64>,k0:<base64>        # still decrypts older rows

Generate one with `python -m app.services.message_crypto`. Rotate by moving the
current key to MESSAGE_KEY_PREVIOUS and setting a new MESSAGE_KEY; retire an old key
only once its rows are past retention (app/jobs/retention.py drops them).

The row's id and conversation id are bound in as associated data, so a ciphertext
copied onto another row does not decrypt — it fails loudly instead.

Dev only: with no MESSAGE_KEY set, a fixed, public dev key (`dev`) is used so a fresh
checkout runs. Anywhere else a missing key refuses to encrypt: a message is never
stored in the clear.
"""

from __future__ import annotations

import base64
import os
import secrets
from dataclasses import dataclass
from functools import lru_cache

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.config import get_settings

_NONCE = 12
_DEV_KEY_ID = "dev"
_DEV_KEY = b"mento-dev-only-message-key-32byt"  # public: dev and tests only


class MessageKeyError(RuntimeError):
    """No usable key — the message must not be stored (never in the clear)."""


@dataclass(frozen=True)
class Keyring:
    current_id: str
    keys: dict[str, bytes]


def _parse(entry: str) -> tuple[str, bytes]:
    key_id, sep, encoded = entry.strip().partition(":")
    if not sep or not key_id or len(key_id) > 16:
        raise MessageKeyError("MESSAGE_KEY entries are <key id (≤16 chars)>:<base64 key>")
    try:
        key = base64.b64decode(encoded, validate=True)
    except ValueError as exc:
        raise MessageKeyError(f"MESSAGE_KEY {key_id!r} is not valid base64") from exc
    if len(key) != 32:
        raise MessageKeyError(f"MESSAGE_KEY {key_id!r} must be 32 bytes (AES-256)")
    return key_id, key


@lru_cache
def keyring() -> Keyring:
    settings = get_settings()
    if not settings.message_key:
        if settings.is_dev:
            return Keyring(current_id=_DEV_KEY_ID, keys={_DEV_KEY_ID: _DEV_KEY})
        raise MessageKeyError("MESSAGE_KEY is not set — own-chat messages cannot be stored")
    current_id, current = _parse(settings.message_key)
    keys = {current_id: current}
    for entry in filter(None, (settings.message_key_previous or "").split(",")):
        key_id, key = _parse(entry)
        keys.setdefault(key_id, key)
    if settings.is_dev:
        keys.setdefault(_DEV_KEY_ID, _DEV_KEY)  # rows written before a dev key was set
    return Keyring(current_id=current_id, keys=keys)


def _aad(message_id: str, conversation_id: str) -> bytes:
    return f"{conversation_id}/{message_id}".encode()


def encrypt(text: str, *, message_id: str, conversation_id: str) -> tuple[bytes, str]:
    """(nonce ‖ ciphertext ‖ tag, key id) for one message body."""
    ring = keyring()
    nonce = os.urandom(_NONCE)
    sealed = AESGCM(ring.keys[ring.current_id]).encrypt(
        nonce, text.encode("utf-8"), _aad(message_id, conversation_id)
    )
    return nonce + sealed, ring.current_id


def decrypt(blob: bytes, key_id: str, *, message_id: str, conversation_id: str) -> str:
    """The body. Raises on an unknown key id, a tampered blob or a blob moved to another
    row (cryptography's InvalidTag) — never returns garbage."""
    key = keyring().keys.get(key_id)
    if key is None:
        raise MessageKeyError(f"no key {key_id!r} in MESSAGE_KEY / MESSAGE_KEY_PREVIOUS")
    blob = bytes(blob)
    plain = AESGCM(key).decrypt(blob[:_NONCE], blob[_NONCE:], _aad(message_id, conversation_id))
    return plain.decode("utf-8")


def new_key(key_id: str) -> str:
    return f"{key_id}:{base64.b64encode(secrets.token_bytes(32)).decode()}"


if __name__ == "__main__":  # pragma: no cover — operator helper
    import sys

    print(new_key(sys.argv[1] if len(sys.argv) > 1 else "k1"))
