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
            self.assertEqual(promotion.verify_workflow(1, expected['path'], SHA), expected)
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
        with tempfile.TemporaryDirectory() as temporary, patch.object(promotion, 'command') as command:
            directory = Path(temporary)
            report = directory / 'nightly-browser-summary.json'
            valid = {
                'schema_version': 1, 'status': 'passed', 'expected_shards': 40,
                'commit': SHA, 'run_id': 1, 'run_attempt': 2,
                'reported_shards': 40, 'missing_or_invalid_shards': [], 'failed_shards': [],
                'counts': {'expected': 100, 'unexpected': 0, 'flaky': 0, 'skipped': 0, 'runner_errors': 0},
            }
            report.write_text(json.dumps(valid))
            self.assertEqual(promotion.verify_browser_rollup(1, directory, SHA, 2), valid['counts'])
            self.assertIn('nightly-browser-summary-attempt-2', command.call_args.args)
            for changed in [
                {'reported_shards': 39},
                {'missing_or_invalid_shards': ['one-shard']},
                {'counts': {**valid['counts'], 'flaky': 1}},
                {'counts': {**valid['counts'], 'expected': True}},
                {'counts': {**valid['counts'], 'skipped': -1}},
            ]:
                report.write_text(json.dumps({**valid, **changed}))
                with self.assertRaisesRegex(ValueError, 'all 40 shards'):
                    promotion.verify_browser_rollup(1, directory, SHA, 2)
            for changed in [{'commit': 'b' * 40}, {'run_id': 2}, {'run_attempt': 1}, {'run_id': True}]:
                report.write_text(json.dumps({**valid, **changed}))
                with self.assertRaisesRegex(ValueError, 'candidate, run and attempt'):
                    promotion.verify_browser_rollup(1, directory, SHA, 2)
            with self.assertRaisesRegex(ValueError, 'attempt is missing or invalid'):
                promotion.verify_browser_rollup(1, directory, SHA, None)

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
                  'database_rto_seconds': 3300, 'core_service_rto_seconds': None,
                  'started_at': '2026-11-09T03:00:00Z', 'replayed_transaction_time': '2026-11-09T02:00:00Z',
                  'tables': {table: {'count': 2, 'sha256': 'c' * 64} for table in ('users', 'orders', 'invoices')}}
        checks = {}
        for name in promotion.CORE_RECOVERY_CHECKS:
            path = self.root / f'{name}.log'
            path.write_text(f'Controlled {name} recovery evidence\n')
            checks[name] = {'status': 'passed', 'verified_at': '2026-11-09T03:59:00Z',
                            'evidence': path.name, 'evidence_sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
        return {
            'backup_job': {'status': 'passed', 'phase': 'retention', 'backup': label,
                           'started_at': at(self.completed - 121)},
            'backup_manifest': manifest,
            'restore_manifest': {**manifest, 'label': older, 'started_at': older, 'completed_at': '2026-11-09T01:05:00Z'},
            'restore_report': report,
            'core_service_report': {
                'status': 'passed', 'scope': 'core_service_recovery', 'candidate_sha': SHA,
                'database_restore_sha256': hashlib.sha256(json.dumps(report).encode()).hexdigest(),
                'started_at': '2026-11-09T03:00:00Z', 'completed_at': '2026-11-09T04:00:00Z',
                'checks': checks,
            },
        }

    def test_backup_requires_fresh_success_and_a_verified_restore_for_the_same_database(self):
        entries = self.backup()
        fingerprint = self.write_bundle(entries)
        result = promotion.verify_backup_receipts(self.index, self.bundle, fingerprint, self.now, SHA)
        self.assertEqual(result['backup_age_seconds'], 3600)
        self.assertEqual(result['rpo_seconds'], 300)
        self.assertEqual(result['database_rto_seconds'], 3300)
        self.assertEqual(result['core_service_rto_seconds'], 3600)
        self.assertEqual(set(result['sha256']), set(entries))
        with self.assertRaisesRegex(ValueError, 'less than 24 hours'):
            promotion.verify_backup_receipts(self.index, self.bundle, fingerprint, self.completed + 86400, SHA)

        for artifact, field, value, expected in (
            ('backup_job', 'status', 'failed', 'successful verified backup'),
            ('backup_manifest', 'sha256', 'invalid', 'manifest is invalid'),
            ('restore_manifest', 'system_id', '23456', 'same database system'),
            ('restore_manifest', 'started_at', '2026-11-09T02:00:00Z', 'same database system'),
            ('restore_report', 'rpo_seconds', 300.001, 'recovery limits'),
            ('restore_report', 'database_rto_seconds', None, 'recovery limits'),
            ('restore_report', 'tables', {}, 'table fingerprints'),
            ('core_service_report', 'candidate_sha', 'b' * 40, 'identify this candidate'),
            ('core_service_report', 'database_restore_sha256', 'd' * 64, 'identify this candidate'),
            ('core_service_report', 'completed_at', '2026-11-09T04:00:00.001Z', '60-minute limit'),
        ):
            with self.subTest(field=field):
                bad = deepcopy(entries)
                bad[artifact][field] = value
                fingerprint = self.write_bundle(bad)
                with self.assertRaisesRegex(ValueError, expected):
                    promotion.verify_backup_receipts(self.index, self.bundle, fingerprint, self.now, SHA)

    def test_requires_core_recovery_journeys_and_their_original_evidence(self):
        entries = self.backup()
        core = entries.pop('core_service_report')
        fingerprint = self.write_bundle(entries)
        with self.assertRaisesRegex(ValueError, 'structured receipt index'):
            promotion.verify_backup_receipts(self.index, self.bundle, fingerprint, self.now, SHA)
        entries['core_service_report'] = core
        for name, field, value, message in (
            ('saving', 'status', 'failed', 'did not pass'),
            ('solar', 'verified_at', '2026-11-09T03:50:00Z', 'before service journeys'),
            ('electricity', 'evidence', '../outside.log', 'invalid receipt'),
            ('consultation', 'evidence_sha256', 'e' * 64, 'evidence file changed'),
        ):
            with self.subTest(check=name):
                bad = deepcopy(entries)
                bad['core_service_report']['checks'][name][field] = value
                fingerprint = self.write_bundle(bad)
                with self.assertRaisesRegex(ValueError, message):
                    promotion.verify_backup_receipts(self.index, self.bundle, fingerprint, self.now, SHA)

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
            result, _ = promotion.verify_release_receipts(self.index, self.bundle, fingerprint, '0.9.0', SHA)
            return result

    def test_promotion_binds_staged_image_ids_to_scan_and_registry_evidence(self):
        job = self.release()['deployment']
        ids = {scope: 'sha256:' + digit * 64
               for scope, digit in zip(('app', 'web', 'postgres', 'clamav'), 'abcd')}
        registry = {'candidate_sha': SHA, 'images': {
            scope: {'manifest_digest': 'sha256:' + digit * 64, 'image_id': ids[scope]}
            for scope, digit in zip(('app', 'web', 'clamav'), 'ef0')
        }}
        for scopes in (('app', 'web'), ('postgres', 'clamav', 'app', 'web')):
            with self.subTest(scopes=scopes):
                directory = self.root / 'scans'
                directory.mkdir(exist_ok=True)
                scans = {}
                for index, scope in enumerate(scopes, 1):
                    raw = b'fixture artifact'
                    for suffix in ('vulnerabilities.json', 'sbom.cdx.json'):
                        (directory / f'{index}-{suffix}').write_bytes(raw)
                    receipt = json.dumps({'image_id': ids[scope], 'blocked': False,
                                          'report_sha256': hashlib.sha256(raw).hexdigest(),
                                          'sbom_sha256': hashlib.sha256(raw).hexdigest()}).encode()
                    (directory / f'{index}-image.json').write_bytes(receipt)
                    scans[scope] = {'index': index, 'receipt_sha256': hashlib.sha256(receipt).hexdigest()}
                licensed = {('postgres-staging' if scope == 'postgres' else scope): ids[scope] for scope in scopes}
                report = {'commit': SHA, 'images': licensed, 'packages': [
                    {'scope': scope, 'status': 'allowed'} for scope in (*licensed, 'browser')
                ]}
                path = directory / 'release-licenses.json'
                raw_report = json.dumps(report).encode()
                path.write_bytes(raw_report)
                job['runtime_images'] = {'schema_version': 1, 'commit': SHA, 'image_ids': ids,
                                         'image_scans': {'directory': '/worker/scans', 'images': scans},
                                         'license_sha256': hashlib.sha256(raw_report).hexdigest()}
                bundle = {'staging_scans': {'directory': 'scans'}, 'production_registry': registry}
                retained_path = None
                if 'postgres' not in scopes:
                    retained = self.root / 'retained'
                    retained.mkdir()
                    retained_index = {}
                    for index, scope in enumerate(('postgres', 'clamav'), 1):
                        for suffix in ('vulnerabilities.json', 'sbom.cdx.json'):
                            (retained / f'{index}-{suffix}').write_bytes(raw)
                        receipt = json.dumps({
                            'image_id': ids[scope], 'blocked': False,
                            'report_sha256': hashlib.sha256(raw).hexdigest(),
                            'sbom_sha256': hashlib.sha256(raw).hexdigest(),
                        }).encode()
                        (retained / f'{index}-image.json').write_bytes(receipt)
                        retained_index[scope] = {'index': index, 'receipt_sha256': hashlib.sha256(receipt).hexdigest()}
                    indexed = json.dumps(retained_index, sort_keys=True).encode()
                    retained_ids = {'postgres-staging': ids['postgres'], 'clamav': ids['clamav']}
                    retained_path = retained / 'release-licenses.json'
                    retained_report = json.dumps({'commit': SHA, 'images': retained_ids, 'packages': [
                        {'scope': scope, 'status': 'approved'} for scope in retained_ids
                    ]}).encode()
                    retained_path.write_bytes(retained_report)
                    job['runtime_images'].update(
                        retained_image_scans={'directory': '/worker/retained', 'images': retained_index,
                                              'sha256': hashlib.sha256(indexed).hexdigest()},
                        retained_license_sha256=hashlib.sha256(retained_report).hexdigest())
                    bundle['staging_scans']['retained_directory'] = 'retained'
                fingerprint = self.write_bundle(bundle)
                result = promotion.verify_image_receipts(self.index, self.bundle, fingerprint, job, SHA)
                self.assertEqual(result['image_ids'], ids)
                self.assertEqual(result['scanned_images'], scans)
                self.assertEqual(result['production_registry'], registry['images'])
                if retained_path is not None:
                    self.assertEqual(result['retained_license_sha256'], hashlib.sha256(retained_report).hexdigest())
                    retained_path.write_bytes(retained_report + b' ')
                    with self.assertRaisesRegex(ValueError, 'Retained license report differs'):
                        promotion.verify_image_receipts(self.index, self.bundle, fingerprint, job, SHA)
                    retained_path.write_bytes(retained_report)
                    original_index = job['runtime_images'].pop('retained_image_scans')
                    with self.assertRaisesRegex(ValueError, 'Retained scan receipts differ'):
                        promotion.verify_image_receipts(self.index, self.bundle, fingerprint, job, SHA)
                    job['runtime_images']['retained_image_scans'] = original_index
                for suffix in ('image.json', 'sbom.cdx.json', 'vulnerabilities.json'):
                    with self.subTest(suffix=suffix):
                        artifact = directory / f'1-{suffix}'
                        original = artifact.read_bytes()
                        artifact.write_bytes(original + b' ')
                        with self.assertRaises(ValueError):
                            promotion.verify_image_receipts(self.index, self.bundle, fingerprint, job, SHA)
                        artifact.write_bytes(original)
                path.write_bytes(raw_report + b' ')
                with self.assertRaisesRegex(ValueError, 'license report differs'):
                    promotion.verify_image_receipts(self.index, self.bundle, fingerprint, job, SHA)
                path.write_bytes(raw_report)
                for field, value in (('image_id', ids['web']), ('manifest_digest', 'latest')):
                    invalid_registry = deepcopy(bundle)
                    invalid_registry['production_registry']['images']['app'][field] = value
                    invalid = self.write_bundle(invalid_registry)
                    with self.assertRaisesRegex(ValueError, 'registry image differs'):
                        promotion.verify_image_receipts(self.index, self.bundle, invalid, job, SHA)
                fingerprint = self.write_bundle(bundle)
                with self.assertRaisesRegex(ValueError, 'missing verified runtime images'):
                    promotion.verify_image_receipts(self.index, self.bundle, fingerprint, {}, SHA)

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

