#!/usr/bin/env python3
"""Linux-only, explicit operator migration of a legacy static-web directory.

Prepare while delivery is locked and no other process is writing web files.
The original directory is retained, never deleted. No application restart.
"""
import argparse
import ctypes
import hashlib
import os
from pathlib import Path
import shutil
import uuid


def exchange(left: Path, right: Path) -> None:
    libc = ctypes.CDLL(None, use_errno=True)
    rename = libc.renameat2
    rename.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    rename.restype = ctypes.c_int
    if rename(-100, os.fsencode(left), -100, os.fsencode(right), 2) != 0:
        error = ctypes.get_errno()
        raise OSError(error, os.strerror(error))


def inventory(directory: Path) -> dict[str, str]:
    result = {}
    for path in directory.rglob('*'):
        if path.is_symlink():
            raise ValueError('Review symlinks before migrating legacy web content')
        if path.is_file():
            with path.open('rb') as source:
                result[str(path.relative_to(directory))] = hashlib.file_digest(source, 'sha256').hexdigest()
        elif not path.is_dir():
            raise ValueError('Unexpected non-file web entry')
    if 'index.html' not in result:
        raise ValueError('Expected static web index.html')
    return result


def migrate(root: Path) -> Path:
    root = root.resolve(strict=True)
    current = root / 'current'
    if current.is_symlink() or not current.is_dir():
        raise ValueError('Expected a legacy current directory, not a release symlink')
    before = inventory(current)
    identifier = uuid.uuid4().hex
    releases = root / 'web-releases'
    if releases.is_symlink():
        raise ValueError('Release directory must remain inside the web root')
    releases.mkdir(exist_ok=True)
    release = releases / ('bootstrap-' + identifier)
    shutil.copytree(current, release)
    if inventory(release) != before or inventory(current) != before:
        raise ValueError('Web files changed during preparation; original remains serving')
    retained = root / ('.legacy-current-' + identifier)
    retained.symlink_to(release, target_is_directory=True)
    # One atomic filesystem operation: current always exists, even on failure.
    # Afterward retained names the untouched original directory.
    exchange(current, retained)
    return retained


def rollback(root: Path, name: str) -> None:
    root = root.resolve(strict=True)
    if not name.startswith('.legacy-current-') or Path(name).name != name:
        raise ValueError('Expected a retained directory name within this web root')
    current, retained = root / 'current', root / name
    if not current.is_symlink() or retained.is_symlink() or not retained.is_dir():
        raise ValueError('Expected current symlink and retained original directory')
    exchange(current, retained)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', type=Path)
    parser.add_argument('--rollback', metavar='RETAINED_DIRECTORY_NAME')
    args = parser.parse_args()
    if args.rollback:
        rollback(args.root, args.rollback)
        print('Original directory restored atomically; release remains retained')
    else:
        retained = migrate(args.root)
        print(f'Migrated; preserve rollback directory: {retained.name}')
