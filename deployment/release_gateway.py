#!/usr/bin/env python3
"""Restricted SSH receiver; trust GitHub's artifact digest, never the uploader."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
import zipfile

REPOSITORY = 'ramonsaboya/trip-dock'
UPLOADS = Path('/var/lib/tripdock-deploy/uploads')
RELEASES = Path('/srv/tripdock-releases')
MAX_BYTES = 2 * 1024 ** 3


def release_sha(value):
    if not re.fullmatch(r'[0-9a-f]{40}', value):
        raise ValueError('Expected a full lowercase commit SHA')
    return value


def ssh_command(value):
    match = re.fullmatch(r'(upload|deploy) ([0-9a-f]{40})', value)
    if not match:
        raise ValueError('Only upload SHA and deploy SHA are allowed')
    return match.groups()


def copy_bounded(source, target, limit=MAX_BYTES):
    digest = hashlib.sha256()
    total = 0
    while chunk := source.read(1024 * 1024):
        total += len(chunk)
        if total > limit:
            raise ValueError('Release exceeds the upload limit')
        target.write(chunk)
        digest.update(chunk)
    return digest.hexdigest()


def github(path):
    request = urllib.request.Request(
        f'https://api.github.com/repos/{REPOSITORY}/{path}',
        headers={'Accept': 'application/vnd.github+json', 'User-Agent': 'TripDock-release-gateway'},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def trusted_artifact(sha, fetch=github):
    if fetch('git/ref/heads/main')['object']['sha'] != sha:
        raise ValueError('Release is not the current main commit')
    artifacts = fetch(f'actions/artifacts?name=release-{sha}&per_page=100')['artifacts']
    for artifact in artifacts:
        workflow = artifact.get('workflow_run', {})
        if artifact['name'] != f'release-{sha}' or artifact['expired'] or workflow.get('head_sha') != sha or workflow.get('head_branch') != 'main':
            continue
        run_id = workflow['id']
        run = fetch(f'actions/runs/{run_id}')
        if run.get('event') not in ('push', 'workflow_dispatch') or run.get('path') != '.github/workflows/delivery.yaml' or run.get('head_sha') != sha or run.get('head_branch') != 'main':
            continue
        jobs = fetch(f'actions/runs/{run_id}/jobs?per_page=100')['jobs']
        if not any(job['name'] == 'Verify and package' and job['conclusion'] == 'success' for job in jobs):
            continue
        digest = artifact.get('digest', '')
        if isinstance(digest, str) and re.fullmatch(r'sha256:[0-9a-f]{64}', digest):
            return artifact
    raise ValueError('No verified, unexpired main-release artifact found')


def unpack_release(bundle, destination):
    with zipfile.ZipFile(bundle) as archive:
        entries = archive.infolist()
        if len(entries) != 2 or {entry.filename for entry in entries} != {'source.tar.gz', 'images.tar.gz'}:
            raise ValueError('Unexpected artifact contents')
        for entry in entries:
            if entry.file_size > MAX_BYTES or stat.S_ISLNK(entry.external_attr >> 16):
                raise ValueError('Invalid artifact entry')
            with archive.open(entry) as source, (destination / entry.filename).open('wb') as target:
                copy_bounded(source, target)
    with tarfile.open(destination / 'source.tar.gz', 'r:gz') as source:
        members = source.getmembers()
        total = 0
        for member in members:
            path = PurePosixPath(member.name)
            total += member.size
            if path.is_absolute() or '..' in path.parts or not (member.isfile() or member.isdir()) or total > MAX_BYTES:
                raise ValueError('Unsafe source archive')
            if member.name in ('images.tar.gz', 'source.tar.gz', 'receiver.json', 'deployment/release.env'):
                raise ValueError('Source collides with protected release files')
        source.extractall(destination, members=members, filter='data')


def dispatch():
    import fcntl
    action, sha = ssh_command(os.environ.get('SSH_ORIGINAL_COMMAND', ''))
    if action == 'deploy':
        os.execv('/usr/bin/sudo', ['sudo', '-n', '/usr/local/sbin/tripdock-release', sha])
    # A stolen deployment key cannot fill disk with arbitrary SHA-named uploads.
    with (UPLOADS.parent / 'upload.lock').open('r+') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if github('git/ref/heads/main')['object']['sha'] != sha:
            raise ValueError('Only the current main commit may be uploaded')
        for old in UPLOADS.iterdir():
            if re.fullmatch(r'[0-9a-f]{40}\.zip|upload-.*', old.name):
                old.unlink()
        descriptor, temporary = tempfile.mkstemp(prefix='upload-', dir=UPLOADS)
        try:
            with os.fdopen(descriptor, 'wb') as target:
                copy_bounded(sys.stdin.buffer, target)
                target.flush()
                os.fsync(target.fileno())
            os.replace(temporary, UPLOADS / f'{sha}.zip')
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
    print(f'Uploaded release {sha}')


def promote(sha):
    import fcntl
    if os.geteuid() != 0:
        raise ValueError('Promotion requires the installed privileged helper')
    RELEASES.mkdir(mode=0o700, exist_ok=True)
    with (RELEASES / 'receiver.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        artifact = trusted_artifact(sha)
        with tempfile.TemporaryDirectory(prefix='.incoming-', dir=RELEASES) as temporary:
            staging = Path(temporary)
            # Snapshot an untrusted user-owned upload into a root-owned directory.
            # No symlink following; later changes to the upload cannot alter this snapshot.
            descriptor = os.open(UPLOADS / f'{sha}.zip', os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            with os.fdopen(descriptor, 'rb') as source, (staging / 'release.zip').open('wb') as target:
                if not stat.S_ISREG(os.fstat(source.fileno()).st_mode):
                    raise ValueError('Upload must be a regular file')
                digest = copy_bounded(source, target)
            if artifact['digest'] != f'sha256:{digest}':
                raise ValueError('Upload does not match the GitHub artifact digest')
            directory = staging / 'source'
            directory.mkdir(mode=0o700)
            unpack_release(staging / 'release.zip', directory)
            destination = RELEASES / sha
            receipt = {'sha': sha, 'artifactId': artifact['id'], 'digest': artifact['digest']}
            if destination.exists():
                old = json.loads((destination / 'receiver.json').read_text())
                if old['sha'] != sha:
                    raise ValueError('Existing release identity mismatch')
                for name in ('images.tar.gz', 'source.tar.gz'):
                    shutil.copyfile(directory / name, destination / name)
            else:
                os.rename(directory, destination)
            (destination / 'receiver.json').write_text(json.dumps(receipt) + '\n')
        # Check again immediately before running the trusted release's deployment script.
        if github('git/ref/heads/main')['object']['sha'] != sha:
            raise ValueError('Release was superseded during transfer')
        subprocess.run(['/bin/bash', 'deployment/deploy.sh', sha], cwd=destination,
                       env={'PATH': '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', 'HOME': '/root'}, check=True)
        (UPLOADS / f'{sha}.zip').unlink(missing_ok=True)


if __name__ == '__main__':
    try:
        if len(sys.argv) == 2 and sys.argv[1] == 'dispatch':
            dispatch()
        elif len(sys.argv) == 3 and sys.argv[1] == 'promote':
            promote(release_sha(sys.argv[2]))
        else:
            raise ValueError('Invalid gateway invocation')
    except (ValueError, OSError, KeyError, tarfile.TarError, zipfile.BadZipFile, subprocess.CalledProcessError) as error:
        print(f'Release refused: {error}', file=sys.stderr)
        sys.exit(1)
