"""Bounded local own-chat replica/process-loss proof; never production capacity."""

import argparse
import asyncio
import importlib.util
import json
import math
from pathlib import Path
import platform
import re
import secrets
import signal
import sys
import time


def support():
    spec = importlib.util.spec_from_file_location(
        "same_database_rehearsal", Path(__file__).with_name("rehearse-same-database.py")
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def percentiles(samples):
    """Nearest-rank, measured milliseconds; sample counts are always reported."""
    values = sorted(samples)
    if not values:
        raise ValueError("Empty latency sample")
    return {
        "samples": len(values),
        "p50_ms": values[math.ceil(len(values) * 0.50) - 1],
        "p95_ms": values[math.ceil(len(values) * 0.95) - 1],
        "max_ms": values[-1],
    }


def verify_replay(messages, expected):
    ids = [row["client_id"] for row in messages]
    seqs = [row["seq"] for row in messages]
    ordered = not seqs or seqs == list(range(seqs[0], seqs[0] + len(seqs)))
    if ids != expected or len(set(ids)) != len(ids) or not ordered:
        raise AssertionError("Missing, reordered or duplicate replay")


def owned_id(helper, name):
    records = [
        ident
        for kind, item, ident in helper.created
        if kind == "container" and item == name
    ]
    if len(records) != 1 or helper.ownership("container", name) != records[0]:
        raise ValueError("Fault target ownership changed")
    return records[0]


async def frame(ws, kind, client_id=None, timeout=10):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        result = json.loads(
            await asyncio.wait_for(ws.recv(), deadline - time.monotonic())
        )
        if result.get("t") in ("error", "held"):
            raise AssertionError("Chat send refused")
        if result.get("t") == kind:
            if (
                client_id is None
                or result.get("message", {}).get("client_id") == client_id
            ):
                return result
            if kind == "message":
                raise AssertionError("Unexpected duplicate or reordered message")
    raise TimeoutError("Expected chat frame missing")


async def connect(base, chat, who, after=0):
    from websockets.asyncio.client import connect as websocket_connect

    ws = await websocket_connect(
        base.replace("http://", "ws://") + "/api/v1/chat/ws/" + chat["cid"],
        open_timeout=10,
        close_timeout=2,
        max_queue=64,
        max_size=16384,
    )
    try:
        await ws.send(json.dumps({"t": "hello", "token": chat[who], "after": after}))
        hello = await frame(ws, "hello")
        return ws, hello
    except BaseException:
        await ws.close()
        raise


async def send(ws, client_id):
    await ws.send(
        json.dumps(
            {
                "t": "send",
                "client_id": client_id,
                "text": "hello from a synthetic rehearsal",
            }
        )
    )


async def no_extra_messages(ws):
    # Bounded observation after replay: no unsolicited duplicate message frames.
    deadline = time.monotonic() + 0.3
    while time.monotonic() < deadline:
        try:
            row = json.loads(
                await asyncio.wait_for(ws.recv(), deadline - time.monotonic())
            )
        except TimeoutError:
            return
        if row.get("t") == "message":
            raise AssertionError("Unexpected duplicate after replay")


SEED = """
import json
from datetime import date
from app.db import SessionLocal
from app.models.user import User
from app.models.listener import ListenerProfile
from app.models.conversation import Conversation
from app.models.enums import ListenerStatus, VettingStatus, ConversationStatus
from app.security import issue_listener_token, issue_session_token
out=[]
with SessionLocal() as s:
    for _ in range(ROOMS):
        u=User(persona_name='Synthetic Cove', persona_avatar='x', dob=date(1990,1,1), age_at_signup=36)
        li=ListenerProfile(persona_name='Synthetic River', persona_avatar='river', categories=[],
            status=ListenerStatus.online, vetting_status=VettingStatus.approved, rank=10,
            active_conversations=1, max_concurrent=3)
        s.add_all([u,li]); s.flush()
        c=Conversation(type='anon', status=ConversationStatus.active,
            user_id=u.id, listener_id=li.id, chat_backend='own')
        s.add(c); s.flush(); c.stream_channel_id=c.id
        out.append(dict(cid=c.id, member=issue_session_token(u.id), mentor=issue_listener_token(li.id)))
    s.commit()
print(json.dumps(out))
"""


async def exercise(helper, args, bases, chats, apis):
    helper.evidence["phase"] = "bounded_load"
    ack_samples, delivery_samples, http_samples = [], [], []
    started = time.perf_counter()

    async def room(chat, index):
        member, _ = await connect(bases[0], chat, "member")
        mentor, _ = await connect(bases[1], chat, "mentor")
        try:
            seen = []
            for i in range(args.messages):
                client_id = f"load-{index}-{i}"
                at = time.perf_counter()
                await send(member, client_id)

                async def arrived(ws, samples):
                    message = (await frame(ws, "message", client_id))["message"]
                    samples.append((time.perf_counter() - at) * 1000)
                    return message

                ack, delivered = await asyncio.gather(
                    arrived(member, ack_samples), arrived(mentor, delivery_samples)
                )
                if ack["id"] != delivered["id"] or ack["seq"] != i + 1:
                    raise AssertionError("Replica delivery differs")
                seen.append(delivered)
            verify_replay(seen, [f"load-{index}-{i}" for i in range(args.messages)])
            for _ in range(10):
                at = time.perf_counter()
                history = await asyncio.to_thread(
                    helper.request,
                    bases[1],
                    "/chat/" + chat["cid"] + "/messages",
                    chat["mentor"],
                )
                http_samples.append((time.perf_counter() - at) * 1000)
                verify_replay(
                    history["messages"],
                    [f"load-{index}-{i}" for i in range(args.messages)],
                )
        finally:
            await member.close()
            await mentor.close()

    await asyncio.gather(*(room(chat, i) for i, chat in enumerate(chats)))
    helper.evidence["measurement"] = {
        "duration_seconds": time.perf_counter() - started,
        "rooms": args.rooms,
        "sockets": args.rooms * 2,
        "max_sends_in_flight": args.rooms,
        "messages_per_room": args.messages,
        "message_characters": len("hello from a synthetic rehearsal"),
        "sender_commit_echo": percentiles(ack_samples),
        "cross_replica_delivery": percentiles(delivery_samples),
        "authenticated_history_http": percentiles(http_samples),
        "targets": {
            "chat_delivery_p95_ms": 500,
            "http_p95_ms": 300,
            "reconnect_ms": 3000,
        },
        "note": "Loopback and synthetic load only; no production capacity claim or load extrapolation.",
        "concurrent_host_activity": args.host_activity,
    }
    helper.passed("bounded concurrent cross-replica delivery and authenticated history")
    helper.evidence["phase"] = "sender_process_loss"
    chat = chats[0]
    member, _ = await connect(bases[0], chat, "member", args.messages)
    mentor, _ = await connect(bases[1], chat, "mentor", args.messages)
    kill_id = "acked-before-process-kill"
    await send(member, kill_id)
    ack = (await frame(member, "message", kill_id))["message"]
    ident = owned_id(helper, apis[0])
    await asyncio.to_thread(helper.docker, "kill", "--signal", "KILL", ident)
    if helper.inspect(apis[0])["State"]["ExitCode"] != 137:
        raise AssertionError("API process did not die by SIGKILL")
    peer = (await frame(mentor, "message", kill_id))["message"]
    if peer["id"] != ack["id"]:
        raise AssertionError("Acknowledged message differs at peer")
    await member.close()
    at = time.perf_counter()
    member, hello = await connect(bases[1], chat, "member", args.messages)
    replay = (await frame(member, "message", kill_id))["message"]
    helper.evidence["reconnect_after_process_loss_ms"] = (
        time.perf_counter() - at
    ) * 1000
    verify_replay([replay], [kill_id])
    if replay["id"] != ack["id"] or hello["last_seq"] != ack["seq"]:
        raise AssertionError("Acknowledged write lost after process kill")
    await no_extra_messages(member)
    await send(member, kill_id)
    if (await frame(member, "message", kill_id))["message"]["id"] != ack["id"]:
        raise AssertionError("Retried send minted a duplicate")
    await no_extra_messages(mentor)
    helper.passed(
        "sender API SIGKILL preserves acknowledged write and idempotent retry"
    )
    await mentor.close()
    helper.evidence["phase"] = "peer_reconnect_replay"
    offline_ids = ["offline-peer-0", "offline-peer-1"]
    for client_id in offline_ids:
        await send(member, client_id)
        await frame(member, "message", client_id)
    await asyncio.to_thread(helper.docker, "start", ident)
    bases[0] = helper.endpoint(apis[0])
    await asyncio.to_thread(
        helper.wait, lambda: helper.request(bases[0], "/health/ready")["status"] == "ok"
    )
    at = time.perf_counter()
    mentor, _ = await connect(bases[0], chat, "mentor", ack["seq"])
    replay = [(await frame(mentor, "message"))["message"] for _ in offline_ids]
    helper.evidence["reconnect_missed_messages_ms"] = (time.perf_counter() - at) * 1000
    verify_replay(replay, offline_ids)
    await no_extra_messages(mentor)
    helper.passed(
        "peer reconnect replays exactly the missed messages without duplicates"
    )
    await member.close()
    await mentor.close()
    last = ack["seq"] + len(offline_ids)
    member, _ = await connect(bases[0], chat, "member", last)
    mentor, _ = await connect(bases[1], chat, "mentor", last)
    helper.evidence["phase"] = "cache_loss"
    cache = owned_id(helper, helper.CACHE)
    await asyncio.to_thread(helper.docker, "stop", "-t", "5", cache)
    await send(member, "cache-down-durable")
    durable = (await frame(member, "message", "cache-down-durable", timeout=20))[
        "message"
    ]
    history = await asyncio.to_thread(
        helper.request,
        bases[1],
        "/chat/" + chat["cid"] + "/messages?after=" + str(last),
        chat["mentor"],
    )
    verify_replay(history["messages"], ["cache-down-durable"])
    await mentor.close()
    mentor, _ = await connect(bases[1], chat, "mentor", last)
    replay = (await frame(mentor, "message"))["message"]
    verify_replay([replay], ["cache-down-durable"])
    if replay["id"] != durable["id"]:
        raise AssertionError("Cache-loss durable write changed")
    await no_extra_messages(mentor)
    helper.passed(
        "cache loss preserves durable writes; independent replica replays from PostgreSQL"
    )
    helper.evidence["phase"] = "cache_restoration"
    await asyncio.to_thread(helper.docker, "start", cache)

    def subscriptions():
        rows = helper.docker(
            "exec", cache, "valkey-cli", "--raw", "CLIENT", "LIST", "TYPE", "PUBSUB"
        )
        return len([row for row in rows.splitlines() if "cmd=psubscribe" in row]) >= 2

    await asyncio.to_thread(helper.wait, subscriptions, 30)
    await send(member, "cache-restored-live")
    ack2, peer2 = await asyncio.gather(
        frame(member, "message", "cache-restored-live"),
        frame(mentor, "message", "cache-restored-live"),
    )
    if ack2["message"]["id"] != peer2["message"]["id"]:
        raise AssertionError("Cross-replica delivery did not recover")
    helper.passed("restored cache resumes live cross-replica delivery")
    await member.close()
    await mentor.close()
    stored = helper.sql(
        "SELECT client_id FROM chat_messages ORDER BY client_id"
    ).splitlines()
    expected = {
        f"load-{index}-{i}" for index in range(args.rooms) for i in range(args.messages)
    }
    expected.update(
        [kill_id, *offline_ids, "cache-down-durable", "cache-restored-live"]
    )
    if len(stored) != len(expected) or set(stored) != expected:
        raise AssertionError("Durable database contains missing or duplicate rows")
    helper.evidence["durable_messages"] = len(stored)
    helper.evidence["phase"] = "completed"


def run(helper, args):
    image = json.loads(helper.docker("image", "inspect", args.image))[0]
    if (
        image["Config"].get("Labels", {}).get("org.opencontainers.image.revision")
        != args.revision
    ):
        raise ValueError("API image revision differs")
    image = image["Id"]
    helper.evidence["image_id"] = image
    helper.evidence["resources"] = {
        "api_replicas": 2,
        "processes_per_replica": 1,
        "api_memory_mib_each": 512,
        "db_cache_memory_mib_each": 256,
        "cpus_per_container": 1,
        "pids_limit_each": 128,
        "host_platform": platform.platform(),
        "docker": json.loads(
            helper.docker(
                "info", "--format", '{"cpus":{{.NCPU}},"memory_bytes":{{.MemTotal}}}'
            )
        ),
    }
    helper.create(
        "network",
        helper.NETWORK,
        ["network", "create", "--label", helper.LABEL, helper.NETWORK],
    )
    helper.create(
        "volume",
        helper.VOLUME,
        ["volume", "create", "--label", helper.LABEL, helper.VOLUME],
    )
    password = secrets.token_hex(24)
    helper.container(
        helper.DB,
        "postgres:16-alpine",
        env={
            "POSTGRES_DB": "mento",
            "POSTGRES_USER": "mento",
            "POSTGRES_PASSWORD": password,
        },
    )
    helper.container(helper.CACHE, "valkey/valkey:8-alpine")
    helper.wait(lambda: helper.sql("SELECT 1") == "1")
    env = {
        "ENV": "dev",
        "DATABASE_URL": "postgresql+psycopg://mento:"
        + password
        + "@"
        + helper.DB
        + "/mento",
        "REDIS_URL": "redis://" + helper.CACHE + ":6379/0",
        "JWT_SECRET": secrets.token_hex(32),
        "UVICORN_WORKERS": "1",
        "DB_POOL_SIZE": "5",
        "DB_MAX_OVERFLOW": "0",
        "STREAM_API_KEY": "",
        "STREAM_API_SECRET": "",
        "PUSH_ENABLED": "false",
        "RECOVERY_RECEIPT_REQUIRED": "false",
    }
    migration = helper.RUN + "-migrate"
    helper.container(
        migration, image, ("alembic", "upgrade", "head"), env, memory="512m"
    )
    helper.wait(lambda: not helper.inspect(migration)["State"]["Running"])
    if helper.inspect(migration)["State"]["ExitCode"] != 0:
        raise RuntimeError("Migration failed")
    apis = [helper.RUN + "-api-a", helper.RUN + "-api-b"]
    for name in apis:
        helper.container(name, image, env=env, port=True, memory="512m")
    bases = [helper.endpoint(name) for name in apis]
    for base in bases:
        helper.wait(lambda: helper.request(base, "/health/ready")["status"] == "ok")
    chats = json.loads(
        helper.docker(
            "exec",
            "-i",
            apis[0],
            "python",
            "-",
            input=SEED.replace("ROOMS", str(args.rooms)),
        )
    )
    asyncio.run(exercise(helper, args, bases, chats, apis))
    helper.evidence["status"] = "passed"


def cli(argv=None):
    helper = support()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", required=True)
    parser.add_argument("--revision", required=True)
    parser.add_argument("--context")
    parser.add_argument(
        "--host-activity",
        default="Not established; other host activity may be present.",
    )
    parser.add_argument("--rooms", type=int, choices=range(1, 5), default=3)
    parser.add_argument("--messages", type=int, choices=range(1, 16), default=10)
    parser.add_argument(
        "--evidence",
        type=Path,
        default=helper.ROOT / ".local" / (helper.RUN + "-own-chat.json"),
    )
    args = parser.parse_args(argv)
    if not re.fullmatch(r"[0-9a-f]{40}", args.revision) or sys.flags.optimize:
        parser.error("Full lowercase Git SHA and unoptimized Python required")
    context = args.context or helper.docker("context", "show")
    host = json.loads(helper.docker("context", "inspect", context))[0]["Endpoints"][
        "docker"
    ]["Host"]
    if not host.startswith(("unix:///", "npipe:////./pipe/")):
        parser.error("Local Docker socket required")
    helper.CONTEXT = context
    helper.evidence["revision"] = args.revision
    helper.evidence["limitations"] = [
        "Synthetic loopback workload, not production capacity or live acceptance.",
        "One process per replica; SIGKILL kills the sole API PID1, not a multi-worker supervisor.",
        "Cache-outage live cross-replica delivery is not guaranteed; PostgreSQL replay is required.",
        "No proxy, TLS, mobile-device or production-host performance acceptance.",
    ]
    args.evidence.parent.mkdir(parents=True, exist_ok=True)
    args.evidence.write_text(json.dumps(helper.evidence) + "\n")

    def interrupted(signum, frame):
        raise KeyboardInterrupt

    previous = signal.signal(signal.SIGTERM, interrupted)
    try:
        run(helper, args)
    except (Exception, KeyboardInterrupt) as exc:
        helper.evidence["status"] = "failed"
        helper.evidence["error_type"] = type(exc).__name__
    finally:
        signal.signal(signal.SIGTERM, previous)
        try:
            helper.evidence["cleanup"] = helper.cleanup()
            if not all(row["removed"] for row in helper.evidence["cleanup"]):
                helper.evidence["status"] = "failed"
        except Exception as exc:
            helper.evidence["status"] = "failed"
            helper.evidence["cleanup_error_type"] = type(exc).__name__
        args.evidence.write_text(json.dumps(helper.evidence, indent=2) + "\n")
    print("Evidence: " + str(args.evidence))
    return 0 if helper.evidence.get("status") == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(cli())
