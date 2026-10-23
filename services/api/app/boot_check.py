"""Production boot invariants, as data, plus an offline checker that prints names only.

`problems(settings)` is the single source of truth for "refuse to boot outside dev": the
API's startup (`app.main._enforce_prod_invariants`) raises with its messages, and

    python -m app.boot_check

runs the same checks against the process environment (nothing started, no database, no
network) and prints ONLY the names of the failing settings, one per line. Exit 0 = every
check passed (nothing printed), 1 = at least one failed, 2 = the checker itself broke.

Nothing here ever prints a setting's value. Messages name settings and say what is wrong;
the checker prints less than that: names. Run it as the operator before an image gets a
new environment:

    docker run --rm --network none --env-file <env file> <image> python -m app.boot_check
"""

from __future__ import annotations

import sys
from dataclasses import dataclass

from pydantic import ValidationError

from app.config import Settings
from app.services import message_crypto


@dataclass(frozen=True)
class Problem:
    names: tuple[str, ...]  # the setting(s) to fix, as environment variable names
    message: str  # human text for the startup error; never contains a value


def problems(settings: Settings) -> list[Problem]:
    found: list[Problem] = []
    if settings.jwt_secret == "change-me-long-random":
        found.append(
            Problem(
                ("JWT_SECRET",), "JWT_SECRET is the published default — set a long random value"
            )
        )
    missing_stream = tuple(
        name
        for name, value in (
            ("STREAM_API_KEY", settings.stream_api_key),
            ("STREAM_API_SECRET", settings.stream_api_secret),
        )
        if not value
    )
    if missing_stream:
        found.append(
            Problem(
                missing_stream,
                "STREAM_API_KEY/SECRET missing — the crisis-scan webhook would reject "
                "everything and messages would flow unscanned",
            )
        )
    if not settings.resolved_cors_origins:
        found.append(
            Problem(
                ("CORS_ORIGINS",),
                "CORS origin list is empty — set CORS_ORIGINS (comma-separated) or valid "
                "APP_BASE_URL / ADMIN_BASE_URL so the web build can reach the API",
            )
        )
    if not settings.admin_jwt_secret or settings.admin_jwt_secret == settings.jwt_secret:
        found.append(
            Problem(
                ("ADMIN_JWT_SECRET",),
                "ADMIN_JWT_SECRET is empty or equal to JWT_SECRET — set a distinct "
                "long random value so admin tokens can't be forged with the shared secret",
            )
        )
    listener_secret = settings.listener_jwt_secret
    if not listener_secret or listener_secret in (settings.jwt_secret, settings.admin_jwt_secret):
        found.append(
            Problem(
                ("LISTENER_JWT_SECRET",),
                "LISTENER_JWT_SECRET is empty or equal to JWT_SECRET / ADMIN_JWT_SECRET — "
                "set a distinct long random value so mentor tokens can't be forged",
            )
        )
    for name, message in message_crypto.config_problems(settings):
        found.append(Problem((name,), message))
    if settings.database_url == Settings.model_fields["database_url"].default:
        found.append(
            Problem(
                ("DATABASE_URL",),
                "DATABASE_URL is the code default (published dev password) — set the real URL",
            )
        )
    if "trusted_proxy_hops" not in settings.model_fields_set:
        found.append(
            Problem(
                ("TRUSTED_PROXY_HOPS",),
                "TRUSTED_PROXY_HOPS is not set — set it to the number of reverse proxies "
                "in front of the API (1 behind Caddy or nginx, 0 if none)",
            )
        )
    return found


def failing_names(settings: Settings) -> list[str]:
    """Names to fix, de-duplicated, in the order the checks run. ENV=dev is itself a failure
    here: this checker is for non-dev environment files, and dev skips the boot checks."""
    if settings.is_dev:
        return ["ENV"]
    names: list[str] = []
    for problem in problems(settings):
        for name in problem.names:
            if name not in names:
                names.append(name)
    return names


def main() -> int:
    try:
        # _env_file=None: only the process environment counts, never a stray .env.
        settings = Settings(_env_file=None)
    except ValidationError as exc:
        # pydantic's own text echoes the offending value; take the field names only.
        names = sorted({str(err["loc"][0]).upper() for err in exc.errors() if err.get("loc")})
        print("\n".join(names))
        return 1
    except Exception as exc:  # report the type only, never the message
        print(f"boot_check: could not load settings ({type(exc).__name__})", file=sys.stderr)
        return 2
    names = failing_names(settings)
    if names:
        print("\n".join(names))
        return 1
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
