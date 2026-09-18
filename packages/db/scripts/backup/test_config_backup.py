import argparse
from datetime import timedelta
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import tarfile
import unittest
from unittest.mock import patch

import config_backup as config
import physical_backup as backup


class ConfigBackupTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.saved_env = dict(os.environ)
        cls.tmp = tempfile.TemporaryDirectory(prefix='barghsa-config-test-')
        cls.root = Path(cls.tmp.name)
        cls.data, cls.socket = cls.root / 'database', cls.root / 'socket'
        cls.socket.mkdir()
        cls.key = cls.root / 'backup-key'
        cls.key.write_text('synthetic-backup-passphrase')
        os.environ.update(PGDIRECT_URL=f'postgresql:///barghsa?host={cls.socket}&user=postgres',
                          BACKUP_CLUSTER_ID='config-tests', BACKUP_GPG_PASSPHRASE_FILE=str(cls.key),
                          VERIFY_ALERT_EXECUTABLE='')
        backup.run(['initdb', '-D', str(cls.data), '--auth=trust'])
        with (cls.data / 'postgresql.conf').open('a') as output:
            output.write(f"\nlisten_addresses=''\nunix_socket_directories='{cls.socket}'\n")
        backup.run(['pg_ctl', '-D', str(cls.data), '-l', str(cls.root / 'postgres.log'), '-w', 'start'])
        cls.sql('CREATE DATABASE barghsa', 'postgres')
        journal = json.loads(Path('/schema/meta/_journal.json').read_text())
        for migration in journal['entries']:
            result = subprocess.run(['psql', '-Xq', '-h', str(cls.socket), '-U', 'postgres',
                                     '-d', 'barghsa', '-v', 'ON_ERROR_STOP=1',
                                     '-f', '/schema/' + migration['tag'] + '.sql'], capture_output=True, text=True)
            if result.returncode:
                raise AssertionError(migration['tag'] + ': ' + result.stderr[-1800:])
        cls.sql("INSERT INTO app_config(key,value) VALUES ('backup.fixture.active',"
                "'{\"enabled\":true,\"amount\":9007199254740993,\"text\":\"quote '' and slash \\\\ end\"}')")
        cls.source = cls.root / 'source'
        cls.source.mkdir()
        contents = {'.env': b'EXAMPLE_SECRET=synthetic-only\n',
                    'deploy/start.sh': b'#!/bin/sh\nexit 0\n',
                    'tls/server.pem': b'synthetic-tls-content\n',
                    'keys/app.key': b'synthetic-application-key\n'}
        kinds = ['env', 'deploy', 'tls', 'encryption_key']
        entries = []
        for (name, value), kind in zip(contents.items(), kinds):
            p = cls.source / name
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(value)
            if kind == 'deploy':
                p.chmod(0o700)
            entries.append({'path': name, 'kind': kind})
        cls.manifest = cls.root / 'files.json'
        cls.manifest.write_text(json.dumps({'version': 1, 'files': entries}))
        cls.store = backup.Store()
        try:
            cls.store.client.head_bucket(Bucket=cls.store.bucket)
        except backup.ClientError as error:
            if not backup.missing(error):
                raise
            cls.store.client.create_bucket(Bucket=cls.store.bucket)
        cls.baseline = cls.root / 'baseline.json'
        config.baseline(cls.args(output=str(cls.baseline)))
        config.backup_config(cls.store, cls.args(label='initial'))

    @classmethod
    def tearDownClass(cls):
        subprocess.run(['pg_ctl', '-D', str(cls.data), '-m', 'immediate', '-w', 'stop'], capture_output=True)
        os.environ.clear()
        os.environ.update(cls.saved_env)
        cls.tmp.cleanup()

    @classmethod
    def sql(cls, sql, database='barghsa'):
        result = subprocess.run(['psql', '-XAt', '-v', 'ON_ERROR_STOP=1', '-h', str(cls.socket),
                                 '-U', 'postgres', '-d', database, '-c', sql], capture_output=True, text=True)
        if result.returncode:
            raise AssertionError(result.stderr)
        return result.stdout.strip()

    @classmethod
    def args(cls, **kwargs):
        values = dict(source_dir=str(cls.source), inventory=str(cls.manifest), work_dir=str(cls.root),
                      label='initial', target_dir=str(cls.root / 'restored'), baseline=str(cls.baseline))
        values.update(kwargs)
        return argparse.Namespace(**values)

    def test_restore_preserves_paths_and_keeps_key_wrapped(self):
        target = self.root / 'restored-paths'
        metadata = config.restore_config(self.store, self.args(target_dir=str(target)))
        self.assertEqual(len(metadata['files']), 4)
        self.assertEqual((target / 'files/.env').read_bytes(), (self.source / '.env').read_bytes())
        self.assertEqual((target / 'files/deploy/start.sh').stat().st_mode & 0o777, 0o700)
        self.assertFalse((target / 'files/keys/app.key').exists())
        self.assertNotIn(b'synthetic-application-key', (target / 'files/keys/app.key.gpg').read_bytes())
        raw = json.loads((target / 'active-config.json').read_text())
        active = next(row for row in raw['tables']['app_config'] if row['key'] == 'backup.fixture.active')
        self.assertEqual(active['value']['amount'], 9007199254740993)
        self.assertEqual(set(raw['tables']), set(config.CONFIG_TABLES))

    def test_real_schema_rehydration_and_independent_loss_check(self):
        before = self.sql('SELECT count(*) FROM app_config')
        report = config.verify_config(self.store, self.args())
        self.assertEqual(report['status'], 'passed', report)
        self.assertEqual(report['rpo_seconds'], 0)
        self.assertGreater(report['rto_seconds'], 0)
        self.assertEqual(self.sql('SELECT count(*) FROM app_config'), before)
        self.assertEqual(self.sql("SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'recovered_%'"), '0')

    def test_changed_file_baseline_is_not_zero_rpo(self):
        changed = json.loads(self.baseline.read_text())
        changed['files'][0]['sha256'] = '0' * 64
        target = self.root / 'changed-baseline.json'
        target.write_text(json.dumps(changed))
        report = config.verify_config(self.store, self.args(baseline=str(target)))
        self.assertEqual(report['status'], 'failed')
        self.assertIsNone(report['rpo_seconds'])

    def test_wrong_key_does_not_publish_target(self):
        wrong = self.root / 'wrong-key'
        wrong.write_text('wrong-passphrase')
        target = self.root / 'wrong-target'
        with patch.dict(os.environ, {'BACKUP_GPG_PASSPHRASE_FILE': str(wrong)}):
            with self.assertRaises(backup.BackupError):
                config.restore_config(self.store, self.args(target_dir=str(target)))
        self.assertFalse(target.exists())

    def test_existing_target_and_caller_directory_are_preserved(self):
        target = self.root / 'existing'
        target.mkdir()
        marker = target / 'keep'
        marker.write_text('user-owned')
        with self.assertRaisesRegex(backup.BackupError, 'must not exist'):
            config.restore_config(self.store, self.args(target_dir=str(target)))
        result = subprocess.run(['bash', '/opt/backup/backup-config.sh', '--dry-run'],
                                env={**os.environ, 'BACKUP_DIR': str(target)}, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(marker.read_text(), 'user-owned')

    def test_missing_file_prevents_completion_manifest(self):
        value = json.loads(self.manifest.read_text())
        value['files'][0]['path'] = 'absent.env'
        bad = self.root / 'missing.json'
        bad.write_text(json.dumps(value))
        with self.assertRaises(FileNotFoundError):
            config.backup_config(self.store, self.args(inventory=str(bad), label='missing'))
        self.assertNotIn('missing', [m['label'] for m in config.manifests(self.store)])

    def test_symlink_cannot_escape_source(self):
        link = self.source / 'outside'
        link.symlink_to(self.key)
        with self.assertRaisesRegex(backup.BackupError, 'Symlinks'):
            config.copy_source(self.source, {'path': 'outside', 'kind': 'env'}, self.root / 'copied')
        self.assertFalse((self.root / 'copied').exists())

    def test_special_file_is_rejected_without_waiting_for_a_writer(self):
        pipe = self.source / 'pipe'
        os.mkfifo(pipe)
        with self.assertRaisesRegex(backup.BackupError, 'regular files'):
            config.copy_source(self.source, {'path': 'pipe', 'kind': 'env'}, self.root / 'pipe-copy')
        self.assertFalse((self.root / 'pipe-copy').exists())

    def test_manifest_rejects_unsafe_paths_and_wrapped_key_collisions(self):
        for name in ['../outside', '/absolute', 'a/../b', 'a//b']:
            with self.subTest(name=name), self.assertRaises(backup.BackupError):
                config.relative(name)
        entries = json.loads(self.manifest.read_text())
        entries['files'].append({'path': 'keys/app.key.gpg', 'kind': 'tls'})
        bad = self.root / 'collision.json'
        bad.write_text(json.dumps(entries))
        with self.assertRaisesRegex(backup.BackupError, 'collides'):
            config.inventory(bad)

    def test_label_is_immutable(self):
        with self.assertRaisesRegex(backup.BackupError, 'already exists'):
            config.backup_config(self.store, self.args())

    def test_snapshot_fails_if_a_required_table_is_missing(self):
        self.sql('ALTER TABLE config_version RENAME TO missing_config_version')
        try:
            with self.assertRaises(backup.BackupError):
                config.snapshot()
        finally:
            self.sql('ALTER TABLE missing_config_version RENAME TO config_version')

    def test_retention_keeps_newest_and_other_backup_namespaces(self):
        store = backup.Store()
        store.prefix += 'retention-test/'
        now = backup.utcnow()
        for label, age in [('old', 120), ('recent', 2)]:
            blob = 'config/blobs/' + ('a' if label == 'old' else 'b') * 32 + '.tar.gpg'
            store.put(blob, b'cipher')
            record = dict(version=1, label=label, captured_at=(now-timedelta(days=age)).isoformat(),
                          blob=blob, sha256='0'*64, size=6)
            store.put(f'config/full/{label}/manifest.json', json.dumps(record).encode())
        store.put('wal/123/keep.gpg', b'wal')
        store.put('config/blobs/' + 'c'*32 + '.tar.gpg', b'in-flight')
        self.assertEqual(config.prune_config(store, now)['deleted_backups'], 1)
        self.assertEqual([r['label'] for r in config.manifests(store)], ['recent'])
        self.assertEqual(config.prune_config(store, now+timedelta(days=200))['deleted_backups'], 0)
        keys = [o['Key'] for o in store.objects('')]
        self.assertIn(store.prefix+'wal/123/keep.gpg', keys)
        self.assertIn(store.prefix+'config/blobs/'+'c'*32+'.tar.gpg', keys)
        self.assertNotIn(store.prefix+'config/blobs/'+'a'*32+'.tar.gpg', keys)

    def test_failed_backup_never_prunes(self):
        with patch.object(config, 'backup_config', side_effect=backup.BackupError('failed')), \
                patch.object(config, 'prune_config') as prune:
            with self.assertRaises(backup.BackupError):
                config.backup_job(self.store, self.args())
            prune.assert_not_called()

    def test_retention_failure_is_not_job_success(self):
        with patch.object(config, 'backup_config', return_value={'label': 'new'}), \
                patch.object(config, 'prune_config', side_effect=backup.BackupError('retention failed')):
            with self.assertRaisesRegex(backup.BackupError, 'retention failed'):
                config.backup_job(self.store, self.args())

    def test_config_archive_rejects_links_and_traversal(self):
        for i, name in enumerate(['files/../../escape', 'files/key']):
            archive = self.root / f'unsafe-{i}.tar'
            with tarfile.open(archive, 'w') as tar:
                entry = tarfile.TarInfo(name)
                if i:
                    entry.type, entry.linkname = tarfile.SYMTYPE, '/etc/passwd'
                tar.addfile(entry, io.BytesIO())
            target = self.root / f'unsafe-{i}'
            target.mkdir()
            with self.assertRaises(backup.BackupError):
                backup.extract(archive, target, allowed_roots=('files',), tablespace_links=False)

    def test_job_setup_failure_reports_to_alert_receiver(self):
        receiver = self.root / 'receiver'
        received = self.root / 'received.json'
        receiver.write_text('#!/bin/sh\ncat > "'+str(received)+'"\n')
        receiver.chmod(0o700)
        result = subprocess.run(['python3', '/opt/backup/config_backup.py', 'job'],
                                env={**os.environ, 'BACKUP_S3_ENDPOINT': '',
                                     'VERIFY_ALERT_EXECUTABLE': str(receiver)}, capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(json.loads(received.read_text())['status'], 'failed')
        self.assertEqual(json.loads(result.stdout)['status'], 'failed')


if __name__ == '__main__':
    unittest.main(verbosity=2)
