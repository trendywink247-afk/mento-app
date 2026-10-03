"""Exit zero only for expected crisis health states; never print response data."""
import json
import sys


def acceptable(response: str) -> bool:
    try:
        body, code = response.rstrip().rsplit("\n", 1)
        payload = json.loads(body)
        return isinstance(payload, dict) and (code, payload.get("status")) in (
            ("200", "ok"), ("503", "stale")
        )
    except (ValueError, TypeError):
        return False


if __name__ == "__main__":
    sys.exit(0 if acceptable(sys.stdin.read(65537)) else 1)
