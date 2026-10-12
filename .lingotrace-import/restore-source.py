#!/usr/bin/env python3
"""Restore exact large assets, then verify every source file; standard library only."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import tempfile


def sha1_object(kind, data):
    return hashlib.sha1(kind.encode() + b' ' + str(len(data)).encode() + b'\0' + data).hexdigest()


def safe_path(root, name):
    relative = Path(name)
    if relative.is_absolute() or '..' in relative.parts:
        raise ValueError('Unsafe manifest path: ' + name)
    path = root / relative
    for parent in [path, *path.parents]:
        if parent == root:
            break
        if parent.is_symlink():
            raise ValueError('Refusing symlink: ' + str(parent))
    return path


def verify_bytes(data, spec):
    if (len(data) != spec['bytes'] or
            hashlib.sha256(data).hexdigest() != spec['sha256'] or
            sha1_object('blob', data) != spec['git_blob_sha1']):
        raise ValueError('Size or content mismatch: ' + spec.get('path', spec['git_blob_sha1']))


def projected_tree(files):
    root = {}
    for spec in files:
        cursor = root
        parts = spec['path'].split('/')
        for part in parts[:-1]:
            cursor = cursor.setdefault(part, {})
        cursor[parts[-1]] = (spec['mode'], spec['git_blob_sha1'])

    def walk(node):
        entries = []
        for name, value in node.items():
            mode, digest = ('40000', walk(value)) if isinstance(value, dict) else value
            key = (name + ('/' if mode == '40000' else '')).encode()
            entries.append((key, mode.encode() + b' ' + name.encode() + b'\0' + bytes.fromhex(digest)))
        return sha1_object('tree', b''.join(data for _, data in sorted(entries)))
    return walk(root)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--verify-only', action='store_true', help='Verify the recovered source without writing assets.')
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    manifest = json.loads((root / '.lingotrace-import/SOURCE-MANIFEST.json').read_text())
    source = manifest['source_files']
    expected_tree = manifest['source_projection_tree_sha1']
    if projected_tree(source) != expected_tree:
        raise ValueError('Manifest source tree identity does not match.')
    restorable = {p for item in manifest['large_resources'] for p in item['target_paths']}
    # Preflight all existing source files before writing; never replace changed user files.
    for spec in source:
        path = safe_path(root, spec['path'])
        if path.exists():
            verify_bytes(path.read_bytes(), spec)
        elif spec['path'] not in restorable or args.verify_only:
            raise ValueError('Missing source file: ' + spec['path'])
    assembled = []
    if not args.verify_only:
        for item in manifest['large_resources']:
            parts = []
            for chunk in item['chunks']:
                data = safe_path(root, chunk['path']).read_bytes()
                verify_bytes(data, chunk)
                parts.append(data)
            data = b''.join(parts)
            verify_bytes(data, item)
            assembled.append((item, data))
        for item, data in assembled:
            for name in item['target_paths']:
                target = safe_path(root, name)
                if target.exists():
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                fd, temporary = tempfile.mkstemp(prefix='.lingotrace-restore-', dir=target.parent)
                try:
                    with os.fdopen(fd, 'wb') as stream:
                        stream.write(data)
                        stream.flush()
                        os.fsync(stream.fileno())
                    os.chmod(temporary, 0o644)
                    # A hard link atomically refuses replacement if the target appeared meanwhile.
                    os.link(temporary, target)
                finally:
                    os.unlink(temporary)
    for spec in source:
        verify_bytes(safe_path(root, spec['path']).read_bytes(), spec)
    print(json.dumps({'status': 'verified', 'source_files': len(source),
                      'source_projection_tree_sha1': expected_tree,
                      'original_candidate_commit': manifest['source_candidate_commit']}, indent=2))


if __name__ == '__main__':
    main()
