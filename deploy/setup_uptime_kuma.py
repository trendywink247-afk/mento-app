"""Idempotent Uptime Kuma setup for status.mento.chat — safe to re-run.

Creates the admin account (first run only), the health monitors, and the
public status page. Run on the box hosting the Uptime Kuma container
(currently the old box, 87.232.72.79) against its local port:

    pip install uptime-kuma-api
    KUMA_PASSWORD=<something real> python deploy/setup_uptime_kuma.py

KUMA_USERNAME/KUMA_PASSWORD default to admin/password1 (temporary — Kuma's
own strength check rejects plain "password") ONLY so this is copy-pasteable
for a first run; set them for real before running against a public instance.
"""

from __future__ import annotations

import os

from uptime_kuma_api import MonitorType, UptimeKumaApi

URL = os.environ.get("KUMA_URL", "http://127.0.0.1:3001")
USERNAME = os.environ.get("KUMA_USERNAME", "admin")
PASSWORD = os.environ.get("KUMA_PASSWORD", "password1")

MONITORS = [
    dict(type=MonitorType.HTTP, name="Talk to a mentor (API)", url="https://api.mento.chat/api/v1/health"),
    dict(type=MonitorType.HTTP, name="API ready (database)", url="https://api.mento.chat/api/v1/health/ready"),
    dict(type=MonitorType.HTTP, name="Website", url="https://app.mento.chat/"),
    dict(type=MonitorType.HTTP, name="Staff dashboard", url="https://admin.mento.chat/admin"),
    # Crisis webhook legitimately reports 503 "stale" during quiet hours — that is
    # expected, not down (see PROGRESS.md), so this monitor accepts both and only
    # truly alerts if the endpoint stops answering at all.
    dict(
        type=MonitorType.HTTP,
        name="Safety net (crisis scan)",
        url="https://api.mento.chat/api/v1/health/crisis",
        accepted_statuscodes=["200-299", "503"],
    ),
]
# Live counts (members/mentors/conversations) are NOT modeled as Kuma monitors:
# Kuma's JSON_QUERY type is an equality check ("is this value still X"), not a
# numeric gauge — a real, changing count would flip the monitor "down" on every
# change. Those three numbers are on a small static widget instead
# (deploy/status-page/counts.html, served at /live), fetching /status/public
# directly — the "defined endpoint, not a headline" the founder asked for.

STATUS_PAGE_SLUG = "mento"


def main() -> None:
    api = UptimeKumaApi(URL)
    if api.need_setup():
        api.setup(USERNAME, PASSWORD)
        print("admin account created")
    else:
        api.login(USERNAME, PASSWORD)
        print("logged in")

    existing = {m["name"]: m for m in api.get_monitors()}
    ids = []
    for m in MONITORS:
        if m["name"] in existing:
            print("skip (exists):", m["name"])
            ids.append(existing[m["name"]]["id"])
            continue
        kwargs = {**m, "interval": 60, "maxretries": 1}
        r = api.add_monitor(**kwargs)
        ids.append(r["monitorID"])
        print("added:", m["name"], "->", r["monitorID"])

    existing_pages = [p["slug"] for p in api.get_status_pages()]
    if STATUS_PAGE_SLUG not in existing_pages:
        api.add_status_page(STATUS_PAGE_SLUG, "Mento status")
        print("status page created:", STATUS_PAGE_SLUG)

    group = {"name": "Service health", "weight": 1, "monitorList": [{"id": i} for i in ids]}
    api.save_status_page(
        STATUS_PAGE_SLUG,
        title="Mento status",
        description="Live status of the Mento support app. Live counts: https://status.mento.chat/live",
        publicGroupList=[group],
    )
    print("status page configured")
    print()
    print("Public URL: https://status.mento.chat/status/" + STATUS_PAGE_SLUG)
    print(f"Dashboard login: {URL}  user={USERNAME} password={'*' * len(PASSWORD)}")
    api.disconnect()


if __name__ == "__main__":
    main()
