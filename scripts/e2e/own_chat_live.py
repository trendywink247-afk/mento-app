#!/usr/bin/env python3
"""Own-chat two-party end-to-end test against a live environment (QA by default).

Drives a throwaway member and a seeded test mentor through the real API and the same
sockets the app uses (/api/v1/events and /api/v1/chat/ws/<id>), and checks every step
in the database (read-only queries through the API container).

    sudo -v   # the script calls `sudo docker compose ... exec api` for tokens and DB checks
    <venv>/bin/python scripts/e2e/own_chat_live.py [--mentor-id <uuid>] [--idle 60]

Needs: Python 3.11+, the `websockets` package, sudo to the QA compose project.
Never prints a token, a login link or any message text except this script's own test lines.
The test member erases itself at the end (Start Fresh); the mentor is put back in the
status it had. Uses a PERSONAL request to the test mentor, so nobody else's inbox (or
phone) is paged. The crisis step creates one real safety flag in QA's review queue.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid

import websockets

API = "https://qa-api.mento.chat/api/v1"
WS = "wss://qa-api.mento.chat/api/v1"
COMPOSE = [
    "sudo", "-n", "docker", "compose",
    "--project-directory", "/opt/mento-staging",
    "-f", "/opt/mento-staging/compose.yml",
    "-f", "/opt/mento-staging/ci.override.yml",
]
DEFAULT_MENTOR = "9e18e59d-5c03-420d-87ad-7596667d0e10"  # seeded QA test mentor
INTRO = "E2E: how do I handle the interview wait?"
CRISIS = "I want to end my life"  # the phrase the API tests use for a suicidal signal

RESULTS: list[tuple[str, str, str]] = []
HTTP_CALLS = {"member": 0, "mentor": 0, "other": 0}


def record(step: str, ok: bool, evidence: str) -> bool:
    RESULTS.append((step, "PASS" if ok else "FAIL", evidence))
    print(f"[{'PASS' if ok else 'FAIL'}] {step}: {evidence}", flush=True)
    return ok


# ---------------------------------------------------------------- HTTP + DB helpers
def http(method: str, path: str, token: str | None = None, body=None, who: str = "other"):
    HTTP_CALLS[who] = HTTP_CALLS.get(who, 0) + 1
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except ValueError:
            return e.code, raw[:200].decode(errors="replace")


def dbq(code: str):
    """Run read-only Python in the API container; the last stdout line is JSON."""
    prelude = "import json\nfrom sqlalchemy import text\nfrom app.db import SessionLocal\nd=SessionLocal()\n"
    out = subprocess.run(
        COMPOSE + ["exec", "-T", "api", "python", "-"],
        input=prelude + code, capture_output=True, text=True, timeout=60,
    )
    if out.returncode != 0:
        raise RuntimeError(f"db query failed: {out.stderr.strip()[-300:]}")
    return json.loads(out.stdout.strip().splitlines()[-1])


def listener_token(listener_id: str) -> str:
    out = subprocess.run(
        COMPOSE + ["exec", "-T", "api", "python", "-m", "scripts.issue_listener_token",
                   "--listener-id", listener_id, "--base-url", "https://qa-app.mento.chat"],
        capture_output=True, text=True, timeout=60, stdin=subprocess.DEVNULL,
    )
    m = re.search(r"[#&]token=([A-Za-z0-9._\-]+)", out.stdout)
    if not m:
        raise RuntimeError("could not issue a listener token (output withheld)")
    return m.group(1)


# ---------------------------------------------------------------- sockets
class Sock:
    """A socket with a background reader; frames are kept for `wait`."""

    def __init__(self, name: str):
        self.name = name
        self.frames: list[dict] = []
        self.ws = None
        self.closed_code: int | None = None
        self._task = None

    async def open(self, url: str, first: dict, expect: str):
        self.ws = await websockets.connect(url, open_timeout=15, max_size=2**20)
        await self.ws.send(json.dumps(first))
        self._task = asyncio.create_task(self._read())
        return await self.wait(lambda f: f.get("t") == expect, 10)

    async def _read(self):
        try:
            async for raw in self.ws:
                try:
                    self.frames.append(json.loads(raw))
                except ValueError:
                    pass
        except websockets.ConnectionClosed as e:
            self.closed_code = e.rcvd.code if e.rcvd else None
        else:
            self.closed_code = self.ws.close_code

    async def wait(self, pred, timeout: float, since: int = 0):
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            for f in self.frames[since:]:
                if pred(f):
                    return f
            await asyncio.sleep(0.05)
        return None

    async def send(self, frame: dict):
        await self.ws.send(json.dumps(frame))

    async def close(self):
        if self.ws is not None:
            await self.ws.close()
        if self._task:
            self._task.cancel()


# ---------------------------------------------------------------- the test
async def run(mentor_id: str, idle_s: int) -> int:
    ts = int(time.time())
    # Identities -------------------------------------------------------------
    st, m = http("POST", "/onboarding/start", body={
        "dob": "1990-01-01", "terms_accepted": True, "install_id": f"e2e-{ts}"})
    if st not in (200, 201):
        return record("setup member", False, f"onboarding {st}") and 1
    mtok = m["session_token"]
    st, me_m = http("GET", "/me", mtok, who="member")
    member_id = (me_m or {}).get("id")
    st, path = http("PUT", "/paths/me", mtok, {"community": "upsc", "stage": "interview_stage"}, who="member")
    record("setup member path UPSC", st == 200, f"PUT /paths/me -> {st}")

    ltok = listener_token(mentor_id)
    st, me = http("GET", "/listener/me", ltok, who="mentor")
    original_status = me.get("status") if isinstance(me, dict) else None
    record("setup mentor login", st == 200, f"GET /listener/me -> {st}, status was {original_status}")

    member_ev, mentor_ev = Sock("member-events"), Sock("mentor-events")
    member_chat = mentor_chat = None
    convo_id = None
    try:
        # 1 ----------------------------------------------------------------------
        st, me2 = http("PATCH", "/listener/me/status", ltok, {"status": "online"}, who="mentor")
        h1 = await member_ev.open(f"{WS}/events", {"t": "auth", "token": mtok, "role": "member"}, "hello")
        h2 = await mentor_ev.open(f"{WS}/events", {"t": "auth", "token": ltok, "role": "listener"}, "hello")
        record("1 mentor online + both event sockets", st == 200 and me2.get("status") == "online" and bool(h1) and bool(h2),
               f"status PATCH {st} -> {me2.get('status') if isinstance(me2, dict) else me2}; member hello={bool(h1)}, mentor hello={bool(h2)}")

        # 2 ----------------------------------------------------------------------
        mark = len(mentor_ev.frames)
        t0 = time.monotonic()
        st, req = http("POST", f"/listeners/{mentor_id}/request", mtok, {"intro_message": INTRO, "issue_category": "upsc"}, who="member")
        req_id = req.get("id") if isinstance(req, dict) else None
        got = await mentor_ev.wait(lambda f: f.get("t") == "request.new" and f.get("id") == req_id, 3, mark)
        lat = time.monotonic() - t0
        st2, inbox = http("GET", "/listener/me/requests", ltok, who="mentor")
        row = next((r for r in (inbox or []) if r.get("id") == req_id), None)
        record("2 request reaches mentor live, with the member's words",
               st == 200 and got is not None and row is not None and row.get("intro_message") == INTRO,
               f"request {st}; request.new in {lat:.2f}s={got is not None}; inbox intro is member's text={bool(row) and row.get('intro_message') == INTRO}")

        # 3 ----------------------------------------------------------------------
        mark_m = len(member_ev.frames)
        st, acc = http("POST", f"/listener/me/requests/{req_id}/accept", ltok, who="mentor")
        convo_id = (acc or {}).get("conversation_id")
        ch = await member_ev.wait(lambda f: f.get("t") == "request.changed" and f.get("id") == req_id, 5, mark_m)
        row = dbq(f"r=d.execute(text(\"select chat_backend, stream_channel_id is null from conversations where id=:i\"),{{'i':'{convo_id}'}}).first()\nprint(json.dumps(list(r) if r else None))")
        record("3 accept opens an own-chat room; member told",
               st == 200 and row == ["own", True] and ch is not None,
               f"accept {st}; db backend/no-stream={row}; member request.changed={ch.get('status') if ch else None}")

        # 4 ----------------------------------------------------------------------
        member_chat, mentor_chat = Sock("member-chat"), Sock("mentor-chat")
        hm = await member_chat.open(f"{WS}/chat/ws/{convo_id}", {"t": "hello", "token": mtok, "after": 0}, "hello")
        hl = await mentor_chat.open(f"{WS}/chat/ws/{convo_id}", {"t": "hello", "token": ltok, "after": 0}, "hello")
        ok = bool(hm) and bool(hl)
        # typing
        mk = len(mentor_chat.frames)
        await member_chat.send({"t": "typing", "on": True})
        typ = await mentor_chat.wait(lambda f: f.get("t") == "typing" and f.get("on") is True, 3, mk)
        await member_chat.send({"t": "typing", "on": False})
        texts = [("member", "E2E member message 1"), ("mentor", "E2E mentor reply 1"),
                 ("member", "E2E member message 2"), ("mentor", "E2E mentor reply 2")]
        delivered = 0
        for side, text_ in texts:
            src, dst = (member_chat, mentor_chat) if side == "member" else (mentor_chat, member_chat)
            mk = len(dst.frames)
            await src.send({"t": "send", "client_id": uuid.uuid4().hex[:16], "text": text_})
            f = await dst.wait(lambda f: f.get("t") == "message" and f["message"].get("text") == text_, 5, mk)
            delivered += f is not None
        # unread for the member: the mentor's last message is unread until the member reads it
        st_l, lst = http("GET", "/conversations", mtok, who="member")
        mine = next((c for c in (lst or []) if c.get("id") == convo_id), {})
        unread_before = mine.get("unread_count")
        last = max((f["message"]["seq"] for f in member_chat.frames if f.get("t") == "message"), default=0)
        mk = len(mentor_chat.frames)
        await member_chat.send({"t": "read", "seq": last})
        rd = await mentor_chat.wait(lambda f: f.get("t") == "read", 3, mk)
        await asyncio.sleep(0.5)
        st_l, lst = http("GET", "/conversations", mtok, who="member")
        unread_after = next((c for c in (lst or []) if c.get("id") == convo_id), {}).get("unread_count")
        st_p, mlst = http("GET", "/listener/me/conversations", ltok, who="mentor")
        prev = next((c for c in (mlst or []) if c.get("id") == convo_id), {}).get("last_message_preview")
        enc = dbq(f"rows=d.execute(text(\"select body from chat_messages where conversation_id=:i\"),{{'i':'{convo_id}'}}).all()\n"
                  "print(json.dumps({'n':len(rows),'plain':sum(1 for (b,) in rows if b'E2E' in bytes(b))}))")
        # Accepting posts the member's intro as message 1, so 4 exchanged + 1 = 5 rows.
        first = next((f["message"].get("text") for f in member_chat.frames if f.get("t") == "message"), None)
        ok = ok and typ is not None and delivered == 4 and rd is not None and (unread_before or 0) >= 1 \
            and unread_after == 0 and prev == "E2E mentor reply 2" and enc["n"] == 5 and enc["plain"] == 0 \
            and first == INTRO
        record("4 messages, typing, read, unread, preview, encryption", ok,
               f"hello both={bool(hm) and bool(hl)}; typing delivered={typ is not None}; delivered {delivered}/4; "
               f"read frame={rd is not None}; unread_count {unread_before}->{unread_after}; mentor preview ok={prev == 'E2E mentor reply 2'}; "
               f"intro is message 1={first == INTRO}; db rows={enc['n']} (4 + intro) plaintext rows={enc['plain']}")

        # 5 ----------------------------------------------------------------------
        mk = len(member_chat.frames)
        cid = uuid.uuid4().hex[:16]
        await member_chat.send({"t": "send", "client_id": cid, "text": CRISIS})
        cf = await member_chat.wait(lambda f: f.get("t") == "message" and f["message"].get("client_id") == cid, 5, mk)
        msg_id = cf["message"]["id"] if cf else None
        has_card = bool(cf and cf["message"].get("crisis", {}).get("helplines"))
        flag = None
        for _ in range(20):
            flag = dbq(f"r=d.execute(text(\"select signal from safety_flags where stream_message_id=:m\"),{{'m':'{msg_id}'}}).first()\nprint(json.dumps(str(r[0]) if r else None))")
            if flag:
                break
            await asyncio.sleep(0.5)
        record("5 crisis line: helpline card + review flag", has_card and bool(flag),
               f"member frame carries helplines={has_card}; safety flag for the message={flag}")

        # 6 ----------------------------------------------------------------------
        st, sn = http("POST", f"/listener/me/conversations/{convo_id}/snooze", ltok, who="mentor")
        snoozed = (sn or {}).get("snoozed_until")
        mk = len(member_chat.frames)
        await mentor_chat.send({"t": "send", "client_id": uuid.uuid4().hex[:16], "text": "E2E mentor reply after snooze"})
        await member_chat.wait(lambda f: f.get("t") == "message" and f["message"].get("text") == "E2E mentor reply after snooze", 5, mk)
        cleared = None
        for _ in range(30):  # the end-of-snooze runs as a queued job
            cleared = dbq(f"print(json.dumps(d.execute(text(\"select snoozed_until is null from conversations where id=:i\"),{{'i':'{convo_id}'}}).scalar()))")
            if cleared:
                break
            await asyncio.sleep(1)
        record("6 a mentor reply ends the snooze", st == 200 and bool(snoozed) and cleared is True,
               f"snooze {st} until={'set' if snoozed else None}; cleared after reply={cleared}")

        # 7 ----------------------------------------------------------------------
        mk_m, mk_l = len(member_chat.frames), len(mentor_chat.frames)
        st, _ = http("POST", f"/listener/me/conversations/{convo_id}/end", ltok, who="mentor")
        em = await member_chat.wait(lambda f: f.get("t") in ("ended", "state"), 5, mk_m)
        el = await mentor_chat.wait(lambda f: f.get("t") in ("ended", "state"), 5, mk_l)
        sa, arch_m = http("GET", f"/chat/{convo_id}/messages", mtok, who="member")
        sb, arch_l = http("GET", f"/chat/{convo_id}/messages", ltok, who="mentor")
        st_o, other = http("POST", "/onboarding/start", body={"dob": "1990-01-01", "terms_accepted": True, "install_id": f"e2e-{ts}-x"})
        sc, _ = http("GET", f"/chat/{convo_id}/messages", other.get("session_token"))
        n_m = len((arch_m or {}).get("messages", [])) if isinstance(arch_m, dict) else 0
        n_l = len((arch_l or {}).get("messages", [])) if isinstance(arch_l, dict) else 0
        record("7 end: both told, both can read, a stranger cannot",
               st == 200 and em is not None and el is not None and sa == 200 and sb == 200 and n_m >= 6 and n_l >= 6 and sc == 404,
               f"end {st}; member told={em.get('t') if em else None}; mentor told={el.get('t') if el else None}; "
               f"archive member {sa}({n_m} msgs) mentor {sb}({n_l} msgs); stranger {sc}")
        # the stranger erases itself
        http("DELETE", "/me", other.get("session_token"))

        # 8 ----------------------------------------------------------------------
        # Clean Wipe needs an ACTIVE room with sockets open, so a second short conversation.
        st, req2 = http("POST", f"/listeners/{mentor_id}/request", mtok, {"intro_message": "E2E: second chat for the wipe test", "issue_category": "upsc"}, who="member")
        st2, acc2 = http("POST", f"/listener/me/requests/{(req2 or {}).get('id')}/accept", ltok, who="mentor")
        c2 = (acc2 or {}).get("conversation_id")
        w_m, w_l = Sock("member-chat2"), Sock("mentor-chat2")
        await w_m.open(f"{WS}/chat/ws/{c2}", {"t": "hello", "token": mtok, "after": 0}, "hello")
        await w_l.open(f"{WS}/chat/ws/{c2}", {"t": "hello", "token": ltok, "after": 0}, "hello")
        mk = len(w_l.frames)
        await w_m.send({"t": "send", "client_id": uuid.uuid4().hex[:16], "text": "E2E message to be wiped"})
        await w_l.wait(lambda f: f.get("t") == "message", 5, mk)
        mk_m, mk_l = len(w_m.frames), len(w_l.frames)
        sw, wiped = http("POST", f"/chat/{c2}/wipe", mtok, who="member")
        wm = await w_m.wait(lambda f: f.get("t") == "wiped", 5, mk_m)
        wl = await w_l.wait(lambda f: f.get("t") == "wiped", 5, mk_l)
        left = dbq(f"print(json.dumps(d.execute(text(\"select count(*) from chat_messages where conversation_id=:i\"),{{'i':'{c2}'}}).scalar()))")
        await w_m.close(); await w_l.close()
        record("8a Clean Wipe: sockets told, bodies gone",
               sw == 200 and wm is not None and wl is not None and left == 0,
               f"wipe {sw}; member wiped frame={wm is not None}; mentor wiped frame={wl is not None}; messages left in db={left}")

        # 9 ----------------------------------------------------------------------
        before = dict(HTTP_CALLS)
        t_idle0 = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime())
        await asyncio.sleep(idle_s)
        alive = member_ev.closed_code is None and mentor_ev.closed_code is None
        made = {k: HTTP_CALLS[k] - before.get(k, 0) for k in HTTP_CALLS}
        logs = subprocess.run(COMPOSE + ["logs", "--since", t_idle0, "api"], capture_output=True, text=True, timeout=60).stdout
        server_reqs = sum(1 for l in logs.splitlines() if "mento.access" in l and "/health" not in l)
        record(f"9 idle {idle_s}s with sockets open",
               alive and made["member"] == 0 and made["mentor"] == 0,
               f"event sockets still open={alive}; HTTP calls member={made['member']} mentor={made['mentor']}; "
               f"all server requests in window (any client, e.g. phones)={server_reqs}")

        # 8b Start Fresh -----------------------------------------------------------
        for s in (member_ev, member_chat, mentor_chat):
            if s:
                await s.close()
        se, _ = http("DELETE", "/me", mtok, who="member")
        gone = dbq(f"print(json.dumps([d.execute(text(\"select count(*) from conversations where user_id=:u\"),{{'u':'{member_id}'}}).scalar(),"
                   f"d.execute(text(\"select count(*) from chat_messages where conversation_id in (:a,:b)\"),{{'a':'{convo_id}','b':'{c2}'}}).scalar(),"
                   f"d.execute(text(\"select count(*) from users where id=:u\"),{{'u':'{member_id}'}}).scalar()]))")
        record("8b Start Fresh: member, conversations and messages erased",
               se == 200 and gone == [0, 0, 0],
               f"DELETE /me {se}; left in db: conversations={gone[0]} messages={gone[1]} member row={gone[2]}")
    finally:
        for s in (member_ev, mentor_ev, member_chat, mentor_chat):
            if s:
                try:
                    await s.close()
                except Exception:  # noqa: BLE001
                    pass
        if original_status in ("online", "away"):
            http("PATCH", "/listener/me/status", ltok, {"status": original_status}, who="mentor")

    print("\n| Step | Result | Evidence |\n|---|---|---|")
    for step, res, ev in RESULTS:
        print(f"| {step} | {res} | {ev} |")
    return 0 if all(r == "PASS" for _, r, _ in RESULTS) else 1


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--mentor-id", default=DEFAULT_MENTOR)
    p.add_argument("--idle", type=int, default=60)
    a = p.parse_args()
    sys.exit(asyncio.run(run(a.mentor_id, a.idle)))


if __name__ == "__main__":
    main()
