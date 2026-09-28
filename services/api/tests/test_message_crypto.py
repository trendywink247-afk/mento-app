"""Own-chat message retention and encryption at rest (WS5 T5.6).

Accept (program plan): a database dump without the key shows only ciphertext; dropping
a partition removes its messages. Plus: keys rotate by id, a ciphertext moved to another
row does not decrypt, and with no retention decided (founder, H13) nothing is dropped.
"""

from __future__ import annotations

import base64
import shutil
import subprocess
from datetime import UTC, datetime
from urllib.parse import urlsplit

import pytest
from cryptography.exceptions import InvalidTag
from sqlalchemy import func, select, text

from app.config import get_settings
from app.jobs import retention
from app.models.chat_message import ChatMessage
from app.services import chat, message_crypto

from .chat_helpers import seed_chat
from .conftest import DB_URL, requires_postgres

pytestmark = requires_postgres

SECRET = "the thing I have never told anyone"


@pytest.fixture(autouse=True)
def _fresh_keyring(monkeypatch):
    message_crypto.keyring.cache_clear()
    monkeypatch.setattr(chat, "publish", lambda cid, ev: None)
    yield
    message_crypto.keyring.cache_clear()


def _key(key_id: str, fill: int) -> str:
    return f"{key_id}:{base64.b64encode(bytes([fill]) * 32).decode()}"


def _use_keys(monkeypatch, current: str, previous: str = "") -> None:
    monkeypatch.setattr(get_settings(), "message_key", current)
    monkeypatch.setattr(get_settings(), "message_key_previous", previous)
    message_crypto.keyring.cache_clear()


# ---- the cipher ------------------------------------------------------------------------------


def test_round_trip_and_no_plaintext_in_the_blob(monkeypatch):
    _use_keys(monkeypatch, _key("k1", 7))
    blob, key_id = message_crypto.encrypt(SECRET, message_id="m1", conversation_id="c1")
    assert key_id == "k1"
    assert SECRET.encode() not in blob
    assert message_crypto.decrypt(blob, "k1", message_id="m1", conversation_id="c1") == SECRET
    # A fresh nonce every time: the same text never encrypts the same way twice.
    assert message_crypto.encrypt(SECRET, message_id="m1", conversation_id="c1")[0] != blob


def test_a_blob_moved_to_another_row_or_tampered_does_not_decrypt(monkeypatch):
    _use_keys(monkeypatch, _key("k1", 7))
    blob, _ = message_crypto.encrypt(SECRET, message_id="m1", conversation_id="c1")
    with pytest.raises(InvalidTag):
        message_crypto.decrypt(blob, "k1", message_id="m2", conversation_id="c1")
    with pytest.raises(InvalidTag):
        message_crypto.decrypt(blob, "k1", message_id="m1", conversation_id="c2")
    flipped = bytearray(blob)
    flipped[-1] ^= 1
    with pytest.raises(InvalidTag):
        message_crypto.decrypt(bytes(flipped), "k1", message_id="m1", conversation_id="c1")


def test_keys_rotate_by_id(monkeypatch):
    _use_keys(monkeypatch, _key("k1", 7))
    old, old_id = message_crypto.encrypt(SECRET, message_id="m1", conversation_id="c1")

    _use_keys(monkeypatch, _key("k2", 9), previous=_key("k1", 7))
    new, new_id = message_crypto.encrypt(SECRET, message_id="m2", conversation_id="c1")
    assert (old_id, new_id) == ("k1", "k2")
    assert message_crypto.decrypt(old, old_id, message_id="m1", conversation_id="c1") == SECRET
    assert message_crypto.decrypt(new, new_id, message_id="m2", conversation_id="c1") == SECRET

    _use_keys(monkeypatch, _key("k2", 9))  # k1 retired too early
    with pytest.raises(message_crypto.MessageKeyError):
        message_crypto.decrypt(old, old_id, message_id="m1", conversation_id="c1")


@pytest.mark.parametrize(
    "bad", ["no-colon", "k1:not base64!", f"k1:{base64.b64encode(b'short').decode()}"]
)
def test_a_malformed_key_is_refused(monkeypatch, bad):
    _use_keys(monkeypatch, bad)
    with pytest.raises(message_crypto.MessageKeyError):
        message_crypto.encrypt("x", message_id="m", conversation_id="c")


def test_outside_dev_a_missing_key_stores_nothing(monkeypatch, db_session):
    room = seed_chat(db_session)
    monkeypatch.setattr(get_settings(), "env", "prod")
    _use_keys(monkeypatch, "")
    with pytest.raises(message_crypto.MessageKeyError):
        chat.send(db_session, room.member_id, room.cid, client_id="k", body=SECRET)
    db_session.rollback()
    assert db_session.execute(select(func.count()).select_from(ChatMessage)).scalar_one() == 0


# ---- through the write path -------------------------------------------------------------------


def test_the_write_path_stores_ciphertext_and_reads_it_back(monkeypatch, db_session):
    _use_keys(monkeypatch, _key("k1", 7))
    room = seed_chat(db_session)
    sent = chat.send(db_session, room.member_id, room.cid, client_id="w1", body=SECRET)
    assert sent.message["text"] == SECRET

    raw = db_session.execute(
        text("SELECT body, key_id FROM chat_messages WHERE id = :id"), {"id": sent.message["id"]}
    ).one()
    assert raw.key_id == "k1" and SECRET.encode() not in bytes(raw.body)
    assert [m["text"] for m in chat.history(db_session, room.cid)] == [SECRET]


def test_a_database_dump_without_the_key_shows_only_ciphertext(monkeypatch, db_session):
    """The plan's accept criterion, with the real pg_dump."""
    if shutil.which("pg_dump") is None:
        pytest.fail("pg_dump is not installed — this proof needs it (a skip is not a pass)")
    _use_keys(monkeypatch, _key("k1", 7))
    room = seed_chat(db_session)
    chat.send(db_session, room.member_id, room.cid, client_id="d1", body=SECRET)
    chat.send(db_session, room.mentor_id, room.cid, client_id="d2", body="I hear you, go on")

    url = urlsplit(DB_URL.replace("postgresql+psycopg", "postgresql"))
    dump = subprocess.run(
        [
            "pg_dump",
            "--data-only",
            "--table=chat_messages*",
            f"--host={url.hostname}",
            f"--port={url.port or 5432}",
            f"--username={url.username}",
            url.path.lstrip("/"),
        ],
        env={"PGPASSWORD": url.password or ""},
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    assert "COPY public.chat_messages_p" in dump  # the rows are in the dump…
    assert SECRET not in dump and "go on" not in dump  # …but not their text


# ---- partitions and retention -------------------------------------------------------------------


def test_a_message_lands_in_its_months_partition(monkeypatch, db_session):
    _use_keys(monkeypatch, _key("k1", 7))
    room = seed_chat(db_session)
    chat.send(db_session, room.member_id, room.cid, client_id="p1", body="hello")
    now = datetime.now(UTC)
    where = db_session.execute(text("SELECT tableoid::regclass::text FROM chat_messages")).scalar()
    assert where == f"chat_messages_p{now.year:04d}_{now.month:02d}"
    assert retention.default_partition_rows(db_session) == 0


def test_partitions_are_kept_ahead_idempotently(db_session):
    first = retention.ensure_partitions(db_session, datetime(2031, 12, 15, tzinfo=UTC))
    again = retention.ensure_partitions(db_session, datetime(2031, 12, 15, tzinfo=UTC))
    assert (
        first
        == again
        == [
            "chat_messages_p2031_12",
            "chat_messages_p2032_01",
            "chat_messages_p2032_02",
        ]
    )
    db_session.rollback()  # DDL is transactional: leave the schema as it was


def test_dropping_an_expired_partition_removes_its_messages(monkeypatch, db_session):
    _use_keys(monkeypatch, _key("k1", 7))
    room = seed_chat(db_session)
    retention.ensure_partitions(db_session, datetime(2030, 1, 10, tzinfo=UTC), months_ahead=1)
    old = chat.send(db_session, room.member_id, room.cid, client_id="o1", body="january")
    db_session.execute(
        text("UPDATE chat_messages SET created_at = '2030-01-10 12:00+00' WHERE id = :id"),
        {"id": old.message["id"]},
    )  # moves the row into January 2030's partition
    fresh = chat.send(db_session, room.member_id, room.cid, client_id="o2", body="february")
    db_session.execute(
        text("UPDATE chat_messages SET created_at = '2030-02-20 12:00+00' WHERE id = :id"),
        {"id": fresh.message["id"]},
    )

    # 2030-03-15 minus 30 days = 2030-02-13: January has wholly expired, February has
    # not (it still holds days inside the window). Everything before 2030 went too.
    dropped = retention.drop_expired(db_session, 30, now=datetime(2030, 3, 15, tzinfo=UTC))
    assert "chat_messages_p2030_01" in dropped
    assert "chat_messages_p2030_02" not in dropped
    ids = db_session.execute(select(ChatMessage.id)).scalars().all()
    assert ids == [fresh.message["id"]]
    db_session.rollback()  # the DROP and the test partitions go back; truncate cleans rows


def test_with_no_retention_decided_nothing_is_dropped(db_session, caplog):
    retention.ensure_partitions(db_session, datetime(2029, 1, 10, tzinfo=UTC), months_ahead=0)
    assert get_settings().message_retention_days is None  # the founder has not set it
    with caplog.at_level("WARNING", logger="mento.retention"):
        assert retention.drop_expired(db_session, None, now=datetime(2099, 1, 1, tzinfo=UTC)) == []
    assert any("H13" in r.getMessage() for r in caplog.records)
    names = [n for n, _ in retention.monthly_partitions(db_session)]
    assert "chat_messages_p2029_01" in names
    db_session.rollback()
