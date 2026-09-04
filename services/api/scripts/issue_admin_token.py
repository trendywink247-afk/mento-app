"""Create (or re-link) an admin and print a console link.

    python -m scripts.issue_admin_token --owner --name "Founder"
    python -m scripts.issue_admin_token --name "Helper"          # helper
    python -m scripts.issue_admin_token --admin-id <uuid>        # re-link existing

Prints /admin#token=... (a URL fragment — never in server logs). Revoke from the
Admins tab, or by flipping status=revoked."""

from __future__ import annotations

import argparse

from app.db import SessionLocal
from app.models.admin import AdminAccount
from app.models.enums import AdminRole
from app.security import issue_admin_token


def main() -> None:
    p = argparse.ArgumentParser(description="Create an admin and print a console link.")
    p.add_argument("--admin-id", help="Re-issue a link for an existing admin UUID")
    p.add_argument("--name", help="Name for a NEW admin")
    p.add_argument("--owner", action="store_true", help="Make the new admin an owner")
    p.add_argument("--base-url", default="http://localhost:8081")
    args = p.parse_args()

    db = SessionLocal()
    try:
        if args.admin_id:
            admin = db.get(AdminAccount, args.admin_id)
            if admin is None:
                raise SystemExit("No such admin.")
        else:
            if not args.name:
                raise SystemExit("--name is required to create a new admin.")
            admin = AdminAccount(
                name=args.name,
                role=AdminRole.owner if args.owner else AdminRole.helper,
            )
            db.add(admin)
            db.commit()
            db.refresh(admin)
        token = issue_admin_token(admin.id)
        print(f"Admin: {admin.name} ({admin.role.value}) [{admin.id}]")
        print(f"Console link: {args.base_url.rstrip('/')}/admin#token={token}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
