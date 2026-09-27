"""Keyset paging for list endpoints (T2.3).

Contract: `limit` (default 50, max 200) and an opaque `cursor`; the response body stays
a plain JSON list so installed apps keep working, and the next page's cursor travels in
the `X-Next-Cursor` header — absent on the last page. A cursor is the sort key of the
last row served (base64url JSON), so a page boundary never repeats or skips a row the
unpaged order would have shown. A cursor that does not decode is a 422.
"""

from __future__ import annotations

import base64
import binascii
import json
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException, Query, Response, status

PAGE_DEFAULT = 50
PAGE_MAX = 200
NEXT_CURSOR_HEADER = "X-Next-Cursor"


@dataclass(frozen=True)
class Page:
    limit: int
    after: list[Any] | None  # the decoded sort key of the last row already served


def encode_cursor(key: Sequence[Any]) -> str:
    raw = json.dumps(list(key), separators=(",", ":"), default=str).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def decode_cursor(cursor: str, arity: int) -> list[Any]:
    try:
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4))
        key = json.loads(raw)
    except (binascii.Error, ValueError, UnicodeDecodeError):
        key = None
    if not isinstance(key, list) or len(key) != arity:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "invalid cursor")
    return key


def page_params(arity: int):  # type: ignore[no-untyped-def] — reason: FastAPI dependency factory
    """A dependency parsing `limit` + `cursor` for a sort key of `arity` values."""

    def dependency(
        limit: int = Query(PAGE_DEFAULT, ge=1, le=PAGE_MAX),
        cursor: str | None = Query(None, max_length=512),
    ) -> Page:
        return Page(limit=limit, after=decode_cursor(cursor, arity) if cursor else None)

    return dependency


def set_next(response: Response, rows: list[Any], page: Page, key_of) -> list[Any]:  # type: ignore[no-untyped-def] — reason: key_of is any row → key callable
    """Callers fetch `limit + 1` rows; trim to `limit` and, when there was more, put the
    last served row's key in the header. Returns the rows to serve."""
    if len(rows) > page.limit:
        rows = rows[: page.limit]
        response.headers[NEXT_CURSOR_HEADER] = encode_cursor(key_of(rows[-1]))
    return rows
