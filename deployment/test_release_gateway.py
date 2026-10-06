import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
import zipfile
from unittest.mock import patch

import release_gateway as gateway

SHA = 'a' * 40
DIGEST = 'sha256:' + 'b' * 64


class GatewayTests(unittest.TestCase):
    def records(self):
        artifact = {'id': 42, 'name': f'release-{SHA}', 'expired': False, 'digest': DIGEST,
                    'workflow_run': {'id': 7, 'head_sha': SHA, 'head_branch': 'main'}}
        return {
            'git/ref/heads/main': {'object': {'sha': SHA}},
            f'actions/artifacts?name=release-{SHA}&per_page=100': {'artifacts': [artifact]},
            'actions/runs/7': {'event': 'push', 'path': '.github/workflows/delivery.yaml', 'head_sha': SHA, 'head_branch': 'main'},
            'actions/runs/7/jobs?per_page=100': {'jobs': [{'name': 'Verify and package', 'conclusion': 'success'}]},
        }

    def test_only_exact_restricted_commands_are_accepted(self):
        self.assertEqual(gateway.ssh_command(f'upload {SHA}'), ('upload', SHA))
        self.assertEqual(gateway.ssh_command(f'deploy {SHA}'), ('deploy', SHA))
        for command in ('', 'sh', f'deploy {SHA}; id', f'upload {SHA}\nsh', 'upload ../../etc/passwd', f'deploy {SHA} extra', 'sftp'):
            with self.subTest(command=command), self.assertRaises(ValueError):
                gateway.ssh_command(command)

    def test_current_main_verified_artifact_is_accepted(self):
        records = self.records()
        self.assertEqual(gateway.trusted_artifact(SHA, records.__getitem__)['digest'], DIGEST)

    def test_stale_unverified_and_foreign_releases_are_rejected(self):
        for mutation in ('stale', 'failed', 'pull_request', 'foreign_workflow', 'expired', 'digest', 'branch', 'wrong_sha'):
            records = self.records()
            artifact = records[f'actions/artifacts?name=release-{SHA}&per_page=100']['artifacts'][0]
            run = records['actions/runs/7']
            if mutation == 'stale': records['git/ref/heads/main']['object']['sha'] = 'c' * 40
            if mutation == 'failed': records['actions/runs/7/jobs?per_page=100']['jobs'][0]['conclusion'] = 'failure'
            if mutation == 'pull_request': run['event'] = 'pull_request'
            if mutation == 'foreign_workflow': run['path'] = 'other.yaml'
            if mutation == 'expired': artifact['expired'] = True
            if mutation == 'digest': artifact['digest'] = None
            if mutation == 'branch': artifact['workflow_run']['head_branch'] = 'experimental'
            if mutation == 'wrong_sha': run['head_sha'] = 'c' * 40
            with self.subTest(mutation=mutation), self.assertRaises((ValueError, TypeError)):
                gateway.trusted_artifact(SHA, records.__getitem__)

    def test_copy_hashes_exact_bytes_and_limits_uploads(self):
        target = io.BytesIO()
        digest = gateway.copy_bounded(io.BytesIO(b'release'), target, 7)
        self.assertEqual(target.getvalue(), b'release')
        self.assertEqual(digest, gateway.hashlib.sha256(b'release').hexdigest())
        with self.assertRaises(ValueError):
            gateway.copy_bounded(io.BytesIO(b'release'), io.BytesIO(), 6)

    def bundle(self, source_name='deployment/deploy.sh', symlink=False):
        source = io.BytesIO()
        with tarfile.open(fileobj=source, mode='w:gz') as archive:
            entry = tarfile.TarInfo(source_name)
            if symlink:
                entry.type = tarfile.SYMTYPE
                entry.linkname = '/etc/passwd'
                archive.addfile(entry)
            else:
                entry.size = 4
                archive.addfile(entry, io.BytesIO(b'test'))
        bundle = io.BytesIO()
        with zipfile.ZipFile(bundle, 'w') as archive:
            archive.writestr('source.tar.gz', source.getvalue())
            archive.writestr('images.tar.gz', b'images')
        bundle.seek(0)
        return bundle

    def test_valid_source_is_extracted(self):
        with tempfile.TemporaryDirectory() as directory:
            gateway.unpack_release(self.bundle(), Path(directory))
            self.assertEqual((Path(directory) / 'deployment/deploy.sh').read_bytes(), b'test')

    def test_archive_traversal_links_and_environment_overwrites_are_rejected(self):
        for name, symlink in [('../outside', False), ('/etc/passwd', False), ('link', True), ('deployment/release.env', False), ('receiver.json', False)]:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory, self.assertRaises(ValueError):
                gateway.unpack_release(self.bundle(name, symlink), Path(directory))

    def test_tampered_upload_never_starts_deployment(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            uploads = root / 'uploads'
            uploads.mkdir()
            (uploads / f'{SHA}.zip').write_bytes(b'tampered')
            with patch.object(gateway, 'UPLOADS', uploads), patch.object(gateway, 'RELEASES', root / 'releases'), patch.object(gateway.os, 'geteuid', return_value=0), patch.object(gateway, 'trusted_artifact', return_value={'digest': DIGEST}), patch.object(gateway.subprocess, 'run') as deploy:
                with self.assertRaises(ValueError):
                    gateway.promote(SHA)
                deploy.assert_not_called()

    def test_unprivileged_promotion_is_rejected(self):
        with patch.object(gateway.os, 'geteuid', return_value=1000), self.assertRaises(ValueError):
            gateway.promote(SHA)

    def test_arbitrary_extra_zip_entries_are_rejected(self):
        bundle = io.BytesIO()
        with zipfile.ZipFile(bundle, 'w') as archive:
            archive.writestr('../outside', b'bad')
        bundle.seek(0)
        with tempfile.TemporaryDirectory() as directory, self.assertRaises(ValueError):
            gateway.unpack_release(bundle, Path(directory))


if __name__ == '__main__':
    unittest.main()
