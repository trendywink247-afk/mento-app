"""Refusals the app has to tell apart.

The error envelope stays what every client already parses — `{"detail": "<a sentence a
person can read>"}` — and gains a sibling `code` the UI can switch on (additive; an old
build ignores it and shows `detail`). Use a plain HTTPException when nobody needs to
branch on the reason.
"""

from __future__ import annotations

from fastapi import Request
from fastapi.responses import JSONResponse


class ApiProblem(Exception):
    def __init__(self, status_code: int, code: str, detail: str, **extra: object) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.code = code
        self.detail = detail
        self.extra = extra


async def api_problem_handler(_request: Request, exc: ApiProblem) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail, "code": exc.code, **exc.extra},
    )
