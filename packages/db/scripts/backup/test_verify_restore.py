import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import physical_backup as backup
import test_physical_backup as fixtures
import verify_restore as verify
import run_backup_job as job


class RestoreEvidenceTests(unittest.TestCase):
    def test_backup_job_never_prunes_after_failed_backup(self):
        with patch.object(job, 'Store'), patch.object(job, 'backup', side_effect=backup.BackupError('backup failed')), \
                patch.object(job, 'prune') as prune, patch.object(job, 'alert', return_value='accepted') as alert:
            result = job.run_job()
        prune.assert_not_called()
        alert.assert_called_once()
        self.assertEqual(result['phase'], 'backup')
        self.assertEqual(result['status'], 'failed')

    def test_backup_job_reports_retention_failure(self):
        with patch.object(job, 'Store'), patch.object(job, 'backup', side_effect=lambda *args: print('{"label":"test"}')), \
                patch.object(job, 'prune', side_effect=backup.BackupError('retention failed')), \
                patch.object(job, 'alert', return_value='accepted'):
            result = job.run_job()
        self.assertEqual(result['phase'], 'retention')
        self.assertEqual(result['backup'], 'test')
        self.assertEqual(result['status'], 'failed')

    def test_backup_job_success_prunes_without_alert(self):
        with patch.object(job, 'Store'), patch.object(job, 'backup', side_effect=lambda *args: print('{"label":"test"}')), \
                patch.object(job, 'prune') as prune, patch.object(job, 'alert') as alert:
            result = job.run_job()
        prune.assert_called_once()
        alert.assert_not_called()
        self.assertEqual(result['status'], 'passed')

    def test_limits_are_inclusive_and_unknown_is_failure(self):
        reference = '2026-09-13T12:05:00Z'
        self.assertEqual(verify.check_limits('2026-09-13T12:00:00Z', reference, 3600), 300)
        for replay, elapsed in [(None, 10), ('2026-09-13T11:59:59Z', 10),
                                ('2026-09-13T12:05:00Z', 3600.01)]:
            with self.subTest(replay=replay, elapsed=elapsed), self.assertRaises(backup.BackupError):
                verify.check_limits(replay, reference, elapsed)

    def test_workspace_preserves_files_when_database_may_be_running(self):
        with tempfile.TemporaryDirectory() as parent:
            with verify.workspace(parent) as root:
                data = root / 'candidate/data'
                data.mkdir(parents=True)
                (data / 'postmaster.pid').write_text('fixture')
            self.assertTrue(data.exists())
            shutil.rmtree(root)
            with verify.workspace(parent) as clean:
                (clean / 'owned').touch()
            self.assertFalse(clean.exists())

    def test_missing_baseline_fails_before_restore(self):
        args = argparse.Namespace(baseline=None, work_dir=None, pitr=None, sql_file=None)
        with patch.object(verify, 'restore') as restore:
            result = verify.exercise(args)
        self.assertEqual(result['status'], 'failed')
        self.assertIsNone(result['rpo_seconds'])
        restore.assert_not_called()

    def test_alert_records_local_receiver_failure_and_acceptance(self):
        with tempfile.TemporaryDirectory() as tmp:
            receiver = Path(tmp) / 'receive'
            received = Path(tmp) / 'result.json'
            receiver.write_text(f'#!/bin/sh\ncat > "{received}"\nexit 0\n')
            receiver.chmod(0o700)
            with patch.dict(os.environ, {'VERIFY_ALERT_EXECUTABLE': str(receiver)}):
                self.assertEqual(verify.alert({'status': 'failed'}), 'accepted')
                self.assertEqual(json.loads(received.read_text())['status'], 'failed')
                receiver.write_text('#!/bin/sh\nexit 1\n')
                self.assertEqual(verify.alert({'status': 'failed'}), 'failed')
            with patch.dict(os.environ, {'VERIFY_ALERT_EXECUTABLE': ''}):
                self.assertEqual(verify.alert({'status': 'failed'}), 'not_configured')


class RestoreExerciseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture = fixtures.PhysicalBackupIntegrationTests
        cls.fixture.setUpClass()
        cls.baseline = cls.fixture.root / 'baseline.json'
        verify.capture(cls.baseline, cls.fixture.target_time)

    @classmethod
    def tearDownClass(cls):
        cls.fixture.tearDownClass()

    def args(self, path=None, sql_file=None):
        return argparse.Namespace(baseline=str(path or self.baseline),
                                  work_dir=str(self.fixture.root), pitr=None, sql_file=sql_file)

    def test_real_restore_replay_fingerprints_and_cleanup(self):
        with patch.dict(os.environ, {'VERIFY_PG_USER': 'postgres', 'PGHOSTADDR': '192.0.2.1',
                                    'PGSERVICE': 'must-not-be-used', 'PGSERVICEFILE': '/missing-service'}):
            result = verify.exercise(self.args())
        self.assertEqual(result['status'], 'passed', result)
        self.assertEqual(result['tables']['users']['count'], 3)
        self.assertEqual(result['rpo_seconds'], 0)
        self.assertGreater(result['database_rto_seconds'], 0)
        self.assertIsNone(result['core_service_rto_seconds'])
        self.assertEqual(list(self.fixture.root.glob('barghsa-exercise-*')), [])

    def test_limit_failure_keeps_measured_rpo(self):
        with patch.dict(os.environ, {'VERIFY_PG_USER': 'postgres'}), patch.object(verify, 'check_limits', side_effect=backup.BackupError('threshold exceeded')):
            result = verify.exercise(self.args())
        self.assertEqual(result['status'], 'failed')
        self.assertEqual(result['rpo_seconds'], 0)
        self.assertGreater(result['database_rto_seconds'], 0)
        self.assertEqual(result['error'], 'threshold exceeded')

    def test_equal_counts_do_not_hide_changed_rows(self):
        value = json.loads(self.baseline.read_text())
        value['tables']['users']['sha256'] = '0' * 64
        changed = self.fixture.root / 'changed.json'
        changed.write_text(json.dumps(value))
        with patch.dict(os.environ, {'VERIFY_PG_USER': 'postgres'}):
            result = verify.exercise(self.args(changed))
        self.assertEqual(result['status'], 'failed', result)
        self.assertIn('fingerprints differ', result['error'])
        self.assertEqual(result['tables']['users']['count'], value['tables']['users']['count'])

    def test_nonzero_assertion_and_sql_errors_fail(self):
        sql = self.fixture.root / 'assertions.sql'
        for statement in ['SELECT 1;', 'SELECT 1/0;']:
            with self.subTest(statement=statement):
                sql.write_text(statement)
                with patch.dict(os.environ, {'VERIFY_PG_USER': 'postgres'}):
                    result = verify.exercise(self.args(sql_file=str(sql)))
                self.assertEqual(result['status'], 'failed', result)

    def test_cli_failure_emits_result_and_preserves_parent(self):
        marker = self.fixture.root / 'user-owned'
        marker.write_text('keep')
        env = {**os.environ, 'VERIFY_ALERT_EXECUTABLE': '', 'VERIFY_PG_USER': 'postgres'}
        result = subprocess.run(['bash', '/opt/backup/verify-restore.sh', '--work-dir',
                                 str(self.fixture.root), '--baseline', '/missing-baseline'],
                                env=env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 1, result.stderr)
        report = json.loads(result.stdout)
        self.assertEqual(report['status'], 'failed')
        self.assertEqual(report['alert'], 'not_configured')
        self.assertEqual(marker.read_text(), 'keep')


if __name__ == '__main__':
    unittest.main(verbosity=2)
