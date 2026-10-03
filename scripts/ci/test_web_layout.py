import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('web_layout', Path(__file__).resolve().parents[2] / 'deploy/web-release-layout.py')
layout = importlib.util.module_from_spec(spec)
spec.loader.exec_module(layout)


@unittest.skipUnless(sys.platform.startswith('linux'), 'Atomic rename exchange requires Linux')
class WebLayoutTests(unittest.TestCase):
    def test_atomic_migration_and_rollback_preserve_original(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            current = root / 'current'
            current.mkdir()
            (current / 'index.html').write_text('original application')
            before_inode = current.stat().st_ino
            retained = layout.migrate(root)
            self.assertTrue(current.is_symlink())
            self.assertEqual(retained.stat().st_ino, before_inode)
            self.assertEqual((current / 'index.html').read_text(), 'original application')
            with self.assertRaises(ValueError):
                layout.migrate(root)
            with self.assertRaises(ValueError):
                layout.rollback(root, '../outside')
            layout.rollback(root, retained.name)
            self.assertFalse(current.is_symlink())
            self.assertEqual(current.stat().st_ino, before_inode)
            self.assertEqual((current / 'index.html').read_text(), 'original application')

    def test_refuses_symlinked_assets_before_switching(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            current = root / 'current'
            current.mkdir()
            (current / 'index.html').write_text('original')
            (current / 'asset').symlink_to(root / 'outside')
            with self.assertRaises(ValueError):
                layout.migrate(root)
            self.assertFalse(current.is_symlink())

    def test_exchange_failure_keeps_original_serving(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            current = root / 'current'
            current.mkdir()
            (current / 'index.html').write_text('original')
            original_inode = current.stat().st_ino
            with patch.object(layout, 'exchange', side_effect=OSError('unsupported filesystem')):
                with self.assertRaises(OSError):
                    layout.migrate(root)
            self.assertFalse(current.is_symlink())
            self.assertEqual(current.stat().st_ino, original_inode)
            self.assertEqual((current / 'index.html').read_text(), 'original')

    def test_changed_source_aborts_before_exchange(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            current = root / 'current'
            current.mkdir()
            (current / 'index.html').write_text('original')
            copy = layout.shutil.copytree

            def concurrent_write(source, destination):
                result = copy(source, destination)
                (source / 'index.html').write_text('changed by concurrent writer')
                return result

            with patch.object(layout.shutil, 'copytree', side_effect=concurrent_write):
                with self.assertRaises(ValueError):
                    layout.migrate(root)
            self.assertFalse(current.is_symlink())
            self.assertEqual((current / 'index.html').read_text(), 'changed by concurrent writer')
