from contextlib import redirect_stderr
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location(
    'check_promotion', Path(__file__).with_name('check-promotion.py')
)
promotion = importlib.util.module_from_spec(spec)
spec.loader.exec_module(promotion)
SHA = 'a' * 40


class PromotionEvidenceTest(unittest.TestCase):
    def test_blocks_earlier_milestone_before_querying_remote_services(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / 'package.json').write_text('{"version":"0.6.0"}')
            argv = ['check-promotion.py', '--ci-run', '1', '--browser-run', '2',
                    '--receipt-index', str(root / 'receipt-index.json')]
            errors = io.StringIO()
            with patch.object(promotion, 'ROOT', root), patch.object(sys, 'argv', argv), \
                    patch.object(promotion, 'command', side_effect=['', SHA]) as command, \
                    redirect_stderr(errors):
                self.assertEqual(promotion.main(), 1)
            self.assertEqual(command.call_count, 2)
            self.assertIn('immutable v0.9.0 first-launch candidate', errors.getvalue())

    def test_requires_exact_successful_manual_workflow(self):
        expected = {
            'path': '.github/workflows/ci.yml',
            'repository': {'full_name': promotion.REPO},
            'head_repository': {'full_name': promotion.REPO},
            'head_sha': SHA,
            'event': 'workflow_dispatch',
            'status': 'completed',
            'conclusion': 'success',
            'html_url': 'https://github.com/barghsadev/barghsa-core/actions/runs/1',
        }
        with patch.object(promotion, 'command', return_value=json.dumps(expected)):
            self.assertEqual(promotion.verify_workflow(1, expected['path'], SHA), expected['html_url'])
        for key, value in [
            ('path', '.github/workflows/browser-nightly.yml'),
            ('head_repository', {'full_name': 'another/repository'}),
            ('head_sha', 'b' * 40),
            ('event', 'push'),
            ('status', 'in_progress'),
            ('conclusion', 'failure'),
        ]:
            with self.subTest(key=key), patch.object(
                promotion, 'command', return_value=json.dumps({**expected, key: value})
            ), self.assertRaisesRegex(ValueError, 'successful manual'):
                promotion.verify_workflow(1, expected['path'], SHA)

    def test_refuses_skipped_license_step(self):
        jobs = [
            {'name': name, 'conclusion': 'success',
             'steps': [{'name': step, 'conclusion': 'success'}]}
            for name, step in (
                ('Run tests', 'Run affected tests or full coverage'),
                ('Scan runtime container images', 'Check shipped component licenses'),
                ('Verify combined source coverage', 'Enforce changed source and critical file coverage'),
            )
        ]
        with patch.object(promotion, 'command', return_value=json.dumps({'jobs': jobs})):
            promotion.verify_ci_checks(1)
        jobs[1]['steps'][0]['conclusion'] = 'skipped'
        with patch.object(promotion, 'command', return_value=json.dumps({'jobs': jobs})):
            with self.assertRaisesRegex(ValueError, 'enforced licenses'):
                promotion.verify_ci_checks(1)

    def test_requires_every_browser_shard_without_unexplained_flakes(self):
        with tempfile.TemporaryDirectory() as temporary, patch.object(promotion, 'command'):
            directory = Path(temporary)
            report = directory / 'nightly-browser-summary.json'
            valid = {
                'schema_version': 1, 'status': 'passed', 'expected_shards': 40,
                'reported_shards': 40, 'missing_or_invalid_shards': [], 'failed_shards': [],
                'counts': {'expected': 100, 'unexpected': 0, 'flaky': 0, 'runner_errors': 0},
            }
            report.write_text(json.dumps(valid))
            self.assertEqual(promotion.verify_browser_rollup(1, directory), valid['counts'])
            for changed in [
                {'reported_shards': 39},
                {'missing_or_invalid_shards': ['one-shard']},
                {'counts': {**valid['counts'], 'flaky': 1}},
            ]:
                report.write_text(json.dumps({**valid, **changed}))
                with self.assertRaisesRegex(ValueError, 'all 40 shards'):
                    promotion.verify_browser_rollup(1, directory)

    def test_requires_exact_healthy_staging_readback(self):
        live = {'version': '0.9.0', 'commit': SHA}
        with patch.object(promotion, 'staging_response', side_effect=[live, {'status': 'ok'}]):
            promotion.verify_staging('0.9.0', SHA)
        with patch.object(promotion, 'staging_response', return_value={**live, 'commit': 'b' * 40}):
            with self.assertRaisesRegex(ValueError, 'different candidate'):
                promotion.verify_staging('0.9.0', SHA)
        with patch.object(promotion, 'staging_response', side_effect=[live, {'status': 'degraded'}]):
            with self.assertRaisesRegex(ValueError, 'must be healthy'):
                promotion.verify_staging('0.9.0', SHA)

    def test_hashes_all_receipts_and_refuses_missing_or_escaped_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            directory = root / 'protected'
            directory.mkdir()
            index = directory / 'receipt-index.json'
            evidence = b'controlled test evidence'
            (directory / 'proof').write_bytes(evidence)
            (root / 'outside').write_bytes(evidence)
            (directory / 'link').symlink_to(root / 'outside')
            receipts = dict.fromkeys(promotion.OPERATIONAL_RECEIPTS, 'proof')
            data = {'candidate_sha': SHA, 'receipts': receipts}
            index.write_text(json.dumps(data))
            paths, digests = promotion.index_receipts(index, SHA)
            self.assertEqual(paths, dict.fromkeys(receipts, (directory / 'proof').resolve()))
            self.assertEqual(digests, dict.fromkeys(receipts, hashlib.sha256(evidence).hexdigest()))
            for path in ('missing', '../outside', 'link'):
                index.write_text(json.dumps({
                    **data, 'receipts': {**receipts, 'authenticated_dast': path},
                }))
                with self.assertRaisesRegex(ValueError, 'invalid receipt'):
                    promotion.index_receipts(index, SHA)


class StructuredReceiptTest(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name).resolve()
        self.index = self.root / 'receipt-index.json'
        self.bundle = self.root / 'bundle.json'
        self.now = datetime(2026, 11, 12, 8, tzinfo=timezone.utc).timestamp()
        self.completed = self.now - 3600

    def write_bundle(self, entries):
        paths = {}
        for name, value in entries.items():
            paths[name] = name + '.json'
            (self.root / paths[name]).write_text(json.dumps(value))
        self.bundle.write_text(json.dumps(paths))
        return hashlib.sha256(self.bundle.read_bytes()).hexdigest()

    def backup(self):
        def at(seconds):
            return datetime.fromtimestamp(seconds, timezone.utc).isoformat()

        label = '2026-11-12T06:58:00Z'
        older = '2026-11-09T01:00:00Z'
        manifest = {'version': 1, 'label': label, 'system_id': '12345', 'blob': f'blobs/{"a" * 32}.tar.gpg',
                    'size': 100, 'sha256': 'b' * 64, 'started_at': at(self.completed - 120),
                    'completed_at': at(self.completed)}
        report = {'status': 'passed', 'scope': 'database_restore', 'backup': older, 'rpo_seconds': 300,
                  'database_rto_seconds': 3600, 'core_service_rto_seconds': None,
                  'started_at': '2026-11-09T03:00:00Z', 'replayed_transaction_time': '2026-11-09T02:00:00Z',
                  'tables': {table: {'count': 2, 'sha256': 'c' * 64} for table in ('users', 'orders', 'invoices')}}
        return {
            'backup_job': {'status': 'passed', 'phase': 'retention', 'backup': label,
                           'started_at': at(self.completed - 121)},
            'backup_manifest': manifest,
            'restore_manifest': {**manifest, 'label': older, 'started_at': older, 'completed_at': '2026-11-09T01:05:00Z'},
            'restore_report': report,
        }

    def test_backup_requires_fresh_success_and_a_verified_restore_for_the_same_database(self):
        entries = self.backup()
        fingerprint = self.write_bundle(entries)
        result = promotion.verify_backup_receipts(self.index, self.bundle, fingerprint, self.now)
        self.assertEqual(result['backup_age_seconds'], 3600)
        self.assertEqual(result['rpo_seconds'], 300)
        self.assertEqual(result['database_rto_seconds'], 3600)
        self.assertEqual(set(result['sha256']), set(entries))
        with self.assertRaisesRegex(ValueError, 'less than 24 hours'):
            promotion.verify_backup_receipts(self.index, self.bundle, fingerprint, self.completed + 86400)

        for artifact, field, value, expected in (
            ('backup_job', 'status', 'failed', 'successful verified backup'),
            ('backup_manifest', 'sha256', 'invalid', 'manifest is invalid'),
            ('restore_manifest', 'system_id', '23456', 'same database system'),
            ('restore_manifest', 'started_at', '2026-11-09T02:00:00Z', 'same database system'),
            ('restore_report', 'rpo_seconds', 300.001, 'recovery limits'),
            ('restore_report', 'database_rto_seconds', None, 'recovery limits'),
            ('restore_report', 'tables', {}, 'table fingerprints'),
        ):
            with self.subTest(field=field):
                bad = deepcopy(entries)
                bad[artifact][field] = value
                fingerprint = self.write_bundle(bad)
                with self.assertRaisesRegex(ValueError, expected):
                    promotion.verify_backup_receipts(self.index, self.bundle, fingerprint, self.now)

    def release(self):
        (self.root / 'package.json').write_text('{"version":"0.9.0"}')
        notes = 'برقسا نسخه 0.9.0\n- رسیدهای انتشار'
        (self.root / 'releases').mkdir()
        (self.root / 'releases/0.9.0.md').write_text(notes + '\n')
        notifier = self.root / 'deploy/staging/notify-release.py'
        notifier.parent.mkdir(parents=True)
        notifier.write_bytes((promotion.ROOT / 'deploy/staging/notify-release.py').read_bytes())
        text = f'{notes}\n\nمحیط آزمایشی: {promotion.STAGING}\nشناسه کد: {SHA}'
        identity = {'version': '0.9.0', 'commit': SHA}
        received = {**identity, 'status': 'sent', 'chat_id': promotion.RELEASE_CHAT_ID}
        photos = ['c' * 64, 'd' * 64]
        return {
            'deployment': {**identity, 'phase': 'completed', 'live_release': identity,
                           'completed_at': '2026-01-01T01:00:00Z', 'screenshots': [name + '.png' for name in photos]},
            'summary': {**received, 'message_id': 100, 'text_sha256': hashlib.sha256(text.encode()).hexdigest()},
            'album': {**received, 'message_ids': [101, 102], 'media_group_id': 'one-album', 'photo_sha256': photos},
        }

    def verify_release(self, entries):
        fingerprint = self.write_bundle(entries)
        with patch.object(promotion, 'ROOT', self.root):
            return promotion.verify_release_receipts(self.index, self.bundle, fingerprint, '0.9.0', SHA)

    def test_requires_confirmed_channel_messages_and_exact_deployed_notes_and_album(self):
        entries = self.release()
        verified = self.verify_release(entries)
        self.assertEqual(verified['summary_message_id'], 100)
        self.assertEqual(verified['image_message_ids'], [101, 102])
        self.assertEqual(set(verified['sha256']), set(entries))
        for artifact, field, value in (
            ('deployment', 'phase', 'failed'), ('deployment', 'live_release', {'commit': 'b' * 40}),
            ('summary', 'chat_id', -1000000000000), ('summary', 'status', 'unknown'),
            ('summary', 'text_sha256', 'a' * 64), ('album', 'message_ids', [100, 102]),
            ('album', 'media_group_id', ''), ('album', 'photo_sha256', ['c' * 64, 'e' * 64]),
        ):
            with self.subTest(field=field):
                bad = deepcopy(entries)
                bad[artifact][field] = value
                with self.assertRaises(ValueError):
                    self.verify_release(bad)

    def test_unconfirmed_optional_album_is_explicit_and_never_replaces_summary(self):
        entries = self.release()
        entries.pop('album')
        with self.assertRaisesRegex(ValueError, 'screenshot receipt'):
            self.verify_release(entries)
        entries['deployment']['screenshot_warning'] = {'exit_code': 1, 'message': 'Image delivery unconfirmed'}
        verified = self.verify_release(entries)
        self.assertTrue(verified['album_unconfirmed'])
        self.assertEqual(verified['image_message_ids'], [])
        entries['summary']['status'] = 'unknown'
        with self.assertRaisesRegex(ValueError, 'summary receipt'):
            self.verify_release(entries)


if __name__ == '__main__':
    unittest.main()

