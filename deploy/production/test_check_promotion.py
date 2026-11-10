from contextlib import redirect_stderr
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
            self.assertEqual(
                promotion.index_receipts(index, SHA),
                dict.fromkeys(receipts, hashlib.sha256(evidence).hexdigest()),
            )
            for path in ('missing', '../outside', 'link'):
                index.write_text(json.dumps({
                    **data, 'receipts': {**receipts, 'authenticated_dast': path},
                }))
                with self.assertRaisesRegex(ValueError, 'invalid receipt'):
                    promotion.index_receipts(index, SHA)


if __name__ == '__main__':
    unittest.main()

