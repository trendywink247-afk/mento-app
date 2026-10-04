from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from recovery_receiver.receiver import create_app
from recovery_receiver.store import Store, canonical, initialize, publish_export

TOKEN = "synthetic-test-credential-" + "x" * 32
DIGEST = "a" * 64
AUTH = {"Authorization": "Bearer " + TOKEN}
PAYLOAD = {"version": 1, "member_digest": DIGEST}


@pytest.fixture
def database(tmp_path):
    path = tmp_path / "receipts.sqlite3"
    initialize(path)
    return path


@pytest.fixture
def app(database):
    return create_app(database, TOKEN)


@pytest.fixture
def client(app):
    with TestClient(app) as value:
        yield value


def assert_manifest(manifest):
    checksum = manifest["sha256"]
    unsigned = {key: value for key, value in manifest.items() if key != "sha256"}
    assert hashlib.sha256(canonical(unsigned)).hexdigest() == checksum
    assert manifest["coverage"] == "unverified"
    assert manifest["receipt_count"] == len(manifest["receipts"])
    assert manifest["high_water"] == (
        manifest["receipts"][-1]["sequence"] if manifest["receipts"] else 0
    )
    assert [row["sequence"] for row in manifest["receipts"]] == list(
        range(1, manifest["receipt_count"] + 1)
    )


def test_success_is_committed_before_ack_and_retry_preserves_original(client, database):
    response = client.post("/receipts", headers=AUTH, json=PAYLOAD)
    assert response.status_code == 200
    assert response.json() == {**PAYLOAD, "durable": True}
    first = Store(database).export()
    assert first["receipts"][0]["member_digest"] == DIGEST
    assert client.post("/receipts", headers=AUTH, json=PAYLOAD).status_code == 200
    assert Store(database).export()["receipts"] == first["receipts"]
    assert_manifest(first)


def test_response_loss_after_commit_is_safe_to_retry(app, client, database, monkeypatch):
    store = app.state.receipt_store
    record = store.record

    def lost_response(digest):
        record(digest)
        raise sqlite3.OperationalError("synthetic failure after durable commit")

    monkeypatch.setattr(store, "record", lost_response)
    assert client.post("/receipts", headers=AUTH, json=PAYLOAD).status_code == 503
    with TestClient(create_app(database, TOKEN)) as restarted:
        assert restarted.post("/receipts", headers=AUTH, json=PAYLOAD).status_code == 200
    assert Store(database).export()["receipt_count"] == 1


def test_abrupt_process_exit_immediately_after_commit_survives_reopen(database):
    script = """
import os, sqlite3, sys
from pathlib import Path
from recovery_receiver.store import Store
class ExitAfterCommit(sqlite3.Connection):
    def commit(self):
        super().commit()
        os._exit(23)
store = Store(Path(sys.argv[1]))
def connect():
    connection = sqlite3.connect(store.path.as_uri() + '?mode=rw', uri=True,
        isolation_level=None, factory=ExitAfterCommit)
    connection.execute('PRAGMA synchronous=FULL')
    return connection
store._connect = connect
store.record('a' * 64)
raise AssertionError('commit must terminate the child')
"""
    environment = {**os.environ, "PYTHONPATH": str(Path(__file__).resolve().parents[2])}
    result = subprocess.run(
        [sys.executable, "-c", script, str(database)],
        cwd=database.parent,
        env=environment,
        capture_output=True,
        timeout=15,
    )
    assert result.returncode == 23, result.stderr.decode(errors="replace")
    reopened = Store(database)
    reopened.record(DIGEST)
    assert reopened.export()["receipt_count"] == 1
    assert_manifest(reopened.export())


def test_commit_failure_rolls_back_and_never_acknowledges(app, client, database, monkeypatch):
    store = app.state.receipt_store
    original = store._connect

    class CommitFailure(sqlite3.Connection):
        def commit(self):
            raise sqlite3.OperationalError("synthetic disk failure with private detail")

    def failing_connection():
        connection = sqlite3.connect(database, isolation_level=None, factory=CommitFailure)
        connection.execute("PRAGMA synchronous=FULL")
        return connection

    monkeypatch.setattr(store, "_connect", failing_connection)
    response = client.post("/receipts", headers=AUTH, json=PAYLOAD)
    assert response.status_code == 503
    assert response.json() == {"detail": "Receipt storage unavailable"}
    monkeypatch.setattr(store, "_connect", original)
    assert store.export()["receipt_count"] == 0
    assert client.post("/receipts", headers=AUTH, json=PAYLOAD).status_code == 200


def test_write_failure_never_acknowledges(app, client, monkeypatch):
    store = app.state.receipt_store
    original = store._connect

    def read_only_connection():
        connection = original()
        connection.execute("PRAGMA query_only=ON")
        return connection

    monkeypatch.setattr(store, "_connect", read_only_connection)
    assert client.post("/receipts", headers=AUTH, json=PAYLOAD).status_code == 503
    assert store.export()["receipt_count"] == 0


@pytest.mark.parametrize("authorization", [None, "Bearer wrong", "Basic " + TOKEN])
def test_unauthorized_request_does_not_write(client, app, authorization):
    headers = {"Authorization": authorization} if authorization else {}
    assert client.post("/receipts", headers=headers, json=PAYLOAD).status_code == 401
    assert app.state.receipt_store.export()["receipt_count"] == 0


def test_duplicate_authorization_headers_are_rejected(client):
    response = client.post(
        "/receipts",
        headers=[("Authorization", "Bearer " + TOKEN), ("Authorization", "Bearer " + TOKEN)],
        json=PAYLOAD,
    )
    assert response.status_code == 401


@pytest.mark.parametrize(
    "payload",
    [
        {},
        [],
        None,
        {"version": True, "member_digest": DIGEST},
        {"version": 1.0, "member_digest": DIGEST},
        {"version": "1", "member_digest": DIGEST},
        {"version": 2, "member_digest": DIGEST},
        {"version": 1, "member_digest": "A" * 64},
        {"version": 1, "member_digest": "a" * 63},
        {"version": 1, "member_digest": "a" * 64 + "\n"},
        {"version": 1, "member_digest": 7},
        {**PAYLOAD, "content": "not accepted"},
    ],
)
def test_invalid_payloads_rejected_without_writing(client, app, payload):
    response = client.post(
        "/receipts",
        headers={**AUTH, "Content-Type": "application/json"},
        content=json.dumps(payload),
    )
    assert response.status_code == 400
    assert app.state.receipt_store.export()["receipt_count"] == 0


@pytest.mark.parametrize(
    ("body", "expected"),
    [
        (b'{"version":1,"version":1,"member_digest":"' + DIGEST.encode() + b'"}', 400),
        (b"{", 400),
        (b"\xff", 400),
        (b" " * 257, 413),
    ],
)
def test_invalid_raw_body_rejected(client, body, expected):
    response = client.post(
        "/receipts", headers={**AUTH, "Content-Type": "application/json"}, content=body
    )
    assert response.status_code == expected


def test_chunked_oversized_body_rejected_without_content_length(client, app):
    response = client.post(
        "/receipts",
        headers={**AUTH, "Content-Type": "application/json"},
        content=iter([b" " * 200, b" " * 200]),
    )
    assert response.status_code == 413
    assert app.state.receipt_store.export()["receipt_count"] == 0


def test_wrong_media_or_compression_is_rejected(client):
    assert client.post("/receipts", headers=AUTH, content="{}").status_code == 415
    assert (
        client.post(
            "/receipts", headers={**AUTH, "Content-Encoding": "gzip"}, json=PAYLOAD
        ).status_code
        == 415
    )


def test_rotation_accepts_only_configured_current_and_previous(database):
    previous = "synthetic-previous-" + "y" * 32
    with TestClient(create_app(database, TOKEN, previous)) as client:
        for token in [TOKEN, previous]:
            assert (
                client.post(
                    "/receipts", headers={"Authorization": "Bearer " + token}, json=PAYLOAD
                ).status_code
                == 200
            )
    with TestClient(create_app(database, TOKEN)) as client:
        assert (
            client.post(
                "/receipts", headers={"Authorization": "Bearer " + previous}, json=PAYLOAD
            ).status_code
            == 401
        )


@pytest.mark.parametrize("token", ["", "x" * 31, "x" * 257, TOKEN + "\n", TOKEN + "é"])
def test_invalid_configuration_rejected_before_serving(database, token):
    with pytest.raises(ValueError, match="credential configuration"):
        create_app(database, token)


def test_missing_store_is_never_implicitly_initialized(tmp_path):
    absent = tmp_path / "missing.sqlite3"
    with pytest.raises(sqlite3.OperationalError):
        create_app(absent, TOKEN)
    assert not absent.exists()


def test_store_identity_change_fails_closed(app, client, database):
    with sqlite3.connect(database) as connection:
        connection.execute("UPDATE metadata SET store_id='00000000-0000-0000-0000-000000000001'")
    assert client.post("/receipts", headers=AUTH, json=PAYLOAD).status_code == 503
    assert Store(database).export()["receipt_count"] == 0


def test_existing_store_cannot_be_initialized_again(database):
    store = Store(database)
    store.record(DIGEST)
    with pytest.raises(FileExistsError):
        initialize(database)
    assert Store(database).identity == store.identity
    assert Store(database).export()["receipt_count"] == 1


def test_exports_remain_consistent_while_writer_adds_receipts(database):
    store = Store(database)
    assert_manifest(store.export())
    with ThreadPoolExecutor(max_workers=2) as executor:
        future = executor.submit(lambda: [store.record(f"{index:064x}") for index in range(40)])
        for _ in range(12):
            manifest = store.export()
            assert_manifest(manifest)
            assert manifest["store_id"] == store.identity
        future.result(timeout=10)
    manifest = store.export()
    assert_manifest(manifest)
    assert manifest["receipt_count"] == manifest["high_water"] == 40


def test_concurrent_duplicate_requests_store_once(database):
    with ThreadPoolExecutor(max_workers=6) as executor:
        results = [executor.submit(Store(database).record, DIGEST) for _ in range(12)]
        for result in results:
            result.result(timeout=10)
    manifest = Store(database).export()
    assert manifest["receipt_count"] == manifest["high_water"] == 1


def test_export_publication_is_private_and_refuses_overwrite(database, tmp_path):
    store = Store(database)
    store.record(DIGEST)
    destination = tmp_path / "manifest.json"
    publish_export(store, destination)
    assert_manifest(json.loads(destination.read_bytes()))
    before = destination.read_bytes()
    with pytest.raises(FileExistsError):
        publish_export(store, destination)
    assert destination.read_bytes() == before
    assert not list(tmp_path.glob(".receipts-*"))
    if os.name == "posix":
        assert destination.stat().st_mode & 0o777 == 0o600


def test_export_failure_never_publishes_partial_file(database, tmp_path, monkeypatch):
    store = Store(database)

    def failed_export():
        raise sqlite3.OperationalError("synthetic")

    monkeypatch.setattr(store, "export", failed_export)
    destination = tmp_path / "failed.json"
    with pytest.raises(sqlite3.OperationalError):
        publish_export(store, destination)
    assert not destination.exists()
    assert not list(tmp_path.glob(".receipts-*"))


def test_no_public_read_or_export_routes(client):
    for path in ["/receipts", "/export", "/docs", "/openapi.json"]:
        assert client.get(path, headers=AUTH).status_code in {404, 405}
