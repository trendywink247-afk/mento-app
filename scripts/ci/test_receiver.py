import importlib.util
import io
import hashlib
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("receiver", Path(__file__).resolve().parents[2] / "deploy/ci-receiver.py")
receiver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(receiver)


class ArchiveTests(unittest.TestCase):
    def test_production_requires_matching_api_worker_and_heartbeat(self):
        expected = "sha256:" + "a" * 64
        healthy = json.dumps([{"Image": expected, "State": {"Running": True}}])
        wrong = json.dumps([{"Image": "sha256:" + "b" * 64, "State": {"Running": True}}])
        stopped = json.dumps([{"Image": expected, "State": {"Running": False}}])
        for snapshots in [(wrong, healthy), (healthy, wrong), (healthy, stopped)]:
            with self.subTest(snapshots=snapshots), patch.object(receiver.subprocess, "check_output", side_effect=snapshots), patch.object(receiver, "run") as run:
                with self.assertRaises(ValueError):
                    receiver.verify_production_runtime(expected)
                run.assert_not_called()
        with patch.object(receiver.subprocess, "check_output", side_effect=[healthy, healthy]), patch.object(receiver, "run") as run:
            receiver.verify_production_runtime(expected)
            self.assertEqual(run.call_args.args[:4], ("docker", "exec", "mento-worker-prod", "python"))
        with patch.object(receiver.subprocess, "check_output", side_effect=[healthy, healthy]), patch.object(receiver, "run", side_effect=receiver.subprocess.CalledProcessError(1, "heartbeat")):
            with self.assertRaises(receiver.subprocess.CalledProcessError):
                receiver.verify_production_runtime(expected)

    def test_image_archive_must_import_only_the_expected_source_tag(self):
        sha = "a" * 40
        for tag, revision, valid in [(f"mento-api:{sha[:12]}", sha, True),
                                      ("mento-api:other", sha, False),
                                      (f"mento-api:{sha[:12]}", "b" * 40, False)]:
            with self.subTest(tag=tag, revision=revision), tempfile.TemporaryDirectory() as temp:
                archive = Path(temp) / "image.tgz"
                files = {"manifest.json": [{"Config": "config.json", "RepoTags": [tag]}],
                         "config.json": {"config": {"Labels": {"org.opencontainers.image.revision": revision}}}}
                with tarfile.open(archive, "w:gz") as out:
                    for name, value in files.items():
                        data = json.dumps(value).encode()
                        item = tarfile.TarInfo(name)
                        item.size = len(data)
                        out.addfile(item, io.BytesIO(data))
                if valid:
                    receiver.verify_image_archive(archive, sha)
                else:
                    with self.assertRaises(ValueError):
                        receiver.verify_image_archive(archive, sha)

    def test_rejects_traversal_links_and_unexpected_files(self):
        for name, kind in [("../escape", tarfile.REGTYPE), ("/escape", tarfile.REGTYPE),
                           ("link", tarfile.SYMTYPE), ("secret.env", tarfile.REGTYPE)]:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as temp:
                archive = Path(temp) / "input.tgz"
                target = Path(temp) / "output"
                target.mkdir()
                with tarfile.open(archive, "w:gz") as out:
                    item = tarfile.TarInfo(name)
                    item.type = kind
                    item.linkname = "/etc/passwd" if kind == tarfile.SYMTYPE else ""
                    out.addfile(item, io.BytesIO())
                with self.assertRaises(ValueError):
                    receiver.extract(archive, target, {"release.json"})
                self.assertEqual(list(target.iterdir()), [])

    def test_regular_public_assets_extract(self):
        with tempfile.TemporaryDirectory() as temp:
            archive = Path(temp) / "input.tgz"
            target = Path(temp) / "output"
            with tarfile.open(archive, "w:gz") as out:
                item = tarfile.TarInfo("./assets/index.js")
                item.size = 2
                out.addfile(item, io.BytesIO(b"ok"))
            receiver.extract(archive, target)
            self.assertEqual((target / "assets/index.js").read_bytes(), b"ok")

    def test_candidate_tampering_and_wrong_commit_are_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            candidate = Path(temp)
            sha = "a" * 40
            manifest = {"sha": sha, "image": "sha256:" + "b" * 64}
            files = {"api-image.tar.gz": b"api", "web-staging.tar.gz": b"staging",
                     "web-production.tar.gz": b"production", "checks.json": b"{}",
                     "image-id.txt": manifest["image"].encode(),
                     "release.json": json.dumps(manifest).encode()}
            checksums = []
            for name, data in files.items():
                (candidate / name).write_bytes(data)
                checksums.append(f"{hashlib.sha256(data).hexdigest()}  {name}")
            (candidate / "SHA256SUMS").write_text("\n".join(checksums))
            self.assertEqual(receiver.verify_candidate(candidate, sha), manifest)
            with self.assertRaises(ValueError):
                receiver.verify_candidate(candidate, "c" * 40)
            (candidate / "api-image.tar.gz").write_bytes(b"tampered")
            with self.assertRaises(ValueError):
                receiver.verify_candidate(candidate, sha)
