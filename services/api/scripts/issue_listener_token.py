"""Issue a listener-console token link (the minimal mentor-side login, DECISIONS §I.6).

Run from services/api:
    python -m scripts.issue_listener_token --name "Open River"
    python -m scripts.issue_listener_token --listener-id <uuid> --base-url https://app.example.com

Prints a ready-to-share /listener#token=... link (a URL fragment, so the token
never reaches server or proxy logs). The token expires after
LISTENER_JWT_TTL_DAYS (30 by default); suspending the listener (vetting_status)
revokes every outstanding link immediately.
"""

from __future__ import annotations

import argparse

from sqlalchemy import select

from app.db import SessionLocal
from app.models.enums import VettingStatus
from app.models.listener import ListenerProfile
from app.security import issue_listener_token


def main() -> None:
    parser = argparse.ArgumentParser(description="Issue a listener-console token link.")
    who = parser.add_mutually_exclusive_group(required=True)
    who.add_argument("--listener-id", help="Listener UUID")
    who.add_argument("--name", help="Listener persona name (exact match)")
    parser.add_argument(
        "--base-url",
        default="http://localhost:8081",
        help="Console host (default: the local Expo web dev server)",
    )
    args = parser.parse_args()

    db = SessionLocal()
    try:
        if args.listener_id:
            listener = db.get(ListenerProfile, args.listener_id)
        else:
            listener = db.scalars(
                select(ListenerProfile).where(ListenerProfile.persona_name == args.name)
            ).first()
        if listener is None:
            raise SystemExit("No such listener. Seed first (scripts.seed_listeners)?")
        if listener.vetting_status != VettingStatus.approved:
            raise SystemExit(
                f"Listener '{listener.persona_name}' is {listener.vetting_status.value} — "
                "only approved listeners can receive console links."
            )
        token = issue_listener_token(listener.id)
        print(f"Listener: {listener.persona_name} ({listener.id})")
        print(f"Console link: {args.base_url.rstrip('/')}/listener#token={token}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
