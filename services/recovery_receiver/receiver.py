"""Small authenticated write-only service. No API settings or customer content."""

from __future__ import annotations

import asyncio
import hmac
import json
import sqlite3
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from starlette.concurrency import run_in_threadpool
from starlette.requests import ClientDisconnect

from .store import DIGEST, Store

MAX_BODY = 256


def _object(pairs: list[tuple]) -> dict:
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError("Duplicate JSON key")
        value[key] = item
    return value


def create_app(database: Path, token: str, previous_token: str | None = None) -> FastAPI:
    tokens = [token] + ([previous_token] if previous_token is not None else [])
    if any(
        not 32 <= len(value) <= 256 or any(not 33 <= ord(char) <= 126 for char in value)
        for value in tokens
    ):
        raise ValueError("Receiver credential configuration is invalid")
    expected = [("Bearer " + value).encode("ascii") for value in tokens]
    store = Store(database)
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    app.state.receipt_store = store

    @app.post("/receipts")
    async def receive(request: Request) -> dict:
        authorization = request.headers.getlist("authorization")
        supplied = authorization[0].encode("utf-8") if len(authorization) == 1 else b""
        authorized = False
        for candidate in expected:
            # Evaluate every accepted key; rotation does not disclose which one matched.
            authorized |= hmac.compare_digest(supplied, candidate)
        if not authorized:
            raise HTTPException(401, "Unauthorized")
        if (
            request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
            != "application/json"
        ):
            raise HTTPException(415, "JSON required")
        if request.headers.get("content-encoding", "identity").lower() != "identity":
            raise HTTPException(415, "Unsupported content encoding")
        declared = request.headers.get("content-length")
        if declared is not None:
            try:
                length = int(declared)
            except ValueError:
                raise HTTPException(400, "Invalid request") from None
            if not 0 <= length <= MAX_BODY:
                raise HTTPException(413, "Request too large")
        body = bytearray()
        try:
            async with asyncio.timeout(5.0):
                async for chunk in request.stream():
                    if len(body) + len(chunk) > MAX_BODY:
                        raise HTTPException(413, "Request too large")
                    body.extend(chunk)
        except (TimeoutError, ClientDisconnect):
            raise HTTPException(408, "Incomplete request") from None
        try:
            payload = json.loads(body.decode("utf-8"), object_pairs_hook=_object)
        except (ValueError, UnicodeError):
            raise HTTPException(400, "Invalid request") from None
        if (
            not isinstance(payload, dict)
            or set(payload) != {"version", "member_digest"}
            or type(payload["version"]) is not int
            or payload["version"] != 1
            or not isinstance(payload["member_digest"], str)
            or DIGEST.fullmatch(payload["member_digest"]) is None
        ):
            raise HTTPException(400, "Invalid request")
        try:
            await run_in_threadpool(store.record, payload["member_digest"])
        except (sqlite3.Error, OSError):
            # Do not log tokens, digests, bodies or storage exception details.
            raise HTTPException(503, "Receipt storage unavailable") from None
        return {"version": 1, "member_digest": payload["member_digest"], "durable": True}

    return app
