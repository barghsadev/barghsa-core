from contextlib import redirect_stderr
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import runpy
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
                    '--load-run', '3',
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

    @staticmethod
    def load_report():
        return {
            'source': SHA, 'environment': 'isolated-load', 'concurrency': 8,
            'requestedSamples': 1000, 'warmupIterations': 0, 'failedChecks': 0,
            'dataset': {'customerAccounts': 1000, 'backgroundProfiles': 5000,
                        'seededInvoices': 13000, 'operationsRecipients': 3, 'clientAddresses': 50},
            'operations': [
                {'operation': name, 'completed': 1000, 'budgetP95Ms': budget,
                 'regressionThresholdMs': budget * 1.2, 'p50Ms': 50, 'p95Ms': 100, 'p99Ms': 160,
                 'withinBudget': True, 'regression': False}
                for name, budget in promotion.LOAD_P95_BUDGETS.items()
            ],
            'durableCounts': {'orders': 1000, 'paid': 1000, 'debits': 1000, 'reservations': 1000,
                              'alerts': 1000, 'alerts_enqueued': 3000, 'invoice_client_addresses': 50},
        }

    def test_load_receipt_requires_full_candidate_run_and_database_outcomes(self):
        report = self.load_report()
        self.assertEqual(promotion.verify_load_report(report, SHA)['samples_per_operation'], 1000)
        for changed, reason in (
            ({'source': 'b' * 40}, 'match the candidate'),
            ({'requestedSamples': 4}, 'full isolated workload'),
            ({'dataset': {**report['dataset'], 'backgroundProfiles': 12}}, 'full isolated workload'),
            ({'failedChecks': False}, 'full isolated workload'),
            ({'operations': report['operations'][:-1]}, 'all seven'),
            ({'operations': [report['operations'][0], *report['operations'][:-1]]}, 'all seven'),
            ({'durableCounts': {**report['durableCounts'], 'debits': 999}}, 'durable database outcomes'),
        ):
            with self.subTest(changed=changed), self.assertRaisesRegex(ValueError, reason):
                promotion.verify_load_report({**report, **changed}, SHA)
        for changed in ({'completed': 999}, {'p95Ms': 300, 'p99Ms': 400},
                        {'p99Ms': None}, {'p99Ms': float('inf')}, {'withinBudget': False}):
            invalid = deepcopy(report)
            invalid['operations'][0].update(changed)
            with self.subTest(changed=changed), self.assertRaisesRegex(ValueError, 'strict latency'):
                promotion.verify_load_report(invalid, SHA)

    def test_performance_receipt_requires_original_hosted_bytes_and_separate_rehearsal(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            downloads = root / 'download'
            downloads.mkdir()
            report = json.dumps(self.load_report())
            (root / 'isolated.json').write_text(report)
            artifact = downloads / 'barghsa-performance.json'
            artifact.write_text(report)
            evidence = root / 'measured-rehearsal.json'
            evidence.write_text('{"fixture":"production-equivalent"}')
            rehearsal = root / 'rehearsal.json'
            details = {'scope': 'production_equivalent_load', 'candidate_sha': SHA,
                       'evidence': evidence.name, 'evidence_sha256': promotion.file_digest(evidence)}
            rehearsal.write_text(json.dumps(details))
            index = root / 'performance.json'
            index.write_text(json.dumps({'isolated_load_report': 'isolated.json',
                                         'production_equivalent_report': rehearsal.name}))

            def check():
                return promotion.verify_performance_receipts(
                    root / 'receipt-index.json', index, promotion.file_digest(index), SHA, 3, downloads)

            run_url = 'https://github.com/barghsadev/barghsa-core/actions/runs/3'
            with patch.object(promotion, 'verify_workflow', return_value={'html_url': run_url}) as workflow, \
                    patch.object(promotion, 'command') as command:
                verified = check()
                self.assertEqual(verified['hosted_run'], run_url)
                self.assertEqual(verified['sha256']['production_equivalent_evidence'], details['evidence_sha256'])
                workflow.assert_called_once_with(3, '.github/workflows/load-weekly.yml', SHA)
                self.assertIn('weekly-load-report', command.call_args.args)
                artifact.write_text(report + '\n')
                with self.assertRaisesRegex(ValueError, 'differs from the hosted run'):
                    check()
                artifact.write_text(report)
                for changed in ({'candidate_sha': 'b' * 40}, {'scope': 'isolated-load'}):
                    rehearsal.write_text(json.dumps({**details, **changed}))
                    with self.assertRaisesRegex(ValueError, 'must identify the candidate'):
                        check()
                rehearsal.write_text(json.dumps(details))
                evidence.write_text('{"fixture":"different"}')
                with self.assertRaisesRegex(ValueError, 'load evidence changed'):
                    check()
                evidence.write_text(report)
                rehearsal.write_text(json.dumps({**details, 'evidence_sha256': promotion.file_digest(evidence)}))
                with self.assertRaisesRegex(ValueError, 'requires independent evidence'):
                    check()

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
        checks = {name: {'status': 'ok'} for name in ('postgresql', 'redis', 'objectStorage')}
        ready = {'status': 'ok', 'commit': SHA, 'checks': checks}
        with patch.object(promotion, 'staging_response', side_effect=[live, ready]):
            promotion.verify_staging('0.9.0', SHA)
        with patch.object(promotion, 'staging_response', return_value={**live, 'commit': 'b' * 40}):
            with self.assertRaisesRegex(ValueError, 'different candidate'):
                promotion.verify_staging('0.9.0', SHA)
        for changed in ({'status': 'degraded'}, {'warnings': ['redis-unavailable']}, {'checks': {}},
                        {'checks': {**checks, 'objectStorage': {'status': 'degraded'}}}):
            with self.subTest(changed=changed), patch.object(
                promotion, 'staging_response', side_effect=[live, {**ready, **changed}]
            ):
                with self.assertRaisesRegex(ValueError, 'must be healthy'):
                    promotion.verify_staging('0.9.0', SHA)
        for revision in (None, 'b' * 40):
            with self.subTest(revision=revision), patch.object(
                promotion, 'staging_response', side_effect=[live, {**ready, 'commit': revision}]
            ):
                with self.assertRaisesRegex(ValueError, 'API is serving a different candidate'):
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

    def test_dast_requires_exact_candidate_complete_probes_and_no_high_findings(self):
        scanner = promotion.runpy.run_path(str(promotion.ROOT / 'deploy/staging/authenticated-dast.py'))
        probes = [
            {'probe': name, 'status': status} for name, status in (
                ('anonymous_session', 401), ('authenticated_session', 200), ('profiles', 200),
                ('electricity_orders', 200), ('unknown_order', 404), ('saving_orders', 200),
                ('solar_requests', 200), ('consultation_requests', 200),
            )
        ]
        findings = [{'rule': '10035', 'risk': 'Low', 'count': 7}]
        valid = {'commit': SHA, 'version': '0.9.0', 'origin': promotion.STAGING,
                 'image': scanner['IMAGE'], 'scanner': '2.17.0',
                 'mode': 'passive_with_authenticated_probes', 'probes': probes, 'findings': findings}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'authenticated-dast.json'

            def report(data):
                payload = json.dumps(data).encode()
                path.write_bytes(payload)
                return hashlib.sha256(payload).hexdigest()

            verified = promotion.verify_dast_receipt(path, report(valid), '0.9.0', SHA)
            self.assertEqual(verified['probes'], {row['probe']: row['status'] for row in probes})
            self.assertEqual(verified['findings'], findings)
            for change, diagnostic in (
                ({'commit': 'b' * 40}, 'staged candidate'),
                ({'version': '0.6.0'}, 'staged candidate'),
                ({'origin': 'https://wrong.example.test'}, 'staged candidate'),
                ({'image': 'latest'}, 'pinned scanner'),
                ({'mode': 'passive'}, 'pinned scanner'),
                ({'probes': probes[:-1]}, 'probe outcome'),
                ({'probes': [*probes[:-1], probes[0]]}, 'probe outcome'),
                ({'probes': [{**probes[0], 'status': 200}, *probes[1:]]}, 'probe outcome'),
                ({'findings': [{**findings[0], 'count': True}]}, 'invalid findings'),
                ({'findings': findings * 2}, 'invalid findings'),
                ({'findings': [{**findings[0], 'risk': 'High'}]}, 'high-severity findings'),
            ):
                with self.subTest(change=change), self.assertRaisesRegex(ValueError, diagnostic):
                    promotion.verify_dast_receipt(path, report({**valid, **change}), '0.9.0', SHA)
            with self.assertRaisesRegex(ValueError, 'changed after indexing'):
                promotion.verify_dast_receipt(path, '0' * 64, '0.9.0', SHA)


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
        baseline = {'version': 1, 'reference_time': '2026-11-09T02:05:00Z',
                    'captured_at': '2026-11-09T02:06:00Z', 'tables': deepcopy(report['tables'])}
        report['baseline_sha256'] = hashlib.sha256(json.dumps(baseline).encode()).hexdigest()
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
            'source_baseline': baseline,
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

    def test_migration_checkpoint_matches_the_deployed_release_and_separate_rehearsal(self):
        manifest = {**self.backup()['backup_manifest'],
                    'label': f'release-{SHA[:12]}-20261112T065800Z-123'}
        queue = runpy.run_path(str(promotion.ROOT / 'deploy/staging/release-queue.py'))
        marker = 'BARGHSA_STAGING_MIGRATION_BACKUP_V1 '
        checkpoint = queue['verify_migration_backup'](
            marker + json.dumps({**manifest, 'upload_verified': True}), SHA)
        job = {'completed_at': '2026-11-12T08:00:00Z',
               'runtime_images': {'commit': SHA, 'migration_backup': checkpoint}}
        evidence = self.root / 'rehearsal.log'
        evidence.write_text('Controlled migration, seed and rollback test fixture\n')
        rehearsal = {'candidate_sha': SHA, 'scope': 'migration_and_rollback', 'strategy': 'rollback',
                     'evidence': evidence.name, 'evidence_sha256': promotion.file_digest(evidence)}
        bundle = {'checkpoint_manifest': manifest, 'migration_rehearsal': rehearsal}

        def check(receipts, release=job):
            return promotion.verify_migration_receipts(
                self.index, self.bundle, self.write_bundle(receipts), release, SHA)

        verified = check(bundle)
        self.assertEqual(verified['checkpoint'], manifest['label'])
        self.assertEqual(verified['strategy'], 'rollback')
        self.assertEqual(verified['sha256']['rehearsal_evidence'], promotion.file_digest(evidence))
        for runtime in ({}, {'commit': 'd' * 40, 'migration_backup': checkpoint},
                        {'commit': SHA, 'migration_backup': {'status': 'disposable'}},
                        {'commit': SHA, 'migration_backup': {**checkpoint, 'system_id': '123'}}):
            with self.subTest(runtime=runtime), self.assertRaisesRegex(ValueError, 'off-server manifest'):
                check(bundle, {**job, 'runtime_images': runtime})
        for changed in ({'size': True}, {'sha256': '0' * 64}, {'blob': 'other'},
                        {'label': f'release-{"d" * 12}-20261112T065800Z-123'}):
            with self.subTest(changed=changed), self.assertRaisesRegex(ValueError, 'off-server manifest'):
                check({**bundle, 'checkpoint_manifest': {**manifest, **changed}})
        with self.assertRaisesRegex(ValueError, 'checkpoint timing'):
            check(bundle, {**job, 'completed_at': '2026-11-12T06:00:00Z'})
        with self.assertRaisesRegex(ValueError, 'identify the candidate and strategy'):
            check({**bundle, 'migration_rehearsal': {**rehearsal, 'strategy': 'unverified'}})
        evidence.write_text('Different rehearsal bytes\n')
        with self.assertRaisesRegex(ValueError, 'evidence is missing or changed'):
            check(bundle)
        reused = {**rehearsal, 'evidence': 'checkpoint_manifest.json',
                  'evidence_sha256': hashlib.sha256(json.dumps(manifest).encode()).hexdigest()}
        with self.assertRaisesRegex(ValueError, 'evidence is missing or changed'):
            check({**bundle, 'migration_rehearsal': reused})

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

    def test_requires_exact_source_baseline_and_recomputes_measured_rpo(self):
        scenarios = (
            ('restore_report', 'baseline_sha256', '0' * 64, 'independent source baseline'),
            ('source_baseline', 'tables', {name: {'count': 2, 'sha256': 'e' * 64}
                                            for name in ('users', 'orders', 'invoices')}, 'independent source baseline'),
            ('source_baseline', 'captured_at', '2026-11-09T03:01:00Z', 'recovery window'),
            ('source_baseline', 'reference_time', '2026-11-09T02:05:00.000001Z', 'measured recovery point'),
            ('restore_report', 'rpo_seconds', 0, 'measured recovery point'),
            ('restore_report', 'replayed_transaction_time', '2026-11-09T03:56:00Z', 'recovery window'),
        )
        for artifact, field, value, message in scenarios:
            with self.subTest(artifact=artifact, field=field):
                entries = self.backup()
                entries[artifact][field] = value
                report = entries['restore_report']
                if artifact == 'source_baseline':
                    report['baseline_sha256'] = hashlib.sha256(json.dumps(entries[artifact]).encode()).hexdigest()
                entries['core_service_report']['database_restore_sha256'] = hashlib.sha256(
                    json.dumps(report).encode()
                ).hexdigest()
                fingerprint = self.write_bundle(entries)
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

    def test_embedded_queue_receipts_must_match_the_protected_receipts(self):
        entries = self.release()
        entries['deployment']['telegram'] = {key: deepcopy(entries[key]) for key in ('summary', 'album')}
        self.assertEqual(self.verify_release(entries)['summary_message_id'], 100)
        entries['summary']['message_id'] = 104
        with self.assertRaisesRegex(ValueError, 'differ from the completed staging job'):
            self.verify_release(entries)


if __name__ == '__main__':
    unittest.main()

