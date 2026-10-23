#!/usr/bin/env python3
"""OpenAPI breaking-change check (stdlib only; oasdiff needs a Go binary).

    python3 scripts/ci/openapi_compat.py check     # live app vs services/api/openapi.snapshot.json
    python3 scripts/ci/openapi_compat.py update    # rewrite the snapshot (deliberate: review the diff)
    python3 scripts/ci/openapi_compat.py diff OLD.json NEW.json

Fails (exit 1) on changes that break shipped app builds (CLAUDE.md "API rules"):
removed path/method, removed or renamed response/request field, removed enum value,
type change, newly required parameter or request field, a parameter that became
required, a request field that gained a tighter constraint. Additions are fine.
A rename shows up as a removal. Stdlib only; run `check` from the repo root with
services/api importable (it sets sys.path itself).
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
API_DIR = ROOT / "services" / "api"
SNAPSHOT = API_DIR / "openapi.snapshot.json"
METHODS = ("get", "put", "post", "delete", "options", "head", "patch", "trace")
# Request-side limits where a LOWER max / HIGHER min rejects input old clients send.
TIGHTEN_MIN = ("minimum", "exclusiveMinimum", "minLength", "minItems", "minProperties")
TIGHTEN_MAX = ("maximum", "exclusiveMaximum", "maxLength", "maxItems", "maxProperties")


def load_live_spec() -> dict:
    os.chdir(API_DIR)
    sys.path.insert(0, str(API_DIR))
    os.environ.setdefault("ENV", "dev")
    from app.main import app  # noqa: PLC0415

    return app.openapi()


def dump(spec: dict) -> str:
    return json.dumps(spec, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def _resolve(spec: dict, node):
    seen = 0
    while isinstance(node, dict) and "$ref" in node and seen < 20:
        cur = spec
        for part in node["$ref"].lstrip("#/").split("/"):
            cur = cur[part.replace("~1", "/").replace("~0", "~")]
        node, seen = cur, seen + 1
    return node


def _types(schema: dict) -> set[str]:
    t = schema.get("type")
    out = set(t) if isinstance(t, list) else ({t} if t else set())
    for key in ("anyOf", "oneOf"):
        for sub in schema.get(key, []):
            out |= _types(sub) if "$ref" not in sub else {"$ref:" + sub["$ref"]}
    if "$ref" in schema:
        out.add("$ref:" + schema["$ref"])
    return out


def _schema(spec: dict, node):
    return _resolve(spec, node) if isinstance(node, dict) else {}


class Differ:
    def __init__(self, old: dict, new: dict) -> None:
        self.old, self.new, self.errors = old, new, []

    def err(self, where: str, msg: str) -> None:
        self.errors.append(f"{where}: {msg}")

    def run(self) -> list[str]:
        for path, old_item in self.old.get("paths", {}).items():
            new_item = self.new.get("paths", {}).get(path)
            if new_item is None:
                self.err(path, "path removed")
                continue
            for method in METHODS:
                if method in old_item:
                    if method not in new_item:
                        self.err(f"{method.upper()} {path}", "operation removed")
                    else:
                        self.operation(
                            f"{method.upper()} {path}",
                            old_item[method],
                            new_item[method],
                        )
        return self.errors

    def operation(self, where: str, old: dict, new: dict) -> None:
        old_params = {
            (p["in"], p["name"]): p
            for p in map(lambda p: _resolve(self.old, p), old.get("parameters", []))
        }
        new_params = {
            (p["in"], p["name"]): p
            for p in map(lambda p: _resolve(self.new, p), new.get("parameters", []))
        }
        for key, p in old_params.items():
            if key not in new_params:
                self.err(where, f"{key[0]} parameter '{key[1]}' removed")
            else:
                q = new_params[key]
                if q.get("required") and not p.get("required"):
                    self.err(where, f"{key[0]} parameter '{key[1]}' became required")
                self.schema(
                    f"{where} param {key[1]}",
                    p.get("schema", {}),
                    q.get("schema", {}),
                    "request",
                )
        for key, q in new_params.items():
            if key not in old_params and q.get("required"):
                self.err(where, f"new required {key[0]} parameter '{key[1]}'")

        old_body, new_body = old.get("requestBody"), new.get("requestBody")
        if new_body is not None:
            nb = _resolve(self.new, new_body)
            if nb.get("required") and not (
                old_body and _resolve(self.old, old_body).get("required")
            ):
                self.err(where, "request body became required")
            if old_body is not None:
                self.content(
                    f"{where} request", _resolve(self.old, old_body), nb, "request"
                )
        elif old_body is not None:
            self.err(where, "request body removed")

        for status, old_resp in old.get("responses", {}).items():
            new_resp = new.get("responses", {}).get(status)
            if new_resp is None:
                if status.startswith("2"):
                    self.err(where, f"response {status} removed")
                continue
            self.content(
                f"{where} response {status}",
                _resolve(self.old, old_resp),
                _resolve(self.new, new_resp),
                "response",
            )

    def content(self, where: str, old: dict, new: dict, side: str) -> None:
        for media, old_media in old.get("content", {}).items():
            new_media = new.get("content", {}).get(media)
            if new_media is None:
                self.err(where, f"media type {media} removed")
                continue
            self.schema(
                f"{where} {media}",
                old_media.get("schema", {}),
                new_media.get("schema", {}),
                side,
            )

    def schema(self, where: str, old, new, side: str, depth: int = 0) -> None:
        if depth > 12:
            return
        if (
            isinstance(old, dict)
            and isinstance(new, dict)
            and old.get("$ref")
            and old.get("$ref") == new.get("$ref")
        ):
            key = (old["$ref"], side)
            if key in getattr(self, "_seen", set()):
                return
            self._seen = getattr(self, "_seen", set()) | {key}
        o, n = _schema(self.old, old), _schema(self.new, new)
        if not o:
            return
        if not n:
            self.err(where, "schema removed")
            return
        ot, nt = _types(o), _types(n)
        if ot and nt and ot != nt:
            # response may widen nothing; request may accept more. Either direction is a
            # type change shipped clients did not expect, except request-side widening.
            if not (side == "request" and ot <= nt):
                self.err(where, f"type changed {sorted(ot)} -> {sorted(nt)}")
                return
        if "enum" in o:
            if "enum" not in n:
                pass  # enum dropped: request widens, response loses a guarantee only
            else:
                removed = [v for v in o["enum"] if v not in n["enum"]]
                added = [v for v in n["enum"] if v not in o["enum"]]
                if removed and side == "request":
                    self.err(where, f"enum value(s) removed: {removed}")
                if added and side == "response":
                    self.err(
                        where,
                        f"enum value(s) added (old clients may not handle them): {added}",
                    )
        if side == "request":
            for k in TIGHTEN_MIN:
                if k in n and (k not in o or n[k] > o[k]):
                    self.err(where, f"{k} tightened/added ({o.get(k)} -> {n[k]})")
            for k in TIGHTEN_MAX:
                if k in n and (k not in o or n[k] < o[k]):
                    self.err(where, f"{k} tightened/added ({o.get(k)} -> {n[k]})")
            if "pattern" in n and n.get("pattern") != o.get("pattern"):
                self.err(where, "pattern added/changed")
        o_props, n_props = o.get("properties", {}), n.get("properties", {})
        for name, sub in o_props.items():
            if name not in n_props:
                self.err(where, f"property '{name}' removed")
            else:
                self.schema(f"{where}.{name}", sub, n_props[name], side, depth + 1)
        o_req, n_req = set(o.get("required", [])), set(n.get("required", []))
        if side == "request":
            for name in sorted(n_req - o_req):
                self.err(where, f"property '{name}' newly required")
        else:
            for name in sorted(o_req - n_req):
                self.err(
                    where, f"property '{name}' no longer guaranteed (was required)"
                )
        if "items" in o:
            self.schema(f"{where}[]", o["items"], n.get("items", {}), side, depth + 1)
        for key in ("anyOf", "oneOf", "allOf"):
            if key in o and key in n and len(o[key]) == len(n[key]):
                for i, (a, b) in enumerate(zip(o[key], n[key])):
                    self.schema(f"{where}|{key}[{i}]", a, b, side, depth + 1)


def find_breaking(old: dict, new: dict) -> list[str]:
    return Differ(old, new).run()


def main(argv: list[str]) -> int:
    cmd = argv[1] if len(argv) > 1 else "check"
    if cmd == "update":
        SNAPSHOT.write_text(dump(load_live_spec()), encoding="utf-8")
        print(f"wrote {SNAPSHOT.relative_to(ROOT)}")
        return 0
    if cmd == "diff" and len(argv) == 4:
        old, new = (json.loads(Path(p).read_text(encoding="utf-8")) for p in argv[2:4])
    elif cmd == "check":
        if not SNAPSHOT.exists():
            print(
                f"missing {SNAPSHOT.relative_to(ROOT)}; run: python3 scripts/ci/openapi_compat.py update"
            )
            return 2
        old, new = json.loads(SNAPSHOT.read_text(encoding="utf-8")), load_live_spec()
    else:
        print(__doc__)
        return 2
    errors = find_breaking(old, new)
    for e in errors:
        print(f"BREAKING {e}")
    if errors:
        print(
            f"{len(errors)} breaking change(s). If intended and approved, see CLAUDE.md API rules, then run `update`."
        )
        return 1
    drift = dump(new) != dump(old)
    print(
        "no breaking changes"
        + (" (additive drift: run `update` to refresh the snapshot)" if drift else "")
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
