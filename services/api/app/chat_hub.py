"""Realtime fan-out for own-chat (WS5 T5.1, hardened in T5.3).

One `Hub` per process. Sockets register per conversation; `publish` sends an event to
every socket of that conversation on EVERY worker: through Valkey pub/sub when it is up
(one psubscribe per process, `mento:chat:*`), straight to local sockets when it is not.
The database — not the hub — is the source of truth: a socket that misses an event
(dropped connection, worker restart, a full queue) catches up with `history(after_seq)`,
so pub/sub may be lossy without ever losing a message.

A slow client cannot stall a room (T5.3): every socket has its own bounded send queue
and its own writer task. Delivery only ever does `put_nowait`; a socket whose queue is
full is dropped (closed 1013) and reconnects with its last seq. Every frame to a socket
goes through its queue — one writer per socket, never two coroutines on one socket.

A new socket joins PAUSED: its queue buffers live events while the router replays
history straight to it, then `arrive` starts the writer, which skips any message the
replay already carried (seq at or below it). A reconnect therefore gets exactly the
messages after its last seq, no more and no less.

Presence is a Valkey hash with a TTL (refreshed by each socket's ping), so it is correct
across workers; without Valkey it falls back to this process's sockets.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from collections import defaultdict
from dataclasses import dataclass, field

import redis
from fastapi import WebSocket
from redis import asyncio as aioredis
from redis.exceptions import RedisError

from app.config import get_settings

logger = logging.getLogger("mento.chat.hub")

_PREFIX = "mento:chat:"
_PRESENCE = "mento:chatp:"  # not under _PREFIX, so the pub/sub pattern never matches it
_PRESENCE_TTL_S = 150  # sockets ping every ~30 s and refresh it

SEND_QUEUE = 64  # frames buffered per socket before it is dropped as too slow
SOCKETS_PER_USER = 3  # per conversation; the oldest goes when a fourth arrives
CLOSE_TOO_SLOW = 1013  # "try again later": the client reconnects with its last seq
CLOSE_REPLACED = 4409  # a newer socket of the same person took this one's place
_CLOSE_TIMEOUT_S = 2.0


@dataclass(eq=False)
class Peer:
    """One socket in one conversation, with its own queue and writer."""

    ws: WebSocket
    user_id: str
    queue: asyncio.Queue = field(default_factory=lambda: asyncio.Queue(maxsize=SEND_QUEUE))
    writer: asyncio.Task | None = None
    replayed_to: int = 0  # messages at or below this seq were sent by the replay
    closed: bool = False
    present: bool = False  # counted in presence (only once the socket is authorized)


class Hub:
    def __init__(self) -> None:
        # conversation_id -> {websocket: Peer}, insertion-ordered (oldest first)
        self._rooms: dict[str, dict[WebSocket, Peer]] = defaultdict(dict)
        self._redis: aioredis.Redis | None = None
        self._sync: redis.Redis | None = None
        self._task: asyncio.Task | None = None

    # ---- lifecycle -------------------------------------------------------------
    async def start(self) -> None:
        try:
            self._redis = aioredis.from_url(get_settings().redis_url, decode_responses=True)
            await self._redis.ping()
        except Exception as exc:  # noqa: BLE001 — degrade to local fan-out, never crash boot
            logger.warning(
                "chat hub: Valkey unavailable (%s) — local fan-out only", type(exc).__name__
            )
            self._redis = None
            return
        self._task = asyncio.create_task(self._listen())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await self._task
            self._task = None
        if self._redis:
            with contextlib.suppress(Exception):
                await self._redis.aclose()
            self._redis = None

    async def _listen(self) -> None:
        assert self._redis is not None
        while True:
            try:
                pubsub = self._redis.pubsub()
                await pubsub.psubscribe(f"{_PREFIX}*")
                async for item in pubsub.listen():
                    if item.get("type") != "pmessage":
                        continue
                    conversation_id = item["channel"].removeprefix(_PREFIX)
                    self._deliver(conversation_id, json.loads(item["data"]))
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 — reconnect; clients catch up from the DB
                logger.warning("chat hub subscriber dropped (%s) — retrying", type(exc).__name__)
                await asyncio.sleep(1)

    # ---- sockets ---------------------------------------------------------------
    def join(self, conversation_id: str, ws: WebSocket, user_id: str) -> Peer:
        """Register a socket, PAUSED and not yet present (see the module docstring):
        it starts buffering live events at once, so nothing published while the
        router authorizes and reads history can fall between the two."""
        peer = Peer(ws=ws, user_id=user_id)
        self._rooms[conversation_id][ws] = peer
        return peer

    async def arrive(self, conversation_id: str, peer: Peer, replayed_to: int) -> None:
        """The socket is authorized and its replay is on the wire: count it present,
        start its writer, and hold the person to SOCKETS_PER_USER here (their oldest
        socket goes, so a reconnect is never refused)."""
        room = self._rooms.get(conversation_id, {})
        mine = [p for p in room.values() if p.user_id == peer.user_id and p is not peer]
        for old in mine[: max(0, len(mine) - SOCKETS_PER_USER + 1)]:
            await self._drop(conversation_id, old, CLOSE_REPLACED)
        peer.replayed_to = replayed_to
        peer.present = True
        await self._presence(conversation_id, peer.user_id, +1)
        if peer.writer is None and not peer.closed:
            peer.writer = asyncio.create_task(self._write(peer))

    async def leave(self, conversation_id: str, ws: WebSocket) -> None:
        room = self._rooms.get(conversation_id)
        peer = room.pop(ws, None) if room is not None else None
        if room is not None and not room:
            self._rooms.pop(conversation_id, None)
        if peer is None:
            return
        peer.closed = True
        if peer.writer is not None and peer.writer is not asyncio.current_task():
            peer.writer.cancel()
        if peer.present:
            peer.present = False
            await self._presence(conversation_id, peer.user_id, -1)

    def send_to(self, peer: Peer, frame: dict) -> None:
        """A frame for this one socket (pong, an error, a held note), through its queue."""
        self._offer(peer, frame, conversation_id=None)

    def room_size(self, conversation_id: str) -> int:
        return len(self._rooms.get(conversation_id, {}))

    async def _write(self, peer: Peer) -> None:
        try:
            while True:
                frame = await peer.queue.get()
                if frame.get("t") == "message" and _seq(frame) <= peer.replayed_to:
                    continue  # the replay already carried it
                await peer.ws.send_json(frame)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 — a dead socket; its own receive loop cleans up
            peer.closed = True

    def _offer(self, peer: Peer, frame: dict, *, conversation_id: str | None) -> None:
        if peer.closed:
            return
        try:
            peer.queue.put_nowait(frame)
        except asyncio.QueueFull:
            logger.warning("chat socket too slow — dropped (it reconnects by seq)")
            room_id = conversation_id or self._room_of(peer)
            if room_id is not None:
                asyncio.get_running_loop().create_task(self._drop(room_id, peer, CLOSE_TOO_SLOW))

    def _room_of(self, peer: Peer) -> str | None:
        for cid, room in self._rooms.items():
            if room.get(peer.ws) is peer:
                return cid
        return None

    async def _drop(self, conversation_id: str, peer: Peer, code: int) -> None:
        """Remove a socket and close it without ever waiting on it for long: a stuck
        client must not stall whoever is dropping it."""
        await self.leave(conversation_id, peer.ws)
        with contextlib.suppress(Exception):
            await asyncio.wait_for(peer.ws.close(code=code), _CLOSE_TIMEOUT_S)

    # Presence lives in Valkey (a per-conversation hash of open-socket counts per user) so
    # it is right across workers. The hash expires unless a socket touches it, so a worker
    # that dies mid-conversation cannot leave someone "online" for long.
    async def _presence(self, conversation_id: str, user_id: str, delta: int) -> None:
        if self._redis is None:
            return
        key = f"{_PRESENCE}{conversation_id}"
        try:
            n = await self._redis.hincrby(key, user_id, delta)
            if n <= 0:
                await self._redis.hdel(key, user_id)
            await self._redis.expire(key, _PRESENCE_TTL_S)
        except RedisError as exc:
            logger.warning("chat presence write failed (%s)", type(exc).__name__)

    async def touch(self, conversation_id: str) -> None:
        if self._redis is not None:
            try:
                await self._redis.expire(f"{_PRESENCE}{conversation_id}", _PRESENCE_TTL_S)
            except RedisError:
                pass

    async def is_connected(self, conversation_id: str, user_id: str) -> bool:
        if self._redis is not None:
            try:
                return (
                    int(await self._redis.hget(f"{_PRESENCE}{conversation_id}", user_id) or 0) > 0
                )
            except RedisError:
                pass
        return any(p.user_id == user_id for p in self._rooms.get(conversation_id, {}).values())

    # ---- events ----------------------------------------------------------------
    async def publish(self, conversation_id: str, event: dict) -> None:
        if self._redis is not None:
            try:
                await self._redis.publish(f"{_PREFIX}{conversation_id}", json.dumps(event))
                return
            except RedisError as exc:
                logger.warning("chat hub publish failed (%s) — local fan-out", type(exc).__name__)
        self._deliver(conversation_id, event)

    def publish_sync(self, conversation_id: str, event: dict) -> bool:
        """Publish from code with no event loop (a job, a script): straight to Valkey,
        where every worker's subscriber picks it up. False if it did not go out."""
        try:
            if self._sync is None:
                self._sync = redis.Redis.from_url(get_settings().redis_url)
            self._sync.publish(f"{_PREFIX}{conversation_id}", json.dumps(event))
            return True
        except RedisError as exc:
            logger.warning("chat hub sync publish failed (%s)", type(exc).__name__)
            return False

    def _deliver(self, conversation_id: str, event: dict) -> None:
        """Never awaits a socket: one full queue drops one socket, the room moves on."""
        room = self._rooms.get(conversation_id)
        if not room:
            return
        skip = event.get("_skip")  # typing echo suppression: don't tell the typist
        payload = {k: v for k, v in event.items() if k != "_skip"}
        for peer in list(room.values()):
            if skip and peer.user_id == skip:
                continue
            self._offer(peer, payload, conversation_id=conversation_id)


def _seq(frame: dict) -> int:
    message = frame.get("message")
    if isinstance(message, dict):
        return int(message.get("seq") or 0)
    return 0


hub = Hub()
