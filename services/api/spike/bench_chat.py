"""Latency bench for own-chat (spike/own-chat).

  python -m spike.bench_chat [--url http://127.0.0.1:8090] [--chats 40] [--messages 25]

Opens `--chats` concurrent conversations (a member and a mentor socket each — with
`uvicorn --workers 2` the two often land on DIFFERENT workers, so delivery crosses Redis
pub/sub), then alternates messages and times send → the other side receiving it. Target
from CLAUDE.md: send → delivered p95 < 500 ms.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import statistics
import time

import httpx
import websockets


async def one_chat(base: str, n: int, lat: list[float], errors: list[str]) -> None:
    async with httpx.AsyncClient() as http:
        s = (await http.post(f"{base}/api/v1/chat/spike/session")).json()
    ws_base = base.replace("http", "ws", 1) + f"/api/v1/chat/ws/{s['conversation_id']}"
    async with websockets.connect(ws_base) as member, websockets.connect(ws_base) as mentor:
        await member.send(json.dumps({"t": "hello", "token": s["member"]["token"]}))
        await mentor.send(json.dumps({"t": "hello", "token": s["mentor"]["token"]}))
        await member.recv()
        await mentor.recv()

        async def wait_message(ws, client_id: str) -> None:
            while True:
                f = json.loads(await ws.recv())
                if f["t"] == "message" and f["message"]["client_id"] == client_id:
                    return
                if f["t"] in ("held", "error"):
                    raise RuntimeError(f["t"])

        for i in range(n):
            sender, receiver = (member, mentor) if i % 2 == 0 else (mentor, member)
            cid = f"c{i}"
            t0 = time.perf_counter()
            await sender.send(json.dumps({"t": "send", "client_id": cid, "text": f"message {i}"}))
            try:
                await asyncio.wait_for(wait_message(receiver, cid), 5)
            except Exception as exc:  # noqa: BLE001
                errors.append(repr(exc))
                return
            lat.append((time.perf_counter() - t0) * 1000)
            # A real chat is not a firehose: a member's 4th message in a row is held by
            # the allowance rule, so alternate sides like a conversation.


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://127.0.0.1:8090")
    ap.add_argument("--chats", type=int, default=40)
    ap.add_argument("--messages", type=int, default=25)
    a = ap.parse_args()

    lat: list[float] = []
    errors: list[str] = []
    t0 = time.perf_counter()
    await asyncio.gather(*(one_chat(a.url, a.messages, lat, errors) for _ in range(a.chats)))
    wall = time.perf_counter() - t0

    lat.sort()
    q = statistics.quantiles(lat, n=100)
    print(f"chats={a.chats} messages/chat={a.messages} delivered={len(lat)} errors={len(errors)}")
    print(f"send→delivered ms  p50={q[49]:.1f}  p95={q[94]:.1f}  p99={q[98]:.1f}  max={lat[-1]:.1f}")
    print(f"throughput {len(lat) / wall:.0f} msg/s over {wall:.1f}s")
    if errors:
        print("first error:", errors[0])


if __name__ == "__main__":
    asyncio.run(main())
