"""Run inside the backup image as postgres; S3 must be an isolated test bucket."""

import argparse
import contextlib
import io
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import time
import unittest
from unittest.mock import patch, Mock
from datetime import timedelta

import physical_backup as backup


class ArchiveSafetyTests(unittest.TestCase):
    def test_rejects_traversal_links_and_devices(self):
        for name, kind, link in [('../outside', tarfile.REGTYPE, ''),
                                  ('/outside', tarfile.REGTYPE, ''),
                                  ('data/link', tarfile.SYMTYPE, '/tmp'),
                                  ('data/hard', tarfile.LNKTYPE, 'data/file'),
                                  ('data/device', tarfile.CHRTYPE, ''),
                                  ('data/pg_tblspc/123', tarfile.SYMTYPE, '/live')]:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as tmp:
                archive = Path(tmp) / 'test.tar'
                with tarfile.open(archive, 'w') as tar:
                    member = tarfile.TarInfo(name)
                    member.type, member.linkname = kind, link
                    tar.addfile(member)
                with self.assertRaises(backup.BackupError):
                    backup.extract(archive, Path(tmp) / 'output')

    def test_rejects_duplicate_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            archive = Path(tmp) / 'test.tar'
            with tarfile.open(archive, 'w') as tar:
                for _ in range(2):
                    tar.addfile(tarfile.TarInfo('data/file'))
            with self.assertRaises(backup.BackupError):
                backup.extract(archive, Path(tmp) / 'output')

    def test_secret_never_appears_in_subprocess_error(self):
        result = subprocess.CompletedProcess([], 1, b'', b'password=secret')
        with patch.object(subprocess, 'run', return_value=result):
            with self.assertRaisesRegex(backup.BackupError, r'psql failed \(exit 1\)'):
                backup.run(['psql', 'secret'])

    def test_dry_run_preserves_caller_directory_and_hides_url(self):
        with tempfile.TemporaryDirectory() as tmp:
            marker = Path(tmp) / 'keep'
            marker.write_text('user data')
            env = {**os.environ, 'BACKUP_DIR': tmp, 'PGDIRECT_URL': 'postgres://secret@server/db'}
            result = subprocess.run(['python3', str(Path(backup.__file__)), 'backup', '--dry-run'],
                                    env=env, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertNotIn('secret', result.stdout + result.stderr)
            self.assertEqual(marker.read_text(), 'user data')

    def test_http_requires_explicit_local_opt_in(self):
        with patch.dict(os.environ, {'BACKUP_S3_ENDPOINT': 'http://localhost:9000',
                                    'BACKUP_ALLOW_HTTP': ''}):
            with self.assertRaisesRegex(backup.BackupError, 'HTTPS'):
                backup.Store()

    def test_connection_url_decodes_credentials_without_arguments(self):
        with patch.dict(os.environ, {'PGDIRECT_URL':
                'postgresql://user:p%40ss@[::1]:5433/db?sslmode=verify-full'}):
            env = backup.connection_env()
        self.assertEqual(env['PGPASSWORD'], 'p@ss')
        self.assertEqual(env['PGHOST'], '::1')
        self.assertEqual(env['PGSSLMODE'], 'verify-full')
        with patch.dict(os.environ, {'PGDIRECT_URL': 'postgresql:///db?unknown=ignored'}):
            with self.assertRaises(backup.BackupError):
                backup.connection_env()

    def test_listing_failure_prevents_any_retention_deletion(self):
        store = Mock()
        store.manifests.side_effect = RuntimeError('storage unavailable')
        with self.assertRaises(RuntimeError):
            backup.prune(store)
        store.client.delete_object.assert_not_called()

    def test_listing_reads_all_pages(self):
        store = object.__new__(backup.Store)
        store.bucket, store.prefix, store.client = 'bucket', 'prefix/', Mock()
        store.client.get_paginator.return_value.paginate.return_value = [
            {'Contents': [{'Key': 'first'}]}, {}, {'Contents': [{'Key': 'last'}]}]
        self.assertEqual([o['Key'] for o in store.objects('full/')], ['first', 'last'])
        store.client.get_paginator.assert_called_once_with('list_objects_v2')


class PhysicalBackupIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(prefix='barghsa-backup-test-')
        cls.root = Path(cls.tmp.name)
        cls.data = cls.root / 'primary'
        cls.socket = cls.root / 'socket'
        cls.socket.mkdir()
        cls.secret = cls.root / 'secret'
        cls.secret.write_text('local-test-only-passphrase\n')
        cls.env = dict(os.environ)
        os.environ.update(PGDATA=str(cls.data), BACKUP_GPG_PASSPHRASE_FILE=str(cls.secret),
                          PGDIRECT_URL=f'postgresql:///barghsa?host={cls.socket}&user=postgres',
                          BACKUP_CLUSTER_ID='integration')
        backup.run(['initdb', '-D', str(cls.data), '--auth=trust', '--data-checksums'])
        command = f"python3 {backup.__file__} archive %f %p"
        with (cls.data / 'postgresql.conf').open('a') as config:
            config.write(f"\nlisten_addresses=''\nunix_socket_directories='{cls.socket}'\n"
                         f"archive_mode=on\narchive_command='{command}'\narchive_timeout=60\n")
        backup.run(['pg_ctl', '-D', str(cls.data), '-l', str(cls.root / 'primary.log'), '-w', 'start'])
        cls.sql('CREATE DATABASE barghsa', database='postgres')
        cls.sql('CREATE EXTENSION vector; CREATE EXTENSION postgis; '
                'CREATE TABLE users(id int PRIMARY KEY); INSERT INTO users VALUES (1); '
                'CREATE TABLE orders(id int PRIMARY KEY); CREATE TABLE invoices(id int PRIMARY KEY)')
        tablespace = cls.root / 'live-tablespace'
        tablespace.mkdir()
        cls.sql(f"CREATE TABLESPACE testspace LOCATION '{tablespace}'")
        cls.sql('CREATE TABLE external_data(id int PRIMARY KEY) TABLESPACE testspace; '
                'INSERT INTO external_data VALUES (9)')
        cls.store = backup.Store()
        cls.store.client.create_bucket(Bucket=cls.store.bucket)
        with contextlib.redirect_stdout(io.StringIO()):
            backup.backup(cls.store, 'base')
        cls.base = cls.store.manifests()[0][1]
        cls.sql('INSERT INTO users VALUES (2)')
        cls.target_time = cls.sql('SELECT clock_timestamp()')
        time.sleep(0.05)
        cls.sql('INSERT INTO users VALUES (3)')
        cls.sql('SELECT pg_switch_wal()')
        segment = cls.sql("SELECT pg_walfile_name(pg_current_wal_lsn() - 1)")
        for _ in range(100):
            if any(o['Key'].endswith(f'{segment}.gpg') for o in cls.store.objects('wal/')):
                break
            time.sleep(0.1)
        else:
            raise AssertionError('Archiver did not publish completed WAL')

    @classmethod
    def tearDownClass(cls):
        subprocess.run(['pg_ctl', '-D', str(cls.data), '-m', 'immediate', '-w', 'stop'],
                       capture_output=True)
        os.environ.clear()
        os.environ.update(cls.env)
        cls.tmp.cleanup()

    @classmethod
    def sql(cls, statement, database='barghsa', socket=None):
        result = subprocess.run(['psql', '-XAt', '-v', 'ON_ERROR_STOP=1', '-h', str(socket or cls.socket),
                                 '-U', 'postgres', '-d', database, '-c', statement], capture_output=True, text=True)
        if result.returncode:
            raise AssertionError(result.stderr)
        return result.stdout.strip()

    def prepare(self, name, pitr=None):
        target = self.root / name
        args = argparse.Namespace(target_dir=str(target), backup='base', pitr=pitr)
        with contextlib.redirect_stdout(io.StringIO()):
            backup.restore(self.store, args)
        return target

    def start_clone(self, target):
        socket = target / 'socket'
        socket.mkdir()
        data = target / 'data'
        with (data / 'postgresql.conf').open('a') as config:
            config.write(f"unix_socket_directories='{socket}'\n")
        try:
            backup.run(['pg_ctl', '-D', str(data), '-l', str(target / 'postgres.log'), '-w', 'start'])
        except backup.BackupError:
            print((target / 'postgres.log').read_text()[-5000:])
            raise
        self.addCleanup(lambda: subprocess.run(
            ['pg_ctl', '-D', str(data), '-m', 'immediate', '-w', 'stop'], capture_output=True))
        for _ in range(200):
            try:
                if self.sql('SELECT NOT pg_is_in_recovery()', socket=socket) == 't':
                    break
            except AssertionError:
                pass
            time.sleep(0.1)
        else:
            self.fail((target / 'postgres.log').read_text()[-5000:])
        return socket

    def test_latest_restore_replays_wal_and_preserves_tablespaces(self):
        target = self.prepare('latest')
        socket = self.start_clone(target)
        self.assertEqual(self.sql('SELECT count(*) FROM users', socket=socket), '3')
        self.assertEqual(self.sql('SELECT id FROM external_data', socket=socket), '9')
        self.assertEqual(self.sql('SELECT pg_is_in_recovery()', socket=socket), 'f')
        self.assertEqual(self.sql('SHOW archive_mode', socket=socket), 'off')
        self.assertTrue(list((target / 'data/pg_tblspc').iterdir()))

    def test_point_in_time_excludes_later_commit(self):
        target = self.prepare('pitr', self.target_time)
        socket = self.start_clone(target)
        self.assertEqual(self.sql('SELECT count(*) FROM users', socket=socket), '2')

    def test_existing_restore_target_is_untouched(self):
        target = self.root / 'existing'
        target.mkdir()
        (target / 'keep').write_text('owned')
        with self.assertRaisesRegex(backup.BackupError, 'must not exist'):
            self.prepare('existing')
        self.assertEqual((target / 'keep').read_text(), 'owned')

    def test_wrong_key_never_publishes_restore(self):
        wrong = self.root / 'wrong-key'
        wrong.write_text('wrong passphrase')
        with patch.dict(os.environ, {'BACKUP_GPG_PASSPHRASE_FILE': str(wrong)}):
            with self.assertRaisesRegex(backup.BackupError, 'gpg failed'):
                self.prepare('wrong-key-target')
        self.assertFalse((self.root / 'wrong-key-target').exists())

    def test_manifest_digest_detects_payload_corruption(self):
        altered = dict(self.base, label='corrupt', sha256='0' * 64)
        self.store.put('full/corrupt/manifest.json', json.dumps(altered).encode())
        args = argparse.Namespace(target_dir=str(self.root / 'corrupt'), backup='corrupt', pitr=None)
        try:
            with self.assertRaisesRegex(backup.BackupError, 'checksum mismatch'):
                backup.restore(self.store, args)
        finally:
            self.store.client.delete_object(Bucket=self.store.bucket,
                                            Key=self.store.prefix + 'full/corrupt/manifest.json')
        self.assertFalse((self.root / 'corrupt').exists())

    def test_duplicate_full_label_is_immutable(self):
        with self.assertRaisesRegex(backup.BackupError, 'already exists'):
            backup.backup(self.store, 'base')

    def test_wal_retry_is_idempotent_and_conflict_is_rejected(self):
        source = self.root / 'history'
        source.write_text('1\t0/1000000\tfixture\n')
        backup.archive_wal(self.store, '00000002.history', source)
        backup.archive_wal(self.store, '00000002.history', source)
        source.write_text('different history')
        with self.assertRaisesRegex(backup.BackupError, 'different archived WAL'):
            backup.archive_wal(self.store, '00000002.history', source)
        self.store.client.delete_object(Bucket=self.store.bucket,
            Key=self.store.prefix + f"wal/{self.base['system_id']}/00000002.history.gpg")

    def test_fetch_distinguishes_missing_from_authentication_failure(self):
        args = ['python3', backup.__file__, 'fetch-wal', self.base['system_id'],
                'FFFFFFFF.history', str(self.root / 'missing')]
        result = subprocess.run(args, capture_output=True)
        self.assertEqual(result.returncode, 1, result.stderr)
        with patch.dict(os.environ, {'BACKUP_S3_SECRET_KEY': 'invalid-secret'}):
            result = subprocess.run(args, capture_output=True)
        self.assertEqual(result.returncode, 126, result.stderr)

    def test_authentication_failure_aborts_actual_recovery(self):
        target = self.prepare('denied-recovery')
        data = target / 'data'
        socket = target / 'socket'
        socket.mkdir()
        with (data / 'postgresql.conf').open('a') as config:
            config.write(f"unix_socket_directories='{socket}'\n")
        with patch.dict(os.environ, {'BACKUP_S3_SECRET_KEY': 'invalid-secret'}):
            subprocess.run(['pg_ctl', '-D', str(data), '-l', str(target / 'postgres.log'),
                            '-w', 'start'], capture_output=True)
        self.addCleanup(lambda: subprocess.run(
            ['pg_ctl', '-D', str(data), '-m', 'immediate', '-w', 'stop'], capture_output=True))
        for _ in range(100):
            if subprocess.run(['pg_ctl', '-D', str(data), 'status'], capture_output=True).returncode:
                break
            time.sleep(0.1)
        else:
            self.fail('Recovery survived a storage authentication failure')
        self.assertIn('FATAL:  could not restore file', (target / 'postgres.log').read_text())
        self.assertIn('command not executable', (target / 'postgres.log').read_text())

    def test_retention_preserves_latest_and_required_old_wal(self):
        # Separate prefix; no fabricated timestamp can prune the replay fixture.
        with patch.dict(os.environ, {'BACKUP_CLUSTER_ID': 'retention'}):
            store = backup.Store()
        now = backup.utcnow()
        for label, age in [('expired', 40), ('latest', 20)]:
            meta = dict(self.base, label=label, blob=f"blobs/{age:032x}.tar.gpg",
                        started_at=(now - timedelta(days=age)).isoformat(),
                        completed_at=(now - timedelta(days=age)).isoformat())
            store.put(f'full/{label}/manifest.json', json.dumps(meta).encode())
            store.put(meta['blob'], b'ciphertext-fixture')
        sid = self.base['system_id']
        store.put(f'wal/{sid}/000000010000000000000001.gpg', b'required-wal')
        store.put(f'wal/{sid}/00000002.history.gpg', b'history')
        with contextlib.redirect_stdout(io.StringIO()):
            backup.prune(store, now + timedelta(days=10))
        self.assertEqual([m['label'] for _, m in store.manifests()], ['latest'])
        self.assertEqual(len(list(store.objects(f'wal/{sid}/'))), 2)


if __name__ == '__main__':
    unittest.main(verbosity=2)
