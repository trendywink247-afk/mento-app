"""Realtime fan-out for own-chat (WS5 T5.1, from `spike/own-chat`).

One `Hub` per process. Sockets register per conversation; `publish` sends an event to
every socket of that conversation on EVERY worker: through Valkey/Redis pub/sub when it is
up (one psubscribe per process, `mento:chat:*`), straight to local sockets when it is
not. The database — not the hub — is the source of truth: a socket that misses an event
(dropped connection, worker restart) catches up with `history(after_seq)`, so pub/sub
may be lossy without ever losing a message.

Presence is a Redis hash with a TTL (refreshed by each socket's ping), so it is correct
across workers; without Redis it falls back to this process's sockets.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from collections import defaultdict

import redis
from fastapi import WebSocket
from redis import asyncio as aioredis
from redis.exceptions import RedisError

from app.config import get_settings

logger = logging.getLogger("mento.chat.hub")

_PREFIX = "mento:chat:"
_PRESENCE = "mento:chatp:"  # not under _PREFIX, so the pub/sub pattern never matches it
_PRESENCE_TTL_S = 150  # sockets ping every ~30 s and refresh it


class Hub:
    def __init__(self) -> None:
        # conversation_id -> {websocket: user_id}
        self._sockets: dict[str, dict[WebSocket, str]] = defaultdict(dict)
        self._redis: aioredis.Redis | None = None
        self._task: asyncio.Task | None = None
        self._sync: redis.Redis | None = None

    # ---- lifecycle -------------------------------------------------------------
    async def start(self) -> None:
        try:
            self._redis = aioredis.from_url(get_settings().redis_url, decode_responses=True)
            await self._redis.ping()
        except Exception as exc:  # noqa: BLE001 — degrade to local fan-out, never crash boot
            logger.warning(
                "chat hub: Redis unavailable (%s) — local fan-out only", type(exc).__name__
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
                    await self._deliver(conversation_id, json.loads(item["data"]))
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 — reconnect; clients catch up from the DB
                logger.warning("chat hub subscriber dropped (%s) — retrying", type(exc).__name__)
                await asyncio.sleep(1)

    # ---- sockets ---------------------------------------------------------------
    async def join(self, conversation_id: str, ws: WebSocket, user_id: str) -> None:
        self._sockets[conversation_id][ws] = user_id
        await self._presence(conversation_id, user_id, +1)

    async def leave(self, conversation_id: str, ws: WebSocket) -> None:
        room = self._sockets.get(conversation_id)
        user_id = room.pop(ws, None) if room is not None else None
        if room is not None and not room:
            self._sockets.pop(conversation_id, None)
        if user_id is not None:
            await self._presence(conversation_id, user_id, -1)

    # Presence lives in Redis (a per-conversation hash of open-socket counts per user) so
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
        return user_id in self._sockets.get(conversation_id, {}).values()

    # ---- events ----------------------------------------------------------------
    async def publish(self, conversation_id: str, event: dict) -> None:
        if self._redis is not None:
            try:
                await self._redis.publish(f"{_PREFIX}{conversation_id}", json.dumps(event))
                return
            except RedisError as exc:
                logger.warning("chat hub publish failed (%s) — local fan-out", type(exc).__name__)
        await self._deliver(conversation_id, event)

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

    async def _deliver(self, conversation_id: str, event: dict) -> None:
        room = self._sockets.get(conversation_id)
        if not room:
            return
        skip = event.get("_skip")  # typing echo suppression: don't tell the typist
        payload = {k: v for k, v in event.items() if k != "_skip"}
        for ws, user_id in list(room.items()):
            if skip and user_id == skip:
                continue
            try:
                await ws.send_json(payload)
            except Exception:  # noqa: BLE001 — a dead socket is cleaned up by its own loop
                await self.leave(conversation_id, ws)


hub = Hub()
