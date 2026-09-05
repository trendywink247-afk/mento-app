"""Send one test push via Expo's push API — device-testing verification only.

    python -m scripts.send_test_push --user-id <uuid> --title "Mento" --body "Test push"
    python -m scripts.send_test_push --token "ExponentPushToken[...]" --title "Mento" --body "Test push"

Looks up the most recently registered push_tokens row for --user-id, or sends
straight to --token. Requires network access to https://exp.host. Sound is
always off (no audio anywhere in Mento — T&S #11)."""

from __future__ import annotations

import argparse

from app.db import SessionLocal
from app.models.push_token import PushToken
from app.services import push


def main() -> None:
    p = argparse.ArgumentParser(description="Send a single test push via Expo's push API.")
    p.add_argument("--user-id", help="Look up this user's most recently registered token")
    p.add_argument("--token", help="Send straight to this Expo push token")
    p.add_argument("--title", default="Mento")
    p.add_argument("--body", default="Test push")
    args = p.parse_args()

    if not args.user_id and not args.token:
        raise SystemExit("Provide --user-id or --token.")

    push.ENABLED = True
    db = SessionLocal()
    try:
        token = args.token
        if not token:
            row = (
                db.query(PushToken)
                .filter(PushToken.user_id == args.user_id)
                .order_by(PushToken.updated_at.desc())
                .first()
            )
            if row is None:
                raise SystemExit(f"No push token registered for user {args.user_id}.")
            token = row.expo_push_token

        push._send(db, [token], args.body, {"kind": "test"})
        print("sent")
    finally:
        db.close()


if __name__ == "__main__":
    main()
