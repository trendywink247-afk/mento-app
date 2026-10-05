"""Synthetic fixtures only, invoked by the isolated primary-loss orchestrator."""

import json
import os
from pathlib import Path
import re
import sys

if not __debug__:
    raise RuntimeError("Rehearsal proof requires Python assertions enabled")

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services/api"))
sys.path.insert(0, str(ROOT / "scripts"))
WORK = Path("/evidence")
RUN = os.environ.get("MENTO_SYNTHETIC_REHEARSAL", "")
if not re.fullmatch(r"mento-primary-loss-[0-9a-f]{32}", RUN):
    raise ValueError("Synthetic rehearsal identity required")


def tls():
    from datetime import UTC, datetime, timedelta
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, RUN + "-receiver")])
    now = datetime.now(UTC)
    certificate = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(minutes=1))
        .not_valid_after(now + timedelta(hours=2))
        .add_extension(
            x509.SubjectAlternativeName([x509.DNSName(RUN + "-receiver")]), critical=False
        )
        .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
        .sign(key, hashes.SHA256())
    )
    directory = WORK / "tls"
    directory.mkdir(mode=0o755)
    (directory / "key.pem").write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
    )
    (directory / "cert.pem").write_bytes(certificate.public_bytes(serialization.Encoding.PEM))
    # This throwaway TLS key must be readable by the unprivileged receiver.
    # It never leaves the controlled private fixture directory and is destroyed.
    os.chmod(directory / "key.pem", 0o644)


def database():
    from sqlalchemy.engine import make_url
    from app.config import get_settings
    from app.db import SessionLocal

    settings = get_settings()
    assert settings.is_dev and not settings.push_enabled
    assert not settings.stream_api_key and not settings.stream_api_secret
    assert make_url(settings.database_url).host in {RUN + "-source", RUN + "-restored"}
    return SessionLocal


def seed():
    from datetime import date
    import uuid
    from sqlalchemy import func, select
    from app.models.chat_message import ChatMessage
    from app.models.conversation import Conversation
    from app.models.enums import JournalChannel, VettingStatus
    from app.models.journal import JournalEntry
    from app.models.listener import ListenerProfile
    from app.models.user import User
    from app.services import message_crypto, recovery, sessions

    with database()() as db:
        users = [
            User(
                persona_name="Synthetic deleted",
                persona_avatar="x",
                dob=date(1996, 1, 1),
                age_at_signup=30,
            ),
            User(
                persona_name="Synthetic retained",
                persona_avatar="x",
                dob=date(1996, 1, 1),
                age_at_signup=30,
            ),
        ]
        mentor = ListenerProfile(
            persona_name="Synthetic mentor",
            persona_avatar="x",
            vetting_status=VettingStatus.approved,
            active_conversations=2,
            max_concurrent=3,
        )
        db.add_all([*users, mentor])
        db.flush()
        result = {"mentor": mentor.id, "accounts": []}
        for user in users:
            room = Conversation(user_id=user.id, listener_id=mentor.id, chat_backend="own")
            db.add(room)
            db.flush()
            note = JournalEntry(
                user_id=user.id,
                channel=JournalChannel.mentor_notes,
                body="SYNTHETIC_RETAINED_NOTE",
                source="chat",
            )
            db.add(note)
            pair = sessions.start(db, user.id)
            code = recovery.issue(user)
            mid = str(uuid.uuid4())
            body, key_id = message_crypto.encrypt(
                "EXCLUDED_SYNTHETIC_CHAT", message_id=mid, conversation_id=room.id
            )
            db.add(
                ChatMessage(
                    id=mid,
                    conversation_id=room.id,
                    sender_kind="member",
                    sender_id=user.id,
                    seq=1,
                    client_id="synthetic-seed",
                    body=body,
                    key_id=key_id,
                )
            )
            db.flush()
            result["accounts"].append(
                {
                    "id": user.id,
                    "room": room.id,
                    "note": note.id,
                    "refresh": pair.refresh_token,
                    "recovery": code,
                }
            )
        db.commit()
        assert db.scalar(select(func.count()).select_from(ChatMessage)) == 2
    (WORK / "fixture.json").write_text(json.dumps(result), encoding="utf-8")


def erase():
    import httpx
    from urllib.parse import urlsplit
    from app.config import get_settings
    from app.models.user import User
    from app.services import chat_events, recovery_receipts, stream
    from app.services.erasure import erase_member

    assert urlsplit(get_settings().recovery_receipt_url).hostname == RUN + "-receiver"
    assert get_settings().recovery_receipt_required
    # Only the synthetic CA is injected. The real HTTPS URL/token/ack validation
    # and durable network receiver remain exercised, never mocked into success.
    original = httpx.Client
    recovery_receipts.httpx.Client = lambda **kwargs: original(
        verify=str(WORK / "tls/cert.pem"), **kwargs
    )
    stream.delete_user = lambda *_: None
    stream.erase_channel = lambda *_: (_ for _ in ()).throw(AssertionError("Stream channel called"))
    chat_events.publish = lambda *_: None
    account = json.loads((WORK / "fixture.json").read_text())["accounts"][0]
    with database()() as db:
        assert erase_member(db, account["id"]) is not None
        assert db.get(User, account["id"]) is None
        assert erase_member(db, account["id"]) is None


def replay():
    from sqlalchemy import func, select
    from app.models.chat_message import ChatMessage
    from app.models.conversation import Conversation
    from app.models.journal import JournalEntry
    from app.models.listener import ListenerProfile
    from app.models.session import Session as AuthSession
    from app.models.user import User
    from app.services import chat_events, recovery, recovery_receipts, sessions, stream
    from app.services.erasure import recovery_digest
    from app.services.recovery_manifest import verify_receipt_export
    from app.services.recovery_reconciliation import reconcile_restored_export
    from recovery_receipt_evidence import trusted_checkpoint

    witness = trusted_checkpoint(WORK / "checkpoint.json", os.environ["TRUSTED_CHECKPOINT_SHA256"])
    raw = (WORK / "receipts.json").read_bytes()
    fixture = json.loads((WORK / "fixture.json").read_text())
    deleted, retained = fixture["accounts"]
    assert verify_receipt_export(raw, witness, require_full_checkpoint=True) == frozenset(
        {recovery_digest(deleted["id"])}
    )

    def forbidden(*_args, **_kwargs):
        raise AssertionError("Offline replay contacted serving integration")

    stream.delete_user = stream.erase_channel = recovery_receipts.acknowledge = forbidden
    chat_events.after_commit = forbidden
    with database()() as db:
        # Stale credentials and both saved notes really came back from the PostgreSQL snapshot restore.
        assert db.get(User, deleted["id"]) is not None
        assert recovery.find(db, deleted["recovery"]).id == deleted["id"]
        assert db.get(JournalEntry, deleted["note"]) is not None
        assert (
            db.scalar(
                select(func.count())
                .select_from(AuthSession)
                .where(AuthSession.user_id == deleted["id"])
            )
            == 1
        )
        assert db.scalar(select(func.count()).select_from(ChatMessage)) == 0
        assert db.get(JournalEntry, retained["note"]).body == "SYNTHETIC_RETAINED_NOTE"
        assert reconcile_restored_export(db, raw, witness) == 1
        db.commit()
    with database()() as db:
        assert db.get(User, deleted["id"]) is None
        assert db.get(JournalEntry, deleted["note"]) is None
        assert db.get(Conversation, deleted["room"]) is None
        assert (
            db.scalar(
                select(func.count())
                .select_from(AuthSession)
                .where(AuthSession.user_id == deleted["id"])
            )
            == 0
        )
        assert recovery.find(db, deleted["recovery"]) is None
        try:
            sessions.rotate(db, deleted["refresh"])
        except sessions.SessionInvalid:
            pass
        else:
            raise AssertionError("Deleted refresh credential was accepted")
        assert db.get(User, retained["id"]) is not None
        assert db.get(JournalEntry, retained["note"]) is not None
        assert db.get(Conversation, retained["room"]) is not None
        assert db.get(ListenerProfile, fixture["mentor"]).active_conversations == 1
        assert recovery.find(db, retained["recovery"]).id == retained["id"]
        assert sessions.rotate(db, retained["refresh"]).user_id == retained["id"]
        db.commit()
        assert reconcile_restored_export(db, raw, witness) == 0
        db.commit()


if __name__ == "__main__":
    {"tls": tls, "seed": seed, "erase": erase, "replay": replay}[sys.argv[1]]()
    print("PASS synthetic " + sys.argv[1], flush=True)
