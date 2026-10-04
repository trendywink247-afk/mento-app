#!/usr/bin/env python3
"""Synthetic receiver restart drill: no ports, host data, VPS or real keys."""

import os
import subprocess
import sys
import uuid


def main(image):
    name = "mento-receipt-drill-" + uuid.uuid4().hex[:12]
    volume = name + "-data"
    token = uuid.uuid4().hex + uuid.uuid4().hex
    created_volume = created_container = False

    def run(args, okay=True, data=None):
        result = subprocess.run(
            ["docker", *args],
            input=data,
            capture_output=True,
            env={**os.environ, "RECEIVER_TOKEN": token},
            timeout=90,
        )
        if okay and result.returncode:
            raise RuntimeError(
                "Isolated receiver command failed; captured output suppressed"
            )
        return result

    def probe():
        script = """
import hashlib,json,os,time,urllib.request,urllib.error
from pathlib import Path
from recovery_receiver.store import Store
url='http://127.0.0.1:18090/receipts'
body=json.dumps(dict(version=1,member_digest=hashlib.sha256(b'synthetic-account').hexdigest())).encode()
def request(method,token=None):
    req=urllib.request.Request(url,data=body if method=='POST' else None,method=method,
        headers={'Content-Type':'application/json',**({'Authorization':'Bearer '+token} if token else {})})
    try:
        with urllib.request.urlopen(req,timeout=3) as response: return response.status,json.loads(response.read())
    except urllib.error.HTTPError as exc: return exc.code,None
for attempt in range(30):
    try:
        assert request('POST')[0]==401
        break
    except (OSError,AssertionError): time.sleep(.25)
else: raise RuntimeError('Receiver unavailable')
assert request('GET')[0] in (404,405)
for _ in range(2):
    status,payload=request('POST',os.environ['RECEIVER_TOKEN'])
    assert status==200 and payload['durable'] is True
export=Store(Path('/data/receipts.sqlite3')).export()
assert export['receipt_count']==export['high_water']==1
print('PASS authenticated commit, denied public reads and idempotent receipt')
"""
        result = run(["exec", "-i", name, "python", "-"], data=script.encode())
        print(result.stdout.decode().strip())

    try:
        run(["volume", "create", "--label", "mento.synthetic=receipt-drill", volume])
        created_volume = True
        mount = f"type=volume,source={volume},target=/data"
        missing = run(
            [
                "run",
                "--rm",
                "--network",
                "none",
                "--mount",
                mount,
                "-e",
                "RECEIVER_TOKEN",
                image,
            ],
            okay=False,
        )
        if missing.returncode == 0:
            raise AssertionError(
                "Serving silently initialized missing receiver storage"
            )
        run(
            [
                "run",
                "--rm",
                "--network",
                "none",
                "--mount",
                mount,
                image,
                "init",
                "--database",
                "/data/receipts.sqlite3",
            ]
        )
        run(
            [
                "run",
                "-d",
                "--name",
                name,
                "--network",
                "none",
                "--read-only",
                "--cap-drop",
                "ALL",
                "--security-opt",
                "no-new-privileges",
                "--pids-limit",
                "64",
                "--memory",
                "192m",
                "--cpus",
                ".5",
                "--tmpfs",
                "/tmp:size=8m,mode=1777",
                "--mount",
                mount,
                "-e",
                "RECEIVER_TOKEN",
                image,
            ]
        )
        created_container = True
        probe()
        run(["restart", name])
        probe()
        print("PASS committed receipt survives container restart without duplication")
    finally:
        if created_container:
            run(["rm", "-f", name])
        if created_volume:
            run(["volume", "rm", volume])
        print("PASS synthetic receiver container and volume removed")


if __name__ == "__main__":
    main(sys.argv[1])
