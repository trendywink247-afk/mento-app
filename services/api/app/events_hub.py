"""Live events: one socket per signed-in app, server pushes, nobody polls (docs/LIVE_EVENTS.md).

One `EventsHub` per process. Each app holds ONE socket (`GET /api/v1/events`) while it is in
the foreground; the server pushes small typed events carrying ids only, and the app refetches
just what changed. In the background the socket is closed and FCM takes over.

Fan-out: every event is published once to the Valkey channel `mento:ev:bus` as
`{"m": [member ids], "l": [listener ids], "ev": {...}}`. Each process holds ONE subscription
and routes the event, in memory, to its own sockets of those identities. Without Valkey it
falls back to this process's sockets (single-worker dev, or an outage: the app catches up on
its next refetch). Lossy by design: Postgres is the truth, events only say "look again".

Per process, one sweeper task (never one per socket):
  - closes sockets whose token expired (4401);
  - every PRESENCE_TOUCH_S, in ONE database round, closes sockets whose account lost its
    standing (4403) and touches `last_seen_at` for every connected mentor, so the server's
    existing stale-presence sweep sees the open app exactly as it saw the old 5-minute
    client heartbeat. No product behaviour change; the client heartbeat becomes unnecessary.

Each socket has a bounded queue and its own writer, so a slow client is dropped (1013), never
allowed to stall delivery to anyone else.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import time
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import UTC, datetime

import anyio.to_thread
import redis
from fastapi import WebSocket
from redis import asyncio as aioredis
from redis.exceptions import RedisError

from app.config import get_settings

logger = logging.getLogger("mento.events.hub")

CHANNEL = "mento:ev:bus"
SEND_QUEUE = 32  # events buffered per socket before it is dropped as too slow
SOCKETS_PER_IDENTITY = 3  # the oldest goes when a fourth arrives
CLOSE_TOO_SLOW = 1013
CLOSE_UNAUTHORIZED = 4401
CLOSE_REVOKED = 4403
CLOSE_REPLACED = 4409
SWEEP_EVERY_S = 60.0
PRESENCE_TOUCH_S = 300.0  # same cadence as the old client heartbeat (5 min)
_CLOSE_TIMEOUT_S = 2.0

Identity = tuple[str, str]  # ("member" | "listener", id)


def valkey_kwargs(*, subscriber: bool = False) -> dict:
    """Timeouts and health checks for every Valkey client: a hung cache must never hang a
    request or the event loop, and a dead connection is noticed before it is used.

    A pub/sub SUBSCRIBER gets no read timeout: it blocks on the socket until a message comes,
    which may be hours, and a read timeout would turn that into a reconnect loop (polling by
    another name). TCP keepalive notices a dead peer instead."""
    if subscriber:
        return {"socket_connect_timeout": 1.0, "socket_keepalive": True}
    return {
        "socket_timeout": 2.0,
        "socket_connect_timeout": 1.0,
        "socket_keepalive": True,
        "health_check_interval": 30,
        "retry_on_timeout": True,
    }


@dataclass(eq=False)
class Conn:
    ws: WebSocket
    who: Identity
    expires_at: float  # token expiry (epoch seconds); the socket closes at it
    opened_at: float = field(default_factory=time.monotonic)
    queue: asyncio.Queue = field(default_factory=lambda: asyncio.Queue(maxsize=SEND_QUEUE))
    writer: asyncio.Task | None = None
    closed: bool = False


class EventsHub:
    def __init__(self) -> None:
        self._conns: dict[Identity, list[Conn]] = defaultdict(list)
        self._redis: aioredis.Redis | None = None  # commands: publish
        self._sub: aioredis.Redis | None = None  # the one subscription
        self._sync: redis.Redis | None = None
        self._listen_task: asyncio.Task | None = None
        self._sweep_task: asyncio.Task | None = None
        self._last_touch = 0.0

    # ---- lifecycle -------------------------------------------------------------
    async def start(self) -> None:
        try:
            self._redis = aioredis.from_url(
                get_settings().redis_url, decode_responses=True, **valkey_kwargs()
            )
            await self._redis.ping()
        except Exception as exc:  # noqa: BLE001 — degrade to local fan-out, never crash boot
            logger.warning(
                "events hub: Valkey unavailable (%s) — local fan-out only", type(exc).__name__
            )
            self._redis = None
        if self._redis is not None:
            self._sub = aioredis.from_url(
                get_settings().redis_url, decode_responses=True, **valkey_kwargs(subscriber=True)
            )
            self._listen_task = asyncio.create_task(self._listen())
        self._sweep_task = asyncio.create_task(self._sweeper())

    async def stop(self) -> None:
        for task in (self._listen_task, self._sweep_task):
            if task:
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError, Exception):
                    await task
        self._listen_task = self._sweep_task = None
        for client in (self._sub, self._redis):
            if client is not None:
                with contextlib.suppress(Exception):
                    await client.aclose()
        self._redis = self._sub = None

    async def _listen(self) -> None:
        assert self._sub is not None
        while True:
            try:
                pubsub = self._sub.pubsub()
                await pubsub.subscribe(CHANNEL)
                async for item in pubsub.listen():
                    if item.get("type") != "message":
                        continue
                    with contextlib.suppress(ValueError, TypeError):
                        self._deliver(json.loads(item["data"]))
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 — resubscribe; apps catch up on refetch
                logger.warning("events subscriber dropped (%s) — retrying", type(exc).__name__)
                await asyncio.sleep(1)

    # ---- sockets ---------------------------------------------------------------
    async def register(self, ws: WebSocket, who: Identity, expires_at: float) -> Conn:
        """Add an authorized socket; the identity's oldest goes past SOCKETS_PER_IDENTITY."""
        conn = Conn(ws=ws, who=who, expires_at=expires_at)
        mine = self._conns[who]
        mine.append(conn)
        while len(mine) > SOCKETS_PER_IDENTITY:
            await self._drop(mine[0], CLOSE_REPLACED)
        conn.writer = asyncio.create_task(self._write(conn))
        return conn

    async def unregister(self, conn: Conn) -> None:
        conn.closed = True
        mine = self._conns.get(conn.who)
        if mine is not None:
            with contextlib.suppress(ValueError):
                mine.remove(conn)
            if not mine:
                self._conns.pop(conn.who, None)
        if conn.writer is not None and conn.writer is not asyncio.current_task():
            conn.writer.cancel()

    def connected(self, role: str | None = None) -> set[str]:
        return {i for (r, i) in self._conns if role is None or r == role}

    def count(self) -> int:
        return sum(len(v) for v in self._conns.values())

    async def _drop(self, conn: Conn, code: int) -> None:
        await self.unregister(conn)
        with contextlib.suppress(Exception):
            await asyncio.wait_for(conn.ws.close(code=code), _CLOSE_TIMEOUT_S)

    async def _write(self, conn: Conn) -> None:
        try:
            while True:
                event = await conn.queue.get()
                await conn.ws.send_json(event)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 — a dead socket; its receive loop cleans up
            conn.closed = True

    # ---- events ----------------------------------------------------------------
    async def publish(self, payload: dict) -> None:
        if self._redis is not None:
            try:
                await self._redis.publish(CHANNEL, json.dumps(payload))
                return
            except RedisError as exc:
                logger.warning("events publish failed (%s) — local fan-out", type(exc).__name__)
        self._deliver(payload)

    def publish_sync(self, payload: dict) -> bool:
        """From code with no event loop (a job, a script): straight to Valkey."""
        try:
            if self._sync is None:
                self._sync = redis.Redis.from_url(get_settings().redis_url, **valkey_kwargs())
            self._sync.publish(CHANNEL, json.dumps(payload))
            return True
        except RedisError as exc:
            logger.warning("events sync publish failed (%s)", type(exc).__name__)
            return False

    def _deliver(self, payload: dict) -> None:
        """Route one bus message to this process's sockets. Never awaits a socket."""
        event = payload.get("ev")
        if not isinstance(event, dict):
            return
        for role, key in (("member", "m"), ("listener", "l")):
            for ident in payload.get(key) or ():
                for conn in list(self._conns.get((role, ident), ())):
                    self._offer(conn, event)

    def _offer(self, conn: Conn, event: dict) -> None:
        if conn.closed:
            return
        try:
            conn.queue.put_nowait(event)
        except asyncio.QueueFull:
            logger.warning("events socket too slow — dropped (it reconnects and refetches)")
            asyncio.get_running_loop().create_task(self._drop(conn, CLOSE_TOO_SLOW))

    # ---- one sweeper per process ----------------------------------------------
    async def _sweeper(self) -> None:
        while True:
            try:
                await asyncio.sleep(SWEEP_EVERY_S)
                await self.sweep()
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001 — the next sweep tries again
                logger.exception("events sweep failed")

    async def sweep(self, *, force_touch: bool = False) -> None:
        now = time.time()
        for conns in list(self._conns.values()):
            for conn in list(conns):
                if conn.expires_at and conn.expires_at <= now:
                    await self._drop(conn, CLOSE_UNAUTHORIZED)
        if not self._conns:
            return
        if not force_touch and time.monotonic() - self._last_touch < PRESENCE_TOUCH_S:
            return
        self._last_touch = time.monotonic()
        members = self.connected("member")
        listeners = self.connected("listener")
        revoked = await anyio.to_thread.run_sync(_standing_and_touch, members, listeners)
        for who in revoked:
            for conn in list(self._conns.get(who, ())):
                await self._drop(conn, CLOSE_REVOKED)


def _standing_and_touch(members: set[str], listeners: set[str]) -> set[Identity]:
    """ONE database round for every socket in this process: who lost standing, and a
    presence touch for every connected, approved mentor."""
    from sqlalchemy import select, update

    from app.db import SessionLocal
    from app.models.enums import MemberStatus, VettingStatus
    from app.models.listener import ListenerProfile
    from app.models.user import User
    from app.services.member_status import standing

    revoked: set[Identity] = set()
    with SessionLocal() as db:
        if members:
            rows = db.execute(
                select(User.id, User.status, User.banned_until).where(User.id.in_(members))
            ).all()
            found = {r[0] for r in rows}
            revoked |= {("member", m) for m in members - found}
            revoked |= {
                ("member", r[0]) for r in rows if standing(r[1], r[2]).status != MemberStatus.active
            }
        if listeners:
            approved = set(
                db.scalars(
                    select(ListenerProfile.id).where(
                        ListenerProfile.id.in_(listeners),
                        ListenerProfile.vetting_status == VettingStatus.approved,
                    )
                )
            )
            revoked |= {("listener", li) for li in listeners - approved}
            if approved:
                db.execute(
                    update(ListenerProfile)
                    .where(ListenerProfile.id.in_(approved))
                    .values(last_seen_at=datetime.now(UTC))
                )
                db.commit()
    return revoked


hub = EventsHub()
