import importlib.util
import io
from pathlib import Path
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("receiver", Path(__file__).resolve().parents[2] / "deploy/ci-receiver.py")
receiver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(receiver)


class ArchiveTests(unittest.TestCase):
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
