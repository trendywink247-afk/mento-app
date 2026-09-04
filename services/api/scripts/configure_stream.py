"""Point Stream at our webhook endpoints (run once per public/tunnel base URL).

Usage (from services/api):
    python -m scripts.configure_stream https://<public-base>

Sets:
  before_message_send_hook_url -> <base>/api/v1/stream/before-message-send  (sync enforcement)
  webhook_url                  -> <base>/api/v1/stream/webhook              (async safety net)
"""

from __future__ import annotations

import sys

from app.services import stream


def main() -> None:
    if len(sys.argv) != 2 or not sys.argv[1].startswith("http"):
        raise SystemExit("usage: python -m scripts.configure_stream https://<public-base>")
    base = sys.argv[1].rstrip("/")
    before = f"{base}/api/v1/stream/before-message-send"
    push = f"{base}/api/v1/stream/webhook"
    stream.configure_webhooks(before, push)
    print("Configured Stream webhooks:")
    print("  before_message_send_hook_url =", before)
    print("  webhook_url                  =", push)


if __name__ == "__main__":
    main()
